import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';
import { appPattern, linkSubject, ownerSubject, PERMISSION_COLUMNS, permissionOf, Permissions, type PermissionRow } from '../permissions/Permissions.js';

/**
 * What a share link gives the person who opens it:
 * - `view`: the owner's app, live and read only;
 * - `use`: their own instance of the app, so they can type into it and keep their own data;
 * - `remix`: a copy of the app in their own workspace, theirs to change
 */
export type GrantRight = 'view' | 'use' | 'remix';

export const GRANT_RIGHTS: readonly GrantRight[] = ['use', 'view', 'remix'];

/** A right on one app given to anyone with the link. Signing in is still needed, so every visit has a user behind it */
export interface Grant {
    readonly id: string;
    /** The random token in the link, 24 bytes in base64url */
    readonly token: string;
    readonly ownerId: string;
    readonly appId: string;
    /** The app's name when the link was made, for the pages of people who open it */
    readonly appName: string;
    readonly right: GrantRight;
    readonly createdAt: string;
    readonly revokedAt?: string;
    /** The people who opened the link, by user id, with when they first did */
    readonly members: Readonly<Record<string, string>>;
}

/** What a person may do with an app that is not theirs, through the links they opened */
export type SharedAccess =
    /** `usedBefore`: a live `view` of a person whose `use` link of the app was revoked, so their browser deletes what it kept of their own instance */
    | { readonly live: Grant & { readonly right: 'view' | 'use' }; readonly usedBefore?: true }
    | { readonly revoked: Grant & { readonly right: 'view' | 'use' } };

const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const LINK_KINDS = ['link.view', 'link.use', 'link.remix'];

/** Whether a grant shows the app (`view` or `use`); a remix link gives only a copy */
function shows(grant: Grant): grant is Grant & { readonly right: 'view' | 'use' } {
    return grant.right === 'view' || grant.right === 'use';
}

interface LinkRow extends PermissionRow {
    workspace_id: string;
    members: Record<string, string> | null;
}

/** A link's entry with the workspace it is in and the people who opened it (who did not take it off their apps) */
const SELECT = `SELECT ${PERMISSION_COLUMNS}, coalesce(n.workspace_id, n.id)::text AS workspace_id,
    (SELECT json_object_agg(c.made_by, to_char(c.first AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       FROM (SELECT o.made_by, min(o.created_at) AS first FROM permission o
              WHERE o.parent = p.id AND o.kind = 'opened' AND o.made_by IS NOT NULL AND o.revoked_by IS DISTINCT FROM o.made_by GROUP BY o.made_by) c) AS members
  FROM permission p JOIN statenet_owner n ON n.number = p.owner`;

function grantOf(row: LinkRow): Grant {
    const entry = permissionOf(row);
    return {
        id: entry.id,
        token: entry.token ?? '',
        ownerId: row.workspace_id,
        appId: entry.pattern.slice('$.apps.'.length),
        appName: entry.label ?? '',
        right: entry.kind.slice('link.'.length) as GrantRight,
        createdAt: entry.createdAt,
        ...(entry.revokedAt !== undefined && { revokedAt: entry.revokedAt }),
        members: row.members ?? {}
    };
}

/**
 * The share links of every app, as entries of the permission table (docs/design/statenet-permissions.md, "Today's
 * mechanisms as entries"): a link is an entry whose subject is `link:<id>`, under the owner of the workspace the app
 * lives in, and opening it passes it on to the person who opened it (`opened`). Revoking a link revokes everyone who
 * opened it. A revoked entry is kept, so the people who opened it can be told, and their browsers can delete what they
 * kept of the app, when they come back. `ownerId` is the workspace the app lives in
 */
export class Grants {
    private readonly permissions: Permissions;

    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {
        this.permissions = new Permissions(db, now);
    }

    private async find(where: string, params: readonly unknown[]): Promise<Grant[]> {
        return (await this.db.query<LinkRow>(`${SELECT} WHERE p.kind IN ('link.view', 'link.use', 'link.remix') AND ${where}`, params)).rows.map(grantOf);
    }

    /** A new link to the app */
    async create(ownerId: string, app: { readonly id: string; readonly name: string }, right: GrantRight, createdBy?: string): Promise<Grant> {
        const owner = await this.permissions.numberOf(ownerId);
        if (owner === undefined) throw new Error(`No owner number is known for ${ownerId}`);
        const id = randomUUID();
        await this.permissions.make({ id, owner, pattern: appPattern(app.id), subject: linkSubject(id), rights: ['read'], kind: `link.${right}`, token: randomBytes(24).toString('base64url'), label: app.name, ...(createdBy !== undefined && { madeBy: createdBy }) });
        return (await this.find('p.id = $1', [id]))[0] as Grant;
    }

    /** The grant of a link's token, revoked or not; `undefined` for a token that is malformed or unknown */
    async byToken(token: string): Promise<Grant | undefined> {
        if (!TOKEN.test(token)) return undefined;
        return (await this.find('p.token = $1', [token]))[0];
    }

    /** The links of one of the owner's apps, the newest first, revoked ones included */
    async forApp(ownerId: string, appId: string): Promise<Grant[]> {
        return this.find('coalesce(n.workspace_id, n.id)::text = $1 AND p.pattern = $2 ORDER BY p.created_at DESC, p.id', [ownerId.toLowerCase(), appPattern(appId)]);
    }

    /**
     * Records that a person opened a live link: the link is passed on to them. The owner is never a member of their own
     * app. A first opening forgets that they rejected the app, which then waits on their Your apps again (`ShareAnswers`)
     */
    async join(grantId: string, userId: string): Promise<Grant | undefined> {
        await this.db.transaction(async (tx) => {
            const link = await this.permissions.get(grantId, tx);
            const number = (await tx.query<{ number: string }>('SELECT owner_number::text AS number FROM app_user WHERE id::text = $1', [userId])).rows[0]?.number;
            if (link === undefined || !LINK_KINDS.includes(link.kind) || link.revokedAt !== undefined || number === undefined || number === link.owner) return;
            const opened = await this.permissions.find("p.parent = $1 AND p.kind = 'opened' AND p.made_by::text = $2 AND p.revoked_at IS NULL", [grantId, userId], tx);
            if (opened.length > 0) return;
            await this.permissions.make({ owner: link.owner, pattern: link.pattern, subject: ownerSubject(number), rights: ['read'], kind: 'opened', parent: grantId, madeBy: userId }, tx);
            await tx.query("DELETE FROM share_answer WHERE user_id::text = $1 AND app_id = $2 AND answer = 'rejected'", [userId, link.pattern.slice('$.apps.'.length)]);
        });
        return (await this.find('p.id = $1', [grantId]))[0];
    }

    /** Revokes one of the owner's links, with everyone who opened it; `undefined` when the owner has no such link */
    async revoke(ownerId: string, grantId: string, by?: string): Promise<Grant | undefined> {
        const grant = (await this.find('p.id = $1 AND coalesce(n.workspace_id, n.id)::text = $2', [grantId, ownerId.toLowerCase()]))[0];
        if (grant === undefined) return undefined;
        await this.permissions.revoke(grantId, by ?? ownerId);
        return (await this.find('p.id = $1', [grantId]))[0];
    }

    /** Revokes every live link of one of the owner's apps (it was deleted); answers those links */
    async revokeApp(ownerId: string, appId: string): Promise<Grant[]> {
        const live = (await this.forApp(ownerId, appId)).filter((grant) => grant.revokedAt === undefined);
        for (const grant of live) await this.permissions.revoke(grant.id, ownerId);
        return live.length === 0 ? [] : this.find('p.id = ANY($1::uuid[]) ORDER BY p.created_at, p.id', [live.map((grant) => grant.id)]);
    }

    /**
     * What a person may do with an app that is not theirs: `use` before `view` among the live links they opened; else
     * a revoked one they had opened, so their browser can be told; else nothing. A link they took off their apps
     * themselves is neither
     */
    async access(appId: string, userId: string): Promise<SharedAccess | undefined> {
        const opened = await this.permissions.find(
            "p.kind = 'opened' AND p.pattern = $1 AND p.made_by::text = $2 AND p.revoked_by IS DISTINCT FROM p.made_by ORDER BY p.created_at, p.id",
            [appPattern(appId), userId]
        );
        const links = new Map((await this.find("p.id = ANY($1::uuid[]) AND p.kind IN ('link.view', 'link.use')", [opened.map((entry) => entry.parent)])).map((grant) => [grant.id, grant] as const));
        // each opening as the person holds it: revoked when it or its link was
        const held = opened.flatMap((entry): Array<Grant & { readonly right: 'view' | 'use' }> => {
            const link = entry.parent === undefined ? undefined : links.get(entry.parent);
            if (link === undefined || !shows(link)) return [];
            const revokedAt = entry.revokedAt ?? link.revokedAt;
            const { revokedAt: _ignored, ...rest } = link;
            return [revokedAt === undefined ? rest : { ...rest, revokedAt }];
        });
        const live = held.filter((grant) => grant.revokedAt === undefined);
        const best = live.find((grant) => grant.right === 'use') ?? live[0];
        if (best !== undefined) return best.right === 'view' && held.some((grant) => grant.right === 'use' && grant.revokedAt !== undefined) ? { live: best, usedBefore: true } : { live: best };
        const revoked = held.sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))[0];
        return revoked === undefined ? undefined : { revoked };
    }

    /** The apps shared with a person through live links they opened, one entry per app (`use` before `view`) */
    async sharedWith(userId: string): Promise<Grant[]> {
        const byApp = new Map<string, Grant>();
        const opened = await this.find(
            "p.revoked_at IS NULL AND p.kind IN ('link.view', 'link.use') AND EXISTS (SELECT 1 FROM permission o WHERE o.parent = p.id AND o.kind = 'opened' AND o.made_by::text = $1 AND o.revoked_at IS NULL) ORDER BY p.created_at, p.id",
            [userId]
        );
        for (const grant of opened) {
            const known = byApp.get(grant.appId);
            if (known === undefined || (known.right === 'view' && grant.right === 'use')) byApp.set(grant.appId, grant);
        }
        return [...byApp.values()].sort((a, b) => a.appName.localeCompare(b.appName));
    }
}
