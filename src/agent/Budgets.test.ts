import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Budgets, costOf } from './Budgets.js';

describe('Budgets', () => {
    let test: TestDatabase;
    let now: Date;
    const clock = (): Date => now;

    beforeEach(async () => {
        test = await magneticTestDatabase();
        now = new Date('2026-11-09T10:00:00Z');
    });

    afterEach(async () => {
        await test.drop();
    });

    it('should price a request by its tokens, cached ones included', () => {
        expect(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
        expect(costOf('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(10.2);
        expect(costOf('claude-unknown', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    });

    const U1 = '00000000-0000-4000-8000-0000000000a1';
    const U2 = '00000000-0000-4000-8000-0000000000a2';
    const U3 = '00000000-0000-4000-8000-0000000000a3';

    it("should refuse a user over the day's budget until the next UTC day", async () => {
        const budgets = new Budgets(test.db, { dailyPerUser: 1, monthly: 100 }, clock);
        expect(await budgets.check(U1)).toBeUndefined();
        await budgets.charge(U1, 0.6);
        expect(await budgets.check(U1)).toBeUndefined();
        await budgets.charge(U1, 0.6);
        expect(await budgets.check(U1)).toMatch(/today's agent budget/);
        expect(await budgets.check(U2)).toBeUndefined();
        now = new Date('2026-11-10T00:00:01Z');
        expect(await budgets.check(U1)).toBeUndefined();
    });

    it("should refuse everyone once the month's budget is spent, and keep it in the ledger", async () => {
        const budgets = new Budgets(test.db, { dailyPerUser: 10, monthly: 3 }, clock);
        await budgets.charge(U1, 2, { model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 5 } });
        await budgets.charge(U2, 1);
        expect(await budgets.check(U3)).toMatch(/budget for this month/);
        const again = new Budgets(test.db, { dailyPerUser: 10, monthly: 3 }, clock);
        expect(await again.spent(U1)).toEqual({ today: 2, total: 2, month: 3 });
        const rows = (await test.db.query('SELECT user_id, model, input_tokens, dollars FROM agent_request ORDER BY id')).rows;
        expect(rows).toEqual([
            { user_id: U1, model: 'claude-haiku-5-5', input_tokens: 10, dollars: 2 },
            { user_id: U2, model: null, input_tokens: null, dollars: 1 }
        ]);
    });

    it("should refuse a user who has spent their one-time allowance, whatever the day or month", async () => {
        const budgets = new Budgets(test.db, { perUserTotal: 5, monthly: 100 }, clock);
        await budgets.charge(U1, 3);
        now = new Date('2026-12-02T10:00:00Z');
        expect(await budgets.check(U1)).toBeUndefined();
        await budgets.charge(U1, 2.5);
        expect(await budgets.check(U1)).toContain('your $5 of agent use');
        expect(await budgets.check(U2)).toBeUndefined();
        now = new Date('2027-03-01T10:00:00Z');
        expect(await budgets.check(U1)).toContain('your $5 of agent use');
        expect(await budgets.spent(U1)).toEqual({ today: 0, total: 5.5, month: 0 });
    });

    it('should count only this month toward the monthly budget', async () => {
        const budgets = new Budgets(test.db, { dailyPerUser: 10, monthly: 100 }, clock);
        await budgets.charge(U1, 1);
        now = new Date('2026-12-01T10:00:00Z');
        await budgets.charge(U1, 2);
        expect(await budgets.spent(U1)).toEqual({ today: 2, total: 3, month: 2 });
    });
});
