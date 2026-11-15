import type { Database } from '@punyts/stateui-pg';
import { atLeast, audit, OrgError } from './Orgs.js';
import type { OrgRole } from './Orgs.js';

/** What an org allows, beyond roles and access lists */
export interface OrgPolicy {
    /** Whether the org's members may keep apps in their own workspace; default on */
    readonly personalWorkspaces: boolean;
    /** Whether share links to the org's apps open for people outside the org; default off */
    readonly externalLinks: boolean;
    /** Whether someone with a verified email at a verified domain of the org joins it as a member when they sign in; default off */
    readonly autoJoin: boolean;
    /** Whether people at the org's verified domains may sign in only through its own provider; default off */
    readonly requireSso: boolean;
    /** The agent models the org's people may pick in its apps; absent for every model the server offers */
    readonly agentModels?: readonly string[];
    /** Days chats in the org's apps, and the state of people no longer in the org, are kept; absent to keep them */
    readonly retentionDays?: number;
    /** Dollars the agent may spend in the org's apps per UTC month; absent for no org limit (each person's own still holds) */
    readonly monthlyBudget?: number;
}

export const DEFAULT_POLICY: OrgPolicy = { personalWorkspaces: true, externalLinks: false, autoJoin: false, requireSso: false };

/** A change of policies: a value to set, or `null` to go back to the default */
export type PolicyChange = { -readonly [K in keyof OrgPolicy]?: OrgPolicy[K] | null };

const SWITCHES = ['personalWorkspaces', 'externalLinks', 'autoJoin', 'requireSso'] as const;

/** The policies stored for an org, over the defaults; anything unreadable is left at its default */
function policyOf(stored: unknown): OrgPolicy {
    const record = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
    const policy: { -readonly [K in keyof OrgPolicy]: OrgPolicy[K] } = { ...DEFAULT_POLICY };
    for (const name of SWITCHES) if (typeof record[name] === 'boolean') policy[name] = record[name];
    if (Array.isArray(record['agentModels']) && record['agentModels'].every((model) => typeof model === 'string')) policy.agentModels = record['agentModels'];
    if (typeof record['retentionDays'] === 'number') policy.retentionDays = record['retentionDays'];
    if (typeof record['monthlyBudget'] === 'number') policy.monthlyBudget = record['monthlyBudget'];
    return policy;
}

/**
 * Each org's policies (`org_policy`). Admins change them, except `requireSso`, which only owners change as they manage
 * the org's sign-in. Every change is written to the audit log. The policies are enforced where they apply: sign-in
 * (`requireSso`, `autoJoin`), share links (`externalLinks`), making apps (`personalWorkspaces`), agent turns
 * (`agentModels`, `monthlyBudget`) and the retention sweep (`retentionDays`)
 */
export class OrgPolicies {
    constructor(
        private readonly db: Database,
        /** The models the server offers, which an org may narrow */
        private readonly models: () => readonly string[]
    ) {}

    async get(orgId: string): Promise<OrgPolicy> {
        return policyOf((await this.db.query<{ policy: unknown }>('SELECT policy FROM org_policy WHERE org_id = $1', [orgId])).rows[0]?.policy);
    }

    /** The policies of every org a person is in, by org id */
    async ofMember(userId: string): Promise<Map<string, OrgPolicy>> {
        const rows = (await this.db.query<{ org_id: string; policy: unknown }>('SELECT m.org_id, p.policy FROM org_member m LEFT JOIN org_policy p ON p.org_id = m.org_id WHERE m.user_id = $1', [userId])).rows;
        return new Map(rows.map((row) => [row.org_id, policyOf(row.policy)]));
    }

    /** Changes some policies; answers them all as they are now */
    async set(actorId: string, orgId: string, change: PolicyChange): Promise<OrgPolicy> {
        const checked = this.checked(change);
        return this.db.transaction(async (tx) => {
            const role = (await tx.query<{ role: OrgRole }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [orgId, actorId])).rows[0]?.role;
            if (role === undefined) throw new OrgError(404, 'No such org.');
            if (!atLeast(role, 'admin')) throw new OrgError(403, 'Your role in the org does not allow this.');
            if (checked.requireSso !== undefined && role !== 'owner') throw new OrgError(403, 'Only an owner can change how people sign in.');
            const stored = (await tx.query<{ policy: Record<string, unknown> }>('SELECT policy FROM org_policy WHERE org_id = $1 FOR UPDATE', [orgId])).rows[0]?.policy ?? {};
            const next: Record<string, unknown> = { ...stored };
            for (const [name, value] of Object.entries(checked)) {
                if (value === null) delete next[name];
                else next[name] = value;
            }
            await tx.query(
                `INSERT INTO org_policy (org_id, policy, updated_by, updated_at) VALUES ($1, $2, $3, now())
                 ON CONFLICT (org_id) DO UPDATE SET policy = EXCLUDED.policy, updated_by = EXCLUDED.updated_by, updated_at = now()`,
                [orgId, JSON.stringify(next), actorId]
            );
            await audit(tx, { orgId, actorId, action: 'policy.changed', targetKind: 'org', targetId: orgId, detail: checked });
            return policyOf(next);
        });
    }

    /** The change, each value checked; refuses one that is not a policy or not a value it can take */
    private checked(change: PolicyChange): PolicyChange {
        const out: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(change)) {
            if (value === undefined) continue;
            if ((SWITCHES as readonly string[]).includes(name)) {
                if (value !== null && typeof value !== 'boolean') throw new OrgError(400, `${name} is on or off.`);
            } else if (name === 'agentModels') {
                if (value !== null && (!Array.isArray(value) || value.length === 0 || !value.every((model) => typeof model === 'string' && this.models().includes(model))))
                    throw new OrgError(400, `Choose one or more of the models this server offers: ${this.models().join(', ')}.`);
            } else if (name === 'retentionDays') {
                if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650)) throw new OrgError(400, 'Keep data for 1 to 3650 days, or leave it unset to keep it.');
            } else if (name === 'monthlyBudget') {
                if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)) throw new OrgError(400, 'A monthly budget is 0 to 1,000,000 dollars, or unset for none.');
            } else throw new OrgError(400, `There is no policy ${name}.`);
            out[name] = value;
        }
        return out as PolicyChange;
    }

    /**
     * Applies each org's `retentionDays`: deletes the chats of its apps older than that, and the instances and persona
     * records of people no longer in the org not changed for that long. Answers how many rows went
     */
    async applyRetention(now: Date = new Date()): Promise<number> {
        const orgs = (
            await this.db.query<{ org_id: string; workspace_id: string; days: number }>(
                "SELECT p.org_id, w.id AS workspace_id, (p.policy->>'retentionDays')::int AS days FROM org_policy p JOIN workspace w ON w.org_id = p.org_id WHERE p.policy ? 'retentionDays'"
            )
        ).rows;
        let removed = 0;
        for (const org of orgs) {
            const cutoff = new Date(now.getTime() - org.days * 86_400_000);
            removed += await this.db.transaction(
                async (tx) => {
                    const chats = (await tx.query('DELETE FROM chat_entry WHERE workspace_id = $1 AND at < $2', [org.workspace_id, cutoff])).rowCount ?? 0;
                    let state = 0;
                    for (const table of ['instance', 'persona_dataset']) {
                        state +=
                            (await tx.query(`DELETE FROM ${table} WHERE workspace_id = $1 AND updated_at < $2 AND persona NOT IN (SELECT user_id::text FROM org_member WHERE org_id = $3)`, [org.workspace_id, cutoff, org.org_id])).rowCount ?? 0;
                    }
                    return chats + state;
                },
                { workspaceIds: [org.workspace_id] }
            );
        }
        return removed;
    }
}
