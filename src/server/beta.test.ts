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
        expect(await budgets.check(users['dan']?.id as string)).toMatch(/^The free agent use of this beta comes with a place in it\./);

        // Act
        const joined = await post(link, 'bob');
        await post(link, 'carol');
        const late = await post(link, 'dan');

        // Assert
        expect(joined.headers.get('location')).toBe(link);
        expect(await page(link, 'bob')).toContain('You have $5.00 of agent use, on us.');
        expect(await budgets.check(users['bob']?.id as string)).toBeUndefined();
        expect(late.headers.get('location')).toBe(link);
        expect(await page(link, 'dan')).toContain('It has reached its 2 people. We’ll contact you when we run the next beta test.');
        expect(await budgets.allowanceOf(users['dan']?.id as string)).toBe(0);
        expect(await budgets.check(users['dan']?.id as string)).toMatch(/^The beta has reached its 2 people, who each got \$5 of free agent use\. We’ll contact you when we run the next beta test\./);
        expect(await page('/admin', 'alice')).toContain('2 of 2 places taken');
        const people = await page('/admin/people', 'alice');
        expect(people).toContain('Beta place 1');
        expect(people).toContain('Beta place 2');
        expect(await page('/settings/billing', 'dan')).toContain('This beta has reached its 2 people, who each got $5.00 of free agent use. We’ll contact you when we run the next beta test.');
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

describe('Signing up in the beta', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    const LIMITS = { perUserTotal: 5, allowanceUsers: 2, betaOrg: 'beta', monthly: 500 };
    const signIn = async (user: string): Promise<{ cookie: string; id: string }> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
        return { cookie, id: (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string };
    };
    const get = (path: string, cookie?: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', headers: cookie === undefined ? {} : { Cookie: cookie } });
    const roleIn = async (userId: string): Promise<string | undefined> =>
        (await magnetic.database.query<{ role: string }>("SELECT m.role FROM org_member m JOIN org o ON o.id = m.org_id WHERE o.slug = 'beta' AND m.user_id::text = $1", [userId])).rows[0]?.role;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['owner', 'bob', 'carol', 'dan'],
            starter: 'none',
            browser: noBrowser,
            secretKey: 'beta-test-secret-key-of-enough-length',
            admins: ['ops@example.com'],
            agent: { budgets: LIMITS }
        });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should offer no sign-in by work email, nor let anyone make an org', async () => {
        // Arrange
        const bob = await signIn('bob');

        // Act
        const signInPage = await (await get('/signin')).text();
        const byEmail = await get('/signin/sso?email=bob%40example.com');
        const make = await fetch(`${magnetic.origin}/settings/orgs`, { method: 'POST', redirect: 'manual', headers: { Cookie: bob.cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Mine&slug=mine' });

        // Assert
        expect(signInPage).toContain('"noSso":true');
        expect(byEmail.status).toBe(404);
        expect(make.status).toBe(403);
        expect(await make.text()).toContain('Making an org is not open yet.');
        expect(await (await get('/settings/orgs', bob.cookie)).text()).not.toContain('Make an org');
    });

    it("should put everyone who signs up in the admin's org with the allowance, until it is full, and say so on the sign-in page", async () => {
        // Arrange: bob signed in before the org was there; the admin's sign-in makes it
        const bob = await signIn('bob');
        expect(await roleIn(bob.id)).toBeUndefined();
        const owner = await signIn('owner');
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = true WHERE id = $1", [owner.id]);
        // a provider gives the email at every sign-in; a development user has none, so the admin opens Your apps
        await (await get('/', owner.cookie)).text();

        // Act: bob comes back to Your apps; carol and dan sign up
        await (await get('/', bob.cookie)).text();
        const carol = await signIn('carol');
        const dan = await signIn('dan');
        const signInPage = await (await get('/signin')).text();

        // Assert
        expect(await roleIn(owner.id)).toBe('owner');
        expect(await roleIn(bob.id)).toBe('builder');
        expect(await roleIn(carol.id)).toBe('builder');
        expect(await roleIn(dan.id)).toBeUndefined();
        expect(await magnetic.budgets.allowanceOf(bob.id)).toBe(5);
        expect(await magnetic.budgets.allowanceOf(dan.id)).toBe(0);
        expect(signInPage).toContain('The beta is full');
        expect(signInPage).toContain('It has reached its 2 people. You can still sign in with');
    });

    it('should show the editor what is used and left, and why the agent cannot be asked once it is spent', async () => {
        // Arrange
        const carol = await signIn('carol');
        const services = await magnetic.workspaces.get(carol.id);
        const created = await services.useCases.createPartApp.execute({ name: 'budget-app' });
        if (created.kind !== 'created') throw new Error(created.kind);
        const budget = async (): Promise<Record<string, unknown>> => (await (await get(`/edit/${created.id}/budget`, carol.cookie)).json()) as Record<string, unknown>;
        const before = await budget();

        // Act
        await magnetic.budgets.charge(carol.id, 5);
        const after = await budget();

        // Assert
        expect(before).toEqual({ used: 0, total: 5 });
        expect(after).toMatchObject({ used: 5, total: 5 });
        expect(after['refusal']).toMatch(/^You have used your \$5 of agent use\./);
    });
});
