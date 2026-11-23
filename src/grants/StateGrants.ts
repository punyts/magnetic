import { randomUUID } from 'node:crypto';
import { patternContains, type PathPattern } from '@punyts/state';
import { addressPath, checkAccess, grantPattern, ownerOfAddress, readGrant, signGrant } from '@punyts/state-sync/authority';
import type { Access, GrantRight } from '@punyts/state-sync/authority';
import type { Database, Queryable } from '@punyts/stateui-pg';
import { audit, OrgError } from '../orgs/Orgs.js';
import type { OrgPolicies } from '../orgs/Policies.js';
import type { OwnerNumbers } from '../statenet/OwnerNumbers.js';
import type { OwnerKeys } from './OwnerKeys.js';

/** How long a signed token lives: grants are short-lived and signed again while they are used */
export const TOKEN_LIFE_MS = 4 * 3_600_000;
/** The longest a share may last before it is given again */
export const MAX_SHARE_MS = 30 * 86_400_000;

export type GrantKind = 'share' | 'passed' | 'org-read';

/** A grant as Shared by me lists it */
export interface GrantRecord {
    readonly id: string;
    readonly kind: GrantKind;
    readonly issuer: string;
    readonly subject: string;
    readonly address: string;
    readonly prefix: string;
    readonly rights: readonly GrantRight[];
    readonly parentId?: string;
    readonly orgId?: string;
    readonly issuedAt: string;
    readonly expiresAt?: string;
    readonly revokedAt?: string;
    readonly lastUsedAt?: string;
}

export interface IssueInput {
    readonly issuer: string;
    readonly subject: string;
    readonly address: string;
    readonly prefix: string;
    readonly rights: readonly GrantRight[];
    /** How long it lasts, at most `MAX_SHARE_MS` (and no longer than the grant it is passed on from) */
    readonly lifeMs?: number;
    /** The grant it is passed on from: the issuer must be its subject */
    readonly parentId?: string;
    /** A standing share that lasts until it is revoked (a dataset shared with a workspace); `lifeMs` is then ignored */
    readonly standing?: boolean;
    /** The person who gave it, for the org's audit, when the issuer is a workspace they manage */
    readonly by?: string;
}

/**
 * The address of a workspace's dataset, for grants: `$.data.<dataset>` of its owner's tree, `<owner>/data/<dataset>`
 * (docs/design/statenet-network.md, "`$` is the owner"). The records stay in the data part; this names them
 */
export const datasetAddress = (workspaceId: string, dataset: string): string => `${workspaceId}/data/${dataset}`;

/** The workspace and dataset an address names, when it names a dataset */
export function datasetOf(address: string): { readonly owner: string; readonly dataset: string } | undefined {
    const [owner, branch, dataset] = address.split('/');
    return branch === 'data' && owner !== undefined && dataset !== undefined ? { owner, dataset } : undefined;
}

/** The app an address names (`<owner>/apps/<appId>`; `*` for every app of the owner), when it names one */
export function appOf(address: string): string | undefined {
    const [, branch, appId] = address.split('/');
    return branch === 'apps' ? appId : undefined;
}

interface GrantRow {
    id: string;
    kind: GrantKind;
    issuer: string;
    subject: string;
    address: string;
    prefix: string;
    rights: GrantRight[];
    parent_grant: string | null;
    org_id: string | null;
    issued_at: Date;
    expires_at: Date | null;
    revoked_at: Date | null;
    last_used_at: Date | null;
}

const COLUMNS = 'id, kind, issuer, subject, address, prefix, rights, parent_grant, org_id, issued_at, expires_at, revoked_at, last_used_at';
/** `<owner>/apps/<app>` (or `*` for every app of the owner), or `<owner>/data/<dataset>` */
const ADDRESS = /^[^/\s]{1,200}\/(apps\/([^/\s]{1,200}|\*)|data\/[^/\s]{1,200})$/;
const PREFIX = /^\$(\.[^.\s]+)*$/;

function toRecord(row: GrantRow): GrantRecord {
    return {
        id: row.id,
        kind: row.kind,
        issuer: row.issuer,
        subject: row.subject,
        address: row.address,
        prefix: row.prefix,
        rights: row.rights,
        ...(row.parent_grant !== null && { parentId: row.parent_grant }),
        ...(row.org_id !== null && { orgId: row.org_id }),
        issuedAt: row.issued_at.toISOString(),
        ...(row.expires_at !== null && { expiresAt: row.expires_at.toISOString() }),
        ...(row.revoked_at !== null && { revokedAt: row.revoked_at.toISOString() }),
        ...(row.last_used_at !== null && { lastUsedAt: row.last_used_at.toISOString() })
    };
}

/**
 * The grants Magnetic issues and the tokens it signs for them (docs/design/statenet-relays.md, "Grants"). A row is the
 * standing right: given by the owner of an address (`share`), passed on, narrower, by a subject (`passed`), or the
 * org's standing read of a member's state in its apps (`org-read`, made when the org first reads it, revoked when the
 * member leaves). `tokenFor` signs a short-lived token for a row, its chain included, with each issuer's current key.
 * Revoking a grant revokes everything passed on from it. Issuing checks the org's policy: with `grantsInOrg`, a
 * member's state in the org's apps goes only to people in the org.
 *
 * In a row, in a token and beside a signing key an owner is its number (docs/design/statenet-network.md, "`$` is the
 * owner"): the owner of an address, an issuer, a subject (`org:<number>` for an org reading). Everything given to
 * this class and every record it answers with names people, workspaces and orgs by their ids, as Magnetic's pages and
 * tables do; it turns one into the other at its edge (`OwnerNumbers`)
 */
export class StateGrants {
    constructor(
        private readonly db: Database,
        private readonly keys: OwnerKeys,
        private readonly policies: OrgPolicies,
        private readonly owners: OwnerNumbers
    ) {}

    /** The records of rows, with people, workspaces and orgs by their ids */
    private records(rows: readonly GrantRow[]): Promise<GrantRecord[]> {
        return Promise.all(
            rows.map(async (row) => ({ ...toRecord(row), issuer: await this.owners.idOfName(row.issuer), subject: await this.owners.idOfName(row.subject), address: await this.owners.addressById(row.address) }))
        );
    }

    async issue(input: IssueInput, now: Date = new Date()): Promise<{ id: string; token: string }> {
        const { prefix, rights } = input;
        const issuer = await this.owners.nameOf(input.issuer);
        const subject = await this.owners.nameOf(input.subject);
        const address = await this.owners.address(input.address);
        if (!ADDRESS.test(address)) throw new OrgError(400, 'An address is <owner>/apps/<app>, or <owner>/data/<dataset>.');
        if (!PREFIX.test(prefix)) throw new OrgError(400, 'A prefix is a "$." path.');
        if (rights.length === 0 || !rights.every((right) => right === 'read' || right === 'write')) throw new OrgError(400, 'Rights are read, write or both.');
        if (subject.trim() === '' || subject.length > 200) throw new OrgError(400, 'A grant needs a subject.');
        const life = Math.min(Math.max(input.lifeMs ?? MAX_SHARE_MS, 60_000), MAX_SHARE_MS);
        let expires: Date | null = input.standing === true && input.parentId === undefined ? null : new Date(now.getTime() + life);
        let kind: GrantKind = 'share';
        if (input.parentId === undefined) {
            if (issuer !== ownerOfAddress(address)) throw new OrgError(403, 'Only the owner of the state can share it, or pass on a grant they hold.');
            if (address.endsWith('/*')) throw new OrgError(400, 'A share names one app.');
        } else {
            const parent = await this.row(this.db, input.parentId);
            if (parent === undefined || parent.revoked_at !== null || (parent.expires_at !== null && parent.expires_at <= now)) throw new OrgError(404, 'That grant is not there any more.');
            if (parent.subject !== issuer) throw new OrgError(403, 'Only the person a grant was given to can pass it on.');
            if (ownerOfAddress(parent.address) !== ownerOfAddress(address) || !patternContains(patternOf(parent.address, parent.prefix), patternOf(address, prefix)) || !rights.every((right) => parent.rights.includes(right))) {
                throw new OrgError(403, 'A grant passed on can only be narrower than the one it came from.');
            }
            if (parent.expires_at !== null && (expires === null || parent.expires_at < expires)) expires = parent.expires_at;
            kind = 'passed';
        }
        await this.checkPolicy(address, subject);
        const id = randomUUID();
        await this.db.transaction(async (tx) => {
            await tx.query(`INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights, parent_grant, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                id,
                kind,
                issuer,
                subject,
                address,
                prefix,
                rights,
                input.parentId ?? null,
                now,
                expires
            ]);
            const orgId = await this.orgOfAddress(tx, address);
            if (orgId !== undefined) await audit(tx, { orgId, actorId: input.by ?? input.issuer, action: 'grant.issued', targetKind: 'grant', targetId: id, detail: { subject, address, prefix, rights: [...rights] } });
        });
        return { id, token: await this.tokenFor(id, now) };
    }

    /** A short-lived token for a grant that still holds, its chain included, each grant signed by its issuer's current key */
    async tokenFor(grantId: string, now: Date = new Date(), depth = 0): Promise<string> {
        if (depth > 8) throw new OrgError(400, 'That grant was passed on too many times.');
        const row = await this.row(this.db, grantId);
        if (row === undefined || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) throw new OrgError(404, 'That grant is not there any more.');
        const parent = row.parent_grant === null ? undefined : await this.tokenFor(row.parent_grant, now, depth + 1);
        const key = await this.keys.signing(row.issuer);
        const ends = Math.min(now.getTime() + TOKEN_LIFE_MS, row.expires_at?.getTime() ?? Number.POSITIVE_INFINITY);
        await this.db.query('UPDATE state_grant SET last_used_at = $2 WHERE id = $1', [grantId, now]);
        return signGrant(
            { entry: row.id, kid: key.kid, issuer: row.issuer, subject: row.subject, owner: ownerOfAddress(row.address), pattern: addressPath(row.address, row.prefix).path, rights: row.rights, issued: now.getTime(), expires: ends, ...(parent !== undefined && { parent }) },
            key.privateKey
        );
    }

    /** Whether an access may use a right at a path of an address now: the token checked against the keys and the revocations */
    async check(access: Access | undefined, need: { readonly address: string; readonly path: string; readonly right: GrantRight }, now: Date = new Date()): Promise<{ ok: true } | { ok: false; reason: string }> {
        // who asks and what for, by their numbers, as the token and the address's owner are
        if (access !== undefined) access = { ...access, subject: await this.owners.nameOf(access.subject) };
        need = { ...need, address: await this.owners.address(need.address) };
        if (access?.grant !== undefined) await this.keys.load(access.grant);
        const revoked = new Set(
            access?.grant === undefined ? [] : (await this.db.query<{ id: string }>('SELECT id::text FROM state_grant WHERE revoked_at IS NOT NULL AND id::text = ANY($1::text[])', [chainIds(access.grant)])).rows.map((row) => row.id)
        );
        const result = checkAccess(access, need, { keyOf: (kid) => this.keys.keyOf(kid), now: now.getTime(), revoked: (id) => revoked.has(id) });
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    }

    /**
     * Revokes a grant and everything passed on from it: its issuer, the owner of the state, or (for an org's standing
     * read) an admin of the org. Answers each revoked id with when its tokens would have expired, for the relays
     */
    async revoke(actorId: string, grantId: string, now: Date = new Date(), by?: string): Promise<Array<{ id: string; expires: number }>> {
        return this.db.transaction(async (tx) => {
            const row = await this.row(tx, grantId);
            if (row === undefined) throw new OrgError(404, 'No such grant.');
            const orgAdmin = row.org_id !== null && ['owner', 'admin'].includes((await tx.query<{ role: string }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id::text = $2', [row.org_id, actorId])).rows[0]?.role ?? '');
            const actor = await this.owners.nameOf(actorId);
            if (actor !== row.issuer && actor !== ownerOfAddress(row.address) && !orgAdmin) throw new OrgError(403, 'Only who gave a grant, or the owner of the state, can revoke it.');
            const revoked = (
                await tx.query<{ id: string }>(
                    `WITH RECURSIVE tree AS (SELECT id FROM state_grant WHERE id = $1 UNION SELECT g.id FROM state_grant g JOIN tree ON g.parent_grant = tree.id)
                     UPDATE state_grant SET revoked_at = $2 WHERE id IN (SELECT id FROM tree) AND revoked_at IS NULL RETURNING id::text`,
                    [grantId, now]
                )
            ).rows.map((revokedRow) => revokedRow.id);
            const orgId = row.org_id ?? (await this.orgOfAddress(tx, row.address));
            if (orgId !== undefined) await audit(tx, { orgId, actorId: by ?? actorId, action: 'grant.revoked', targetKind: 'grant', targetId: grantId, detail: { revoked } });
            return revoked.map((id) => ({ id, expires: now.getTime() + TOKEN_LIFE_MS }));
        });
    }

    /** Shared by me: the grants on an owner's state and the ones they gave, newest first */
    async sharedBy(ownerId: string): Promise<GrantRecord[]> {
        return this.records((await this.db.query<GrantRow>(`SELECT ${COLUMNS} FROM state_grant WHERE split_part(address, '/', 1) = $1 OR issuer = $1 ORDER BY issued_at DESC LIMIT 500`, [await this.owners.nameOf(ownerId)])).rows);
    }

    /** The shares of a workspace's datasets that hold now, newest first */
    async datasetShares(workspaceId: string, now: Date = new Date()): Promise<GrantRecord[]> {
        return this.records((
            await this.db.query<GrantRow>(
                `SELECT ${COLUMNS} FROM state_grant WHERE split_part(address, '/', 1) = $1 AND split_part(address, '/', 2) = 'data' AND kind = 'share' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2) ORDER BY issued_at DESC LIMIT 500`,
                [await this.owners.nameOf(workspaceId), now]
            )
        ).rows);
    }

    /** The datasets shared with a workspace that hold now: read rights whose subject is the workspace, newest first */
    async datasetsSharedWith(workspaceId: string, now: Date = new Date()): Promise<GrantRecord[]> {
        return this.records((
            await this.db.query<GrantRow>(
                `SELECT ${COLUMNS} FROM state_grant WHERE subject = $1 AND split_part(address, '/', 2) = 'data' AND 'read' = ANY(rights) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2) ORDER BY issued_at DESC LIMIT 500`,
                [await this.owners.nameOf(workspaceId), now]
            )
        ).rows);
    }

    /** The share that lets a workspace read another's dataset now, if there is one */
    async datasetShare(readerId: string, owner: string, dataset: string, now: Date = new Date()): Promise<GrantRecord | undefined> {
        const row = (
            await this.db.query<GrantRow>(
                `SELECT ${COLUMNS} FROM state_grant WHERE subject = $1 AND address = $2 AND 'read' = ANY(rights) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $3) ORDER BY issued_at DESC LIMIT 1`,
                [await this.owners.nameOf(readerId), await this.owners.address(datasetAddress(owner, dataset)), now]
            )
        ).rows[0];
        return row === undefined ? undefined : (await this.records([row]))[0];
    }

    /** The org's standing read of a member's state in its apps: made the first time the org reads it, and kept until revoked */
    async orgRead(orgId: string, userId: string, now: Date = new Date()): Promise<string> {
        const existing = (await this.db.query<{ id: string }>("SELECT id::text FROM state_grant WHERE kind = 'org-read' AND org_id = $1 AND issuer = $2 AND revoked_at IS NULL", [orgId, await this.owners.nameOf(userId)])).rows[0]?.id;
        if (existing !== undefined) return existing;
        const id = randomUUID();
        await this.db.query("INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights, org_id, issued_at) VALUES ($1, 'org-read', $2, $3, $4, '$', '{read}', $5, $6)", [
            id,
            await this.owners.nameOf(userId),
            await this.owners.nameOf(orgSubject(orgId)),
            await this.owners.address(`${userId}/apps/*`),
            orgId,
            now
        ]);
        return id;
    }

    private async checkPolicy(address: string, named: string): Promise<void> {
        // the org's members are known by their ids
        const subject = await this.owners.idOfName(named);
        const orgId = await this.orgOfAddress(this.db, address);
        if (orgId === undefined || !(await this.policies.get(orgId)).grantsInOrg) return;
        const member = (await this.db.query('SELECT 1 FROM org_member WHERE org_id = $1 AND (user_id::text = $2 OR $2 = $3)', [orgId, subject, orgSubject(orgId)])).rowCount ?? 0;
        if (member === 0) throw new OrgError(403, "The org's policy keeps grants of its apps' state in the org.");
    }

    /**
     * The org whose workspace holds the address's app, if any (every org app has its settings row, which row-level
     * security does not hide), or whose workspace has the address's dataset
     */
    private async orgOfAddress(tx: Queryable, named: string): Promise<string | undefined> {
        // a workspace is known by its id
        const address = await this.owners.addressById(named);
        const data = datasetOf(address);
        if (data !== undefined) return (await tx.query<{ org_id: string }>("SELECT org_id::text FROM workspace WHERE id::text = $1 AND kind = 'org'", [data.owner])).rows[0]?.org_id;
        const appId = appOf(address);
        if (appId === undefined || appId === '*') return undefined;
        return (await tx.query<{ org_id: string }>('SELECT w.org_id FROM app_setting s JOIN workspace w ON w.id = s.workspace_id WHERE s.app_id::text = $1 AND w.org_id IS NOT NULL', [appId])).rows[0]?.org_id;
    }

    private async row(tx: Queryable, id: string): Promise<GrantRow | undefined> {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
        return (await tx.query<GrantRow>(`SELECT ${COLUMNS} FROM state_grant WHERE id = $1`, [id])).rows[0];
    }
}

/** The subject an org reads as */
export const orgSubject = (orgId: string): string => `org:${orgId}`;

/** The grant ids of a token's chain (the entries its grants were made from), without checking it */
function chainIds(token: string): string[] {
    const ids: string[] = [];
    for (let claims = readGrant(token); claims !== undefined && ids.length < 16; claims = claims.parent === undefined ? undefined : readGrant(claims.parent)) ids.push(claims.entry);
    return ids;
}

/**
 * The pattern a row's address and prefix name in its owner's tree (`<owner>/apps/*` and `$` is `$.apps.*`), as its
 * tokens carry it (docs/design/statenet-permissions.md, "Tokens")
 */
function patternOf(address: string, prefix: string): PathPattern {
    return grantPattern(addressPath(address, prefix).path) as PathPattern;
}
