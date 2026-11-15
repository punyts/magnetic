import type { Database } from '@punyts/stateui-pg';
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
                        `SELECT p.persona, max(p.updated_at) AS updated_at, min(u.name) AS name
                           FROM (SELECT persona, updated_at FROM instance WHERE workspace_id = $1 AND app_id = $2
                                 UNION ALL SELECT persona, updated_at FROM persona_dataset WHERE workspace_id = $1 AND app_id = $2) p
                           JOIN org_member m ON m.org_id = $3 AND m.user_id::text = p.persona
                           JOIN app_user u ON u.id = m.user_id
                          GROUP BY p.persona ORDER BY max(p.updated_at) DESC, p.persona`,
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
                const instance = (await tx.query<{ diff: unknown; updated_at: Date }>('SELECT diff, updated_at FROM instance WHERE workspace_id = $1 AND app_id = $2 AND persona = $3', [workspaceId, appId, userId])).rows[0];
                const datasets = (
                    await tx.query<{ binding: string; model: string; records: unknown; updated_at: Date }>(
                        'SELECT binding, model, records, updated_at FROM persona_dataset WHERE workspace_id = $1 AND app_id = $2 AND persona = $3 ORDER BY binding',
                        [workspaceId, appId, userId]
                    )
                ).rows;
                if (instance === undefined && datasets.length === 0) throw new OrgError(404, 'That person has no instance of this app.');
                const times = [instance?.updated_at, ...datasets.map((row) => row.updated_at)].filter((at): at is Date => at !== undefined).map((at) => at.getTime());
                await audit(tx, { orgId, workspaceId, actorId, action: 'instance.support_view', targetKind: 'app', targetId: appId, detail: { userId } });
                return {
                    userId,
                    name: member.name,
                    updatedAt: new Date(Math.max(...times)).toISOString(),
                    instance: instance?.diff ?? {},
                    data: Object.fromEntries(datasets.map((row) => [row.binding, { model: row.model, records: row.records }]))
                };
            },
            { workspaceIds: [workspaceId] }
        );
    }
}
