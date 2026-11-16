import type { Database } from '@punyts/stateui-pg';
import { betaPlaceOf, betaTaken } from '../beta/Beta.js';

/** The tokens of one model request, as the Claude API reports them in `usage` */
export interface TokenUsage {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens?: number | null;
    readonly cache_read_input_tokens?: number | null;
}

/** Dollars per million tokens */
export interface ModelPrice {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    /** A five-minute cache write */
    readonly cacheWrite: number;
}

/** The first-party prices of the models Magnetic offers */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
};

/** What one request cost, in dollars. A model without a price is priced as the dearest one, so a budget never runs long */
export function costOf(model: string, usage: TokenUsage): number {
    const price = MODEL_PRICES[model] ?? MODEL_PRICES['claude-opus-5-5'] as ModelPrice;
    return (
        (usage.input_tokens * price.input +
            usage.output_tokens * price.output +
            (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
            (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
        1_000_000
    );
}

export interface BudgetLimits {
    /** Dollars each user may spend on agent turns per UTC day; undefined for no daily limit */
    readonly dailyPerUser?: number | undefined;
    /** Dollars each user may spend on agent turns ever, such as a beta's one-time allowance; undefined for none */
    readonly perUserTotal?: number | undefined;
    /**
     * Only the first this many people (by when they first signed in) get `perUserTotal`; the others start with none and
     * may buy agent use. Undefined for everyone
     */
    readonly allowanceUsers?: number | undefined;
    /**
     * The slug of the beta org (docs/design/magnetic-beta.md): only those holding one of its first `allowanceUsers`
     * places get `perUserTotal`, instead of the first people to sign in
     */
    readonly betaOrg?: string | undefined;
    /** Dollars the whole server may spend per UTC month */
    readonly monthly: number;
    /** True when people can buy more agent use (Agent use on Your apps): the refusals say where */
    readonly canBuy?: boolean | undefined;
}

export const DEFAULT_BUDGETS: BudgetLimits = { dailyPerUser: 1, monthly: 100 };

/** Why a turn may not start, said to the person; or `undefined` when it may */
export type BudgetRefusal = string | undefined;

/** Where a request was spent, for the spend ledger */
export interface ChargeDetail {
    readonly workspaceId?: string;
    readonly appId?: string;
    readonly model?: string;
    readonly usage?: TokenUsage;
}

/**
 * What agent turns have cost, as a ledger of requests (`agent_request`): summed per user per UTC day and in total per
 * UTC month. A turn may start while both are under their limits; the turn that crosses a limit finishes, and the next
 * is refused
 */
export class Budgets {
    constructor(
        private readonly db: Database,
        readonly limits: BudgetLimits = DEFAULT_BUDGETS,
        private readonly now: () => Date = () => new Date()
    ) {}

    private bounds(): { day: Date; month: Date } {
        const now = this.now();
        return { day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
    }

    /** What the user has spent today and ever, the server this month, and what the user bought (less refunds) */
    async spent(userId: string): Promise<{ today: number; total: number; month: number; bought: number }> {
        const { day, month } = this.bounds();
        const row = (
            await this.db.query<{ today: number | null; total: number | null; month: number | null; bought: string | null }>(
                `SELECT (SELECT sum(dollars) FROM agent_request WHERE user_id = $1 AND at >= $2) AS today,
                        (SELECT sum(dollars) FROM agent_request WHERE user_id = $1) AS total,
                        (SELECT sum(dollars) FROM agent_request WHERE at >= $3) AS month,
                        (SELECT sum(dollars) FROM agent_credit WHERE user_id = $1) AS bought`,
                [userId, day, month]
            )
        ).rows[0];
        return { today: Number(row?.today ?? 0), total: Number(row?.total ?? 0), month: Number(row?.month ?? 0), bought: Math.max(0, Number(row?.bought ?? 0)) };
    }

    /**
     * The one-time allowance of a person: `perUserTotal`, or nothing when only the first `allowanceUsers` people get it
     * and they are not among them. Undefined when agent use has no limit per person
     */
    async allowanceOf(userId: string): Promise<number | undefined> {
        const allowance = this.limits.perUserTotal;
        const first = this.limits.allowanceUsers;
        if (allowance === undefined) return undefined;
        if (this.limits.betaOrg !== undefined) {
            const place = await betaPlaceOf(this.db, this.limits.betaOrg, userId);
            return place !== undefined && (first === undefined || place <= first) ? allowance : 0;
        }
        if (first === undefined) return allowance;
        // Those who signed in before them, in the order they first did (the id breaks a tie)
        const before = (
            await this.db.query<{ before: number }>(
                'SELECT count(*)::int AS before FROM app_user other, app_user me WHERE me.id = $1 AND (other.created_at, other.id) < (me.created_at, me.id)',
                [userId]
            )
        ).rows[0]?.before;
        return before !== undefined && before < first ? allowance : 0;
    }

    /** Whether the user may start a turn now */
    async check(userId: string): Promise<BudgetRefusal> {
        const spent = await this.spent(userId);
        const allowance = await this.allowanceOf(userId);
        // Spending what they bought: the daily limit and the server's month limit what the operator gives away, so
        // they do not stop paid use
        const paying = allowance !== undefined && spent.bought > 0 && spent.total >= allowance;
        const buy = this.limits.canBuy === true ? ' Add more under Agent use on Your apps.' : '';
        if (!paying && spent.month >= this.limits.monthly) return `Magnetic has used its agent budget for this month. Everything else still works, and the agent will be back next month.${buy}`;
        if (allowance !== undefined && spent.total >= allowance + spent.bought)
            return spent.bought > 0
                ? `You have used the agent use you added.${buy} Everything else still works: your apps, editing by hand and sharing.`
                : allowance === 0
                  ? `${await this.noAllowance()}${buy} Everything else still works: your apps, editing by hand and sharing.`
                  : `You have used your $${allowance} of agent use.${buy} Everything else still works: your apps, editing by hand and sharing.`;
        if (!paying && this.limits.dailyPerUser !== undefined && spent.today >= this.limits.dailyPerUser) return "You have used today's agent budget. Everything else still works, and the agent will be back tomorrow (UTC).";
        return undefined;
    }

    /** Whether every place that comes with the allowance is taken (without a beta org: someone has none, so they are) */
    async allowanceFull(): Promise<boolean> {
        const first = this.limits.allowanceUsers;
        if (this.limits.betaOrg === undefined) return first !== undefined;
        return first !== undefined && (await betaTaken(this.db, this.limits.betaOrg)) >= first;
    }

    /** Why someone has no free agent use: the beta is full, or (with places left) they did not join through its link */
    private async noAllowance(): Promise<string> {
        const first = this.limits.allowanceUsers;
        if (this.limits.betaOrg === undefined) return `The free agent use of this beta went to its first ${first} people.`;
        if (await this.allowanceFull()) return `The beta has reached its ${first} people, who each got $${this.limits.perUserTotal} of free agent use. Try again after the beta test.`;
        return 'The free agent use of this beta comes with its invite link.';
    }

    /** What the agent has spent in a workspace (an org's) this UTC month */
    async workspaceSpent(workspaceId: string): Promise<number> {
        const { month } = this.bounds();
        return (await this.db.query<{ spent: number | null }>('SELECT sum(dollars) AS spent FROM agent_request WHERE workspace_id = $1 AND at >= $2', [workspaceId, month])).rows[0]?.spent ?? 0;
    }

    /** What the agent has spent in a workspace this UTC month, by person and app, the most first */
    async workspaceSpend(workspaceId: string): Promise<Array<{ readonly userId: string; readonly appId: string | null; readonly dollars: number; readonly requests: number }>> {
        const { month } = this.bounds();
        const rows = (
            await this.db.query<{ user_id: string; app_id: string | null; dollars: number; requests: number }>(
                'SELECT user_id, app_id, sum(dollars) AS dollars, count(*)::int AS requests FROM agent_request WHERE workspace_id = $1 AND at >= $2 GROUP BY user_id, app_id ORDER BY sum(dollars) DESC',
                [workspaceId, month]
            )
        ).rows;
        return rows.map((row) => ({ userId: row.user_id, appId: row.app_id, dollars: Number(row.dollars), requests: row.requests }));
    }

    /** Adds what a request cost */
    async charge(userId: string, dollars: number, detail: ChargeDetail = {}): Promise<void> {
        const usage = detail.usage;
        await this.db.query(
            `INSERT INTO agent_request (user_id, workspace_id, app_id, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, dollars, at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                userId,
                detail.workspaceId ?? null,
                detail.appId ?? null,
                detail.model ?? null,
                usage?.input_tokens ?? null,
                usage?.output_tokens ?? null,
                usage?.cache_creation_input_tokens ?? null,
                usage?.cache_read_input_tokens ?? null,
                dollars,
                this.now()
            ]
        );
    }
}
