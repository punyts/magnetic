import { copyAppParts } from '@punyts/stateui-mcp';
import { PgPartRepository, txWorkspaceDb } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';
import type { FunctionEntry } from '@punyts/stateui-app/core';
import { atLeast, audit, OrgError } from './Orgs.js';
import type { OrgRole } from './Orgs.js';

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

/**
 * Who may do what with each app (`app_access`, `app_setting`), and where an app is. In a person's own workspace they
 * manage everything. In an org's: owners and admins manage every app, whoever made an app manages it, and anyone else
 * has the highest of their own entries and their groups' entries on the app's access list, or `use` when the app is
 * open to the org. Every route, tool and socket asks here
 */
export class AppAccess {
    constructor(private readonly db: Database) {}

    /** What a person may do with an app of a workspace; `undefined` for nothing */
    async permission(userId: string, workspaceId: string, appId: string): Promise<AppPermission | undefined> {
        if (workspaceId === userId) return 'manage';
        const row = (
            await this.db.query<{ org_id: string; role: OrgRole | null; created_by: string | null; open_to_org: boolean | null; entries: AppPermission[] | null }>(
                `SELECT w.org_id, m.role, s.created_by, s.open_to_org,
                        (SELECT array_agg(a.permission) FROM app_access a
                          WHERE a.workspace_id = w.id AND a.app_id = $3
                            AND ((a.principal_kind = 'user' AND a.principal_id = $1)
                              OR (a.principal_kind = 'group' AND a.principal_id IN (SELECT gm.group_id FROM org_group_member gm WHERE gm.user_id = $1)))) AS entries
                   FROM workspace w
                   LEFT JOIN org_member m ON m.org_id = w.org_id AND m.user_id = $1
                   LEFT JOIN app_setting s ON s.workspace_id = w.id AND s.app_id = $3
                  WHERE w.id = $2 AND w.kind = 'org'`,
                [userId, workspaceId, appId]
            )
        ).rows[0];
        if (row === undefined || row.role === null) return undefined;
        if (atLeast(row.role, 'admin') || row.created_by === userId) return 'manage';
        return highest([...(row.entries ?? []), row.open_to_org === true ? 'use' : undefined]);
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
        const entries = (
            await this.db.query<{ principal_kind: 'user' | 'group'; principal_id: string; permission: AppPermission }>(
                'SELECT principal_kind, principal_id, permission FROM app_access WHERE workspace_id = $1 AND app_id = $2 ORDER BY principal_kind, principal_id',
                [workspaceId, appId]
            )
        ).rows.map((row) => ({ principalKind: row.principal_kind, principalId: row.principal_id, permission: row.permission }));
        const open = (await this.db.query<{ open_to_org: boolean }>('SELECT open_to_org FROM app_setting WHERE workspace_id = $1 AND app_id = $2', [workspaceId, appId])).rows[0]?.open_to_org === true;
        return { openToOrg: open, entries };
    }

    /** Gives a member or a group a permission on an org app, or takes it away (`undefined`); for people who manage it */
    async set(actorId: string, workspaceId: string, appId: string, principal: { readonly kind: 'user' | 'group'; readonly id: string }, permission: AppPermission | undefined): Promise<void> {
        await this.db.transaction(async (tx) => {
            const orgId = await this.manageable(tx, actorId, workspaceId, appId);
            const known =
                principal.kind === 'user'
                    ? (await tx.query('SELECT 1 FROM org_member WHERE org_id = $1 AND user_id = $2', [orgId, principal.id])).rows.length > 0
                    : (await tx.query('SELECT 1 FROM org_group WHERE org_id = $1 AND id = $2', [orgId, principal.id])).rows.length > 0;
            if (!known) throw new OrgError(404, principal.kind === 'user' ? 'That person is not in the org.' : 'The org has no such group.');
            if (permission === undefined) {
                await tx.query('DELETE FROM app_access WHERE workspace_id = $1 AND app_id = $2 AND principal_kind = $3 AND principal_id = $4', [workspaceId, appId, principal.kind, principal.id]);
            } else {
                await tx.query(
                    `INSERT INTO app_access (workspace_id, app_id, principal_kind, principal_id, permission, granted_by) VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (workspace_id, app_id, principal_kind, principal_id) DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by, granted_at = now()`,
                    [workspaceId, appId, principal.kind, principal.id, permission, actorId]
                );
            }
            await audit(tx, {
                orgId,
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
            const orgId = await this.manageable(tx, actorId, workspaceId, appId);
            await tx.query('INSERT INTO app_setting (workspace_id, app_id, open_to_org) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, app_id) DO UPDATE SET open_to_org = EXCLUDED.open_to_org', [
                workspaceId,
                appId,
                open
            ]);
            await audit(tx, { orgId, workspaceId, actorId, action: 'access.open_to_org', targetKind: 'app', targetId: appId, detail: { open } });
        });
    }

    /** Records who made an app in an org workspace: they manage it */
    async recordCreated(userId: string, workspaceId: string, appId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const org = (await tx.query<{ org_id: string }>("SELECT org_id FROM workspace WHERE id = $1 AND kind = 'org'", [workspaceId])).rows[0];
            if (org === undefined) return;
            await tx.query('INSERT INTO app_setting (workspace_id, app_id, created_by) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, app_id) DO NOTHING', [workspaceId, appId, userId]);
            await audit(tx, { orgId: org.org_id, workspaceId, actorId: userId, action: 'app.created', targetKind: 'app', targetId: appId });
        });
    }

    /** The org of an org workspace, when the actor manages the app there; refuses otherwise */
    private async manageable(tx: Queryable, actorId: string, workspaceId: string, appId: string): Promise<string> {
        const org = (await tx.query<{ org_id: string }>("SELECT org_id FROM workspace WHERE id = $1 AND kind = 'org'", [workspaceId])).rows[0];
        if (org === undefined) throw new OrgError(400, 'Access lists are for the apps of an org.');
        if (!allows(await this.permission(actorId, workspaceId, appId), 'manage')) throw new OrgError(403, 'Only people who manage the app can change who has it.');
        return org.org_id;
    }
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
    return db.transaction(
        async (tx) => {
            const from = new PgPartRepository(txWorkspaceDb(tx, personal));
            const to = new PgPartRepository(txWorkspaceDb(tx, target));
            const app = await from.findById('apps', appId);
            if (app === undefined) throw new OrgError(404, 'You have no app with this id.');
            const copied = await copyAppParts(from, to, appId, { keepId: true, functions: input.functions });
            if (copied.kind !== 'copied') throw new OrgError(409, copied.kind === 'failed' ? copied.reason : 'The app could not be moved.');
            await tx.query("DELETE FROM part WHERE workspace_id = $1 AND kind = 'apps' AND id = $2", [personal, appId]);
            // People's state of the app keeps its addresses: the mover's own was already at their id (the personal
            // workspace's default persona), which is their persona in the org
            for (const table of ['state_node', 'state_change', 'namespace_head']) {
                await tx.query(`UPDATE ${table} SET workspace_id = $2 WHERE workspace_id = $1 AND split_part(address, '/', 2) = $3 AND split_part(address, '/', 3) = 'user'`, [personal, target, appId.toLowerCase()]);
            }
            for (const table of ['app_file', 'app_file_content', 'preview_error']) {
                await tx.query(`UPDATE ${table} SET workspace_id = $2 WHERE workspace_id = $1 AND app_id = $3`, [personal, target, appId]);
            }
            await tx.query('UPDATE chat_entry SET workspace_id = $2 WHERE workspace_id = $1 AND app_id = $3', [personal, target, appId]);
            await tx.query('UPDATE link_grant SET workspace_id = $2 WHERE workspace_id = $1 AND app_id = $3', [personal, target, appId]);
            await tx.query('INSERT INTO app_setting (workspace_id, app_id, created_by) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, app_id) DO UPDATE SET created_by = EXCLUDED.created_by', [
                target,
                appId,
                personal
            ]);
            await audit(tx, {
                orgId: input.orgId,
                workspaceId: target,
                actorId: personal,
                action: 'app.moved_in',
                targetKind: 'app',
                targetId: appId,
                detail: { name: copied.app.name, from: app.name, parts: copied.parts, missingFunctions: copied.missingFunctions ?? [] }
            });
            return { appId, name: copied.app.name, parts: copied.parts, missingFunctions: copied.missingFunctions ?? [] };
        },
        { workspaceIds: [personal, target] }
    );
}
