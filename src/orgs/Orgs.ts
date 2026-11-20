import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@punyts/stateui-pg';
import type { Database, Queryable } from '@punyts/stateui-pg';

export const ORG_ROLES = ['owner', 'admin', 'builder', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** How far each role reaches: a role can do what the roles below it can */
const RANK: Record<OrgRole, number> = { member: 0, builder: 1, admin: 2, owner: 3 };
/** An invite id: a UUID */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isOrgRole(value: unknown): value is OrgRole {
    return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

/** True when `role` reaches at least `least` */
export function atLeast(role: OrgRole | undefined, least: OrgRole): boolean {
    return role !== undefined && RANK[role] >= RANK[least];
}

export interface Org {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    /** The org's workspace, where its apps live */
    readonly workspaceId: string;
    readonly createdAt: string;
}

/** An org seen by one of its members */
export interface Membership extends Org {
    readonly role: OrgRole;
}

/** An invite waiting for the person it is for, as their Your apps shows it */
export interface PendingInvite {
    readonly id: string;
    readonly org: Org;
    readonly role: OrgRole;
    /** The name of the person who invited them */
    readonly invitedBy: string;
    readonly expiresAt: string;
}

export interface OrgMember {
    readonly userId: string;
    readonly name: string;
    readonly email?: string;
    readonly role: OrgRole;
    readonly joinedAt: string;
    readonly groups: readonly string[];
}

export interface OrgGroup {
    readonly id: string;
    readonly name: string;
    readonly members: readonly string[];
}

/** Why an org change was refused, said to the person */
export class OrgError extends Error {
    constructor(
        readonly status: 400 | 403 | 404 | 409,
        message: string
    ) {
        super(message);
    }
}

/** How long an invite can be accepted */
export const INVITE_DAYS = 7;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

interface OrgRow {
    id: string;
    slug: string;
    name: string;
    workspace_id: string;
    created_at: Date;
}

function orgOf(row: OrgRow): Org {
    return { id: row.id, slug: row.slug, name: row.name, workspaceId: row.workspace_id, createdAt: row.created_at.toISOString() };
}

const ORG_SELECT = 'SELECT o.id, o.slug, o.name, w.id AS workspace_id, o.created_at FROM org o JOIN workspace w ON w.org_id = o.id';

/** One row of the audit log */
export interface AuditEntry {
    readonly orgId?: string;
    readonly workspaceId?: string;
    readonly actorId?: string;
    readonly action: string;
    readonly targetKind?: string;
    readonly targetId?: string;
    readonly detail?: Record<string, unknown>;
    /** The address the request came from */
    readonly ip?: string;
}

/** Writes one audit event, in the transaction given */
export async function audit(tx: Queryable, entry: AuditEntry): Promise<void> {
    await tx.query('INSERT INTO audit_event (org_id, workspace_id, actor_id, action, target_kind, target_id, detail, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
        entry.orgId ?? null,
        entry.workspaceId ?? null,
        entry.actorId ?? null,
        entry.action,
        entry.targetKind ?? null,
        entry.targetId ?? null,
        JSON.stringify(entry.detail ?? {}),
        entry.ip ?? null
    ]);
}

/**
 * Orgs and their people (`org`, `org_member`, `org_group`, `org_invite`, `workspace`). Every change is checked against
 * the role of the person making it and written to the audit log in the same transaction. An org always keeps at least
 * one owner
 */
export class Orgs {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** Makes an org with its workspace; the person who makes it is its first owner */
    async create(userId: string, input: { readonly name: string; readonly slug: string }): Promise<Org> {
        const name = input.name.trim().slice(0, 200);
        const slug = input.slug.trim().toLowerCase();
        if (name === '') throw new OrgError(400, 'Give the org a name.');
        if (!SLUG.test(slug)) throw new OrgError(400, 'A slug is 2 to 63 lower-case letters, digits and dashes.');
        const id = randomUUID();
        const workspaceId = randomUUID();
        try {
            await this.db.transaction(async (tx) => {
                await tx.query('INSERT INTO org (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [id, slug, name, userId]);
                await tx.query("INSERT INTO workspace (id, kind, org_id) VALUES ($1, 'org', $2)", [workspaceId, id]);
                await tx.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'owner')", [id, userId]);
                await audit(tx, { orgId: id, workspaceId, actorId: userId, action: 'org.created', targetKind: 'org', targetId: id, detail: { name, slug } });
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new OrgError(409, 'An org already has this slug.');
            throw error;
        }
        return (await this.get(id)) as Org;
    }

    async get(orgId: string): Promise<Org | undefined> {
        const row = (await this.db.query<OrgRow>(`${ORG_SELECT} WHERE o.id = $1`, [orgId])).rows[0];
        return row === undefined ? undefined : orgOf(row);
    }

    /** The org whose workspace this is, if it is an org's */
    async byWorkspace(workspaceId: string): Promise<Org | undefined> {
        const row = (await this.db.query<OrgRow>(`${ORG_SELECT} WHERE w.id = $1`, [workspaceId])).rows[0];
        return row === undefined ? undefined : orgOf(row);
    }

    /** The orgs a person belongs to, with their role in each, by name */
    async of(userId: string): Promise<Membership[]> {
        const rows = (
            await this.db.query<OrgRow & { role: OrgRole }>(
                'SELECT o.id, o.slug, o.name, w.id AS workspace_id, o.created_at, m.role FROM org o JOIN workspace w ON w.org_id = o.id JOIN org_member m ON m.org_id = o.id AND m.user_id = $1 ORDER BY o.name, o.id',
                [userId]
            )
        ).rows;
        return rows.map((row) => ({ ...orgOf(row), role: row.role }));
    }

    /** A person's role in an org, or `undefined` when they are not in it */
    async role(orgId: string, userId: string): Promise<OrgRole | undefined> {
        return (await this.db.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2', [orgId, userId])).rows[0]?.role;
    }

    /** The members of an org with their groups, for the people who may see them (any member) */
    async members(actorId: string, orgId: string): Promise<OrgMember[]> {
        await this.require(orgId, actorId, 'member');
        const rows = (
            await this.db.query<{ user_id: string; name: string; email: string | null; role: OrgRole; joined_at: Date; groups: string[] | null }>(
                `SELECT m.user_id, u.name, u.email, m.role, m.joined_at,
                        (SELECT array_agg(g.name ORDER BY g.name) FROM org_group g JOIN org_group_member gm ON gm.group_id = g.id WHERE g.org_id = m.org_id AND gm.user_id = m.user_id) AS groups
                   FROM org_member m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY u.name, m.user_id`,
                [orgId]
            )
        ).rows;
        return rows.map((row) => ({
            userId: row.user_id,
            name: row.name,
            ...(row.email !== null && { email: row.email }),
            role: row.role,
            joinedAt: row.joined_at.toISOString(),
            groups: row.groups ?? []
        }));
    }

    /** Changes a member's role. Admins manage members and builders; only owners make or unmake owners and admins */
    async setRole(actorId: string, orgId: string, userId: string, role: OrgRole): Promise<void> {
        await this.db.transaction(async (tx) => {
            const actor = await this.lockedRole(tx, orgId, actorId);
            const current = await this.lockedRole(tx, orgId, userId);
            if (current === undefined) throw new OrgError(404, 'That person is not in the org.');
            this.mayChange(actor, current, role);
            if (current === 'owner' && role !== 'owner') await this.keepAnOwner(tx, orgId, userId);
            await tx.query('UPDATE org_member SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, userId, role]);
            await audit(tx, { orgId, actorId, action: 'member.role', targetKind: 'user', targetId: userId, detail: { from: current, to: role } });
        });
    }

    /** Removes a member, and them from every group of the org. A member may leave; otherwise as for `setRole` */
    async remove(actorId: string, orgId: string, userId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const actor = await this.lockedRole(tx, orgId, actorId);
            const current = await this.lockedRole(tx, orgId, userId);
            if (current === undefined) throw new OrgError(404, 'That person is not in the org.');
            if (actorId !== userId) this.mayChange(actor, current, 'member');
            if (current === 'owner') await this.keepAnOwner(tx, orgId, userId);
            await tx.query('DELETE FROM org_group_member WHERE user_id = $2 AND group_id IN (SELECT id FROM org_group WHERE org_id = $1)', [orgId, userId]);
            await tx.query("DELETE FROM app_access WHERE principal_kind = 'user' AND principal_id = $2 AND workspace_id = (SELECT id FROM workspace WHERE org_id = $1)", [orgId, userId]);
            await tx.query('DELETE FROM org_member WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
            // The org reads a member's state only while they are one
            await tx.query("UPDATE state_grant SET revoked_at = now() WHERE kind = 'org-read' AND org_id = $1 AND issuer = (SELECT owner_number::text FROM app_user WHERE id = $2) AND revoked_at IS NULL", [orgId, userId]);
            await audit(tx, { orgId, actorId, action: actorId === userId ? 'member.left' : 'member.removed', targetKind: 'user', targetId: userId, detail: { role: current } });
        });
    }

    /** Makes a group; admins and owners */
    async createGroup(actorId: string, orgId: string, name: string): Promise<OrgGroup> {
        const trimmed = name.trim().slice(0, 100);
        if (trimmed === '') throw new OrgError(400, 'Give the group a name.');
        const id = randomUUID();
        try {
            await this.db.transaction(async (tx) => {
                await this.requireIn(tx, orgId, actorId, 'admin');
                await tx.query('INSERT INTO org_group (id, org_id, name) VALUES ($1, $2, $3)', [id, orgId, trimmed]);
                await audit(tx, { orgId, actorId, action: 'group.created', targetKind: 'group', targetId: id, detail: { name: trimmed } });
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new OrgError(409, 'The org already has a group of this name.');
            throw error;
        }
        return { id, name: trimmed, members: [] };
    }

    async groups(actorId: string, orgId: string): Promise<OrgGroup[]> {
        await this.require(orgId, actorId, 'member');
        const rows = (
            await this.db.query<{ id: string; name: string; members: string[] | null }>(
                'SELECT g.id, g.name, (SELECT array_agg(gm.user_id ORDER BY gm.user_id) FROM org_group_member gm WHERE gm.group_id = g.id) AS members FROM org_group g WHERE g.org_id = $1 ORDER BY g.name',
                [orgId]
            )
        ).rows;
        return rows.map((row) => ({ id: row.id, name: row.name, members: row.members ?? [] }));
    }

    /** Puts a member in a group, or takes them out; admins and owners */
    async setGroupMember(actorId: string, orgId: string, groupId: string, userId: string, member: boolean): Promise<void> {
        await this.db.transaction(async (tx) => {
            await this.requireIn(tx, orgId, actorId, 'admin');
            const group = (await tx.query('SELECT 1 FROM org_group WHERE id = $1 AND org_id = $2', [groupId, orgId])).rows.length > 0;
            if (!group) throw new OrgError(404, 'The org has no such group.');
            if (member) {
                if ((await this.lockedRole(tx, orgId, userId)) === undefined) throw new OrgError(404, 'That person is not in the org.');
                await tx.query('INSERT INTO org_group_member (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, userId]);
            } else {
                await tx.query('DELETE FROM org_group_member WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
            }
            await audit(tx, { orgId, actorId, action: member ? 'group.member_added' : 'group.member_removed', targetKind: 'group', targetId: groupId, detail: { userId } });
        });
    }

    /** The ids of the groups of an org a person is in */
    async groupIdsOf(orgId: string, userId: string): Promise<string[]> {
        return (await this.db.query<{ id: string }>('SELECT g.id FROM org_group g JOIN org_group_member gm ON gm.group_id = g.id WHERE g.org_id = $1 AND gm.user_id = $2', [orgId, userId])).rows.map(
            (row) => row.id
        );
    }

    /**
     * Invites an email to the org with a role and groups, and returns the invite's token for the link (only its hash is
     * kept). Admins invite up to admin; only owners invite owners
     */
    async invite(
        actorId: string,
        orgId: string,
        input: { readonly email: string; readonly role: OrgRole; readonly groups?: readonly string[] }
    ): Promise<{ readonly id: string; readonly token: string; readonly expiresAt: string }> {
        const email = input.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new OrgError(400, 'That is not an email address.');
        const token = randomBytes(32).toString('base64url');
        const id = randomUUID();
        const expiresAt = new Date(this.now().getTime() + INVITE_DAYS * 86_400_000);
        await this.db.transaction(async (tx) => {
            const actor = await this.requireIn(tx, orgId, actorId, 'admin');
            if (input.role === 'owner' && actor !== 'owner') throw new OrgError(403, 'Only an owner can invite an owner.');
            const groups = [...new Set(input.groups ?? [])];
            if (groups.length > 0) {
                const found = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM org_group WHERE org_id = $1 AND id = ANY($2::uuid[])', [orgId, groups])).rows[0]?.n ?? 0;
                if (found !== groups.length) throw new OrgError(404, 'The org has no such group.');
            }
            await tx.query('INSERT INTO org_invite (id, org_id, email, role, groups, token_hash, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
                id,
                orgId,
                email,
                input.role,
                groups,
                hashOf(token),
                actorId,
                this.now(),
                expiresAt
            ]);
            await audit(tx, { orgId, actorId, action: 'invite.created', targetKind: 'invite', targetId: id, detail: { email, role: input.role, groups } });
        });
        return { id, token, expiresAt: expiresAt.toISOString() };
    }

    /**
     * Accepts an invite: once, before it expires, and only by a signed-in person whose verified email is the one invited.
     * Someone already in the org keeps the higher of the two roles
     */
    async accept(token: string, userId: string): Promise<Org> {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new OrgError(404, 'This invite is not valid.');
        return this.acceptWhere('token_hash', hashOf(token), userId);
    }

    /** Accepts an invite waiting on the person's Your apps, by its id: as `accept`, for the person whose verified email it names */
    async acceptInvite(inviteId: string, userId: string): Promise<Org> {
        if (!UUID_PATTERN.test(inviteId)) throw new OrgError(404, 'This invite is not valid.');
        return this.acceptWhere('id', inviteId, userId);
    }

    /** Declines an invite waiting on the person's Your apps: it is not shown again, and its link stops working */
    async decline(inviteId: string, userId: string): Promise<void> {
        if (!UUID_PATTERN.test(inviteId)) throw new OrgError(404, 'This invite is not valid.');
        await this.db.transaction(async (tx) => {
            const invite = (await tx.query<{ org_id: string; email: string }>('SELECT org_id, email FROM org_invite WHERE id = $1 AND accepted_at IS NULL AND declined_at IS NULL FOR UPDATE', [inviteId])).rows[0];
            const user = (await tx.query<{ email: string | null; email_verified: boolean }>('SELECT email, email_verified FROM app_user WHERE id = $1', [userId])).rows[0];
            if (invite === undefined || user?.email?.toLowerCase() !== invite.email || !user.email_verified) throw new OrgError(404, 'This invite is not valid any more.');
            await tx.query('UPDATE org_invite SET declined_at = $2 WHERE id = $1', [inviteId, this.now()]);
            await audit(tx, { orgId: invite.org_id, actorId: userId, action: 'invite.declined', targetKind: 'invite', targetId: inviteId, detail: {} });
        });
    }

    /**
     * The invites waiting for a person: to their verified email, not yet accepted, declined or out of date, to orgs they
     * are not in already. Newest first
     */
    async pendingFor(userId: string): Promise<PendingInvite[]> {
        const user = (await this.db.query<{ email: string | null; email_verified: boolean }>('SELECT email, email_verified FROM app_user WHERE id = $1', [userId])).rows[0];
        if (user?.email === null || user?.email === undefined || !user.email_verified) return [];
        const rows = (
            await this.db.query<{ id: string; org_id: string; role: OrgRole; expires_at: Date; invited_by: string }>(
                `SELECT i.id, i.org_id, i.role, i.expires_at, u.name AS invited_by
                   FROM org_invite i JOIN app_user u ON u.id = i.created_by
                  WHERE i.email = $1 AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at > $2
                    AND NOT EXISTS (SELECT 1 FROM org_member m WHERE m.org_id = i.org_id AND m.user_id = $3)
                  ORDER BY i.created_at DESC`,
                [user.email.toLowerCase(), this.now(), userId]
            )
        ).rows;
        const invites: PendingInvite[] = [];
        for (const row of rows) {
            const org = await this.get(row.org_id);
            if (org !== undefined) invites.push({ id: row.id, org, role: row.role, invitedBy: row.invited_by, expiresAt: row.expires_at.toISOString() });
        }
        return invites;
    }

    private async acceptWhere(column: 'token_hash' | 'id', value: string, userId: string): Promise<Org> {
        const orgId = await this.db.transaction(async (tx) => {
            const invite = (
                await tx.query<{ id: string; org_id: string; email: string; role: OrgRole; groups: string[]; expires_at: Date; accepted_at: Date | null; declined_at: Date | null }>(
                    `SELECT id, org_id, email, role, groups, expires_at, accepted_at, declined_at FROM org_invite WHERE ${column} = $1 FOR UPDATE`,
                    [value]
                )
            ).rows[0];
            if (invite === undefined || invite.accepted_at !== null || invite.declined_at !== null || invite.expires_at.getTime() <= this.now().getTime()) throw new OrgError(404, 'This invite is not valid any more.');
            const user = (await tx.query<{ email: string | null; email_verified: boolean }>('SELECT email, email_verified FROM app_user WHERE id = $1', [userId])).rows[0];
            if (user?.email?.toLowerCase() !== invite.email || !user.email_verified) throw new OrgError(403, 'This invite is for another email address. Sign in with the one it was sent to.');
            const current = await this.lockedRole(tx, invite.org_id, userId);
            const role = current !== undefined && RANK[current] >= RANK[invite.role] ? current : invite.role;
            await tx.query('INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role', [invite.org_id, userId, role]);
            for (const groupId of invite.groups) await tx.query('INSERT INTO org_group_member (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [groupId, userId]);
            await tx.query('UPDATE org_invite SET accepted_at = $2, accepted_by = $3 WHERE id = $1', [invite.id, this.now(), userId]);
            await audit(tx, { orgId: invite.org_id, actorId: userId, action: 'invite.accepted', targetKind: 'invite', targetId: invite.id, detail: { role } });
            return invite.org_id;
        });
        return (await this.get(orgId)) as Org;
    }

    /** What an invite is for, to show before it is accepted; `undefined` when it is not valid any more */
    async invitation(token: string): Promise<{ readonly org: Org; readonly email: string; readonly role: OrgRole } | undefined> {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
        const invite = (await this.db.query<{ org_id: string; email: string; role: OrgRole; expires_at: Date; accepted_at: Date | null; declined_at: Date | null }>('SELECT org_id, email, role, expires_at, accepted_at, declined_at FROM org_invite WHERE token_hash = $1', [hashOf(token)])).rows[0];
        if (invite === undefined || invite.accepted_at !== null || invite.declined_at !== null || invite.expires_at.getTime() <= this.now().getTime()) return undefined;
        const org = await this.get(invite.org_id);
        return org === undefined ? undefined : { org, email: invite.email, role: invite.role };
    }

    /** The org's audit log, newest first; admins and owners */
    async auditLog(actorId: string, orgId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
        await this.require(orgId, actorId, 'admin');
        return (
            await this.db.query('SELECT id, actor_id, action, target_kind, target_id, detail, at FROM audit_event WHERE org_id = $1 ORDER BY id DESC LIMIT $2', [
                orgId,
                Math.min(Math.max(limit, 1), 1000)
            ])
        ).rows;
    }

    /** Refuses a person whose role in the org is below `least` (or who is not in it) */
    async require(orgId: string, userId: string, least: OrgRole): Promise<OrgRole> {
        const role = await this.role(orgId, userId);
        if (role === undefined) throw new OrgError(404, 'No such org.');
        if (!atLeast(role, least)) throw new OrgError(403, 'Your role in the org does not allow this.');
        return role;
    }

    private async requireIn(tx: Queryable, orgId: string, userId: string, least: OrgRole): Promise<OrgRole> {
        const role = await this.lockedRole(tx, orgId, userId);
        if (role === undefined) throw new OrgError(404, 'No such org.');
        if (!atLeast(role, least)) throw new OrgError(403, 'Your role in the org does not allow this.');
        return role;
    }

    private async lockedRole(tx: Queryable, orgId: string, userId: string): Promise<OrgRole | undefined> {
        return (await tx.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, userId])).rows[0]?.role;
    }

    /** Admins change builders and members; owners change anyone; nobody else changes anyone */
    private mayChange(actor: OrgRole | undefined, current: OrgRole, next: OrgRole): void {
        if (actor === undefined) throw new OrgError(404, 'No such org.');
        if (actor === 'owner') return;
        if (actor === 'admin' && RANK[current] < RANK.admin && RANK[next] < RANK.admin) return;
        throw new OrgError(403, 'Your role in the org does not allow this.');
    }

    private async keepAnOwner(tx: Queryable, orgId: string, leaving: string): Promise<void> {
        const others = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM org_member WHERE org_id = $1 AND role = 'owner' AND user_id <> $2", [orgId, leaving])).rows[0]?.n ?? 0;
        if (others === 0) throw new OrgError(409, 'An org needs an owner: make someone else an owner first.');
    }
}
