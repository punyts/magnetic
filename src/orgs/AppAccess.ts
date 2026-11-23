import { copyAppParts } from '@punyts/stateui-mcp';
import { PgPartRepository, txWorkspaceDb } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';
import type { FunctionEntry } from '@punyts/stateui-app/core';
import { atLeast, audit, OrgError } from './Orgs.js';
import type { OrgRole } from './Orgs.js';
import type { StateChanges } from '../statenet/StateNamespaces.js';
import { appPattern, groupSubject, membersSubject, ownerSubject, Permissions, type Permission, type Right } from '../permissions/Permissions.js';

export const APP_PERMISSIONS = ['view', 'use', 'edit', 'manage'] as const;
export type AppPermission = (typeof APP_PERMISSIONS)[number];

const RANK: Record<AppPermission, number> = { view: 0, use: 1, edit: 2, manage: 3 };

export function isAppPermission(value: unknown): value is AppPermission {
    return typeof value === 'string' && (APP_PERMISSIONS as readonly string[]).includes(value);
}

/** True when `permission` reaches at least `least` */
export function allows(permission: AppPermission | undefined, least: AppPermission): boolean {
    return permission !== undefined && RANK[permission] >= RANK[least];
}

function highest(permissions: Iterable<AppPermission | undefined>): AppPermission | undefined {
    let best: AppPermission | undefined;
    for (const permission of permissions) if (permission !== undefined && (best === undefined || RANK[permission] > RANK[best])) best = permission;
    return best;
}

/** Where an app lives for a person, and what they may do with it there */
export interface AppPlace {
    readonly workspaceId: string;
    /** The org whose workspace it is; absent for the person's own */
    readonly orgId?: string;
    readonly permission: AppPermission;
}

/** One entry of an app's access list */
export interface AccessEntry {
    readonly principalKind: 'user' | 'group';
    readonly principalId: string;
    readonly permission: AppPermission;
}

/** The kinds of entry that give access to an app of an org, as AppAccess reads them */
const APP_KINDS = ['access.view', 'access.use', 'access.edit', 'access.manage', 'open', 'creator', 'admins'];

/** What an entry gives on an app: `manage` with `share`, `edit` with `write`, else `view` for a view entry and `use` */
function levelOf(entry: Permission): AppPermission {
    if (entry.rights.includes('share')) return 'manage';
    if (entry.rights.includes('write')) return 'edit';
    return entry.kind === 'access.view' ? 'view' : 'use';
}

const RIGHTS_OF: Record<AppPermission, Right[]> = { view: ['read'], use: ['read'], edit: ['read', 'write'], manage: ['read', 'write', 'share'] };

/**
 * Who may do what with each app of an org, and where an app is, read from the permission table
 * (docs/design/statenet-permissions.md, "Today's mechanisms as entries"). In a person's own workspace they manage
 * everything. In an org's: owners and admins hold its whole tree (`admins`), whoever made an app manages it
 * (`creator`), and anyone else has the highest of the entries that reach them on the app: their own, their groups',
 * and `use` when the app is open to the org (`open`). Every route, tool and socket asks here
 */
export class AppAccess {
    private readonly permissions: Permissions;

    constructor(private readonly db: Database) {
        this.permissions = new Permissions(db);
    }

    /** What a person may do with an app of a workspace; `undefined` for nothing */
    async permission(userId: string, workspaceId: string, appId: string): Promise<AppPermission | undefined> {
        if (workspaceId === userId) return 'manage';
        const org = (
            await this.db.query<{ number: string; role: OrgRole | null }>(
                "SELECT o.owner_number::text AS number, m.role FROM workspace w JOIN org o ON o.id = w.org_id LEFT JOIN org_member m ON m.org_id = w.org_id AND m.user_id = $1 WHERE w.id = $2 AND w.kind = 'org'",
                [userId, workspaceId]
            )
        ).rows[0];
        if (org === undefined || org.role === null) return undefined;
        const holder = await this.permissions.holder(userId);
        if (holder === undefined) return undefined;
        const entries = (await this.permissions.holding(holder, org.number, appPattern(appId))).filter((entry) => APP_KINDS.includes(entry.kind));
        return highest(entries.map(levelOf));
    }

    /** The workspaces a person can reach apps in: their own first, then their orgs' */
    async workspacesOf(userId: string): Promise<Array<{ readonly workspaceId: string; readonly orgId?: string; readonly role?: OrgRole }>> {
        const orgs = (
            await this.db.query<{ id: string; org_id: string; role: OrgRole }>(
                "SELECT w.id, w.org_id, m.role FROM workspace w JOIN org_member m ON m.org_id = w.org_id AND m.user_id = $1 WHERE w.kind = 'org' ORDER BY w.created_at",
                [userId]
            )
        ).rows;
        return [{ workspaceId: userId }, ...orgs.map((row) => ({ workspaceId: row.id, orgId: row.org_id, role: row.role }))];
    }

    /**
     * Where an app is for a person, and their permission there: their own workspace first, then their orgs'. An app they
     * may not even view is `undefined`, as if it did not exist
     */
    async locate(userId: string, appId: string): Promise<AppPlace | undefined> {
        const places = await this.workspacesOf(userId);
        const ids = places.map((place) => place.workspaceId);
        const found = await this.db.transaction(
            async (tx) =>
                (await tx.query<{ workspace_id: string }>("SELECT workspace_id FROM part WHERE kind = 'apps' AND id = $1 AND workspace_id = ANY($2::uuid[])", [appId.toLowerCase(), ids])).rows.map(
                    (row) => row.workspace_id
                ),
            { workspaceIds: ids }
        );
        for (const place of places) {
            if (!found.includes(place.workspaceId)) continue;
            const permission = await this.permission(userId, place.workspaceId, appId.toLowerCase());
            if (permission !== undefined) return { workspaceId: place.workspaceId, ...(place.orgId !== undefined && { orgId: place.orgId }), permission };
        }
        return undefined;
    }

    /** The apps of an org's workspace a person may at least view, with their permission, by app id */
    async visibleApps(userId: string, workspaceId: string): Promise<Map<string, AppPermission>> {
        const apps = await this.db.transaction(
            async (tx) => (await tx.query<{ id: string }>("SELECT id FROM part WHERE workspace_id = $1 AND kind = 'apps'", [workspaceId])).rows.map((row) => row.id),
            { workspaceIds: [workspaceId] }
        );
        const visible = new Map<string, AppPermission>();
        for (const appId of apps) {
            const permission = await this.permission(userId, workspaceId, appId);
            if (permission !== undefined) visible.set(appId, permission);
        }
        return visible;
    }

    /** An app's access list and whether it is open to the org; for people who manage it */
    async list(actorId: string, workspaceId: string, appId: string): Promise<{ readonly openToOrg: boolean; readonly entries: readonly AccessEntry[] }> {
        if (!allows(await this.permission(actorId, workspaceId, appId), 'manage')) throw new OrgError(403, 'Only people who manage the app can see who has it.');
        const org = await this.orgOf(this.db, workspaceId);
        const live = org === undefined ? [] : await this.permissions.find("p.owner = $1::numeric AND p.pattern = $2 AND p.revoked_at IS NULL AND (p.kind LIKE 'access.%' OR p.kind = 'open')", [org.number, appPattern(appId)]);
        const users = new Map(
            (await this.db.query<{ number: string; id: string }>('SELECT owner_number::text AS number, id::text FROM app_user WHERE owner_number::text = ANY($1::text[])', [live.map((entry) => entry.subject.slice('owner:'.length))])).rows.map(
                (row) => [row.number, row.id] as const
            )
        );
        const entries: AccessEntry[] = [];
        for (const entry of live) {
            if (!entry.kind.startsWith('access.')) continue;
            const permission = entry.kind.slice('access.'.length) as AppPermission;
            if (entry.subject.startsWith('owner:')) {
                const id = users.get(entry.subject.slice('owner:'.length));
                if (id !== undefined) entries.push({ principalKind: 'user', principalId: id, permission });
            } else if (entry.subject.startsWith('group:')) {
                entries.push({ principalKind: 'group', principalId: entry.subject.slice(entry.subject.indexOf('.') + 1), permission });
            }
        }
        entries.sort((a, b) => a.principalKind.localeCompare(b.principalKind) || a.principalId.localeCompare(b.principalId));
        return { openToOrg: live.some((entry) => entry.kind === 'open'), entries };
    }

    /** Gives a member or a group a permission on an org app, or takes it away (`undefined`); for people who manage it */
    async set(actorId: string, workspaceId: string, appId: string, principal: { readonly kind: 'user' | 'group'; readonly id: string }, permission: AppPermission | undefined): Promise<void> {
        await this.db.transaction(async (tx) => {
            const org = await this.manageable(tx, actorId, workspaceId, appId);
            let subject: string | undefined;
            if (principal.kind === 'user') {
                const number = (await tx.query<{ number: string }>('SELECT u.owner_number::text AS number FROM org_member m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id::text = $2', [org.id, principal.id])).rows[0]?.number;
                subject = number === undefined ? undefined : ownerSubject(number);
            } else if ((await tx.query("SELECT 1 FROM org_group WHERE org_id = $1 AND id::text = $2", [org.id, principal.id])).rows.length > 0) {
                subject = groupSubject(org.number, principal.id);
            }
            if (subject === undefined) throw new OrgError(404, principal.kind === 'user' ? 'That person is not in the org.' : 'The org has no such group.');
            await this.permissions.revokeWhere("p.owner = $1::numeric AND p.pattern = $2 AND p.subject = $3 AND p.kind LIKE 'access.%'", [org.number, appPattern(appId), subject], actorId, tx);
            if (permission !== undefined) {
                await this.permissions.make({ owner: org.number, pattern: appPattern(appId), subject, rights: RIGHTS_OF[permission], kind: `access.${permission}`, madeBy: actorId }, tx);
            }
            await audit(tx, {
                orgId: org.id,
                workspaceId,
                actorId,
                action: permission === undefined ? 'access.removed' : 'access.set',
                targetKind: 'app',
                targetId: appId,
                detail: { principal, permission: permission ?? null }
            });
        });
    }

    /** Opens an org app to every member (`use`), or closes it again; for people who manage it */
    async setOpenToOrg(actorId: string, workspaceId: string, appId: string, open: boolean): Promise<void> {
        await this.db.transaction(async (tx) => {
            const org = await this.manageable(tx, actorId, workspaceId, appId);
            await this.permissions.revokeWhere("p.owner = $1::numeric AND p.pattern = $2 AND p.kind = 'open'", [org.number, appPattern(appId)], actorId, tx);
            if (open) await this.permissions.make({ owner: org.number, pattern: appPattern(appId), subject: membersSubject(org.number), rights: ['read'], kind: 'open', madeBy: actorId }, tx);
            await audit(tx, { orgId: org.id, workspaceId, actorId, action: 'access.open_to_org', targetKind: 'app', targetId: appId, detail: { open } });
        });
    }

    /** Records who made an app in an org workspace: they manage it */
    async recordCreated(userId: string, workspaceId: string, appId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const org = await this.orgOf(tx, workspaceId);
            if (org === undefined) return;
            await recordCreator(this.permissions, tx, org.number, userId, appId);
            await audit(tx, { orgId: org.id, workspaceId, actorId: userId, action: 'app.created', targetKind: 'app', targetId: appId });
        });
    }

    /** The org of an org workspace, with its number */
    private async orgOf(tx: Queryable, workspaceId: string): Promise<{ id: string; number: string } | undefined> {
        return (await tx.query<{ id: string; number: string }>("SELECT o.id::text, o.owner_number::text AS number FROM workspace w JOIN org o ON o.id = w.org_id WHERE w.id::text = $1 AND w.kind = 'org'", [workspaceId])).rows[0];
    }

    /** The org of an org workspace, when the actor manages the app there; refuses otherwise */
    private async manageable(tx: Queryable, actorId: string, workspaceId: string, appId: string): Promise<{ id: string; number: string }> {
        const org = await this.orgOf(tx, workspaceId);
        if (org === undefined) throw new OrgError(400, 'Access lists are for the apps of an org.');
        if (!allows(await this.permission(actorId, workspaceId, appId), 'manage')) throw new OrgError(403, 'Only people who manage the app can change who has it.');
        return org;
    }
}

/** Gives whoever made an app in an org its management, once */
async function recordCreator(permissions: Permissions, tx: Queryable, orgNumber: string, userId: string, appId: string): Promise<void> {
    const number = (await tx.query<{ number: string }>('SELECT owner_number::text AS number FROM app_user WHERE id::text = $1', [userId])).rows[0]?.number;
    if (number === undefined) return;
    const subject = ownerSubject(number);
    const held = await permissions.find("p.owner = $1::numeric AND p.pattern = $2 AND p.subject = $3 AND p.kind = 'creator' AND p.revoked_at IS NULL", [orgNumber, appPattern(appId), subject], tx);
    if (held.length === 0) await permissions.make({ owner: orgNumber, pattern: appPattern(appId), subject, rights: ['read', 'write', 'share'], kind: 'creator', madeBy: userId }, tx);
}

/** What a move did */
export interface MovedApp {
    readonly appId: string;
    /** The app's name in the org, which gets `-2`, `-3`… when the org has an app of its name */
    readonly name: string;
    /** The parts copied into the org besides the app, with the names they had before when they got new ones */
    readonly parts: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly from?: string }>;
    /** The function paths the app and its parts name that the server does not run, so the person sees them before using it */
    readonly missingFunctions: readonly string[];
}

/**
 * Moves an app from a person's own workspace into an org's, in one transaction: the app keeps its id (so its URLs and
 * links keep working), the parts it reaches are copied into the org (the personal workspace keeps its copies, so its
 * other apps keep working), and its instances, persona records, files with their bytes, preview errors, chats and links
 * go with it. The owner's own instance becomes their instance as a member (persona = their user id). The person who
 * moved it manages it in the org, and nobody else has it until they give access. The person must be a builder or
 * above in the org
 */
export async function moveAppToOrg(
    db: Database,
    state: StateChanges,
    input: { readonly userId: string; readonly appId: string; readonly orgId: string; readonly functions: readonly FunctionEntry[] }
): Promise<MovedApp> {
    const personal = input.userId.toLowerCase();
    const appId = input.appId.toLowerCase();
    const org = (
        await db.query<{ id: string; role: OrgRole | null }>(
            "SELECT w.id, m.role FROM workspace w LEFT JOIN org_member m ON m.org_id = w.org_id AND m.user_id = $2 WHERE w.org_id = $1 AND w.kind = 'org'",
            [input.orgId, personal]
        )
    ).rows[0];
    if (org === undefined || org.role === null) throw new OrgError(404, 'No such org.');
    if (!atLeast(org.role, 'builder')) throw new OrgError(403, 'Only builders and above can bring apps into the org.');
    const target = org.id;
    const { moved, addresses } = await db.transaction(
        async (tx) => {
            const from = new PgPartRepository(txWorkspaceDb(tx, personal));
            const to = new PgPartRepository(txWorkspaceDb(tx, target));
            const app = await from.findById('apps', appId);
            if (app === undefined) throw new OrgError(404, 'You have no app with this id.');
            const copied = await copyAppParts(from, to, appId, { keepId: true, functions: input.functions });
            if (copied.kind !== 'copied') throw new OrgError(409, copied.kind === 'failed' ? copied.reason : 'The app could not be moved.');
            await tx.query("DELETE FROM part WHERE workspace_id = $1 AND kind = 'apps' AND id = $2", [personal, appId]);
            // People's state of the app keeps its addresses: the mover's own was already at their number (the personal
            // workspace's default persona), which is their persona in the org. The aggregate moves it after this commits
            const stateAddresses = (
                await tx.query<{ address: string }>("SELECT address FROM namespace_head WHERE workspace_id = $1 AND split_part(address, '/', 3) = $2 AND split_part(address, '/', 2) = 'apps'", [personal, appId.toLowerCase()])
            ).rows.map((row) => row.address);
            for (const table of ['app_file', 'app_file_content', 'preview_error']) {
                await tx.query(`UPDATE ${table} SET workspace_id = $2 WHERE workspace_id = $1 AND app_id = $3`, [personal, target, appId]);
            }
            await tx.query('UPDATE chat_entry SET workspace_id = $2 WHERE workspace_id = $1 AND app_id = $3', [personal, target, appId]);
            // The app's links, and the entries of the people who opened them, move to the org's tree
            const permissions = new Permissions(db);
            const [fromNumber, into] = [await permissions.numberOf(personal, tx), await permissions.numberOf(input.orgId, tx)];
            if (fromNumber === undefined || into === undefined) throw new OrgError(404, 'No such org.');
            await tx.query("UPDATE permission SET owner = $2::numeric WHERE owner = $1::numeric AND pattern = $3 AND kind IN ('link.view', 'link.use', 'link.remix', 'opened')", [fromNumber, into, appPattern(appId)]);
            await recordCreator(permissions, tx, into, personal, appId);
            await audit(tx, {
                orgId: input.orgId,
                workspaceId: target,
                actorId: personal,
                action: 'app.moved_in',
                targetKind: 'app',
                targetId: appId,
                detail: { name: copied.app.name, from: app.name, parts: copied.parts, missingFunctions: copied.missingFunctions ?? [] }
            });
            return { moved: { appId, name: copied.app.name, parts: copied.parts, missingFunctions: copied.missingFunctions ?? [] }, addresses: stateAddresses };
        },
        { workspaceIds: [personal, target] }
    );
    for (const address of addresses) await state.move(address, personal, target);
    return moved;
}
