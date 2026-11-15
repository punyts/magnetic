import { userStateAddress } from '@punyts/stateui-mcp';
import { PgStateStore } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';

/** People's own state of the org's apps, read through the statenet storage */
const STATE = new PgStateStore();
import { allows } from './AppAccess.js';
import type { AppAccess } from './AppAccess.js';
import { atLeast, audit, OrgError } from './Orgs.js';
import type { OrgRole } from './Orgs.js';

/** One member's instance of an org app, as the list of who uses it shows it */
export interface InstanceSummary {
    readonly userId: string;
    readonly name: string;
    /** When their state was last saved */
    readonly updatedAt: string;
}

/** A member's instance of an org app as last saved, seen read only for support */
export interface SupportView extends InstanceSummary {
    /** What differs in their instance from the app's starting state: route, form values, choices */
    readonly instance: unknown;
    /** The records of their own (persona) bindings, by binding */
    readonly data: Readonly<Record<string, { readonly model: string; readonly records: unknown }>>;
}

/**
 * The members' instances of an org app: who uses it and when they last did (for people who manage the app), and one
 * member's instance read only, for support (org admins and owners). Each support view is written to the audit log. The
 * state is what was last saved, so a change still in a member's open view may not be in it yet
 */
export class AppInstances {
    constructor(
        private readonly db: Database,
        private readonly access: AppAccess
    ) {}

    /** The members who have an instance of the app, the most recently used first */
    async list(actorId: string, orgId: string, workspaceId: string, appId: string): Promise<InstanceSummary[]> {
        if (!allows(await this.access.permission(actorId, workspaceId, appId), 'manage')) throw new OrgError(403, 'Only people who manage the app can see who uses it.');
        const rows = await this.db.transaction(
            async (tx) =>
                (
                    await tx.query<{ persona: string; updated_at: Date; name: string | null }>(
                        `SELECT split_part(h.address, '/', 1) AS persona, h.updated_at, u.name
                           FROM namespace_head h
                           JOIN org_member m ON m.org_id = $3 AND m.user_id::text = split_part(h.address, '/', 1)
                           JOIN app_user u ON u.id = m.user_id
                          WHERE h.workspace_id = $1 AND h.address = split_part(h.address, '/', 1) || '/' || $2 || '/user'
                          ORDER BY h.updated_at DESC, persona`,
                        [workspaceId, appId, orgId]
                    )
                ).rows,
            { workspaceIds: [workspaceId] }
        );
        return rows.map((row) => ({ userId: row.persona, name: row.name ?? '', updatedAt: row.updated_at.toISOString() }));
    }

    /** One member's instance of the app, read only, for an org admin or owner; written to the audit log */
    async view(actorId: string, orgId: string, workspaceId: string, appId: string, userId: string): Promise<SupportView> {
        return this.db.transaction(
            async (tx) => {
                const role = (await tx.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2', [orgId, actorId])).rows[0]?.role;
                if (role === undefined) throw new OrgError(404, 'No such org.');
                if (!atLeast(role, 'admin')) throw new OrgError(403, "Only the org's admins and owners can open a member's instance.");
                const member = (await tx.query<{ name: string }>('SELECT u.name FROM org_member m JOIN app_user u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id = $2', [orgId, userId])).rows[0];
                const app = (await tx.query("SELECT 1 FROM part WHERE workspace_id = $1 AND kind = 'apps' AND id = $2", [workspaceId, appId])).rows.length > 0;
                if (member === undefined || !app) throw new OrgError(404, 'That person has no instance of this app.');
                // Their own state of the app, at its statenet address
                const address = userStateAddress(workspaceId, userId, appId);
                const head = (await tx.query<{ updated_at: Date }>('SELECT updated_at FROM namespace_head WHERE address = $1 AND workspace_id = $2', [address, workspaceId])).rows[0];
                const state = await STATE.read(tx, address);
                if (head === undefined || state.value === undefined) throw new OrgError(404, 'That person has no instance of this app.');
                const { data: records, localData, ...diff } = state.value;
                const bindings = typeof records === 'object' && records !== null && !Array.isArray(records) ? records : {};
                await audit(tx, { orgId, workspaceId, actorId, action: 'instance.support_view', targetKind: 'app', targetId: appId, detail: { userId } });
                return {
                    userId,
                    name: member.name,
                    updatedAt: head.updated_at.toISOString(),
                    instance: localData === undefined ? diff : { ...diff, data: localData },
                    data: Object.fromEntries(Object.entries(bindings).map(([binding, value]) => [binding, { model: (state.meta.get(`data.${binding}`) as { model?: string } | undefined)?.model ?? '', records: value }]))
                };
            },
            { workspaceIds: [workspaceId] }
        );
    }
}
