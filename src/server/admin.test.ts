import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budgets } from '../agent/Budgets.js';
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

describe('The admin pages over HTTP', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let admin: string;
    let bob: string;
    let bobId: string;
    let carolId: string;
    const LIMITS = { perUserTotal: 5, allowanceUsers: 2, monthly: 100 };
    const signIn = async (user: string): Promise<{ cookie: string; id: string }> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
        return { cookie, id: (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string };
    };
    const get = (path: string, cookie: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const post = (path: string, cookie: string, form: Record<string, string>): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice', 'bob', 'carol'],
            starter: 'none',
            browser: noBrowser,
            admins: ['Ops@Example.com'],
            agent: { budgets: LIMITS }
        });
        const alice = await signIn('alice');
        admin = alice.cookie;
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = true, created_at = '2026-11-01' WHERE id = $1", [alice.id]);
        const b = await signIn('bob');
        bob = b.cookie;
        bobId = b.id;
        await magnetic.database.query("UPDATE app_user SET email = 'bob@example.com', created_at = '2026-11-02' WHERE id = $1", [bobId]);
        carolId = (await signIn('carol')).id;
        await magnetic.database.query("UPDATE app_user SET created_at = '2026-11-03' WHERE id = $1", [carolId]);
        await magnetic.database.query("INSERT INTO feedback (id, user_id, kind, text, app_name, context) VALUES (gen_random_uuid(), $1, 'bug', 'The <chart> is blank', 'sales', '{\"size\":\"phone\"}')", [bobId]);
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should be no page at all to someone who is not an admin, even with the email unverified', async () => {
        expect((await get('/admin', bob)).status).toBe(404);
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = false WHERE id = $1", [bobId]);
        expect((await get('/admin/people', bob)).status).toBe(404);
        await magnetic.database.query("UPDATE app_user SET email = 'bob@example.com' WHERE id = $1", [bobId]);
        expect((await fetch(`${magnetic.origin}/admin`, { redirect: 'manual' })).headers.get('location')).toBe('/signin?next=%2Fadmin');
    });

    it('should show the numbers, with the open feedback and the places left', async () => {
        const html = await (await get('/admin', admin)).text();
        expect(html).toContain('<dt>People</dt><dd><a href="/admin/people">3</a></dd>');
        expect(html).toContain('<dt>Open feedback</dt><dd><a href="/admin/feedback">1</a></dd>');
        expect(html).toContain('$5.00 once, to the first 2 people. No places are left.');
    });

    it('should list open feedback, escaped, and mark it done and open again', async () => {
        // Act
        const open = await (await get('/admin/feedback', admin)).text();
        const id = /action="\/admin\/feedback\/([0-9a-f-]{36})"/.exec(open)?.[1] as string;
        const done = await post(`/admin/feedback/${id}`, admin, { status: 'done', back: '/admin/feedback?status=open' });
        const after = await (await get('/admin/feedback?status=open', admin)).text();
        const all = await (await get('/admin/feedback?status=all&kind=bug', admin)).text();
        const elsewhere = await post(`/admin/feedback/${id}`, admin, { status: 'open', back: 'https://evil.example/' });

        // Assert
        expect(open).toContain('The &lt;chart&gt; is blank');
        expect(open).toContain('in sales · phone');
        expect(done.headers.get('location')).toBe('/admin/feedback?status=open&done=done');
        expect(after).toContain('Nothing here.');
        expect(all).toContain('The &lt;chart&gt; is blank');
        expect(elsewhere.headers.get('location')).toBe('/admin/feedback?done=open');
        expect((await post(`/admin/feedback/${id}`, bob, { status: 'done' })).status).toBe(404);
    });

    it('should list people in sign-in order with who got the allowance, and give agent use that lets them start a turn', async () => {
        // Arrange: carol is third, so she got nothing
        const budgets = new Budgets(magnetic.database, LIMITS);
        expect(await budgets.check(carolId)).toMatch(/first 2 people/);

        // Act
        const refused = await post(`/admin/people/${carolId}/give`, admin, { dollars: '5000', note: 'typo' });
        const given = await post(`/admin/people/${carolId}/give`, admin, { dollars: '$2.50', note: 'Beta tester' });
        const page = await (await get(given.headers.get('location') as string, admin)).text();

        // Assert
        expect(refused.status).toBe(400);
        expect(given.headers.get('location')).toBe(`/admin/people?gave=${carolId}&dollars=2.5`);
        expect(page).toContain('Gave carol $2.50 of agent use.');
        expect(page.indexOf('<strong>alice</strong>')).toBeLessThan(page.indexOf('<strong>bob</strong>'));
        expect(page.indexOf('<strong>bob</strong>')).toBeLessThan(page.indexOf('<strong>carol</strong>'));
        expect(await budgets.check(carolId)).toBeUndefined();
        expect((await magnetic.database.query("SELECT kind, dollars::float AS dollars, note FROM agent_credit WHERE user_id = $1", [carolId])).rows).toEqual([{ kind: 'gift', dollars: 2.5, note: 'Beta tester' }]);
        expect((await post(`/admin/people/${carolId}/give`, bob, { dollars: '5' })).status).toBe(404);
    });
});
