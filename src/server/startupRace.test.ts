import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { createDatabase } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseExclusive } from '../storage/exclusive.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

describe('Two servers on one database, asked for the same page at once', () => {
    let test: TestDatabase;
    const pools: Database[] = [];
    const servers: RunningMagnetic[] = [];

    beforeAll(async () => {
        test = await magneticTestDatabase();
        for (let i = 0; i < 2; i++) {
            // Each server its own pool on the same schema, as two machines would have
            const pool = createDatabase({ url: test.url, config: { ...test.config, max: 5 } });
            pools.push(pool);
            servers.push(await startMagnetic({ database: pool, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice'], starter: 'none', browser: noBrowser }));
        }
    });

    afterAll(async () => {
        await Promise.all(servers.map((server) => server.stop()));
        await Promise.all(pools.map((pool) => pool.close()));
        await test.drop();
    });

    it('should make the sign-in page once and serve it from both', async () => {
        // Act
        const answers = await Promise.all([0, 1, 0, 1].map((i) => fetch(`${(servers[i] as RunningMagnetic).origin}/signin`)));

        // Assert
        expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
        const made = await test.db.query<{ count: string }>("SELECT count(*) FROM part WHERE kind = 'apps' AND name = 'magnetic-signin'");
        expect(Number(made.rows[0]?.count)).toBeLessThanOrEqual(1);
    });
});

describe('databaseExclusive', () => {
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
    });

    afterAll(async () => {
        await test.drop();
    });

    it('should run the work of one key one at a time, and of other keys side by side', async () => {
        // Arrange
        const exclusive = databaseExclusive(test.db);
        const order: string[] = [];
        const work = (name: string) => async () => {
            order.push(`${name} in`);
            await new Promise((resolve) => setTimeout(resolve, 50));
            order.push(`${name} out`);
            return name;
        };

        // Act
        const results = await Promise.all([exclusive('same', work('a')), exclusive('same', work('b')), exclusive('other', work('c'))]);

        // Assert
        expect(results).toEqual(['a', 'b', 'c']);
        const a = order.indexOf('a out');
        const b = order.indexOf('b in');
        const first = Math.min(order.indexOf('a in'), order.indexOf('b in'));
        // Whichever of a and b went first was out before the other came in
        expect(first === order.indexOf('a in') ? a < b : order.indexOf('b out') < order.indexOf('a in')).toBe(true);
        // c did not wait for them
        expect(order.indexOf('c in')).toBeLessThan(Math.max(order.indexOf('a out'), order.indexOf('b out')));
    });

    it('should let the lock go when the work fails', async () => {
        // Arrange
        const exclusive = databaseExclusive(test.db);

        // Act
        await expect(exclusive('failing', async () => Promise.reject(new Error('no')))).rejects.toThrow('no');
        const after = await exclusive('failing', async () => 'free');

        // Assert
        expect(after).toBe('free');
    });
});
