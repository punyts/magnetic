import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Budgets, costOf } from './Budgets.js';

describe('Budgets', () => {
    let dir: string;
    let now: Date;
    const clock = (): Date => now;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'magnetic-budgets-'));
        now = new Date('2026-11-09T10:00:00Z');
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('should price a request by its tokens, cached ones included', () => {
        expect(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
        expect(costOf('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(10.2);
        expect(costOf('claude-unknown', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    });

    it("should refuse a user over the day's budget until the next UTC day", async () => {
        const budgets = new Budgets(join(dir, 'budgets.json'), { dailyPerUser: 1, monthly: 100 }, clock);
        expect(await budgets.check('u1')).toBeUndefined();
        await budgets.charge('u1', 0.6);
        expect(await budgets.check('u1')).toBeUndefined();
        await budgets.charge('u1', 0.6);
        expect(await budgets.check('u1')).toMatch(/today's agent budget/);
        expect(await budgets.check('u2')).toBeUndefined();
        now = new Date('2026-11-10T00:00:01Z');
        expect(await budgets.check('u1')).toBeUndefined();
    });

    it("should refuse everyone once the month's budget is spent, and keep it on disk", async () => {
        const path = join(dir, 'budgets.json');
        const budgets = new Budgets(path, { dailyPerUser: 10, monthly: 3 }, clock);
        await budgets.charge('u1', 2);
        await budgets.charge('u2', 1);
        expect(await budgets.check('u3')).toMatch(/budget for this month/);
        const again = new Budgets(path, { dailyPerUser: 10, monthly: 3 }, clock);
        expect(await again.spent('u1')).toEqual({ today: 2, month: 3 });
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ days: { '2026-11-09': { u1: 2, u2: 1 } }, months: { '2026-11': 3 } });
    });

    it('should drop days older than a week', async () => {
        const path = join(dir, 'budgets.json');
        const budgets = new Budgets(path, { dailyPerUser: 10, monthly: 100 }, clock);
        await budgets.charge('u1', 1);
        now = new Date('2026-11-20T10:00:00Z');
        await budgets.charge('u1', 1);
        expect(Object.keys((JSON.parse(await readFile(path, 'utf8')) as { days: object }).days)).toEqual(['2026-11-20']);
    });
});
