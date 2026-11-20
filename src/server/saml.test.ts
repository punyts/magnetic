import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SSO_REQUIRED } from '../orgs/SignInRules.js';
import { startMockOidcProvider } from '../testing/mockOidcProvider.js';
import type { MockOidcProvider } from '../testing/mockOidcProvider.js';
import { startMockSamlProvider } from '../testing/mockSamlProvider.js';
import type { MockSamlProvider, MockSamlTamper } from '../testing/mockSamlProvider.js';
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

/** The provider's page posts its answer from its own site */
const PROVIDER_ORIGIN = 'https://idp.elsewhere.test';

describe('SAML sign-in per org', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    let idp: MockSamlProvider;
    let publicProvider: MockOidcProvider;
    let orgOidc: MockOidcProvider;
    const dns = new Map<string, string[][]>();
    let alice: string;
    let bob: string;
    let aliceId: string;
    let orgId: string;

    const get = (path: string, cookie?: string): Promise<Response> => fetch(path.startsWith('http') ? path : `${magnetic.origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });
    const json = (path: string, cookie: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const form = (path: string, cookie: string, fields: Record<string, string>, origin = magnetic.origin): Promise<Response> =>
        fetch(path.startsWith('http') ? path : `${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

    async function devSignIn(user: string): Promise<string> {
        return `magnetic_session=${cookiesOf(await form('/signin/dev', '', { user })).get('magnetic_session')}`;
    }

    /** Starts a sign-in with a work email and sends the browser to the provider; the start, and its cookie */
    async function startSaml(email: string): Promise<{ started: Response; cookie: string }> {
        const started = await get(`/signin/sso?email=${encodeURIComponent(email)}`);
        if (started.status === 303) await get(started.headers.get('location') as string);
        return { started, cookie: `magnetic_signin=${cookiesOf(started).get('magnetic_signin')}` };
    }

    /** The provider's page posts its answer to the ACS URL, from another site, with no Magnetic cookie */
    const postAnswer = (answer: { acs: string; samlResponse: string }): Promise<Response> => form(answer.acs, '', { SAMLResponse: answer.samlResponse }, PROVIDER_ORIGIN);

    /** A whole sign-in: start, the provider's answer, and the finish in the browser that started it */
    async function samlSignIn(email: string, tamper?: MockSamlTamper): Promise<{ answered: Response; done?: Response }> {
        const { cookie } = await startSaml(email);
        const answered = await postAnswer(idp.answer(tamper));
        if (answered.status !== 303) return { answered };
        return { answered, done: await get(answered.headers.get('location') as string, cookie) };
    }

    const userIdOf = async (response: Response): Promise<string | undefined> => (await magnetic.sessions.find(cookiesOf(response).get('magnetic_session')))?.userId;

    beforeAll(async () => {
        database = await magneticTestDatabase();
        idp = await startMockSamlProvider();
        publicProvider = await startMockOidcProvider();
        orgOidc = await startMockOidcProvider();
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
            resolveTxt: async (name) => dns.get(name) ?? []
        });
        alice = await devSignIn('alice');
        bob = await devSignIn('bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        const bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        orgId = (await magnetic.orgs.create(aliceId, { name: 'Acme', slug: 'acme' })).id;
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, bobId]);
        const added = (await (await json(`/orgs/${orgId}/domains`, alice, 'POST', { domain: 'acme.test' })).json()) as { recordName: string; recordValue: string };
        dns.set(added.recordName, [[added.recordValue]]);
        await json(`/orgs/${orgId}/domains/acme.test/verify`, alice, 'POST');
        await magnetic.policies.set(aliceId, orgId, { autoJoin: true });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await idp.stop();
        await publicProvider.stop();
        await orgOidc.stop();
        await database.drop();
    });

    it('should let owners set the provider by its metadata URL, show it to admins, and refuse metadata that is no good', async () => {
        // Act
        const byAdmin = await json(`/orgs/${orgId}/saml`, bob, 'POST', { metadataUrl: idp.metadataUrl, enabled: true });
        const notHttps = await json(`/orgs/${orgId}/saml`, alice, 'POST', { metadataUrl: 'http://idp.example.com/metadata', enabled: true });
        const both = await json(`/orgs/${orgId}/saml`, alice, 'POST', { metadataUrl: idp.metadataUrl, metadataXml: idp.metadata(), enabled: true });
        const doctype = await json(`/orgs/${orgId}/saml`, alice, 'POST', { metadataXml: `<!DOCTYPE x [<!ENTITY a "b">]>${idp.metadata().replace('<?xml version="1.0"?>', '')}`, enabled: true });
        const set = await json(`/orgs/${orgId}/saml`, alice, 'POST', { metadataUrl: idp.metadataUrl, enabled: true });
        const shown = (await (await json(`/orgs/${orgId}/saml`, bob, 'GET')).json()) as { entityId: string; provider: Record<string, unknown> };
        const page = await (await get(`/settings/orgs/${orgId}`, alice)).text();

        // Assert
        expect(byAdmin.status).toBe(403);
        expect(notHttps.status).toBe(400);
        expect(both.status).toBe(400);
        expect(doctype.status).toBe(400);
        expect(((await doctype.json()) as { message: string }).message).toMatch(/document type declaration/);
        expect(set.status).toBe(200);
        expect(shown.entityId).toBe(`${magnetic.origin}/auth/saml/${orgId}`);
        expect(shown.provider).toMatchObject({ metadataUrl: idp.metadataUrl, entityId: idp.entityId, ssoUrl: expect.stringContaining('/sso') as unknown, certificates: 1, enabled: true });
        expect(page).toContain(`${magnetic.origin}/auth/saml/${orgId}`);
        expect((await magnetic.orgs.auditLog(aliceId, orgId)).filter((event) => event['action'] === 'saml.changed')).toHaveLength(1);
    });

    it("should sign a person in through the org's SAML provider, the answer posted from the provider's site", async () => {
        // Arrange
        idp.person = { nameId: 'grace-1', attributes: { email: 'grace@acme.test', displayName: 'Grace Hopper' } };

        // Act
        const { started, cookie } = await startSaml('grace@acme.test');
        const request = idp.lastRequest;
        const answered = await postAnswer(idp.answer());
        const done = await get(answered.headers.get('location') as string, cookie);
        const grace = await userIdOf(done);

        // Assert
        expect(started.status).toBe(303);
        expect(started.headers.get('location')).toMatch(/\/sso\?SAMLRequest=/);
        expect(request?.acs).toBe(`${magnetic.origin}/auth/saml/${orgId}`);
        expect(request?.issuer).toBe(`${magnetic.origin}/auth/saml/${orgId}`);
        expect(answered.status).toBe(303);
        expect(answered.headers.get('location')).toMatch(new RegExp(`^/auth/saml/${orgId}/finish\\?request=`));
        expect(cookiesOf(answered).has('magnetic_session')).toBe(false);
        expect(done.status).toBe(303);
        expect(grace).toBeDefined();
        expect(await magnetic.orgs.role(orgId, grace as string)).toBe('member');
        expect((await magnetic.database.query('SELECT provider, subject, org_id FROM identity WHERE user_id = $1', [grace])).rows).toEqual([{ provider: `org:${orgId}:saml`, subject: 'grace-1', org_id: orgId }]);
        expect((await magnetic.database.query('SELECT name, email, email_verified FROM app_user WHERE id = $1', [grace])).rows[0]).toEqual({ name: 'Grace Hopper', email: 'grace@acme.test', email_verified: true });
        expect((await samlSignIn('grace@acme.test')).done?.status).toBe(303);
        expect((await magnetic.database.query('SELECT count(*)::int AS n FROM identity WHERE user_id = $1', [grace])).rows[0]).toEqual({ n: 1 });
    });

    it('should refuse an unsigned, expired, wrong-audience or wrongly signed assertion, or one from another issuer', async () => {
        // Arrange
        idp.person = { nameId: 'mallory-1', attributes: { email: 'mallory@acme.test' } };
        const tampers: MockSamlTamper[] = ['unsigned', 'expired', 'audience', 'otherKey', 'issuer'];

        // Act
        const results = [];
        for (const tamper of tampers) results.push((await samlSignIn('mallory@acme.test', tamper)).answered);

        // Assert
        for (const answered of results) {
            expect(answered.status).toBe(400);
            expect(cookiesOf(answered).has('magnetic_session')).toBe(false);
            expect(cookiesOf(answered).has('magnetic_signin')).toBe(false);
        }
        expect((await magnetic.database.query("SELECT count(*)::int AS n FROM identity WHERE subject = 'mallory-1'")).rows[0]).toEqual({ n: 0 });
    });

    it('should take an answer once, and finish a sign-in only in the browser that started it', async () => {
        // Arrange
        idp.person = { nameId: 'heidi-1', attributes: { email: 'heidi@acme.test' } };
        const first = await startSaml('heidi@acme.test');
        const answer = idp.answer();

        // Act
        const answered = await postAnswer(answer);
        const replayed = await postAnswer(answer);
        const finishUrl = answered.headers.get('location') as string;
        const noCookie = await get(finishUrl);
        const other = await startSaml('heidi@acme.test');
        const otherBrowser = await get(finishUrl, other.cookie);
        const done = await get(finishUrl, first.cookie);
        const again = await get(finishUrl, first.cookie);

        // Assert
        expect(answered.status).toBe(303);
        expect(replayed.status).toBe(400);
        expect(noCookie.status).toBe(400);
        expect(otherBrowser.status).toBe(400);
        expect(done.status).toBe(303);
        expect(await userIdOf(done)).toBeDefined();
        expect(again.status).toBe(400);
    });

    it('should refuse a temporary NameID, which cannot name a person again', async () => {
        // Arrange
        idp.person = { nameId: 'tmp-123', nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient', attributes: { email: 'ivan@acme.test' } };

        // Act
        const { answered } = await samlSignIn('ivan@acme.test');

        // Assert
        expect(answered.status).toBe(400);
        expect(await answered.text()).toContain('temporary name');
    });

    it('should hold requireSso for an org that signs in with SAML only', async () => {
        // Arrange
        await magnetic.policies.set(aliceId, orgId, { requireSso: true });
        publicProvider.person = { sub: 'judy-public', name: 'Judy', email: 'judy@acme.test', email_verified: true };
        idp.person = { nameId: 'judy-1', attributes: { email: 'judy@acme.test' } };

        // Act
        const started = await get('/auth/mock');
        const callback = (await get(started.headers.get('location') as string)).headers.get('location') as string;
        const refused = await get(callback, `magnetic_signin=${cookiesOf(started).get('magnetic_signin')}`);
        const viaSaml = await samlSignIn('judy@acme.test');

        // Assert
        expect(refused.status).toBe(400);
        expect(await refused.text()).toContain(SSO_REQUIRED.slice(0, 40));
        expect(viaSaml.done?.status).toBe(303);
        expect(await magnetic.orgs.role(orgId, (await userIdOf(viaSaml.done as Response)) as string)).toBe('member');
        await magnetic.policies.set(aliceId, orgId, { requireSso: false });
    });

    it('should keep one kind of org sign-in on at a time, keeping the settings of the one switched off', async () => {
        // Act
        await json(`/orgs/${orgId}/sso`, alice, 'POST', { issuer: orgOidc.issuer, clientId: orgOidc.clientId, clientSecret: orgOidc.clientSecret, enabled: true });
        const afterOidc = (await (await json(`/orgs/${orgId}/saml`, alice, 'GET')).json()) as { provider: { enabled: boolean; entityId: string } };
        const oidcStart = await get('/signin/sso?email=kim@acme.test');
        const backToSaml = await json(`/orgs/${orgId}/saml`, alice, 'POST', { enabled: true });
        const afterSaml = (await (await json(`/orgs/${orgId}/sso`, alice, 'GET')).json()) as { provider: { enabled: boolean } };
        const samlStart = await get('/signin/sso?email=kim@acme.test');

        // Assert
        expect(afterOidc.provider).toMatchObject({ enabled: false, entityId: idp.entityId });
        expect(oidcStart.headers.get('location')).toContain(orgOidc.issuer);
        expect(backToSaml.status).toBe(200);
        expect(afterSaml.provider.enabled).toBe(false);
        expect(samlStart.headers.get('location')).toMatch(/\/sso\?SAMLRequest=/);
    });

    it('should read the metadata URL again daily, taking a new certificate, and keep the last good copy when it fails', async () => {
        // Arrange
        const stale = "UPDATE org_saml SET fetched_at = now() - interval '25 hours' WHERE org_id = $1";
        idp.rotate();
        await magnetic.database.query(stale, [orgId]);

        // Act
        const notDue = await magnetic.saml.refreshDue().then(async (first) => ({ first, second: await magnetic.saml.refreshDue() }));
        idp.person = { nameId: 'lena-1', attributes: { email: 'lena@acme.test' } };
        const afterRotate = await samlSignIn('lena@acme.test');
        idp.failing = true;
        await magnetic.database.query(stale, [orgId]);
        const failed = await magnetic.saml.refreshDue();
        idp.failing = false;
        const shown = (await (await json(`/orgs/${orgId}/saml`, alice, 'GET')).json()) as { provider: { fetchError?: string } };
        const stillWorks = await samlSignIn('lena@acme.test');
        const page = await (await get(`/settings/orgs/${orgId}`, alice)).text();

        // Assert
        expect(notDue.first).toEqual({ read: 1, failed: 0 });
        expect(notDue.second).toEqual({ read: 0, failed: 0 });
        expect(afterRotate.done?.status).toBe(303);
        expect(failed).toEqual({ read: 1, failed: 1 });
        expect(shown.provider.fetchError).toBe('The metadata URL answered 500.');
        expect(page).toContain('The metadata URL answered 500.');
        expect(stillWorks.done?.status).toBe(303);
    });
});
