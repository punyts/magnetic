import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budgets } from '../agent/Budgets.js';
import { Beta } from '../beta/Beta.js';
import { Orgs } from '../orgs/Orgs.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

/** No headless browser: these tests never preview */
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

describe('The beta link', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    const users: Record<string, { cookie: string; id: string }> = {};
    let link: string;
    const LIMITS = { perUserTotal: 5, allowanceUsers: 2, betaOrg: 'beta', monthly: 500 };
    const signIn = async (user: string): Promise<{ cookie: string; id: string }> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
        return { cookie, id: (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string };
    };
    const get = (path: string, user?: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', headers: user === undefined ? {} : { Cookie: users[user]?.cookie as string } });
    const post = (path: string, user: string): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: users[user]?.cookie as string, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    const page = async (path: string, user: string): Promise<string> => await (await get(path, user)).text();

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice', 'bob', 'carol', 'dan'],
            starter: 'none',
            browser: noBrowser,
            secretKey: 'beta-test-secret-key-of-enough-length',
            admins: ['ops@example.com'],
            agent: { budgets: LIMITS }
        });
        for (const name of ['alice', 'bob', 'carol', 'dan']) users[name] = await signIn(name);
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = true WHERE id = $1", [users['alice']?.id]);
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should be no page until an admin starts the beta, then give the admin its link', async () => {
        // Arrange: the link the server will sign
        const code = new Beta(magnetic.database, new Orgs(magnetic.database), 'beta', 2, 'beta-test-secret-key-of-enough-length').code;
        expect((await get(`/beta/${code}`, 'bob')).status).toBe(404);
        expect(await page('/admin', 'alice')).toContain('Start the beta');

        // Act
        const started = await post('/admin/beta', 'alice');
        const overview = await page('/admin?started=1', 'alice');

        // Assert
        expect(started.headers.get('location')).toBe('/admin?started=1');
        expect(overview).toContain('The beta has started. Hand out its link.');
        expect(overview).toContain('0 of 2 places taken');
        link = /value="https?:\/\/[^/]+(\/beta\/[A-Za-z0-9_-]+)"/.exec(overview)?.[1] as string;
        expect(link).toBe(`/beta/${code}`);
        expect((await get(`/beta/${code.slice(0, -1)}x`, 'bob')).status).toBe(404);
        expect((await post('/admin/beta', 'bob')).status).toBe(404);
        expect((await get(link)).headers.get('location')).toBe(`/signin?next=${encodeURIComponent(link)}`);
        expect(await page(link, 'alice')).toContain('You run the beta org');
    });

    it('should give the first people to join a place and the allowance, and tell those after that the beta is full', async () => {
        // Arrange
        const budgets = new Budgets(magnetic.database, LIMITS);
        expect(await page(link, 'bob')).toContain('2 of its 2 places are left.');
        expect(await budgets.check(users['dan']?.id as string)).toMatch(/^The free agent use of this beta comes with its invite link\./);

        // Act
        const joined = await post(link, 'bob');
        await post(link, 'carol');
        const late = await post(link, 'dan');

        // Assert
        expect(joined.headers.get('location')).toBe(link);
        expect(await page(link, 'bob')).toContain('You have $5.00 of agent use, on us.');
        expect(await budgets.check(users['bob']?.id as string)).toBeUndefined();
        expect(late.headers.get('location')).toBe(link);
        expect(await page(link, 'dan')).toContain('It has reached its 2 people. Try again after the beta test.');
        expect(await budgets.allowanceOf(users['dan']?.id as string)).toBe(0);
        expect(await budgets.check(users['dan']?.id as string)).toMatch(/^The beta has reached its 2 people, who each got \$5 of free agent use\. Try again after the beta test\./);
        expect(await page('/admin', 'alice')).toContain('2 of 2 places taken');
        const people = await page('/admin/people', 'alice');
        expect(people).toContain('Beta place 1');
        expect(people).toContain('Beta place 2');
        expect(await page('/settings/billing', 'dan')).toContain('This beta has reached its 2 people, who each got $5.00 of free agent use. Try again after the beta test.');
    });

    it('should let only one of two people take the last place at once', async () => {
        // Arrange: a beta of 3 places, two taken
        const beta = new Beta(magnetic.database, new Orgs(magnetic.database), 'beta', 3, 'beta-test-secret-key-of-enough-length');
        const erin = (await magnetic.database.query<{ id: string }>("INSERT INTO app_user (id, name) VALUES (gen_random_uuid(), 'erin') RETURNING id::text AS id")).rows[0]?.id as string;

        // Act
        const results = await Promise.all([beta.join(users['dan']?.id as string), beta.join(erin)]);

        // Assert
        expect([...results].sort()).toEqual(['full', 'joined']);
        expect((await beta.status()).taken).toBe(3);
    });
});
