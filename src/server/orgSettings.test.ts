import { PgUiInstanceRepository, txWorkspaceDb } from '@punyts/stateui-pg';
import { randomUUID } from 'node:crypto';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';

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

describe('The org settings pages', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    let alice: string;
    let bob: string;
    let aliceId: string;
    let bobId: string;
    let orgId: string;

    async function signIn(user: string): Promise<string> {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    }

    const page = (path: string, cookie?: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });

    /** Posts a form as the browser does, from the page itself */
    const post = (path: string, cookie: string, fields: Record<string, string | string[]>): Promise<Response> => {
        const body = new URLSearchParams();
        for (const [name, value] of Object.entries(fields)) for (const each of Array.isArray(value) ? value : [value]) body.append(name, each);
        return fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    };

    function openSocket(appId: string, cookie: string): Promise<WebSocket | number> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, { headers: { Origin: magnetic.origin, Cookie: cookie } });
            ws.once('open', () => resolve(ws));
            ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
            ws.once('error', reject);
        });
    }

    beforeAll(async () => {
        database = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: database.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser });
        alice = await signIn('alice');
        bob = await signIn('bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        await magnetic.database.query("UPDATE app_user SET email = 'bob@acme.test', email_verified = true WHERE id = $1", [bobId]);
    });

    afterAll(async () => {
        await magnetic.stop();
        await database.drop();
    });

    it('should send a visitor to sign in, and make an org from the form, refusing a bad short name', async () => {
        // Act
        const visitor = await page('/settings/orgs');
        const bad = await post('/settings/orgs', alice, { name: 'Acme', slug: 'A' });
        const made = await post('/settings/orgs', alice, { name: 'Acme & Co', slug: 'acme' });
        orgId = (made.headers.get('location') ?? '').split('/').at(-1) as string;
        const list = await (await page('/settings/orgs', alice)).text();
        const org = await page(`/settings/orgs/${orgId}`, alice);
        const html = await org.text();

        // Assert
        expect(visitor.status).toBe(303);
        expect(visitor.headers.get('location')).toBe('/signin?next=%2Fsettings%2Forgs');
        expect(bad.status).toBe(400);
        expect(await bad.text()).toContain('A slug is 2 to 63');
        expect(made.status).toBe(303);
        expect(list).toContain(`href="/settings/orgs/${orgId}"`);
        expect(list).toContain('Acme &amp; Co');
        expect(org.status).toBe(200);
        expect(org.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(html).toContain('You are an owner here.');
        expect(html).toContain('Invite someone');
        expect(html).toContain('Audit log');
        expect(html).toContain('org.created');
    });

    it('should make an invite link shown once, and let an admin change a role and see it saved', async () => {
        // Act
        const invited = await post(`/settings/orgs/${orgId}`, alice, { do: 'invite', email: 'Bob@Acme.test', role: 'member' });
        const html = await invited.text();
        const token = /\/invites\/([A-Za-z0-9_-]{43})/.exec(html)?.[1] as string;
        const visitor = await page(`/invites/${token}`);
        const offered = await page(`/invites/${token}`, bob);
        const offeredHtml = await offered.text();
        const wrongPerson = await post(`/invites/${token}`, alice, {});
        const accepted = await post(`/invites/${token}`, bob, {});
        const used = await page(`/invites/${token}`, bob);
        const promoted = await post(`/settings/orgs/${orgId}`, alice, { do: 'role', userId: bobId, role: 'builder' });
        const saved = await (await page(promoted.headers.get('location') as string, alice)).text();

        // Assert
        expect(invited.status).toBe(200);
        expect(html).toContain('Send this link to bob@acme.test');
        expect(visitor.status).toBe(303);
        expect(visitor.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/invites/${token}`)}`);
        expect(offered.status).toBe(200);
        expect(offeredHtml).toContain('Join Acme &amp; Co');
        expect(offeredHtml).toContain('as a member, with the email bob@acme.test');
        expect(wrongPerson.status).toBe(403);
        expect(await wrongPerson.text()).toContain('This invite is for another email address.');
        expect(accepted.status).toBe(303);
        expect(accepted.headers.get('location')).toBe(`/settings/orgs/${orgId}`);
        expect(used.status).toBe(404);
        expect(promoted.status).toBe(303);
        expect(promoted.headers.get('location')).toBe(`/settings/orgs/${orgId}?done`);
        expect(saved).toContain('Saved.');
        expect(await magnetic.orgs.role(orgId, bobId)).toBe('builder');
    });

    it('should let a builder make an app in the org and bring in one of their own, each opening in the editor', async () => {
        // Arrange
        const own = await fetch(`${magnetic.origin}/new`, { method: 'POST', headers: { Cookie: bob, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=diary' });
        const ownId = ((await own.json()) as { id: string }).id;
        const offered = await (await page(`/settings/orgs/${orgId}`, bob)).text();

        // Act
        const made = await post(`/settings/orgs/${orgId}`, bob, { do: 'makeApp', name: 'Field Notes' });
        const moved = await post(`/settings/orgs/${orgId}`, bob, { do: 'moveIn', appId: ownId });
        const bad = await post(`/settings/orgs/${orgId}`, bob, { do: 'makeApp', name: '123' });

        // Assert
        expect(offered).toContain(`<option value="${ownId}">diary</option>`);
        expect(made.status).toBe(303);
        expect(made.headers.get('location')).toMatch(/^\/edit\/[0-9a-f-]{36}$/);
        expect(moved.status).toBe(303);
        expect(moved.headers.get('location')).toBe(`/edit/${ownId}`);
        expect(await (await magnetic.workspaces.get(bobId)).instanceViews.find(ownId)).toBeUndefined();
        expect((await (await page(`/edit/${ownId}`, bob)).status)).toBe(200);
        expect(bad.status).toBe(400);
        expect(await bad.text()).toContain('Give the app a name that starts with a letter.');
    });

    it("should show a builder the org without its admin parts, and refuse an admin's change with the reason", async () => {
        // Act
        const bobPage = await (await page(`/settings/orgs/${orgId}`, bob)).text();
        const refused = await post(`/settings/orgs/${orgId}`, bob, { do: 'role', userId: aliceId, role: 'member' });
        const stranger = await page(`/settings/orgs/${randomUUID()}`, bob);

        // Assert
        expect(bobPage).toContain('You are a builder here.');
        expect(bobPage).not.toContain('Invite someone');
        expect(bobPage).not.toContain('Audit log');
        expect(refused.status).toBe(403);
        expect(await refused.text()).toContain('Your role in the org does not allow this.');
        expect(stranger.status).toBe(404);
    });

    it('should give an app to a group, and close the view of someone taken out of the group', async () => {
        // Arrange
        await magnetic.database.query("UPDATE org_member SET role = 'member' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);
        const made = await fetch(`${magnetic.origin}/orgs/${orgId}/apps`, { method: 'POST', headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stock' }) });
        const appId = ((await made.json()) as { id: string }).id;
        await post(`/settings/orgs/${orgId}`, alice, { do: 'makeGroup', name: 'Warehouse' });
        const groupId = (await magnetic.orgs.groups(aliceId, orgId)).find((group) => group.name === 'Warehouse')?.id as string;
        await post(`/settings/orgs/${orgId}`, alice, { do: 'group', groupId, userId: bobId });
        const given = await post(`/settings/orgs/${orgId}`, alice, { do: 'access', appId, principal: `group:${groupId}`, permission: 'use' });

        // Act
        const socket = await openSocket(appId, bob);
        const closed = new Promise<number>((resolve) => (socket as WebSocket).once('close', (code) => resolve(code)));
        const aliceSees = await (await page(`/settings/orgs/${orgId}`, alice)).text();
        const ungrouped = await post(`/settings/orgs/${orgId}`, alice, { do: 'ungroup', groupId, userId: bobId });

        // Assert
        expect(given.status).toBe(303);
        expect(typeof socket).not.toBe('number');
        expect(aliceSees).toContain('Group: Warehouse');
        expect(ungrouped.status).toBe(303);
        expect(await closed).toBe(1008);
        expect(await openSocket(appId, bob)).toBe(404);
    });

    it("should list who uses an app, and show an admin a member's state read only, audited", async () => {
        // Arrange
        const made = await fetch(`${magnetic.origin}/orgs/${orgId}/apps`, { method: 'POST', headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Expenses' }) });
        const appId = ((await made.json()) as { id: string }).id;
        await post(`/settings/orgs/${orgId}`, alice, { do: 'open', appId, open: 'true' });
        const workspaceId = (await magnetic.orgs.get(orgId))?.workspaceId as string;
        await magnetic.database.transaction(
            async (tx) => {
                await new PgUiInstanceRepository(txWorkspaceDb(tx, workspaceId), bobId).write(appId, {}, { route: { screen: 'claim' } } as never);
            },
            { workspaceIds: [workspaceId] }
        );

        // Act
        const orgHtml = await (await page(`/settings/orgs/${orgId}`, alice)).text();
        const support = await page(`/settings/orgs/${orgId}/apps/${appId}/instances/${bobId}`, alice);
        const supportHtml = await support.text();
        const byBob = await page(`/settings/orgs/${orgId}/apps/${appId}/instances/${bobId}`, bob);

        // Assert
        expect(orgHtml).toContain('Every member may use it.');
        expect(orgHtml).toContain(`/settings/orgs/${orgId}/apps/${appId}/instances/${bobId}`);
        expect(support.status).toBe(200);
        expect(supportHtml).toContain('bob in expenses');
        expect(supportHtml).toContain('&quot;claim&quot;');
        expect(byBob.status).toBe(403);
        expect((await magnetic.orgs.auditLog(aliceId, orgId)).some((event) => event['action'] === 'instance.support_view')).toBe(true);
    });

    it("should show admins the org's policies, domains, sign-in and spend, change them from the page, and keep sign-in rules to owners", async () => {
        // Arrange
        await magnetic.database.query("UPDATE org_member SET role = 'admin' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);
        await magnetic.policies.set(aliceId, orgId, { requireSso: true });

        // Act
        const ownerPage = await (await page(`/settings/orgs/${orgId}`, alice)).text();
        const adminPage = await (await page(`/settings/orgs/${orgId}`, bob)).text();
        const byAdmin = await post(`/settings/orgs/${orgId}`, bob, { do: 'policy', externalLinks: 'on', personalWorkspaces: 'on', agentModels: ['claude-haiku-5-5'], retentionDays: '90', monthlyBudget: '' });
        const domain = await post(`/settings/orgs/${orgId}`, alice, { do: 'addDomain', domain: 'acme.test' });
        const domainByAdmin = await post(`/settings/orgs/${orgId}`, bob, { do: 'addDomain', domain: 'other.test' });
        const notThere = await post(`/settings/orgs/${orgId}`, alice, { do: 'verifyDomain', domain: 'acme.test' });
        const noKey = await post(`/settings/orgs/${orgId}`, alice, { do: 'sso', issuer: 'https://login.acme.test', clientId: 'magnetic', clientSecret: 'secret', enabled: 'on' });
        const after = await (await page(`/settings/orgs/${orgId}`, alice)).text();

        // Assert
        expect(ownerPage).toContain('Policies');
        expect(ownerPage).toContain('Delete the org');
        expect(ownerPage).toContain('This server has no secret key');
        expect(adminPage).toContain('Agent spend this month');
        expect(adminPage).not.toContain('Delete the org');
        expect(adminPage).toMatch(/name="requireSso" value="on" checked disabled/);
        expect(byAdmin.status).toBe(303);
        expect(await magnetic.policies.get(orgId)).toEqual({ personalWorkspaces: true, externalLinks: true, autoJoin: false, requireSso: true, grantsInOrg: false, agentModels: ['claude-haiku-5-5'], retentionDays: 90 });
        expect(domain.status).toBe(303);
        expect(domainByAdmin.status).toBe(403);
        expect(notThere.status).toBe(409);
        expect(noKey.status).toBe(409);
        expect(after).toContain('_magnetic-challenge.acme.test');
        await magnetic.policies.set(aliceId, orgId, { requireSso: null, externalLinks: null, agentModels: null, retentionDays: null });
        await magnetic.database.query("UPDATE org_member SET role = 'member' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);
    });

    it('should let a member leave the org from its page', async () => {
        // Act
        const left = await post(`/settings/orgs/${orgId}`, bob, { do: 'leave' });

        // Assert
        expect(left.status).toBe(303);
        expect(left.headers.get('location')).toBe('/settings/orgs');
        expect(await magnetic.orgs.role(orgId, bobId)).toBeUndefined();
    });
});
