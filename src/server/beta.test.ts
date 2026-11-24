import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budgets } from '../agent/Budgets.js';
import { Beta } from '../beta/Beta.js';
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
            devUsers: ['alice', 'bob', 'carol', 'dan', 'gina'],
            starter: 'none',
            browser: noBrowser,
            secretKey: 'beta-test-secret-key-of-enough-length',
            admins: ['ops@example.com'],
            serverOrgs: [{ slug: 'beta', name: 'Magnetic beta', monthlyBudget: 500 }],
            agent: { budgets: LIMITS }
        });
        for (const name of ['alice', 'bob', 'carol', 'dan', 'gina']) users[name] = await signIn(name);
        const aliceId = users['alice']?.id as string;
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = true WHERE id = $1", [aliceId]);
        // the server invited the admin's address as the beta org's owner when it started
        for (const invite of await magnetic.orgs.pendingFor(aliceId)) await magnetic.orgs.acceptInvite(invite.id, aliceId);
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should make the beta org at start with its budget, invite the admin as its owner, and give the admin its link', async () => {
        // Arrange: the link the server signs
        const code = new Beta(magnetic.database, 'beta', 2, 'beta-test-secret-key-of-enough-length').code;

        // Act
        const org = await magnetic.orgs.bySlug('beta');
        const overview = await page('/admin', 'alice');
        link = /value="https?:\/\/[^/]+(\/beta\/[A-Za-z0-9_-]+)"/.exec(overview)?.[1] as string;

        // Assert
        expect(org?.name).toBe('Magnetic beta');
        expect(await magnetic.policies.get(org?.id as string)).toMatchObject({ personalWorkspaces: false, monthlyBudget: 500 });
        expect(await magnetic.orgs.role(org?.id as string, users['alice']?.id as string)).toBe('owner');
        expect(overview).toContain('0 of 2 places taken');
        expect(overview).not.toContain('Start the beta');
        expect(link).toBe(`/beta/${code}`);
        expect((await get(`/beta/${code.slice(0, -1)}x`, 'bob')).status).toBe(404);
        expect((await post('/admin/beta', 'alice')).status).toBe(404);
        expect((await get(link)).headers.get('location')).toBe(`/signin?next=${encodeURIComponent(link)}`);
        expect(await page(link, 'alice')).toContain('You run the beta org');
    });

    it('should take no place from someone the org invited, and leave the invite to accept for its role', async () => {
        // Arrange
        const gina = users['gina']?.id as string;
        const org = await magnetic.orgs.bySlug('beta');
        await magnetic.database.query("UPDATE app_user SET email = 'gina@example.com', email_verified = true WHERE id = $1", [gina]);
        await magnetic.orgs.invite(users['alice']?.id as string, org?.id as string, { email: 'gina@example.com', role: 'admin' });

        // Act
        const opened = await get(link, 'gina');
        const before = (await magnetic.database.query('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2', [org?.id, gina])).rows;
        for (const invite of await magnetic.orgs.pendingFor(gina)) await magnetic.orgs.acceptInvite(invite.id, gina);
        const after = (await magnetic.database.query<{ role: string }>('SELECT role FROM org_member WHERE org_id = $1 AND user_id = $2', [org?.id, gina])).rows;

        // Assert
        expect(opened.status).toBe(303);
        expect(opened.headers.get('location')).toBe('/');
        expect(before).toEqual([]);
        expect(after).toEqual([{ role: 'admin' }]);
    });

    it('should give the first people to open the link a place and the allowance, and tell those after that the beta is full', async () => {
        // Arrange
        const budgets = new Budgets(magnetic.database, LIMITS);
        expect(await budgets.check(users['dan']?.id as string)).toMatch(/^The free agent use of this beta comes with a place in it\./);

        // Act
        const bobPage = await page(link, 'bob');
        await page(link, 'carol');
        const danPage = await page(link, 'dan');
        const bobAgain = await page(link, 'bob');

        // Assert
        expect(bobPage).toContain('You have $5.00 of agent use, on us.');
        expect(bobAgain).toContain('You have $5.00 of agent use, on us.');
        expect(await budgets.check(users['bob']?.id as string)).toBeUndefined();
        expect(danPage).toContain('It has reached its 2 people. We’ll contact you when we run the next beta test.');
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
        const beta = new Beta(magnetic.database, 'beta', 3, 'beta-test-secret-key-of-enough-length');
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
            serverOrgs: [{ slug: 'beta', name: 'Magnetic beta' }],
            agent: { budgets: LIMITS }
        });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should offer sign-in by work email, but not let anyone make an org', async () => {
        // Arrange
        const bob = await signIn('bob');

        // Act
        const signInPage = await (await get('/signin')).text();
        const byEmail = await get('/signin/sso?email=bob%40example.com');
        const make = await fetch(`${magnetic.origin}/settings/orgs`, { method: 'POST', redirect: 'manual', headers: { Cookie: bob.cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Mine&slug=mine' });

        // Assert
        expect(signInPage).toContain('"noSso":false');
        expect(byEmail.status).toBe(404);
        expect(await byEmail.text()).toContain('No organisation signs in here');
        expect(make.status).toBe(403);
        expect(await make.text()).toContain('Making an org is not open yet.');
        expect(await (await get('/settings/orgs', bob.cookie)).text()).not.toContain('Make an org');
    });

    it('should leave people out of the beta org when they sign in, let the link put them in, and say on the sign-in page when it is full', async () => {
        // Arrange
        const link = `/beta/${new Beta(magnetic.database, 'beta', 2, 'beta-test-secret-key-of-enough-length').code}`;
        const bob = await signIn('bob');
        const carol = await signIn('carol');
        const dan = await signIn('dan');
        const before = [await roleIn(bob.id), await roleIn(carol.id), await roleIn(dan.id)];

        // Act
        for (const person of [bob, carol, dan]) await (await get(link, person.cookie)).text();
        const signInPage = await (await get('/signin')).text();

        // Assert
        expect(before).toEqual([undefined, undefined, undefined]);
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
