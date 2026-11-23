import { addressPath, checkAccess, MAX_REQUEST_MS, ownerOfAddress, readGrant, signGrant } from '@punyts/state-sync/authority';
import type { Access, GrantContext, GrantRight } from '@punyts/state-sync/authority';
import type { Database } from '@punyts/stateui-pg';
import { membersSubject, ownerSubject, PermissionError, Permissions, type Permission } from '../permissions/Permissions.js';
import { audit, OrgError } from '../orgs/Orgs.js';
import type { OrgPolicies } from '../orgs/Policies.js';
import type { OwnerNumbers } from '../statenet/OwnerNumbers.js';
import type { OwnerKeys } from './OwnerKeys.js';

/** How long a signed token lives: grants are short-lived and signed again while they are used */
export const TOKEN_LIFE_MS = 4 * 3_600_000;
/** The longest a share may last before it is given again */
export const MAX_SHARE_MS = 30 * 86_400_000;

export type GrantKind = 'share' | 'passed' | 'org-read' | 'bound';

const DAY_MS = 86_400_000;

/**
 * What people using a workspace's apps may do to one of its datasets (docs/design/statenet-requests.md, R3c): write it,
 * or request changes, which wait `requestDays` for a decision
 */
export interface DatasetSetting {
    readonly rights: 'write' | 'request';
    readonly requestDays: number;
}

/** A dataset nobody set: written, and requests would wait a week */
export const DEFAULT_DATASET_SETTING: DatasetSetting = Object.freeze({ rights: 'write', requestDays: 7 });

/** The rights of a `bound` entry under a setting */
const boundRights = (setting: DatasetSetting): GrantRight[] => (setting.rights === 'request' ? ['read', 'request'] : ['read', 'write']);

/** A state grant or dataset share, with people, workspaces and orgs by their ids */
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
 * (docs/design/statenet-network.md, "`$` is the owner"). Named by the workspace's id here; at the edge of this class
 * the owner becomes its number, so it is the address of the dataset's namespace (docs/design/statenet-requests.md)
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

/** `<owner>/apps/<app>` (or `*` for every app of the owner), or `<owner>/data/<dataset>` */
const ADDRESS = /^[^/\s]{1,200}\/(apps\/([^/\s]{1,200}|\*)|data\/[^/\s]{1,200})$/;
const PREFIX = /^\$(\.[^.\s]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_KINDS = "('share', 'passed', 'org-read')";

/** The name a subject goes by in a token: an owner by its number, an org's admins as the org reads (`org:<number>`) */
export function subjectName(subject: string): string {
    if (subject.startsWith('owner:')) return subject.slice('owner:'.length);
    const admins = /^members:([0-9]+)\.admin$/.exec(subject);
    return admins === null ? subject : `org:${admins[1] as string}`;
}

/** The subject of a name a token goes by: `org:<number>` reads as the org's owners and admins */
function subjectOfName(name: string): string {
    return name.startsWith('org:') ? membersSubject(name.slice('org:'.length), 'admin') : ownerSubject(name);
}

/** The address and prefix an entry under an owner names (`$.apps.<app>.data` is `<owner>/apps/<app>` and `$.data`) */
export function addressOfEntry(entry: Pick<Permission, 'owner' | 'pattern'>): { readonly address: string; readonly prefix: string } {
    const [, branch, name, ...rest] = entry.pattern.split('.');
    if ((branch === 'apps' || branch === 'data') && name !== undefined) return { address: `${entry.owner}/${branch}/${name}`, prefix: ['$', ...rest].join('.') };
    return { address: entry.owner, prefix: entry.pattern };
}

/** Turns the table's refusal into the org error the routes answer */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (error instanceof PermissionError) throw new OrgError(error.status, error.message);
        throw error;
    }
}

/**
 * The state grants Magnetic gives and the tokens it signs for them (docs/design/statenet-permissions.md, "Tokens"),
 * as entries of the permission table: given by the owner of an address (`share`), passed on, narrower, by a subject
 * (`passed`), or the org's standing read of a member's state in its apps (`org-read`, made when the org first reads it,
 * revoked when the member leaves). `tokenFor` signs a short-lived token for an entry, its chain included, with each
 * issuer's current key. Revoking an entry revokes everything passed on from it. Issuing checks the org's policy: with
 * `grantsInOrg`, a member's state in the org's apps goes only to people in the org.
 *
 * In the table and in a token an owner is its number (docs/design/statenet-network.md, "`$` is the owner"). Everything
 * given to this class and every record it answers with names people, workspaces and orgs by their ids, as Magnetic's
 * pages and tables do; it turns one into the other at its edge (`OwnerNumbers`)
 */
export class StateGrants {
    /** Entries revoked within a token's life, as `refreshRevoked` last read them and `revoke` added since */
    private revokedIds = new Set<string>();

    constructor(
        private readonly db: Database,
        private readonly keys: OwnerKeys,
        private readonly policies: OrgPolicies,
        private readonly owners: OwnerNumbers
    ) {}

    private table(now: Date): Permissions {
        return new Permissions(this.db, () => now);
    }

    /** The name of who gave an entry: the owner of a root, the subject of the entry it was passed on from */
    private async issuerOf(entry: Permission): Promise<string> {
        if (entry.parent === undefined) return entry.owner;
        const parent = await this.table(new Date()).get(entry.parent);
        return parent === undefined ? entry.owner : subjectName(parent.subject);
    }

    /** The records of entries, with people, workspaces and orgs by their ids */
    private records(entries: readonly Permission[]): Promise<GrantRecord[]> {
        return Promise.all(
            entries.map(async (entry) => {
                const { address, prefix } = addressOfEntry(entry);
                const org = entry.kind === 'org-read' ? await this.owners.idOfName(subjectName(entry.subject)) : undefined;
                return {
                    id: entry.id,
                    kind: entry.kind as GrantKind,
                    issuer: await this.owners.idOfName(await this.issuerOf(entry)),
                    subject: await this.owners.idOfName(subjectName(entry.subject)),
                    address: await this.owners.addressById(address),
                    prefix,
                    rights: entry.rights.filter((right): right is GrantRight => right === 'read' || right === 'write'),
                    ...(entry.parent !== undefined && { parentId: entry.parent }),
                    ...(org?.startsWith('org:') === true && { orgId: org.slice('org:'.length) }),
                    issuedAt: entry.createdAt,
                    ...(entry.until !== undefined && { expiresAt: entry.until }),
                    ...(entry.revokedAt !== undefined && { revokedAt: entry.revokedAt }),
                    ...(entry.lastUsedAt !== undefined && { lastUsedAt: entry.lastUsedAt })
                };
            })
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
        const owner = ownerOfAddress(address);
        if (!/^[0-9]+$/.test(owner)) throw new OrgError(404, 'No such owner.');
        const life = Math.min(Math.max(input.lifeMs ?? MAX_SHARE_MS, 60_000), MAX_SHARE_MS);
        const until = input.standing === true && input.parentId === undefined ? undefined : new Date(now.getTime() + life);
        const table = this.table(now);
        if (input.parentId === undefined) {
            if (issuer !== owner) throw new OrgError(403, 'Only the owner of the state can share it, or pass on a grant they hold.');
            if (address.endsWith('/*')) throw new OrgError(400, 'A share names one app.');
        } else {
            const parent = await table.get(input.parentId);
            if (parent === undefined || !STATE_KINDS.includes(`'${parent.kind}'`)) throw new OrgError(404, 'That grant is not there any more.');
            if (parent.revokedAt === undefined && subjectName(parent.subject) !== issuer) throw new OrgError(403, 'Only the person a grant was given to can pass it on.');
        }
        await this.checkPolicy(address, subject);
        const made = await refusing(() =>
            this.db.transaction(async (tx) => {
                const by = input.by ?? (UUID.test(input.issuer) ? input.issuer : undefined);
                const entry = await table.make(
                    {
                        owner,
                        pattern: addressPath(address, prefix).path,
                        subject: subjectOfName(subject),
                        rights,
                        kind: input.parentId === undefined ? 'share' : 'passed',
                        ...(input.parentId !== undefined && { parent: input.parentId }),
                        ...(until !== undefined && { until }),
                        ...(by !== undefined && { madeBy: by })
                    },
                    tx
                );
                const orgId = await this.orgOfAddress(address);
                if (orgId !== undefined) await audit(tx, { orgId, actorId: input.by ?? input.issuer, action: 'grant.issued', targetKind: 'grant', targetId: entry.id, detail: { subject, address, prefix, rights: [...rights] } });
                return entry;
            })
        );
        return { id: made.id, token: await this.tokenFor(made.id, now) };
    }

    /** A short-lived token for an entry that still holds, its chain included, each signed by its issuer's current key */
    async tokenFor(grantId: string, now: Date = new Date(), depth = 0): Promise<string> {
        if (depth > 8) throw new OrgError(400, 'That grant was passed on too many times.');
        const table = this.table(now);
        const entry = await table.get(grantId);
        if (entry === undefined || entry.revokedAt !== undefined || (entry.until !== undefined && Date.parse(entry.until) <= now.getTime())) throw new OrgError(404, 'That grant is not there any more.');
        const parent = entry.parent === undefined ? undefined : await this.tokenFor(entry.parent, now, depth + 1);
        const issuer = await this.issuerOf(entry);
        const key = await this.keys.signing(issuer);
        const ends = Math.min(now.getTime() + TOKEN_LIFE_MS, entry.until === undefined ? Number.POSITIVE_INFINITY : Date.parse(entry.until));
        // A request outlives the token: it waits as long as the entry says, within the entry's own life
        const requesting = entry.rights.includes('request');
        await table.used(grantId);
        return signGrant(
            {
                entry: entry.id,
                kid: key.kid,
                issuer,
                subject: subjectName(entry.subject),
                owner: entry.owner,
                pattern: entry.pattern,
                rights: entry.rights.filter((right): right is GrantRight => right === 'read' || right === 'write' || right === 'request'),
                issued: now.getTime(),
                expires: ends,
                ...(requesting && { lasts: entry.until === undefined ? now.getTime() + MAX_REQUEST_MS : Date.parse(entry.until) }),
                ...(requesting && entry.requestDays !== undefined && { requestMs: entry.requestDays * DAY_MS }),
                ...(parent !== undefined && { parent })
            },
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
            access?.grant === undefined ? [] : (await this.db.query<{ id: string }>('SELECT id::text FROM permission WHERE revoked_at IS NOT NULL AND id::text = ANY($1::text[])', [chainIds(access.grant)])).rows.map((row) => row.id)
        );
        const result = checkAccess(access, need, { keyOf: (kid) => this.keys.keyOf(kid), now: now.getTime(), revoked: (id) => revoked.has(id) });
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    }

    /**
     * Revokes an entry and everything passed on from it: who made it, who gave it, the owner of the state, or an owner
     * or admin of the org it is under or that reads by it. Answers each revoked id with when its tokens would have
     * expired, for the relays
     */
    async revoke(actorId: string, grantId: string, now: Date = new Date(), by?: string): Promise<Array<{ id: string; expires: number }>> {
        const table = this.table(now);
        return this.db.transaction(async (tx) => {
            const entry = await table.get(grantId, tx);
            if (entry === undefined || entry.kind === 'admins' || entry.kind === 'creator') throw new OrgError(404, 'No such grant.');
            const actor = await this.owners.nameOf(actorId);
            const orgNumbers = [subjectName(entry.subject).replace(/^org:/, ''), entry.owner];
            const orgAdmin =
                (await tx.query("SELECT 1 FROM org_member m JOIN org o ON o.id = m.org_id WHERE m.user_id::text = $1 AND m.role IN ('owner', 'admin') AND o.owner_number::text = ANY($2::text[])", [actorId, orgNumbers])).rows.length > 0;
            const mine = actor === entry.owner || actor === (await this.issuerOf(entry)) || (by ?? actorId) === entry.madeBy || actorId === entry.madeBy;
            if (!mine && !orgAdmin) throw new OrgError(403, 'Only who gave a grant, or the owner of the state, can revoke it.');
            const revoked = await table.revoke(grantId, by ?? (UUID.test(actorId) ? actorId : undefined), tx);
            for (const id of revoked) this.revokedIds.add(id);
            const { address } = addressOfEntry(entry);
            const org = entry.kind === 'org-read' ? await this.owners.idOfName(subjectName(entry.subject)) : undefined;
            const orgId = org?.startsWith('org:') === true ? org.slice('org:'.length) : await this.orgOfAddress(address);
            if (orgId !== undefined) await audit(tx, { orgId, actorId: by ?? actorId, action: 'grant.revoked', targetKind: 'grant', targetId: grantId, detail: { revoked } });
            return revoked.map((id) => ({ id, expires: now.getTime() + TOKEN_LIFE_MS }));
        });
    }

    /**
     * Shared by me: the entries under an owner's tree and the ones they made, newest first, without the ones that come
     * with an org or an app (its owners and admins, whoever made an app)
     */
    async sharedBy(ownerId: string): Promise<Permission[]> {
        const number = await this.owners.nameOf(ownerId);
        return this.table(new Date()).find("(p.owner::text = $1 OR p.made_by::text = $2) AND p.kind NOT IN ('admins', 'creator', 'bound') ORDER BY p.created_at DESC, p.id LIMIT 500", [number, ownerId.toLowerCase()]);
    }

    /** The shares of a workspace's datasets that hold now, newest first */
    async datasetShares(workspaceId: string, now: Date = new Date()): Promise<GrantRecord[]> {
        return this.records(
            await this.table(now).find("p.owner::text = $1 AND p.pattern LIKE '$.data.%' AND p.kind = 'share' AND p.revoked_at IS NULL AND (p.until IS NULL OR p.until > $2) ORDER BY p.created_at DESC LIMIT 500", [
                await this.owners.nameOf(workspaceId),
                now
            ])
        );
    }

    /** The datasets shared with a workspace that hold now: read rights whose subject is the workspace, newest first */
    async datasetsSharedWith(workspaceId: string, now: Date = new Date()): Promise<GrantRecord[]> {
        return this.records(
            await this.table(now).find("p.subject = $1 AND p.pattern LIKE '$.data.%' AND 'read' = ANY(p.rights) AND p.revoked_at IS NULL AND (p.until IS NULL OR p.until > $2) ORDER BY p.created_at DESC LIMIT 500", [
                ownerSubject(await this.owners.nameOf(workspaceId)),
                now
            ])
        );
    }

    /** The share that lets a workspace read another's dataset now, if there is one */
    async datasetShare(readerId: string, owner: string, dataset: string, now: Date = new Date()): Promise<GrantRecord | undefined> {
        const found = await this.table(now).find("p.subject = $1 AND p.owner::text = $2 AND p.pattern = $3 AND 'read' = ANY(p.rights) AND p.revoked_at IS NULL AND (p.until IS NULL OR p.until > $4) ORDER BY p.created_at DESC LIMIT 1", [
            ownerSubject(await this.owners.nameOf(readerId)),
            await this.owners.nameOf(owner),
            `$.data.${dataset}`,
            now
        ]);
        return found.length === 0 ? undefined : (await this.records(found))[0];
    }

    /**
     * The access an instance's binding of a workspace's dataset connects with, as the persona it acts for
     * (docs/design/statenet-requests.md, R3b): the workspace itself for its own persona (`default`), otherwise a token
     * for the person's standing `bound` entry on the dataset, made the first time they bind it and kept until revoked,
     * with the rights the dataset's setting gives (R3c: read and write, or read and request). The token's keys are
     * loaded, so a check with `accessContext` reads them synchronously
     */
    async boundAccess(persona: string, workspaceId: string, dataset: string, now: Date = new Date()): Promise<Access> {
        const owner = await this.owners.nameOf(workspaceId);
        if (persona === 'default' || persona.toLowerCase() === workspaceId.toLowerCase()) return { subject: owner };
        const person = await this.owners.nameOf(persona);
        const table = this.table(now);
        const subject = ownerSubject(person);
        const pattern = `$.data.${dataset}`;
        const setting = await this.datasetSetting(workspaceId, dataset);
        const rights = boundRights(setting);
        let existing = (await table.find("p.kind = 'bound' AND p.owner::text = $1 AND p.subject = $2 AND p.pattern = $3 AND p.revoked_at IS NULL", [owner, subject, pattern]))[0];
        if (existing !== undefined && !(existing.rights.length === rights.length && rights.every((right) => existing?.rights.includes(right)))) {
            for (const id of await table.revoke(existing.id, undefined)) this.revokedIds.add(id);
            existing = undefined;
        }
        const id = existing?.id ?? (await table.make({ owner, pattern, subject, rights, kind: 'bound', ...(setting.rights === 'request' && { requestDays: setting.requestDays }) })).id;
        const grant = await this.tokenFor(id, now);
        await this.keys.load(grant);
        return { subject: person, grant };
    }

    /** The id of a workspace's data part by its name */
    private async datasetPartId(workspaceId: string, dataset: string): Promise<string | undefined> {
        return this.db.transaction(
            async (tx) => (await tx.query<{ id: string }>("SELECT id::text FROM part WHERE workspace_id = $1 AND kind = 'data' AND name = $2", [workspaceId, dataset])).rows[0]?.id,
            { workspaceIds: [workspaceId] }
        );
    }

    /** What people using a workspace's apps may do to one of its datasets; the default when nobody set it */
    async datasetSetting(workspaceId: string, dataset: string): Promise<DatasetSetting> {
        return (await this.datasetSettings(workspaceId)).get(dataset) ?? DEFAULT_DATASET_SETTING;
    }

    /** The settings of a workspace's datasets that were set, by dataset name */
    async datasetSettings(workspaceId: string): Promise<Map<string, DatasetSetting>> {
        const rows = await this.db.transaction(
            async (tx) =>
                (
                    await tx.query<{ name: string; bound_rights: 'write' | 'request'; request_days: number }>(
                        "SELECT p.name, s.bound_rights, s.request_days FROM dataset_setting s JOIN part p ON p.workspace_id = s.workspace_id AND p.id = s.part_id AND p.kind = 'data' WHERE s.workspace_id = $1",
                        [workspaceId]
                    )
                ).rows,
            { workspaceIds: [workspaceId] }
        );
        return new Map(rows.map((row) => [row.name, { rights: row.bound_rights, requestDays: row.request_days }]));
    }

    /**
     * Sets what people using a workspace's apps may do to one of its datasets. A change of rights revokes the dataset's
     * `bound` entries, so each person's next session gets the new rights (and their waiting requests end); a change of
     * days alone is written to them. Answers how many entries were revoked
     */
    async setDatasetSetting(workspaceId: string, dataset: string, setting: DatasetSetting, by: string, now: Date = new Date()): Promise<number> {
        if (setting.rights !== 'write' && setting.rights !== 'request') throw new OrgError(400, 'People using the apps either write a dataset or request changes.');
        if (!Number.isInteger(setting.requestDays) || setting.requestDays < 1 || setting.requestDays > 30) throw new OrgError(400, 'Requests wait 1 to 30 days.');
        const partId = await this.datasetPartId(workspaceId, dataset);
        if (partId === undefined) throw new OrgError(404, 'No such dataset.');
        const previous = await this.datasetSetting(workspaceId, dataset);
        await this.db.transaction(
            (tx) =>
                tx.query(
                    `INSERT INTO dataset_setting (workspace_id, part_id, bound_rights, request_days, updated_at, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (workspace_id, part_id) DO UPDATE SET bound_rights = $3, request_days = $4, updated_at = $5, updated_by = $6`,
                    [workspaceId, partId, setting.rights, setting.requestDays, now, UUID.test(by) ? by : null]
                ),
            { workspaceIds: [workspaceId] }
        );
        const owner = await this.owners.nameOf(workspaceId);
        const pattern = `$.data.${dataset}`;
        if (previous.rights !== setting.rights) {
            const revoked = await this.table(now).revokeWhere("p.kind = 'bound' AND p.owner::text = $1 AND p.pattern = $2", [owner, pattern], UUID.test(by) ? by : undefined);
            for (const id of revoked) this.revokedIds.add(id);
            return revoked.length;
        }
        if (setting.rights === 'request' && previous.requestDays !== setting.requestDays) {
            await this.db.query("UPDATE permission SET request_days = $3 WHERE kind = 'bound' AND owner::text = $1 AND pattern = $2 AND revoked_at IS NULL", [owner, pattern, setting.requestDays]);
        }
        return 0;
    }

    /**
     * What a dataset's authority checks sessions with: the keys loaded so far and the entries revoked within a token's
     * life, read now (`refreshRevoked`)
     */
    accessContext(): GrantContext {
        return { keyOf: (kid) => this.keys.keyOf(kid), now: Date.now(), revoked: (id) => this.revokedIds.has(id) };
    }

    /** Reads the entries revoked within a token's life, for `accessContext`; a server calls it every few seconds */
    async refreshRevoked(now: Date = new Date()): Promise<void> {
        const rows = (await this.db.query<{ id: string }>('SELECT id::text FROM permission WHERE revoked_at IS NOT NULL AND revoked_at > $1', [new Date(now.getTime() - TOKEN_LIFE_MS)])).rows;
        this.revokedIds = new Set(rows.map((row) => row.id));
    }

    /** The org's standing read of a member's state in its apps: made the first time the org reads it, and kept until revoked */
    async orgRead(orgId: string, userId: string, now: Date = new Date()): Promise<string> {
        const member = await this.owners.nameOf(userId);
        const org = (await this.owners.nameOf(orgSubject(orgId))).slice('org:'.length);
        const table = this.table(now);
        const subject = membersSubject(org, 'admin');
        const existing = (await table.find("p.kind = 'org-read' AND p.owner::text = $1 AND p.subject = $2 AND p.revoked_at IS NULL", [member, subject]))[0];
        if (existing !== undefined) return existing.id;
        return (await table.make({ owner: member, pattern: '$.apps.*', subject, rights: ['read'], kind: 'org-read' })).id;
    }

    private async checkPolicy(address: string, named: string): Promise<void> {
        // the org's members are known by their ids
        const subject = await this.owners.idOfName(named);
        const orgId = await this.orgOfAddress(address);
        if (orgId === undefined || !(await this.policies.get(orgId)).grantsInOrg) return;
        const member = (await this.db.query('SELECT 1 FROM org_member WHERE org_id = $1 AND (user_id::text = $2 OR $2 = $3)', [orgId, subject, orgSubject(orgId)])).rowCount ?? 0;
        if (member === 0) throw new OrgError(403, "The org's policy keeps grants of its apps' state in the org.");
    }

    /**
     * The org an address is under: the org whose workspace has the address's dataset, or holds the address's app (the
     * org's own state of it, or a member's, looked for in the workspaces of the orgs they are in)
     */
    private async orgOfAddress(named: string): Promise<string | undefined> {
        // a workspace is known by its id
        const address = await this.owners.addressById(named);
        const [owner = ''] = address.split('/');
        const own = (await this.db.query<{ org_id: string; id: string }>("SELECT org_id::text, id::text FROM workspace WHERE id::text = $1 AND kind = 'org'", [owner])).rows[0];
        if (own !== undefined) return own.org_id;
        const appId = appOf(address);
        if (appId === undefined || appId === '*') return undefined;
        const orgs = (await this.db.query<{ org_id: string; id: string }>("SELECT w.org_id::text, w.id::text FROM workspace w JOIN org_member m ON m.org_id = w.org_id WHERE m.user_id::text = $1 AND w.kind = 'org'", [owner])).rows;
        if (orgs.length === 0) return undefined;
        const holding = await this.db.transaction(
            async (tx) => (await tx.query<{ workspace_id: string }>("SELECT workspace_id::text FROM part WHERE kind = 'apps' AND id::text = $1 AND workspace_id = ANY($2::uuid[])", [appId.toLowerCase(), orgs.map((org) => org.id)])).rows[0]?.workspace_id,
            { workspaceIds: orgs.map((org) => org.id) }
        );
        return orgs.find((org) => org.id === holding)?.org_id;
    }
}

/** The subject an org reads as */
export const orgSubject = (orgId: string): string => `org:${orgId}`;

/** The entry ids of a token's chain, without checking it */
function chainIds(token: string): string[] {
    const ids: string[] = [];
    for (let claims = readGrant(token); claims !== undefined && ids.length < 16; claims = claims.parent === undefined ? undefined : readGrant(claims.parent)) ids.push(claims.entry);
    return ids;
}
