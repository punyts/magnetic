import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

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

/** Whether a grant shows the app (`view` or `use`); a remix link gives only a copy */
function shows(grant: Grant): grant is Grant & { readonly right: 'view' | 'use' } {
    return grant.right === 'view' || grant.right === 'use';
}

interface GrantRow {
    id: string;
    token: string;
    workspace_id: string;
    app_id: string;
    app_name: string;
    right: GrantRight;
    created_at: Date;
    revoked_at: Date | null;
    members: Record<string, string> | null;
}

const SELECT = `SELECT g.id, g.token, g.workspace_id, g.app_id, g.app_name, g."right", g.created_at, g.revoked_at,
    (SELECT json_object_agg(m.user_id, to_char(m.first_opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       FROM link_grant_member m WHERE m.grant_id = g.id) AS members
  FROM link_grant g`;

function grantOf(row: GrantRow): Grant {
    return {
        id: row.id,
        token: row.token,
        ownerId: row.workspace_id,
        appId: row.app_id,
        appName: row.app_name,
        right: row.right,
        createdAt: row.created_at.toISOString(),
        ...(row.revoked_at !== null && { revokedAt: row.revoked_at.toISOString() }),
        members: row.members ?? {}
    };
}

/**
 * The share links of every app (`link_grant`, `link_grant_member`). A revoked grant is kept, so the people who opened
 * it can be told, and their browsers can delete what they kept of the app, when they come back. `ownerId` is the
 * workspace the app lives in
 */
export class Grants {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    private async find(where: string, params: readonly unknown[]): Promise<Grant[]> {
        return (await this.db.query<GrantRow>(`${SELECT} WHERE ${where}`, params)).rows.map(grantOf);
    }

    /** A new link to the app */
    async create(ownerId: string, app: { readonly id: string; readonly name: string }, right: GrantRight, createdBy?: string): Promise<Grant> {
        const grant: Grant = { id: randomUUID(), token: randomBytes(24).toString('base64url'), ownerId, appId: app.id, appName: app.name, right, createdAt: this.now().toISOString(), members: {} };
        await this.db.query('INSERT INTO link_grant (id, token, workspace_id, app_id, app_name, "right", created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
            grant.id,
            grant.token,
            ownerId,
            app.id,
            app.name,
            right,
            createdBy ?? null,
            grant.createdAt
        ]);
        return grant;
    }

    /** The grant of a link's token, revoked or not; `undefined` for a token that is malformed or unknown */
    async byToken(token: string): Promise<Grant | undefined> {
        if (!TOKEN.test(token)) return undefined;
        return (await this.find('g.token = $1', [token]))[0];
    }

    /** The links of one of the owner's apps, the newest first, revoked ones included */
    async forApp(ownerId: string, appId: string): Promise<Grant[]> {
        return this.find('g.workspace_id = $1 AND g.app_id = $2 ORDER BY g.created_at DESC, g.id', [ownerId, appId]);
    }

    /**
     * Records that a person opened a live link; the owner is never a member of their own app. A first opening forgets
     * that they rejected the app, which then waits on their Your apps again (`ShareAnswers`)
     */
    async join(grantId: string, userId: string): Promise<Grant | undefined> {
        await this.db.query(
            `WITH joined AS (
                INSERT INTO link_grant_member (grant_id, user_id, first_opened_at)
                SELECT id, $2, $3 FROM link_grant WHERE id = $1 AND revoked_at IS NULL AND workspace_id <> $2
                ON CONFLICT DO NOTHING
                RETURNING grant_id
             )
             DELETE FROM share_answer a USING joined j, link_grant g
              WHERE g.id = j.grant_id AND a.user_id = $2 AND a.app_id = g.app_id::text AND a.answer = 'rejected'`,
            [grantId, userId, this.now()]
        );
        return (await this.find('g.id = $1', [grantId]))[0];
    }

    /** Revokes one of the owner's links; `undefined` when the owner has no such link */
    async revoke(ownerId: string, grantId: string): Promise<Grant | undefined> {
        await this.db.query('UPDATE link_grant SET revoked_at = $3 WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL', [grantId, ownerId, this.now()]);
        return (await this.find('g.id = $1 AND g.workspace_id = $2', [grantId, ownerId]))[0];
    }

    /** Revokes every live link of one of the owner's apps (it was deleted); answers those links */
    async revokeApp(ownerId: string, appId: string): Promise<Grant[]> {
        const ids = (await this.db.query<{ id: string }>('UPDATE link_grant SET revoked_at = $3 WHERE workspace_id = $1 AND app_id = $2 AND revoked_at IS NULL RETURNING id', [ownerId, appId, this.now()])).rows.map((row) => row.id);
        return ids.length === 0 ? [] : this.find('g.id = ANY($1::uuid[]) ORDER BY g.created_at, g.id', [ids]);
    }

    /**
     * What a person may do with an app that is not theirs: `use` before `view` among the live links they opened; else
     * a revoked one they had opened, so their browser can be told; else nothing
     */
    async access(appId: string, userId: string): Promise<SharedAccess | undefined> {
        const opened = (
            await this.find(`g.app_id = $1 AND g."right" IN ('use', 'view') AND EXISTS (SELECT 1 FROM link_grant_member m WHERE m.grant_id = g.id AND m.user_id = $2) ORDER BY g.created_at, g.id`, [appId, userId])
        ).filter(shows);
        const live = opened.filter((grant) => grant.revokedAt === undefined);
        const best = live.find((grant) => grant.right === 'use') ?? live[0];
        if (best !== undefined) return best.right === 'view' && opened.some((grant) => grant.right === 'use' && grant.revokedAt !== undefined) ? { live: best, usedBefore: true } : { live: best };
        const revoked = opened.sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))[0];
        return revoked === undefined ? undefined : { revoked };
    }

    /** The apps shared with a person through live links they opened, one entry per app (`use` before `view`) */
    async sharedWith(userId: string): Promise<Grant[]> {
        const byApp = new Map<string, Grant>();
        const opened = await this.find(`g.revoked_at IS NULL AND g."right" IN ('use', 'view') AND EXISTS (SELECT 1 FROM link_grant_member m WHERE m.grant_id = g.id AND m.user_id = $1) ORDER BY g.created_at, g.id`, [userId]);
        for (const grant of opened) {
            const known = byApp.get(grant.appId);
            if (known === undefined || (known.right === 'view' && grant.right === 'use')) byApp.set(grant.appId, grant);
        }
        return [...byApp.values()].sort((a, b) => a.appName.localeCompare(b.appName));
    }
}
