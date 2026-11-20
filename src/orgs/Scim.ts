import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';
import type { FilterTerm } from '../scim/filter.js';
import { ScimError } from '../scim/schemas.js';
import type { ScimGroupInput, ScimGroupRow, ScimUserInput, ScimUserRow } from '../scim/schemas.js';
import type { OrgDomains } from './Domains.js';
import { audit, dropMember, OrgError } from './Orgs.js';
import type { OrgRole, Orgs } from './Orgs.js';

/*
 * SCIM provisioning per org (docs/design/magnetic-scim.md): the org's identity provider pushes people and groups.
 * Nobody gets an account by SCIM: a pushed person is held by email until they sign in. Pushed groups are the
 * provider's. Deactivating or deleting a person removes them from the org
 */

const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A SCIM token: 32 random bytes, base64url */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** How stale `last_used_at` may get before a request writes it again */
const LAST_USED_EVERY = "interval '1 minute'";

/** Said when SCIM is turned on for an org with no verified domain */
export const SCIM_NEEDS_DOMAIN = "Verify a domain first: SCIM takes only people at the org's verified domains.";

/** An org's SCIM provisioning, as its settings page shows it */
export interface OrgScimStatus {
    readonly createdAt: string;
    readonly lastUsedAt?: string;
    /** Pushed people, linked or held */
    readonly users: number;
    /** Pushed people not yet signed in */
    readonly held: number;
    readonly groups: number;
}

/** What a change of the directory did to the org's people, for the server to close views */
export interface ScimOutcome {
    /** People removed from the org: all their views of its apps close */
    readonly removed: readonly string[];
    /** People who left a group: their views of apps they can no longer open close */
    readonly regrouped: readonly string[];
}

const NOTHING: ScimOutcome = { removed: [], regrouped: [] };

/** The owner's side of an org's SCIM: turning it on and off, and its token. Owners only, as for the org's sign-in */
export class OrgScim {
    constructor(
        private readonly db: Database,
        private readonly orgs: Orgs
    ) {}

    async status(actorId: string, orgId: string): Promise<OrgScimStatus | undefined> {
        await this.orgs.require(orgId, actorId, 'owner');
        const row = (
            await this.db.query<{ created_at: Date; last_used_at: Date | null; users: number; held: number; groups: number }>(
                `SELECT o.created_at, o.last_used_at,
                        (SELECT count(*)::int FROM scim_user s WHERE s.org_id = o.org_id) AS users,
                        (SELECT count(*)::int FROM scim_user s WHERE s.org_id = o.org_id AND s.user_id IS NULL) AS held,
                        (SELECT count(*)::int FROM org_group g WHERE g.org_id = o.org_id AND g.scim) AS groups
                   FROM org_scim o WHERE o.org_id = $1`,
                [orgId]
            )
        ).rows[0];
        if (row === undefined) return undefined;
        return { createdAt: row.created_at.toISOString(), ...(row.last_used_at !== null && { lastUsedAt: row.last_used_at.toISOString() }), users: row.users, held: row.held, groups: row.groups };
    }

    /** Whether the org takes its people by SCIM */
    async isOn(orgId: string): Promise<boolean> {
        return (await this.db.query('SELECT 1 FROM org_scim WHERE org_id = $1', [orgId])).rows.length > 0;
    }

    /** Turns SCIM on: the token, shown once. The org needs a verified domain */
    async enable(actorId: string, orgId: string): Promise<string> {
        await this.orgs.require(orgId, actorId, 'owner');
        const token = randomBytes(32).toString('base64url');
        await this.db.transaction(async (tx) => {
            const verified = (await tx.query('SELECT 1 FROM org_domain WHERE org_id = $1 AND verified_at IS NOT NULL', [orgId])).rows.length > 0;
            if (!verified) throw new OrgError(409, SCIM_NEEDS_DOMAIN);
            const made = (await tx.query('INSERT INTO org_scim (org_id, token_hash, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [orgId, hashOf(token), actorId])).rowCount ?? 0;
            if (made === 0) throw new OrgError(409, 'SCIM is on already.');
            await audit(tx, { orgId, actorId, action: 'scim.enabled', targetKind: 'org', targetId: orgId });
        });
        return token;
    }

    /** A new token; the old one stops at once */
    async replaceToken(actorId: string, orgId: string): Promise<string> {
        await this.orgs.require(orgId, actorId, 'owner');
        const token = randomBytes(32).toString('base64url');
        await this.db.transaction(async (tx) => {
            const changed = (await tx.query('UPDATE org_scim SET token_hash = $2, created_by = $3, created_at = now(), last_used_at = NULL WHERE org_id = $1', [orgId, hashOf(token), actorId])).rowCount ?? 0;
            if (changed === 0) throw new OrgError(409, 'SCIM is off.');
            await audit(tx, { orgId, actorId, action: 'scim.token_replaced', targetKind: 'org', targetId: orgId });
        });
        return token;
    }

    /** Turns SCIM off: the token and the held people go; members stay, and pushed groups become ordinary groups */
    async disable(actorId: string, orgId: string): Promise<void> {
        await this.orgs.require(orgId, actorId, 'owner');
        await this.db.transaction(async (tx) => {
            const gone = (await tx.query('DELETE FROM org_scim WHERE org_id = $1', [orgId])).rowCount ?? 0;
            if (gone === 0) throw new OrgError(409, 'SCIM is off.');
            await tx.query('DELETE FROM scim_user WHERE org_id = $1', [orgId]);
            await tx.query('UPDATE org_group SET scim = false, external_id = NULL WHERE org_id = $1 AND scim', [orgId]);
            await audit(tx, { orgId, actorId, action: 'scim.disabled', targetKind: 'org', targetId: orgId });
        });
    }

    /** Whether a token is the org's current one; notes its use */
    async accepts(orgId: string, token: string): Promise<boolean> {
        if (!TOKEN.test(token) || !UUID.test(orgId)) return false;
        const hash = hashOf(token);
        const found = (await this.db.query<{ stale: boolean }>(`SELECT last_used_at IS NULL OR last_used_at < now() - ${LAST_USED_EVERY} AS stale FROM org_scim WHERE org_id = $1 AND token_hash = $2`, [orgId, hash])).rows[0];
        if (found === undefined) return false;
        if (found.stale) await this.db.query('UPDATE org_scim SET last_used_at = now() WHERE org_id = $1', [orgId]);
        return true;
    }
}

const USER_COLUMNS = 'id, external_id, user_name, email, display_name, given_name, family_name, active, created_at, updated_at';
const GROUP_COLUMNS = 'id, name, external_id, created_at, updated_at';

interface HeldRow extends ScimUserRow {
    readonly org_id: string;
    readonly user_id: string | null;
}

/** A filter as SQL over `scim_user` or `org_group g`, with its parameters numbered from `from` */
function whereOf(terms: readonly FilterTerm[], columns: Readonly<Record<string, (n: number) => string>>, from: number): { readonly sql: string; readonly params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const term of terms) {
        const column = columns[term.attribute];
        if (column === undefined) throw new ScimError(400, `Filtering on ${term.attribute} is not supported.`, 'invalidFilter');
        params.push(term.value);
        parts.push(column(from + params.length - 1));
    }
    return { sql: parts.map((part) => ` AND ${part}`).join(''), params };
}

const USER_FILTERS: Readonly<Record<string, (n: number) => string>> = {
    username: (n) => `lower(user_name) = lower($${n}::text)`,
    externalid: (n) => `external_id = $${n}::text`,
    'emails.value': (n) => `lower(email) = lower($${n}::text)`,
    emails: (n) => `lower(email) = lower($${n}::text)`,
    id: (n) => `id::text = $${n}::text`,
    displayname: (n) => `display_name = $${n}::text`,
    active: (n) => `active::text = lower($${n}::text)`
};

const GROUP_FILTERS: Readonly<Record<string, (n: number) => string>> = {
    displayname: (n) => `lower(name) = lower($${n}::text)`,
    externalid: (n) => `external_id = $${n}::text`,
    id: (n) => `id::text = $${n}::text`,
    'members.value': (n) => `EXISTS (SELECT 1 FROM scim_group_member sm WHERE sm.group_id = org_group.id AND sm.scim_user_id::text = $${n}::text)`
};

const unique = (error: unknown, what: string): never => {
    if (isUniqueViolation(error)) throw new ScimError(409, what, 'uniqueness');
    throw error;
};

/**
 * The org's people and groups as its identity provider pushes them (`scim_user`, `scim_group_member`, and `org_group`
 * rows marked `scim`), and what that does to the org: linking a person to their account, making and ending their
 * membership, and keeping pushed groups' members. Each change is one transaction, audited with `via: 'scim'`
 */
export class ScimDirectory {
    constructor(
        private readonly db: Database,
        private readonly domains: OrgDomains
    ) {}

    async listUsers(orgId: string, terms: readonly FilterTerm[], startIndex: number, count: number): Promise<{ readonly rows: ScimUserRow[]; readonly total: number }> {
        const where = whereOf(terms, USER_FILTERS, 2);
        const total = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM scim_user WHERE org_id = $1${where.sql}`, [orgId, ...where.params])).rows[0]?.n ?? 0;
        const rows = count === 0 ? [] : (await this.db.query<ScimUserRow>(`SELECT ${USER_COLUMNS} FROM scim_user WHERE org_id = $1${where.sql} ORDER BY created_at, id OFFSET ${startIndex - 1} LIMIT ${count}`, [orgId, ...where.params])).rows;
        return { rows, total };
    }

    async user(orgId: string, id: string): Promise<ScimUserRow | undefined> {
        if (!UUID.test(id)) return undefined;
        return (await this.db.query<ScimUserRow>(`SELECT ${USER_COLUMNS} FROM scim_user WHERE org_id = $1 AND id = $2`, [orgId, id])).rows[0];
    }

    async createUser(orgId: string, input: ScimUserInput): Promise<{ readonly row: ScimUserRow; readonly outcome: ScimOutcome }> {
        await this.atOrgDomain(orgId, input.email);
        const id = randomUUID();
        try {
            return await this.db.transaction(async (tx) => {
                await tx.query(
                    'INSERT INTO scim_user (id, org_id, external_id, user_name, email, display_name, given_name, family_name, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                    [id, orgId, input.externalId ?? null, input.userName, input.email, input.displayName ?? null, input.givenName ?? null, input.familyName ?? null, input.active]
                );
                await audit(tx, { orgId, action: 'scim.user_pushed', targetKind: 'scim_user', targetId: id, detail: { via: 'scim', active: input.active } });
                const outcome = await this.settle(tx, orgId, id);
                return { row: (await this.userIn(tx, orgId, id)) as ScimUserRow, outcome };
            });
        } catch (error) {
            return unique(error, 'The org has a user with this userName or email already.');
        }
    }

    /** Replaces what is kept of a user (PUT, and PATCH after its operations) */
    async replaceUser(orgId: string, id: string, input: ScimUserInput): Promise<{ readonly row: ScimUserRow; readonly outcome: ScimOutcome } | undefined> {
        if (!UUID.test(id)) return undefined;
        await this.atOrgDomain(orgId, input.email);
        try {
            return await this.db.transaction(async (tx) => {
                const before = (await tx.query<{ active: boolean; email: string }>('SELECT active, email FROM scim_user WHERE org_id = $1 AND id = $2 FOR UPDATE', [orgId, id])).rows[0];
                if (before === undefined) return undefined;
                await tx.query(
                    'UPDATE scim_user SET external_id = $3, user_name = $4, email = $5, display_name = $6, given_name = $7, family_name = $8, active = $9, updated_at = now() WHERE org_id = $1 AND id = $2',
                    [orgId, id, input.externalId ?? null, input.userName, input.email, input.displayName ?? null, input.givenName ?? null, input.familyName ?? null, input.active]
                );
                await audit(tx, { orgId, action: 'scim.user_changed', targetKind: 'scim_user', targetId: id, detail: { via: 'scim', ...(before.active !== input.active && { active: input.active }), ...(before.email !== input.email && { email: 'changed' }) } });
                const outcome = await this.settle(tx, orgId, id);
                return { row: (await this.userIn(tx, orgId, id)) as ScimUserRow, outcome };
            });
        } catch (error) {
            return unique(error, 'The org has a user with this userName or email already.');
        }
    }

    /** Deletes a pushed user, removing their account from the org; `undefined` when there is none */
    async deleteUser(orgId: string, id: string): Promise<ScimOutcome | undefined> {
        if (!UUID.test(id)) return undefined;
        return this.db.transaction(async (tx) => {
            const row = (await tx.query<{ user_id: string | null }>('SELECT user_id FROM scim_user WHERE org_id = $1 AND id = $2 FOR UPDATE', [orgId, id])).rows[0];
            if (row === undefined) return undefined;
            const removed = row.user_id === null ? [] : await this.removeMember(tx, orgId, row.user_id);
            await tx.query('DELETE FROM scim_user WHERE org_id = $1 AND id = $2', [orgId, id]);
            await audit(tx, { orgId, action: 'scim.user_deleted', targetKind: 'scim_user', targetId: id, detail: { via: 'scim' } });
            return { removed, regrouped: [] };
        });
    }

    async listGroups(orgId: string, terms: readonly FilterTerm[], startIndex: number, count: number): Promise<{ readonly rows: ScimGroupRow[]; readonly total: number }> {
        const where = whereOf(terms, GROUP_FILTERS, 2);
        const total = (await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM org_group WHERE org_id = $1 AND scim${where.sql}`, [orgId, ...where.params])).rows[0]?.n ?? 0;
        const rows = count === 0 ? [] : (await this.db.query<ScimGroupRow>(`SELECT ${GROUP_COLUMNS} FROM org_group WHERE org_id = $1 AND scim${where.sql} ORDER BY created_at, id OFFSET ${startIndex - 1} LIMIT ${count}`, [orgId, ...where.params])).rows;
        return { rows, total };
    }

    async group(orgId: string, id: string): Promise<ScimGroupRow | undefined> {
        if (!UUID.test(id)) return undefined;
        return (await this.db.query<ScimGroupRow>(`SELECT ${GROUP_COLUMNS} FROM org_group WHERE org_id = $1 AND id = $2 AND scim`, [orgId, id])).rows[0];
    }

    /** The pushed members of groups, by group id: their SCIM ids and the names to show */
    async membersOf(groupIds: readonly string[]): Promise<Map<string, Array<{ readonly id: string; readonly display: string }>>> {
        const members = new Map<string, Array<{ readonly id: string; readonly display: string }>>(groupIds.map((id) => [id, []]));
        if (groupIds.length === 0) return members;
        const rows = (
            await this.db.query<{ group_id: string; id: string; display: string }>(
                'SELECT sm.group_id, s.id, coalesce(s.display_name, s.user_name) AS display FROM scim_group_member sm JOIN scim_user s ON s.id = sm.scim_user_id WHERE sm.group_id = ANY($1::uuid[]) ORDER BY s.created_at, s.id',
                [groupIds]
            )
        ).rows;
        for (const row of rows) members.get(row.group_id)?.push({ id: row.id, display: row.display });
        return members;
    }

    async createGroup(orgId: string, input: ScimGroupInput): Promise<{ readonly row: ScimGroupRow; readonly outcome: ScimOutcome }> {
        const id = randomUUID();
        try {
            return await this.db.transaction(async (tx) => {
                await tx.query('INSERT INTO org_group (id, org_id, name, scim, external_id) VALUES ($1, $2, $3, true, $4)', [id, orgId, input.displayName, input.externalId ?? null]);
                const regrouped = await this.setMembers(tx, orgId, id, input.members);
                await audit(tx, { orgId, action: 'scim.group_pushed', targetKind: 'group', targetId: id, detail: { via: 'scim', members: input.members.length } });
                return { row: (await this.groupIn(tx, orgId, id)) as ScimGroupRow, outcome: { removed: [], regrouped } };
            });
        } catch (error) {
            return unique(error, 'The org has a group of this name already.');
        }
    }

    /** Replaces a pushed group's name and members (PUT, and PATCH after its operations) */
    async replaceGroup(orgId: string, id: string, input: ScimGroupInput): Promise<{ readonly row: ScimGroupRow; readonly outcome: ScimOutcome } | undefined> {
        if (!UUID.test(id)) return undefined;
        try {
            return await this.db.transaction(async (tx) => {
                const before = (await tx.query<{ name: string }>('SELECT name FROM org_group WHERE org_id = $1 AND id = $2 AND scim FOR UPDATE', [orgId, id])).rows[0];
                if (before === undefined) return undefined;
                await tx.query('UPDATE org_group SET name = $3, external_id = $4, updated_at = now() WHERE org_id = $1 AND id = $2', [orgId, id, input.displayName, input.externalId ?? null]);
                const regrouped = await this.setMembers(tx, orgId, id, input.members);
                await audit(tx, { orgId, action: 'scim.group_changed', targetKind: 'group', targetId: id, detail: { via: 'scim', ...(before.name !== input.displayName && { renamed: true }), members: input.members.length, left: regrouped.length } });
                return { row: (await this.groupIn(tx, orgId, id)) as ScimGroupRow, outcome: { removed: [], regrouped } };
            });
        } catch (error) {
            return unique(error, 'The org has a group of this name already.');
        }
    }

    /** Deletes a pushed group and the app access given to it */
    async deleteGroup(orgId: string, id: string): Promise<ScimOutcome | undefined> {
        if (!UUID.test(id)) return undefined;
        return this.db.transaction(async (tx) => {
            const found = (await tx.query('SELECT 1 FROM org_group WHERE org_id = $1 AND id = $2 AND scim FOR UPDATE', [orgId, id])).rows.length > 0;
            if (!found) return undefined;
            const regrouped = (await tx.query<{ user_id: string }>('SELECT user_id FROM org_group_member WHERE group_id = $1', [id])).rows.map((row) => row.user_id);
            await tx.query("DELETE FROM app_access WHERE principal_kind = 'group' AND principal_id = $2 AND workspace_id = (SELECT id FROM workspace WHERE org_id = $1)", [orgId, id]);
            await tx.query('DELETE FROM org_group WHERE org_id = $1 AND id = $2', [orgId, id]);
            await audit(tx, { orgId, action: 'scim.group_deleted', targetKind: 'group', targetId: id, detail: { via: 'scim' } });
            return { removed: [], regrouped };
        });
    }

    /**
     * After a sign-in with a verified email: links the people pushed with that email, while active and held, to the
     * account, at each org whose verified domain it is, and makes them members with their pushed groups. The orgs they
     * joined
     */
    async signedIn(userId: string, email: string): Promise<string[]> {
        const held = (await this.db.query<{ org_id: string }>('SELECT s.org_id FROM scim_user s JOIN org_scim o ON o.org_id = s.org_id WHERE lower(s.email) = lower($1) AND s.user_id IS NULL AND s.active', [email])).rows;
        const joined: string[] = [];
        for (const { org_id: orgId } of held) {
            if ((await this.domains.orgOfEmail(email)) !== orgId) continue;
            await this.db.transaction(async (tx) => {
                const row = (await tx.query<{ id: string }>('SELECT id FROM scim_user WHERE org_id = $1 AND lower(email) = lower($2) AND user_id IS NULL AND active FOR UPDATE', [orgId, email])).rows[0];
                if (row === undefined) return;
                // An account linked to another pushed person of the org stays theirs
                if ((await tx.query('SELECT 1 FROM scim_user WHERE org_id = $1 AND user_id = $2', [orgId, userId])).rows.length > 0) return;
                await tx.query('UPDATE scim_user SET user_id = $3 WHERE org_id = $1 AND id = $2', [orgId, row.id, userId]);
                await this.settle(tx, orgId, row.id);
                joined.push(orgId);
            });
        }
        return joined;
    }

    /** Refuses an email outside the org's verified domains */
    private async atOrgDomain(orgId: string, email: string): Promise<void> {
        if ((await this.domains.orgOfEmail(email)) !== orgId) throw new ScimError(400, "The email is not at one of the org's verified domains.", 'invalidValue');
    }

    private async userIn(tx: Queryable, orgId: string, id: string): Promise<ScimUserRow | undefined> {
        return (await tx.query<ScimUserRow>(`SELECT ${USER_COLUMNS} FROM scim_user WHERE org_id = $1 AND id = $2`, [orgId, id])).rows[0];
    }

    private async groupIn(tx: Queryable, orgId: string, id: string): Promise<ScimGroupRow | undefined> {
        return (await tx.query<ScimGroupRow>(`SELECT ${GROUP_COLUMNS} FROM org_group WHERE org_id = $1 AND id = $2`, [orgId, id])).rows[0];
    }

    /**
     * Brings the org in line with a pushed person: linked to an account that is already a member with that verified
     * email, when not linked yet; then, when linked, a member with their pushed groups while active, and not a member
     * while not
     */
    private async settle(tx: Queryable, orgId: string, id: string): Promise<ScimOutcome> {
        const row = (await tx.query<HeldRow>(`SELECT ${USER_COLUMNS}, org_id, user_id FROM scim_user WHERE org_id = $1 AND id = $2`, [orgId, id])).rows[0];
        if (row === undefined) return NOTHING;
        let userId = row.user_id;
        if (userId === null) {
            userId =
                (
                    await tx.query<{ id: string }>(
                        `SELECT u.id FROM app_user u JOIN org_member m ON m.user_id = u.id AND m.org_id = $1
                          WHERE lower(u.email) = lower($2) AND u.email_verified AND NOT EXISTS (SELECT 1 FROM scim_user s WHERE s.org_id = $1 AND s.user_id = u.id)
                          ORDER BY m.joined_at, u.id LIMIT 1`,
                        [orgId, row.email]
                    )
                ).rows[0]?.id ?? null;
            if (userId === null) return NOTHING;
            await tx.query('UPDATE scim_user SET user_id = $3 WHERE org_id = $1 AND id = $2', [orgId, id, userId]);
        }
        const member = (await tx.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, userId])).rows[0];
        if (!row.active) return member === undefined ? NOTHING : { removed: await this.removeMember(tx, orgId, userId), regrouped: [] };
        if (member === undefined) {
            await tx.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member')", [orgId, userId]);
            await audit(tx, { orgId, actorId: userId, action: 'member.provisioned', targetKind: 'user', targetId: userId, detail: { via: 'scim' } });
        }
        await tx.query('INSERT INTO org_group_member (group_id, user_id) SELECT group_id, $2 FROM scim_group_member WHERE scim_user_id = $1 ON CONFLICT DO NOTHING', [id, userId]);
        return NOTHING;
    }

    /** Removes a member as SCIM does: never the org's last owner */
    private async removeMember(tx: Queryable, orgId: string, userId: string): Promise<string[]> {
        const role = (await tx.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, userId])).rows[0]?.role;
        if (role === undefined) return [];
        if (role === 'owner') {
            const others = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM org_member WHERE org_id = $1 AND role = 'owner' AND user_id <> $2", [orgId, userId])).rows[0]?.n ?? 0;
            if (others === 0) throw new ScimError(409, "The org's last owner is removed in Magnetic, not by its identity provider.", 'mutability');
        }
        await dropMember(tx, orgId, userId);
        await audit(tx, { orgId, action: 'member.deprovisioned', targetKind: 'user', targetId: userId, detail: { via: 'scim', role } });
        return [userId];
    }

    /** Sets a pushed group's members by their SCIM ids; the accounts that left the group */
    private async setMembers(tx: Queryable, orgId: string, groupId: string, members: readonly string[]): Promise<string[]> {
        const ids = members.filter((id) => UUID.test(id));
        if (ids.length !== members.length || (ids.length > 0 && ((await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM scim_user WHERE org_id = $1 AND id = ANY($2::uuid[])', [orgId, ids])).rows[0]?.n ?? 0) !== ids.length)) {
            throw new ScimError(400, 'A member is not a user of this org.', 'invalidValue');
        }
        await tx.query('DELETE FROM scim_group_member WHERE group_id = $1 AND NOT (scim_user_id = ANY($2::uuid[]))', [groupId, ids]);
        await tx.query('INSERT INTO scim_group_member (group_id, scim_user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [groupId, ids]);
        // The accounts in the group: the linked, active pushed members who are in the org
        const wanted = (
            await tx.query<{ user_id: string }>(
                'SELECT s.user_id FROM scim_group_member sm JOIN scim_user s ON s.id = sm.scim_user_id JOIN org_member m ON m.org_id = s.org_id AND m.user_id = s.user_id WHERE sm.group_id = $1 AND s.active',
                [groupId]
            )
        ).rows.map((row) => row.user_id);
        const left = (await tx.query<{ user_id: string }>('DELETE FROM org_group_member WHERE group_id = $1 AND NOT (user_id = ANY($2::uuid[])) RETURNING user_id', [groupId, wanted])).rows.map((row) => row.user_id);
        await tx.query('INSERT INTO org_group_member (group_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [groupId, wanted]);
        return left;
    }
}
