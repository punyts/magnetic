import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

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
    /** Dollars each user may spend on agent turns per UTC day */
    readonly dailyPerUser: number;
    /** Dollars the whole server may spend per UTC month */
    readonly monthly: number;
}

export const DEFAULT_BUDGETS: BudgetLimits = { dailyPerUser: 1, monthly: 100 };

interface BudgetFile {
    /** UTC day → user id → dollars */
    days: Record<string, Record<string, number>>;
    /** UTC month → dollars */
    months: Record<string, number>;
}

/** Why a turn may not start, said to the person; or `undefined` when it may */
export type BudgetRefusal = string | undefined;

/**
 * What agent turns have cost: per user per UTC day and in total per UTC month, in one JSON file. A turn may start
 * while both are under their limits; the turn that crosses a limit finishes, and the next is refused. Days older
 * than a week are dropped
 */
export class Budgets {
    private file: BudgetFile | undefined;
    private writes: Promise<void> = Promise.resolve();

    constructor(
        private readonly path: string,
        readonly limits: BudgetLimits = DEFAULT_BUDGETS,
        private readonly now: () => Date = () => new Date()
    ) {}

    private async load(): Promise<BudgetFile> {
        this.file ??= (await readJson<BudgetFile>(this.path)) ?? { days: {}, months: {} };
        return this.file;
    }

    private keys(): { day: string; month: string } {
        const iso = this.now().toISOString();
        return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
    }

    /** What the user has spent today and the server this month */
    async spent(userId: string): Promise<{ today: number; month: number }> {
        const file = await this.load();
        const { day, month } = this.keys();
        return { today: file.days[day]?.[userId] ?? 0, month: file.months[month] ?? 0 };
    }

    /** Whether the user may start a turn now */
    async check(userId: string): Promise<BudgetRefusal> {
        const spent = await this.spent(userId);
        if (spent.month >= this.limits.monthly) return 'Magnetic has used its agent budget for this month. Everything else still works, and the agent will be back next month.';
        if (spent.today >= this.limits.dailyPerUser) return "You have used today's agent budget. Everything else still works, and the agent will be back tomorrow (UTC).";
        return undefined;
    }

    /** Adds what a request cost */
    charge(userId: string, dollars: number): Promise<void> {
        const result = this.writes.then(async () => {
            const file = await this.load();
            const { day, month } = this.keys();
            const today = (file.days[day] ??= {});
            today[userId] = (today[userId] ?? 0) + dollars;
            file.months[month] = (file.months[month] ?? 0) + dollars;
            const weekAgo = new Date(this.now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
            for (const key of Object.keys(file.days)) if (key < weekAgo) delete file.days[key];
            await writeJsonAtomic(this.path, file);
        });
        this.writes = result.catch(() => undefined);
        return result;
    }
}
