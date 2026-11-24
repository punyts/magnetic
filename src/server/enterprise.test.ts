import { txInstances } from '@punyts/stateui-pg';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentModel, ModelMessage } from '../agent/AgentModel.js';
import { SSO_REQUIRED } from '../orgs/SignInRules.js';
import { startMockOidcProvider } from '../testing/mockOidcProvider.js';
import type { MockOidcProvider } from '../testing/mockOidcProvider.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { NO_PERSONAL_APPS, ORG_BUDGET_SPENT, startMagnetic } from './startMagnetic.js';
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

/** Answers every request at once with a short reply, at no cost worth counting */
const quickModel: AgentModel = {
    request: async () =>
        ({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-5-5',
            content: [{ type: 'text', text: 'Done.' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        }) as unknown as ModelMessage
};

/** The `name=value` of each `Set-Cookie`, by name */
function cookiesOf(response: Response): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const equals = (pair as string).indexOf('=');
        cookies.set((pair as string).slice(0, equals), (pair as string).slice(equals + 1));
    }
    return cookies;
}

describe('Enterprise controls', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    /** A provider the server offers everyone, like LinkedIn */
    let publicProvider: MockOidcProvider;
    /** The org's own provider, like its Okta */
    let orgProvider: MockOidcProvider;
    const dns = new Map<string, string[][]>();
    let alice: string;
    let bob: string;
    let aliceId: string;
    let bobId: string;
    let orgId: string;
    let workspaceId: string;

    const get = (path: string, cookie?: string): Promise<Response> => fetch(path.startsWith('http') ? path : `${magnetic.origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });
    const json = (path: string, cookie: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const form = (path: string, cookie: string, fields: Record<string, string>): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

    async function devSignIn(user: string): Promise<string> {
        const response = await form('/signin/dev', '', { user });
        return `magnetic_session=${cookiesOf(response).get('magnetic_session')}`;
    }

    /** Signs in through the server's public provider; the callback's response */
    async function publicSignIn(): Promise<Response> {
        const started = await get('/auth/mock');
        const cookie = `magnetic_signin=${cookiesOf(started).get('magnetic_signin')}`;
        const callback = (await get(started.headers.get('location') as string)).headers.get('location') as string;
        return get(callback, cookie);
    }

    /** Signs in with a work email, through the org's provider; the response that starts it, and the callback's */
    async function workSignIn(email: string): Promise<{ started: Response; done?: Response }> {
        const started = await get(`/signin/sso?email=${encodeURIComponent(email)}`);
        if (started.status !== 303) return { started };
        const cookie = `magnetic_signin=${cookiesOf(started).get('magnetic_signin')}`;
        const callback = (await get(started.headers.get('location') as string)).headers.get('location') as string;
        return { started, done: await get(callback, cookie) };
    }

    const userIdOf = async (response: Response): Promise<string> => (await magnetic.sessions.find(cookiesOf(response).get('magnetic_session')))?.userId as string;

    beforeAll(async () => {
        database = await magneticTestDatabase();
        publicProvider = await startMockOidcProvider();
        orgProvider = await startMockOidcProvider();
        magnetic = await startMagnetic({
            database: database.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice', 'bob'],
            starter: 'none',
            browser: noBrowser,
            allowHttpProviders: true,
            providers: [{ name: 'mock', label: 'Sign in with Mock', issuer: publicProvider.issuer, clientId: publicProvider.clientId, clientSecret: publicProvider.clientSecret }],
            secretKey: 'a test secret key of some length',
            resolveTxt: async (name) => dns.get(name) ?? [],
            agent: { model: quickModel }
        });
        alice = await devSignIn('alice');
        bob = await devSignIn('bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        const org = await magnetic.orgs.create(aliceId, { name: 'Acme', slug: 'acme' });
        orgId = org.id;
        workspaceId = org.workspaceId;
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, bobId]);
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await publicProvider.stop();
        await orgProvider.stop();
        await database.drop();
    });

    it('should let admins set policies, leave how people sign in to owners, and refuse a value a policy cannot take', async () => {
        // Act
        const byAdmin = await json(`/orgs/${orgId}/policy`, bob, 'POST', { retentionDays: 30, monthlyBudget: 50 });
        const ssoByAdmin = await json(`/orgs/${orgId}/policy`, bob, 'POST', { requireSso: true });
        const badModel = await json(`/orgs/${orgId}/policy`, alice, 'POST', { agentModels: ['gpt-9'] });
        const badPolicy = await json(`/orgs/${orgId}/policy`, alice, 'POST', { everything: true });
        const cleared = await json(`/orgs/${orgId}/policy`, alice, 'POST', { retentionDays: null, monthlyBudget: null });

        // Assert
        expect(byAdmin.status).toBe(200);
        expect(await byAdmin.json()).toMatchObject({ retentionDays: 30, monthlyBudget: 50, personalWorkspaces: true, externalLinks: false });
        expect(ssoByAdmin.status).toBe(403);
        expect(badModel.status).toBe(400);
        expect(badPolicy.status).toBe(400);
        expect(await cleared.json()).toEqual({ personalWorkspaces: true, externalLinks: false, autoJoin: false, requireSso: false, grantsInOrg: false, connections: true });
        expect((await magnetic.orgs.auditLog(aliceId, orgId)).filter((event) => event['action'] === 'policy.changed')).toHaveLength(2);
    });

    it('should verify a domain only once its TXT record is published, and never auto-join someone at an unverified one', async () => {
        // Arrange
        await magnetic.policies.set(aliceId, orgId, { autoJoin: true });
        const added = (await (await json(`/orgs/${orgId}/domains`, alice, 'POST', { domain: 'Acme.test' })).json()) as { recordName: string; recordValue: string };
        publicProvider.person = { sub: 'ada-1', name: 'Ada', email: 'ada@acme.test', email_verified: true };

        // Act
        const early = await json(`/orgs/${orgId}/domains/acme.test/verify`, alice, 'POST');
        const beforeVerified = await userIdOf(await publicSignIn());
        const roleBeforeVerified = await magnetic.orgs.role(orgId, beforeVerified);
        const byAdmin = await json(`/orgs/${orgId}/domains`, bob, 'POST', { domain: 'acme2.test' });
        dns.set(added.recordName, [[added.recordValue]]);
        const verified = await json(`/orgs/${orgId}/domains/acme.test/verify`, alice, 'POST');
        const afterVerified = await userIdOf(await publicSignIn());
        publicProvider.person = { sub: 'eve-1', name: 'Eve', email: 'eve@acme.test', email_verified: false };
        const unverifiedEmail = await userIdOf(await publicSignIn());

        // Assert
        expect(added.recordName).toBe('_magnetic-challenge.acme.test');
        expect(await early.json()).toEqual({ verified: false });
        expect(roleBeforeVerified).toBeUndefined();
        expect(byAdmin.status).toBe(403);
        expect(await verified.json()).toEqual({ verified: true });
        expect(afterVerified).toBe(beforeVerified);
        expect(await magnetic.orgs.role(orgId, afterVerified)).toBe('member');
        expect(await magnetic.orgs.role(orgId, unverifiedEmail)).toBeUndefined();
        const log = await magnetic.orgs.auditLog(aliceId, orgId);
        expect(log.map((event) => event['action'])).toEqual(expect.arrayContaining(['domain.added', 'domain.verified', 'member.auto_joined', 'user.signed_in']));
        expect(log.find((event) => event['action'] === 'user.signed_in')?.['actor_id']).toBe(afterVerified);
    });

    it("should sign people in through the org's own provider, and with requireSso let them in no other way", async () => {
        // Arrange
        const sso = await json(`/orgs/${orgId}/sso`, alice, 'POST', { issuer: orgProvider.issuer, clientId: orgProvider.clientId, clientSecret: orgProvider.clientSecret, enabled: true });
        const ssoByAdmin = await json(`/orgs/${orgId}/sso`, bob, 'POST', { issuer: orgProvider.issuer, clientId: 'x', clientSecret: 'y', enabled: true });
        const shown = (await (await json(`/orgs/${orgId}/sso`, bob, 'GET')).json()) as Record<string, unknown>;
        await magnetic.policies.set(aliceId, orgId, { requireSso: true });
        publicProvider.person = { sub: 'ada-1', name: 'Ada', email: 'ada@acme.test', email_verified: true };
        orgProvider.person = { sub: 'okta-grace', name: 'Grace', email: 'grace@acme.test' };

        // Act
        const refused = await publicSignIn();
        const work = await workSignIn('grace@acme.test');
        const unknownDomain = await workSignIn('someone@elsewhere.test');
        orgProvider.person = { sub: 'okta-mallory', name: 'Mallory', email: 'ceo@bigbank.test' };
        const outsider = await workSignIn('grace@acme.test');
        const signInPage = await (await get('/signin')).text();

        // Assert
        expect(sso.status).toBe(200);
        expect(ssoByAdmin.status).toBe(403);
        expect(shown).toEqual({ available: true, redirectUri: `${magnetic.origin}/auth/sso/callback`, provider: { issuer: orgProvider.issuer, clientId: orgProvider.clientId, enabled: true } });
        expect(JSON.stringify(await magnetic.database.query('SELECT client_secret FROM org_sso'))).not.toContain(orgProvider.clientSecret);
        expect(refused.status).toBe(400);
        expect(await refused.text()).toContain(SSO_REQUIRED.slice(0, 40));
        expect(work.started.status).toBe(303);
        expect(work.done?.status).toBe(303);
        const grace = await userIdOf(work.done as Response);
        expect(await magnetic.orgs.role(orgId, grace)).toBe('member');
        expect((await magnetic.database.query('SELECT provider, org_id FROM identity WHERE user_id = $1', [grace])).rows).toEqual([{ provider: `org:${orgId}`, org_id: orgId }]);
        expect((await magnetic.database.query('SELECT email_verified FROM app_user WHERE id = $1', [grace])).rows[0]).toEqual({ email_verified: true });
        expect(unknownDomain.started.status).toBe(404);
        // The org's provider vouches only for its own domains: an email elsewhere is kept, unverified
        const mallory = await userIdOf(outsider.done as Response);
        expect((await magnetic.database.query('SELECT email_verified FROM app_user WHERE id = $1', [mallory])).rows[0]).toEqual({ email_verified: false });
        expect(signInPage).toContain('Sign in with your email');
        await magnetic.policies.set(aliceId, orgId, { requireSso: false, autoJoin: false });
    });

    it('should open a share link to an org app only for its members, unless the org allows outside people', async () => {
        // Arrange
        const made = await json(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Roster' });
        const appId = ((await made.json()) as { id: string }).id;
        const link = ((await (await json(`/edit/${appId}/share`, alice, 'POST', { right: 'use' })).json()) as { url: string }).url;
        publicProvider.person = { sub: 'zed-1', name: 'Zed', email: 'zed@outside.test', email_verified: true };
        const outsiderCookie = `magnetic_session=${cookiesOf(await publicSignIn()).get('magnetic_session')}`;

        // Act
        const membersOnly = await get(link, outsiderCookie);
        const forMember = await get(link, bob);
        await magnetic.policies.set(aliceId, orgId, { externalLinks: true });
        const allowed = await get(link, outsiderCookie);
        await magnetic.policies.set(aliceId, orgId, { externalLinks: false });
        const appAfter = await get(`/apps/${appId}`, outsiderCookie);

        // Assert
        expect(membersOnly.status).toBe(403);
        expect(await membersOnly.text()).toContain('shares it only with its members');
        expect(forMember.status).toBe(303);
        expect(allowed.status).toBe(303);
        expect(allowed.headers.get('location')).toBe(`/apps/${appId}`);
        expect(appAfter.status).toBe(404);
    });

    it("should refuse turns in the org's apps once its monthly budget is spent, and nowhere else; and hold its people to its models", async () => {
        // Arrange
        const made = await json(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Budgeted' });
        const appId = ((await made.json()) as { id: string }).id;
        const own = await fetch(`${magnetic.origin}/new`, { method: 'POST', headers: { Cookie: alice, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=mine' });
        const ownId = ((await own.json()) as { id: string }).id;
        await magnetic.policies.set(aliceId, orgId, { monthlyBudget: 0.5, agentModels: ['claude-haiku-5-5'] });
        const turn = (id: string, model?: string): Promise<Response> => json(`/edit/${id}/turns`, alice, 'POST', { text: 'Add a title', ...(model !== undefined && { model }) });

        // Act
        const opus = await turn(appId, 'claude-opus-5-5');
        const beforeSpent = await turn(appId);
        while (magnetic.turns.isRunning(aliceId)) await new Promise((resolve) => setTimeout(resolve, 10));
        await magnetic.budgets.charge(aliceId, 0.6, { workspaceId, appId });
        const spent = await turn(appId);
        const personal = await turn(ownId, 'claude-opus-5-5');
        while (magnetic.turns.isRunning(aliceId)) await new Promise((resolve) => setTimeout(resolve, 10));
        const spend = (await (await json(`/orgs/${orgId}/spend`, bob, 'GET')).json()) as { month: number; budget: number; byPersonAndApp: Array<{ userId: string; dollars: number }> };

        // Assert
        expect(opus.status).toBe(409);
        expect(((await opus.json()) as { message: string }).message).toMatch(/does not allow this model/);
        expect(beforeSpent.status).toBe(202);
        expect(spent.status).toBe(409);
        expect(((await spent.json()) as { message: string }).message).toBe(ORG_BUDGET_SPENT);
        expect(personal.status).toBe(202);
        expect(spend.budget).toBe(0.5);
        expect(spend.month).toBeGreaterThanOrEqual(0.6);
        expect(spend.byPersonAndApp[0]).toMatchObject({ userId: aliceId });
        await magnetic.policies.set(aliceId, orgId, { monthlyBudget: null, agentModels: null });
    });

    it('should make a new app in the org when the org keeps apps in the org, and refuse one to a member who may not build', async () => {
        // Arrange
        await magnetic.policies.set(aliceId, orgId, { personalWorkspaces: false });
        const make = (): Promise<Response> => fetch(`${magnetic.origin}/new`, { method: 'POST', headers: { Cookie: bob, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=side-project' });
        const workspaceId = (await magnetic.orgs.of(bobId)).find((org) => org.id === orgId)?.workspaceId as string;

        // Act
        const made = await make();
        const madeId = ((await made.json()) as { id: string }).id;
        await magnetic.database.query("UPDATE org_member SET role = 'member' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);
        const refused = await make();
        await magnetic.database.query("UPDATE org_member SET role = 'admin' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);

        // Assert
        expect(made.status).toBe(201);
        expect((await magnetic.access.visibleApps(bobId, workspaceId)).get(madeId)).toBe('manage');
        expect(refused.status).toBe(403);
        expect(await refused.json()).toEqual({ message: NO_PERSONAL_APPS });
        await magnetic.policies.set(aliceId, orgId, { personalWorkspaces: true });
    });

    it('should never let an audit event be changed or deleted', async () => {
        await expect(magnetic.database.query("UPDATE audit_event SET action = 'nothing' WHERE org_id = $1", [orgId])).rejects.toThrow(/append only/);
        await expect(magnetic.database.query('DELETE FROM audit_event WHERE org_id = $1', [orgId])).rejects.toThrow(/append only/);
    });

    it('should drop old chats and the old state of people who left, once the org keeps data for a set time', async () => {
        // Arrange
        const appId = '00000000-0000-4000-8000-000000000001';
        const now = new Date('2026-11-15T12:00:00Z');
        await magnetic.policies.set(aliceId, orgId, { retentionDays: 30 });
        await magnetic.database.transaction(
            async (tx) => {
                await tx.query("INSERT INTO chat_entry (workspace_id, app_id, user_id, role, text, at) VALUES ($1, $2, $3, 'person', 'old', $4), ($1, $2, $3, 'person', 'new', $5)", [workspaceId, appId, aliceId, new Date('2026-09-01T00:00:00Z'), new Date('2026-11-14T00:00:00Z')]);
                for (const persona of ['left-person', aliceId]) await txInstances(tx, workspaceId, persona, magnetic.owners).write(appId, {}, { route: { screen: 'x' } } as never);
                await tx.query('UPDATE namespace_head SET updated_at = $2 WHERE workspace_id = $1', [workspaceId, new Date('2026-09-01T00:00:00Z')]);
            },
            { workspaceIds: [workspaceId] }
        );

        // Act
        const removed = await magnetic.policies.applyRetention(now);
        const left = await magnetic.database.transaction(
            async (tx) => ({ chats: (await tx.query('SELECT text FROM chat_entry WHERE workspace_id = $1 AND app_id = $2', [workspaceId, appId])).rows, instances: (await tx.query("SELECT split_part(address, '/', 1) AS persona FROM namespace_head WHERE workspace_id = $1 AND split_part(address, '/', 3) = $2", [workspaceId, appId])).rows }),
            { workspaceIds: [workspaceId] }
        );

        // Assert
        expect(removed).toBe(2);
        expect(left.chats).toEqual([{ text: 'new' }]);
        expect(left.instances).toEqual([{ persona: magnetic.owners.of(aliceId) }]);
    });

    it('should export the org for its owners, and delete it only when its short name is typed', async () => {
        // Act
        const byAdmin = await json(`/orgs/${orgId}/export`, bob, 'GET');
        const exported = await json(`/orgs/${orgId}/export`, alice, 'GET');
        const body = (await exported.json()) as { format: string; parts: Array<{ name: string }>; members: unknown[]; audit: unknown[] };
        const wrong = await json(`/orgs/${orgId}`, alice, 'DELETE', { confirm: 'nope' });
        const deleted = await json(`/orgs/${orgId}`, alice, 'DELETE', { confirm: 'acme' });
        const parts = await magnetic.database.transaction(async (tx) => (await tx.query('SELECT count(*)::int AS n FROM part WHERE workspace_id = $1', [workspaceId])).rows[0], { workspaceIds: [workspaceId] });
        const trail = (await magnetic.database.query('SELECT action FROM audit_event WHERE org_id = $1 ORDER BY id DESC LIMIT 1', [orgId])).rows[0];

        // Assert
        expect(byAdmin.status).toBe(403);
        expect(exported.status).toBe(200);
        expect(exported.headers.get('content-disposition')).toBe('attachment; filename="acme-export.json"');
        expect(body.format).toBe('magnetic-org-export/3');
        expect(body.parts.map((part) => part.name)).toEqual(expect.arrayContaining(['roster', 'budgeted']));
        expect(body.members.length).toBeGreaterThanOrEqual(2);
        expect(body.audit.length).toBeGreaterThan(5);
        expect(wrong.status).toBe(400);
        expect(deleted.status).toBe(200);
        expect(await magnetic.orgs.get(orgId)).toBeUndefined();
        expect(parts).toEqual({ n: 0 });
        expect(trail).toEqual({ action: 'org.deleted' });
    });
});
