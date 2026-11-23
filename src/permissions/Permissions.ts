import { randomUUID } from 'node:crypto';
import { patternContains, patternCovers, type PathPattern } from '@punyts/state';
import { grantPattern } from '@punyts/state-sync/authority';
import type { Database, Queryable } from '@punyts/stateui-pg';
import { ORG_ROLES, type OrgRole } from '../orgs/Orgs.js';

export const RIGHTS = ['read', 'request', 'write', 'share'] as const;
export type Right = (typeof RIGHTS)[number];

/** What an entry stands for in Magnetic's pages; the check never reads it */
export type PermissionKind =
    | 'access.view'
    | 'access.use'
    | 'access.edit'
    | 'access.manage'
    | 'open'
    | 'creator'
    | 'admins'
    | 'link.view'
    | 'link.use'
    | 'link.remix'
    | 'opened'
    | 'share'
    | 'passed'
    | 'org-read'
    | 'bound';

/** The longest chain of entries passed on, the owner's own included (state-sync's `MAX_GRANT_DEPTH`) */
export const MAX_DEPTH = 8;

/** One permission entry (docs/design/statenet-permissions.md, "An entry") */
export interface Permission {
    readonly id: string;
    /** The owner number whose tree the pattern is under */
    readonly owner: string;
    readonly pattern: string;
    readonly subject: string;
    readonly rights: readonly Right[];
    readonly parent?: string;
    readonly kind: PermissionKind;
    /** The person who made it; for an opened link, who opened it */
    readonly madeBy?: string;
    readonly createdAt: string;
    readonly until?: string;
    readonly revokedAt?: string;
    readonly revokedBy?: string;
    /** A link's token */
    readonly token?: string;
    /** The app's name when a link was made */
    readonly label?: string;
    readonly lastUsedAt?: string;
    /** How long a request made with it waits for a decision, in days (1 to 30), for an entry with `request` */
    readonly requestDays?: number;
}

export interface MakeInput {
    readonly id?: string;
    readonly owner: string;
    readonly pattern: string;
    readonly subject: string;
    readonly rights: readonly Right[];
    readonly kind: PermissionKind;
    readonly parent?: string;
    readonly madeBy?: string;
    readonly until?: Date;
    readonly token?: string;
    readonly label?: string;
    readonly requestDays?: number;
}

/** Why an entry could not be made; the caller turns it into its own error */
export class PermissionError extends Error {
    constructor(
        readonly status: 400 | 403 | 404,
        message: string
    ) {
        super(message);
    }
}

export interface PermissionRow {
    id: string;
    owner: string;
    pattern: string;
    subject: string;
    rights: Right[];
    parent: string | null;
    kind: PermissionKind;
    made_by: string | null;
    created_at: Date;
    until: Date | null;
    revoked_at: Date | null;
    revoked_by: string | null;
    token: string | null;
    label: string | null;
    last_used_at: Date | null;
    request_days: number | null;
}

export const PERMISSION_COLUMNS = 'p.id::text, p.owner::text, p.pattern, p.subject, p.rights, p.parent::text, p.kind, p.made_by::text, p.created_at, p.until, p.revoked_at, p.revoked_by::text, p.token, p.label, p.last_used_at, p.request_days';

export function permissionOf(row: PermissionRow): Permission {
    return {
        id: row.id,
        owner: row.owner,
        pattern: row.pattern,
        subject: row.subject,
        rights: row.rights,
        ...(row.parent !== null && { parent: row.parent }),
        kind: row.kind,
        ...(row.made_by !== null && { madeBy: row.made_by }),
        createdAt: row.created_at.toISOString(),
        ...(row.until !== null && { until: row.until.toISOString() }),
        ...(row.revoked_at !== null && { revokedAt: row.revoked_at.toISOString() }),
        ...(row.revoked_by !== null && { revokedBy: row.revoked_by }),
        ...(row.token !== null && { token: row.token }),
        ...(row.label !== null && { label: row.label }),
        ...(row.last_used_at !== null && { lastUsedAt: row.last_used_at.toISOString() }),
        ...(row.request_days !== null && { requestDays: row.request_days })
    };
}

/** The pattern of an app under its owner: its definition and the owner's own state of it */
export const appPattern = (appId: string): string => `$.apps.${appId.toLowerCase()}`;
/** The subject of an owner (a person or an org) by its number */
export const ownerSubject = (number: string): string => `owner:${number}`;
/** The subject of an org's members, or of its members with at least a role */
export const membersSubject = (orgNumber: string, role?: OrgRole): string => (role === undefined ? `members:${orgNumber}` : `members:${orgNumber}.${role}`);
/** The subject of an org's group */
export const groupSubject = (orgNumber: string, groupId: string): string => `group:${orgNumber}.${groupId}`;
/** The subject of whoever opens a link */
export const linkSubject = (id: string): string => `link:${id}`;

/** Whether an entry holds at a time: not revoked, not past its `until` */
const holds = (entry: Pick<Permission, 'revokedAt' | 'until'>, now: Date): boolean => entry.revokedAt === undefined && (entry.until === undefined || Date.parse(entry.until) > now.getTime());

/** A pattern of the table, read by @punyts/state's matcher; an error for one that is not a pattern */
export function compiled(pattern: string): PathPattern {
    const read = grantPattern(pattern);
    if (read === undefined) throw new PermissionError(400, `${pattern} is not a path pattern.`);
    return read;
}

/** Who a person is to the table: their own number, the orgs they act for, their memberships, roles and groups */
export interface Holder {
    readonly userId: string;
    readonly number: string;
    readonly subjects: readonly string[];
    /** The subjects that are an org a person acts for, by the org's number: they count only outside the org's own tree */
    readonly orgSubjects: ReadonlyMap<string, string>;
}

/**
 * The permission table (docs/design/statenet-permissions.md, S14b): every right Magnetic gives is an entry here, and
 * `allows` is the one check. An entry passed on is never wider than its parent, revoking one revokes everything passed
 * on from it, and none is ever deleted. Every method takes the transaction to work in, or works on its own
 */
export class Permissions {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** The owner number of a person, an org, or a workspace (its owner's) by id */
    async numberOf(id: string, tx: Queryable = this.db): Promise<string | undefined> {
        return (await tx.query<{ number: string }>('SELECT number::text FROM statenet_owner WHERE id::text = $1 OR workspace_id::text = $1 ORDER BY kind DESC LIMIT 1', [id.toLowerCase()])).rows[0]?.number;
    }

    /** The workspace that is an owner number's tree */
    async workspaceOf(number: string, tx: Queryable = this.db): Promise<string | undefined> {
        return (await tx.query<{ id: string }>('SELECT coalesce(workspace_id, id)::text AS id FROM statenet_owner WHERE number = $1::bigint', [number])).rows[0]?.id;
    }

    /** One entry by id */
    async get(id: string, tx: Queryable = this.db): Promise<Permission | undefined> {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
        const row = (await tx.query<PermissionRow>(`SELECT ${PERMISSION_COLUMNS} FROM permission p WHERE p.id = $1`, [id])).rows[0];
        return row === undefined ? undefined : permissionOf(row);
    }

    /** Which of these entries are revoked (revoking an entry revokes everything passed on from it) */
    async revokedAmong(ids: readonly string[], tx: Queryable = this.db): Promise<ReadonlySet<string>> {
        const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        if (valid.length === 0) return new Set();
        return new Set((await tx.query<{ id: string }>('SELECT id::text AS id FROM permission WHERE id = ANY($1::uuid[]) AND revoked_at IS NOT NULL', [valid])).rows.map((row) => row.id));
    }

    /** Entries matching a condition on `p` */
    async find(where: string, params: readonly unknown[], tx: Queryable = this.db): Promise<Permission[]> {
        return (await tx.query<PermissionRow>(`SELECT ${PERMISSION_COLUMNS} FROM permission p WHERE ${where}`, params)).rows.map(permissionOf);
    }

    /**
     * Makes an entry. One passed on must come from an entry that holds, all of whose ancestors hold, under the same
     * owner, with a pattern its parent's contains, no more rights and no later `until`; its `until` is cut to its
     * parent's
     */
    async make(input: MakeInput, tx: Queryable = this.db): Promise<Permission> {
        const now = this.now();
        const pattern = compiled(input.pattern);
        if (input.rights.length === 0 || !input.rights.every((right) => (RIGHTS as readonly string[]).includes(right))) throw new PermissionError(400, 'Rights are read, request, write and share.');
        if (!/^[0-9]+$/.test(input.owner)) throw new PermissionError(400, 'An entry is under an owner number.');
        let until = input.until;
        if (input.parent !== undefined) {
            const chain = await this.chain(input.parent, tx);
            const parent = chain[0];
            if (parent === undefined || !chain.every((entry) => holds(entry, now))) throw new PermissionError(404, 'That grant is not there any more.');
            if (chain.length >= MAX_DEPTH) throw new PermissionError(400, 'That grant was passed on too many times.');
            if (parent.owner !== input.owner || !patternContains(compiled(parent.pattern), pattern) || !input.rights.every((right) => parent.rights.includes(right))) {
                throw new PermissionError(403, 'A grant passed on can only be narrower than the one it came from.');
            }
            if (parent.until !== undefined && (until === undefined || Date.parse(parent.until) < until.getTime())) until = new Date(parent.until);
        }
        const id = input.id ?? randomUUID();
        const row = (
            await tx.query<PermissionRow>(
                `INSERT INTO permission AS p (id, owner, pattern, subject, rights, parent, kind, made_by, created_at, until, token, label, request_days)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${PERMISSION_COLUMNS}`,
                [id, input.owner, input.pattern, input.subject, input.rights, input.parent ?? null, input.kind, input.madeBy ?? null, now, until ?? null, input.token ?? null, input.label ?? null, input.requestDays ?? null]
            )
        ).rows[0] as PermissionRow;
        return permissionOf(row);
    }

    /**
     * Revokes an entry and everything passed on from it that still holds; answers the ids revoked. A person's access to
     * an owner's apps ending (an `opened` or `access.*` entry) ends their `bound` entries under that owner too
     * (`endBound`)
     */
    async revoke(id: string, by: string | undefined, tx: Queryable = this.db): Promise<string[]> {
        const rows = (
            await tx.query<{ id: string; owner: string; subject: string; kind: string }>(
                `WITH RECURSIVE tree AS (SELECT id FROM permission WHERE id = $1 UNION SELECT p.id FROM permission p JOIN tree ON p.parent = tree.id)
                 UPDATE permission SET revoked_at = $2, revoked_by = $3 WHERE id IN (SELECT id FROM tree) AND revoked_at IS NULL RETURNING id::text, owner::text, subject, kind`,
                [id, this.now(), by ?? null]
            )
        ).rows;
        const revoked = rows.map((row) => row.id);
        const access = new Map(rows.filter((row) => row.kind === 'opened' || row.kind.startsWith('access.')).map((row) => [`${row.owner} ${row.subject}`, row]));
        for (const { owner, subject } of access.values()) revoked.push(...(await this.endBound(owner, subject, by, tx)));
        return revoked;
    }

    /**
     * Revokes a person's `bound` entries under an owner (docs/design/statenet-requests.md) unless they still hold an
     * `opened` or `access.*` entry there: they write the owner's datasets only while they can open its apps. Answers
     * the ids revoked
     */
    async endBound(owner: string, subject: string, by: string | undefined, tx: Queryable = this.db): Promise<string[]> {
        return (
            await tx.query<{ id: string }>(
                `UPDATE permission b SET revoked_at = $3, revoked_by = $4
                 WHERE b.kind = 'bound' AND b.owner = $1::numeric AND b.subject = $2 AND b.revoked_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM permission k WHERE k.owner = b.owner AND k.subject = b.subject AND (k.kind = 'opened' OR k.kind LIKE 'access.%')
                                   AND k.revoked_at IS NULL AND (k.until IS NULL OR k.until > $3))
                 RETURNING b.id::text`,
                [owner, subject, this.now(), by ?? null]
            )
        ).rows.map((row) => row.id);
    }

    /** Revokes every entry matching a condition on `p`, with everything passed on from them */
    async revokeWhere(where: string, params: readonly unknown[], by: string | undefined, tx: Queryable = this.db): Promise<string[]> {
        const ids = (await tx.query<{ id: string }>(`SELECT p.id::text FROM permission p WHERE p.revoked_at IS NULL AND ${where}`, params)).rows.map((row) => row.id);
        const revoked: string[] = [];
        for (const id of ids) revoked.push(...(await this.revoke(id, by, tx)));
        return revoked;
    }

    /** An entry and its ancestors, the entry first */
    async chain(id: string, tx: Queryable = this.db): Promise<Permission[]> {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
        return (
            await tx.query<PermissionRow & { depth: number }>(
                `WITH RECURSIVE up AS (SELECT p.*, 0 AS depth FROM permission p WHERE p.id = $1
                                      UNION ALL SELECT p.*, up.depth + 1 FROM permission p JOIN up ON p.id = up.parent WHERE up.depth < ${MAX_DEPTH + 1})
                 SELECT ${PERMISSION_COLUMNS}, p.depth FROM up p ORDER BY p.depth`,
                [id]
            )
        ).rows.map(permissionOf);
    }

    /** Who a person is to the table */
    async holder(userId: string, tx: Queryable = this.db): Promise<Holder | undefined> {
        const number = (await tx.query<{ number: string }>('SELECT owner_number::text AS number FROM app_user WHERE id::text = $1', [userId])).rows[0]?.number;
        if (number === undefined) return undefined;
        const orgs = (
            await tx.query<{ number: string; role: OrgRole }>('SELECT o.owner_number::text AS number, m.role FROM org_member m JOIN org o ON o.id = m.org_id WHERE m.user_id::text = $1', [userId])
        ).rows;
        const groups = (
            await tx.query<{ number: string; id: string }>(
                'SELECT o.owner_number::text AS number, g.id::text FROM org_group_member gm JOIN org_group g ON g.id = gm.group_id JOIN org o ON o.id = g.org_id WHERE gm.user_id::text = $1',
                [userId]
            )
        ).rows;
        const subjects = [ownerSubject(number), 'everyone'];
        const orgSubjects = new Map<string, string>();
        for (const org of orgs) {
            orgSubjects.set(ownerSubject(org.number), org.number);
            subjects.push(ownerSubject(org.number), membersSubject(org.number));
            // a role reaches every role below it
            for (const role of ORG_ROLES.slice(ORG_ROLES.indexOf(org.role))) subjects.push(membersSubject(org.number, role));
        }
        for (const group of groups) subjects.push(groupSubject(group.number, group.id));
        return { userId, number, subjects, orgSubjects };
    }

    /**
     * The entries that give a person something at a path of an owner's tree now: their subject is the person, an org
     * they act for (outside its own tree), a membership, role or group of theirs, or everyone; their pattern covers the
     * path; they and their ancestors hold
     */
    async holding(holder: Holder, owner: string, path: string, tx: Queryable = this.db): Promise<Permission[]> {
        const now = this.now();
        const subjects = holder.subjects.filter((subject) => holder.orgSubjects.get(subject) !== owner);
        const candidates = (
            await this.find('p.owner = $1::numeric AND p.subject = ANY($2::text[]) AND p.revoked_at IS NULL AND (p.until IS NULL OR p.until > $3)', [owner, subjects, now], tx)
        ).filter((entry) => {
            const pattern = grantPattern(entry.pattern);
            return pattern !== undefined && patternCovers(pattern, path);
        });
        const held: Permission[] = [];
        for (const entry of candidates) {
            if (entry.parent === undefined || (await this.chain(entry.parent, tx)).every((ancestor) => holds(ancestor, now))) held.push(entry);
        }
        return held;
    }

    /** `allows(subject, owner, path, right)`: the owner holds everything; anyone else needs an entry that holds */
    async allows(userId: string, owner: string, path: string, right: Right, tx: Queryable = this.db): Promise<boolean> {
        const holder = await this.holder(userId, tx);
        if (holder === undefined) return false;
        if (holder.number === owner) return true;
        return (await this.holding(holder, owner, path, tx)).some((entry) => entry.rights.includes(right));
    }

    /** Records that an entry was used to sign a token */
    async used(id: string, tx: Queryable = this.db): Promise<void> {
        await tx.query('UPDATE permission SET last_used_at = $2 WHERE id = $1', [id, this.now()]);
    }
}
