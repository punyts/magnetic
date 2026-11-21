import { randomUUID } from 'node:crypto';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { SCIM_GROUP, SCIM_MEMBER } from '../orgs/Orgs.js';
import { SCIM_NEEDS_DOMAIN } from '../orgs/Scim.js';
import { startMockOidcProvider } from '../testing/mockOidcProvider.js';
import type { MockOidcProvider } from '../testing/mockOidcProvider.js';
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

function cookiesOf(response: Response): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const equals = (pair as string).indexOf('=');
        cookies.set((pair as string).slice(0, equals), (pair as string).slice(equals + 1));
    }
    return cookies;
}

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

/** A User as Okta pushes one */
const oktaUser = (email: string, given: string): Record<string, unknown> => ({
    schemas: [USER],
    userName: email,
    name: { givenName: given, familyName: 'Doe' },
    emails: [{ primary: true, value: email, type: 'work' }],
    displayName: `${given} Doe`,
    locale: 'en-US',
    externalId: `00u${given}`,
    groups: [],
    active: true
});

/** A User as Entra ID pushes one */
const entraUser = (email: string, given: string): Record<string, unknown> => ({
    schemas: [USER, ENTERPRISE],
    externalId: given.toLowerCase(),
    userName: email,
    active: true,
    displayName: `${given} Roe`,
    emails: [{ primary: true, type: 'work', value: email }],
    meta: { resourceType: 'User' },
    name: { formatted: `${given} Roe`, familyName: 'Roe', givenName: given },
    roles: [],
    [ENTERPRISE]: { department: 'Field' }
});

describe('SCIM provisioning per org', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    let provider: MockOidcProvider;
    const dns = new Map<string, string[][]>();
    let alice: string;
    let bob: string;
    let aliceId: string;
    let orgId: string;
    let token: string;

    const get = (path: string, cookie?: string): Promise<Response> => fetch(path.startsWith('http') ? path : `${magnetic.origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });
    const json = (path: string, cookie: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const form = (path: string, cookie: string, fields: Record<string, string>): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    /** A SCIM request as an identity provider's server sends it: a bearer token, no cookie, no Origin */
    const scim = (method: string, path: string, body?: unknown, bearer = token, org = orgId): Promise<Response> =>
        fetch(`${magnetic.origin}/scim/v2/${org}${path}`, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/scim+json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const patch = (path: string, operations: unknown[]): Promise<Response> => scim('PATCH', path, { schemas: [PATCH], Operations: operations });

    async function devSignIn(user: string): Promise<string> {
        return `magnetic_session=${cookiesOf(await form('/signin/dev', '', { user })).get('magnetic_session')}`;
    }

    /** Signs a person in through the public provider with a verified email; their session cookie and account */
    async function signIn(email: string): Promise<{ readonly cookie: string; readonly userId: string }> {
        provider.person = { sub: `sub-${email}`, name: email.split('@')[0] as string, email, email_verified: true };
        const started = await get('/auth/mock');
        const callback = (await get(started.headers.get('location') as string)).headers.get('location') as string;
        const done = await get(callback, `magnetic_signin=${cookiesOf(started).get('magnetic_signin')}`);
        const session = cookiesOf(done).get('magnetic_session') as string;
        return { cookie: `magnetic_session=${session}`, userId: (await magnetic.sessions.find(session))?.userId as string };
    }

    /** Verifies a domain for an org, as its owner */
    async function verify(cookie: string, org: string, domain: string): Promise<void> {
        const added = (await (await json(`/orgs/${org}/domains`, cookie, 'POST', { domain })).json()) as { recordName: string; recordValue: string };
        dns.set(added.recordName, [[added.recordValue]]);
        await json(`/orgs/${org}/domains/${domain}/verify`, cookie, 'POST');
    }

    /** Opens a view socket of an app; the socket once open, or the refusal's status */
    const openView = (appId: string, cookie: string): Promise<WebSocket | number> =>
        new Promise((resolve, reject) => {
            const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, { headers: { Origin: magnetic.origin, Cookie: cookie } });
            ws.once('open', () => resolve(ws));
            ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
            ws.once('error', reject);
        });
    /** The close code of an open view socket, once it closes */
    const closeOf = (socket: WebSocket | number): Promise<number> => (typeof socket === 'number' ? Promise.resolve(socket) : new Promise((resolve) => socket.once('close', (code) => resolve(code))));

    /** The token on the settings page just after it was made */
    const tokenOf = (page: string): string | undefined => /role="status">[^<]*<br><code class="link">([A-Za-z0-9_-]{43})<\/code>/.exec(page)?.[1];

    const groupNames = async (userId: string): Promise<string[]> =>
        (await magnetic.database.query<{ name: string }>('SELECT g.name FROM org_group g JOIN org_group_member gm ON gm.group_id = g.id WHERE g.org_id = $1 AND gm.user_id = $2 ORDER BY g.name', [orgId, userId])).rows.map((row) => row.name);

    beforeAll(async () => {
        database = await magneticTestDatabase();
        provider = await startMockOidcProvider();
        magnetic = await startMagnetic({
            database: database.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice', 'bob'],
            starter: 'none',
            browser: noBrowser,
            allowHttpProviders: true,
            providers: [{ name: 'mock', label: 'Sign in with Mock', issuer: provider.issuer, clientId: provider.clientId, clientSecret: provider.clientSecret }],
            secretKey: 'a test secret key of some length',
            resolveTxt: async (name) => dns.get(name) ?? []
        });
        alice = await devSignIn('alice');
        bob = await devSignIn('bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        const bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        orgId = (await magnetic.orgs.create(aliceId, { name: 'Acme', slug: 'acme' })).id;
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, bobId]);
        await verify(alice, orgId, 'acme.test');
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await provider.stop();
        await database.drop();
    });

    it('should let only the owner turn SCIM on, show the token once, and take only that token for that org', async () => {
        // Arrange
        const plain = (await magnetic.orgs.create(aliceId, { name: 'Plain', slug: 'plain' })).id;

        // Act
        const byAdmin = await form(`/settings/orgs/${orgId}`, bob, { do: 'scimOn' });
        const noDomain = await form(`/settings/orgs/${plain}`, alice, { do: 'scimOn' });
        const turnedOn = await form(`/settings/orgs/${orgId}`, alice, { do: 'scimOn' });
        const page = await turnedOn.text();
        token = tokenOf(page) as string;
        const again = await (await get(`/settings/orgs/${orgId}`, alice)).text();
        const adminPage = await (await get(`/settings/orgs/${orgId}`, bob)).text();
        const config = await scim('GET', '/ServiceProviderConfig');
        const types = (await (await scim('GET', '/ResourceTypes')).json()) as { totalResults: number };
        const schemas = (await (await scim('GET', '/Schemas')).json()) as { Resources: Array<{ id: string }> };
        const wrong = await scim('GET', '/Users', undefined, 'x'.repeat(43));
        const otherOrg = await scim('GET', '/Users', undefined, token, plain);
        const noToken = await fetch(`${magnetic.origin}/scim/v2/${orgId}/Users`);

        // Assert
        expect(byAdmin.status).toBe(403);
        expect(noDomain.status).toBe(409);
        expect(await noDomain.text()).toContain(SCIM_NEEDS_DOMAIN.slice(0, 30));
        expect(turnedOn.status).toBe(200);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(page).toContain(`/scim/v2/${orgId}`);
        expect(again).not.toContain(token);
        expect(again).toContain('Make a new token');
        expect(adminPage).not.toContain('Make a new token');
        expect(adminPage).toContain('only people the identity provider pushes join');
        expect(config.status).toBe(200);
        expect(config.headers.get('content-type')).toContain('application/scim+json');
        expect(((await config.json()) as { patch: { supported: boolean } }).patch.supported).toBe(true);
        expect(types.totalResults).toBe(2);
        expect(schemas.Resources.map((schema) => schema.id)).toEqual([USER, GROUP]);
        expect(wrong.status).toBe(401);
        expect(otherOrg.status).toBe(401);
        expect(noToken.status).toBe(401);
        expect(noToken.headers.get('www-authenticate')).toBe('Bearer');
    });

    it('should hold a pushed person until they sign in, then make them a member with their pushed groups', async () => {
        // Act
        const pushed = await scim('POST', '/Users', oktaUser('judy@acme.test', 'Judy'));
        const judy = (await pushed.json()) as { id: string; active: boolean; emails: Array<{ value: string }>; meta: { location: string } };
        const found = (await (await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "JUDY@acme.test"')}&startIndex=1&count=100`)).json()) as { totalResults: number; Resources: Array<{ id: string }> };
        const none = (await (await scim('GET', `/Users?filter=${encodeURIComponent('userName eq "nobody@acme.test"')}`)).json()) as { totalResults: number };
        const group = (await (await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Field Ops', members: [{ value: judy.id, display: 'Judy Doe' }] })).json()) as { id: string; members: Array<{ value: string }> };
        const heldMembers = (await magnetic.database.query('SELECT 1 FROM org_member WHERE org_id = $1 AND user_id IN (SELECT id FROM app_user WHERE email = $2)', [orgId, 'judy@acme.test'])).rows.length;
        const { userId } = await signIn('judy@acme.test');
        const audit = (await magnetic.database.query<{ action: string; detail: unknown }>('SELECT action, detail FROM audit_event WHERE org_id = $1', [orgId])).rows;

        // Assert
        expect(pushed.status).toBe(201);
        expect(pushed.headers.get('location')).toBe(judy.meta.location);
        expect(judy.active).toBe(true);
        expect(judy.emails[0]?.value).toBe('judy@acme.test');
        expect(found.totalResults).toBe(1);
        expect(found.Resources[0]?.id).toBe(judy.id);
        expect(none.totalResults).toBe(0);
        expect(group.members.map((member) => member.value)).toEqual([judy.id]);
        expect(heldMembers).toBe(0);
        expect(await magnetic.orgs.role(orgId, userId)).toBe('member');
        expect(await groupNames(userId)).toEqual(['Field Ops']);
        expect(audit.map((event) => event.action)).toEqual(expect.arrayContaining(['scim.enabled', 'scim.user_pushed', 'scim.group_pushed', 'member.provisioned']));
        expect(JSON.stringify(audit)).not.toContain('judy');
    });

    it('should link a person already in the org at once, and refuse their removal by an admin', async () => {
        // Arrange
        const kim = await signIn('kim@acme.test');
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'builder')", [orgId, kim.userId]);

        // Act
        const pushed = await scim('POST', '/Users', entraUser('kim@acme.test', 'Kim'));
        const members = (await (await json(`/orgs/${orgId}/members`, alice, 'GET')).json()) as { members: Array<{ userId: string; scim?: boolean }> };
        const removal = await json(`/orgs/${orgId}/members/${kim.userId}`, alice, 'DELETE');
        const leaving = await form(`/settings/orgs/${orgId}`, kim.cookie, { do: 'leave' });
        const page = await (await get(`/settings/orgs/${orgId}`, alice)).text();

        // Assert
        expect(pushed.status).toBe(201);
        expect(members.members.find((member) => member.userId === kim.userId)?.scim).toBe(true);
        expect(await magnetic.orgs.role(orgId, kim.userId)).toBe('builder');
        expect(removal.status).toBe(409);
        expect(((await removal.json()) as { message: string }).message).toBe(SCIM_MEMBER);
        expect(leaving.status).toBe(409);
        expect(page).toContain('Managed by your identity provider');
    });

    it('should refuse an email outside the verified domains, a second user with the same email, and a filter it does not take', async () => {
        // Act
        const outside = await scim('POST', '/Users', oktaUser('zed@elsewhere.test', 'Zed'));
        const twice = await scim('POST', '/Users', { ...oktaUser('judy@acme.test', 'Judy'), userName: 'judy2' });
        const noEmail = await scim('POST', '/Users', { schemas: [USER], userName: 'plainname' });
        const badFilter = await scim('GET', `/Users?filter=${encodeURIComponent('userName co "a"')}`);
        const notJson = await fetch(`${magnetic.origin}/scim/v2/${orgId}/Users`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: 'x' });

        // Assert
        expect(outside.status).toBe(400);
        expect(((await outside.json()) as { scimType: string }).scimType).toBe('invalidValue');
        expect(twice.status).toBe(409);
        expect(((await twice.json()) as { scimType: string }).scimType).toBe('uniqueness');
        expect(noEmail.status).toBe(400);
        expect(badFilter.status).toBe(400);
        expect(((await badFilter.json()) as { scimType: string }).scimType).toBe('invalidFilter');
        expect(notJson.status).toBe(415);
    });

    it('should remove a member who is deactivated or deleted, and rejoin them when turned on again', async () => {
        // Arrange
        const found = (await (await scim('GET', `/Users?filter=${encodeURIComponent('emails[type eq "work"].value eq "judy@acme.test"')}`)).json()) as { Resources: Array<{ id: string }> };
        const judyId = found.Resources[0]?.id as string;
        const userId = (await magnetic.database.query<{ user_id: string }>('SELECT user_id FROM scim_user WHERE id = $1', [judyId])).rows[0]?.user_id as string;

        // Act
        const entraOff = await patch(`/Users/${judyId}`, [{ op: 'Replace', path: 'active', value: 'False' }]);
        const afterOff = await magnetic.orgs.role(orgId, userId);
        const oktaOn = await patch(`/Users/${judyId}`, [{ op: 'replace', value: { active: true } }]);
        const afterOn = await magnetic.orgs.role(orgId, userId);
        const groupsOn = await groupNames(userId);
        const entraEmail = await patch(`/Users/${judyId}`, [
            { op: 'Add', path: 'emails[type eq "work"].value', value: 'judy.doe@acme.test' },
            { op: 'Replace', path: 'name.givenName', value: 'Judith' },
            { op: 'Add', path: `${ENTERPRISE}:department`, value: 'Field' }
        ]);
        const changed = (await entraEmail.json()) as { emails: Array<{ value: string }>; name: { givenName: string } };
        const put = await scim('PUT', `/Users/${judyId}`, { ...oktaUser('judy.doe@acme.test', 'Judith'), active: false });
        const afterPut = await magnetic.orgs.role(orgId, userId);
        await patch(`/Users/${judyId}`, [{ op: 'replace', path: 'active', value: true }]);
        const deleted = await scim('DELETE', `/Users/${judyId}`);
        const afterDelete = await magnetic.orgs.role(orgId, userId);
        const gone = await scim('GET', `/Users/${judyId}`);

        // Assert
        expect(entraOff.status).toBe(200);
        expect(afterOff).toBeUndefined();
        expect(oktaOn.status).toBe(200);
        expect(afterOn).toBe('member');
        expect(groupsOn).toEqual(['Field Ops']);
        expect(changed.emails[0]?.value).toBe('judy.doe@acme.test');
        expect(changed.name.givenName).toBe('Judith');
        expect(put.status).toBe(200);
        expect(afterPut).toBeUndefined();
        expect(deleted.status).toBe(204);
        expect(afterDelete).toBeUndefined();
        expect(gone.status).toBe(404);
    });

    it("should refuse to remove the org's last owner", async () => {
        // Arrange
        const olive = await signIn('olive@solo.test');
        const solo = (await magnetic.orgs.create(olive.userId, { name: 'Solo', slug: 'solo' })).id;
        await verify(olive.cookie, solo, 'solo.test');
        const soloToken = tokenOf(await (await form(`/settings/orgs/${solo}`, olive.cookie, { do: 'scimOn' })).text()) as string;
        const pushed = (await (await scim('POST', '/Users', oktaUser('olive@solo.test', 'Olive'), soloToken, solo)).json()) as { id: string };

        // Act
        const off = await scim('PATCH', `/Users/${pushed.id}`, { schemas: [PATCH], Operations: [{ op: 'replace', value: { active: false } }] }, soloToken, solo);

        // Assert
        expect(off.status).toBe(409);
        expect(await magnetic.orgs.role(solo, olive.userId)).toBe('owner');
    });

    it('should keep pushed groups as the provider says, refuse a clash and an admin edit, and delete a group with its access', async () => {
        // Arrange
        await magnetic.orgs.createGroup(aliceId, orgId, 'Finance');
        const ann = await signIn('ann@acme.test');
        const lee = await signIn('lee@acme.test');
        const annId = ((await (await scim('POST', '/Users', entraUser('ann@acme.test', 'Ann'))).json()) as { id: string }).id;
        const leeId = ((await (await scim('POST', '/Users', entraUser('lee@acme.test', 'Lee'))).json()) as { id: string }).id;
        await signIn('ann@acme.test');
        await signIn('lee@acme.test');
        const org = await magnetic.orgs.get(orgId);

        // Act
        const clash = await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Finance', members: [] });
        const made = (await (await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Sales', externalId: 'g1', members: [] })).json()) as { id: string };
        await patch(`/Groups/${made.id}`, [{ op: 'add', path: 'members', value: [{ value: annId }, { value: leeId }] }]);
        const both = await groupNames(lee.userId);
        await patch(`/Groups/${made.id}`, [{ op: 'remove', path: `members[value eq "${leeId}"]` }]);
        const leeAfterOkta = await groupNames(lee.userId);
        await patch(`/Groups/${made.id}`, [{ op: 'Add', path: 'members', value: [{ value: leeId }] }]);
        await patch(`/Groups/${made.id}`, [{ op: 'Remove', path: 'members', value: [{ value: annId }] }]);
        const annAfterEntra = await groupNames(ann.userId);
        const renamed = await patch(`/Groups/${made.id}`, [{ op: 'Replace', path: 'displayName', value: 'Sales EMEA' }]);
        const lean = (await (await scim('GET', `/Groups?excludedAttributes=members&filter=${encodeURIComponent('displayName eq "Sales EMEA"')}`)).json()) as { totalResults: number; Resources: Array<Record<string, unknown>> };
        const byMember = (await (await scim('GET', `/Groups?filter=${encodeURIComponent(`members[value eq "${leeId}"]`)}`)).json()) as { totalResults: number };
        const adminAdd = await json(`/orgs/${orgId}/groups/${made.id}/members/${ann.userId}`, alice, 'POST');
        const handGroup = await scim('GET', `/Groups/${(await magnetic.orgs.groups(aliceId, orgId)).find((group) => group.name === 'Finance')?.id}`);
        await magnetic.database.query("INSERT INTO app_access (workspace_id, app_id, principal_kind, principal_id, permission) VALUES ($1, $2, 'group', $3, 'use')", [org?.workspaceId, '00000000-0000-4000-8000-000000000001', made.id]);
        const deleted = await scim('DELETE', `/Groups/${made.id}`);
        const access = (await magnetic.database.query("SELECT 1 FROM app_access WHERE principal_kind = 'group' AND principal_id = $1", [made.id])).rows.length;

        // Assert
        expect(clash.status).toBe(409);
        expect(both).toEqual(['Sales']);
        expect(leeAfterOkta).toEqual([]);
        expect(annAfterEntra).toEqual([]);
        expect(await groupNames(lee.userId)).toEqual([]);
        expect(renamed.status).toBe(200);
        expect(lean.totalResults).toBe(1);
        expect(lean.Resources[0]?.['members']).toBeUndefined();
        expect(lean.Resources[0]?.['externalId']).toBe('g1');
        expect(byMember.totalResults).toBe(1);
        expect(adminAdd.status).toBe(409);
        expect(((await adminAdd.json()) as { message: string }).message).toBe(SCIM_GROUP);
        expect(handGroup.status).toBe(404);
        expect(deleted.status).toBe(204);
        expect(access).toBe(0);
    });

    it('should close the views of a person SCIM takes out of a group that gave the app, or out of the org', async () => {
        // Arrange: Pat, pushed and signed in, uses an org app through a pushed group
        const patId = ((await (await scim('POST', '/Users', entraUser('pat@acme.test', 'Pat'))).json()) as { id: string }).id;
        const pat = await signIn('pat@acme.test');
        const group = ((await (await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Board users', members: [{ value: patId }] })).json()) as { id: string }).id;
        const appId = ((await (await json(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Board' })).json()) as { id: string }).id;
        await json(`/orgs/${orgId}/apps/${appId}/access`, alice, 'POST', { principalKind: 'group', principalId: group, permission: 'use' });
        const opened = await openView(appId, pat.cookie);
        const ungrouped = closeOf(opened);

        // Act
        await patch(`/Groups/${group}`, [{ op: 'remove', path: `members[value eq "${patId}"]` }]);
        const afterUngroup = await get(`/apps/${appId}`, pat.cookie);
        await patch(`/Groups/${group}`, [{ op: 'add', path: 'members', value: [{ value: patId }] }]);
        const reopened = await openView(appId, pat.cookie);
        const removed = closeOf(reopened);
        await patch(`/Users/${patId}`, [{ op: 'replace', path: 'active', value: false }]);

        // Assert
        expect(typeof opened).not.toBe('number');
        expect(await ungrouped).toBe(1008);
        expect(afterUngroup.status).toBe(404);
        expect(typeof reopened).not.toBe('number');
        expect(await removed).toBe(1008);
        expect(await magnetic.orgs.role(orgId, pat.userId)).toBeUndefined();
    });

    it('should still take invites while SCIM is on, but not to a pushed group', async () => {
        // Arrange
        const pushed = ((await (await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Pushed only', members: [] })).json()) as { id: string }).id;

        // Act
        const toPushed = await json(`/orgs/${orgId}/invites`, alice, 'POST', { email: 'ivy@acme.test', role: 'member', groups: [pushed] });
        const invite = await json(`/orgs/${orgId}/invites`, alice, 'POST', { email: 'ivy@acme.test', role: 'member' });
        const link = ((await invite.json()) as { link: string }).link;
        const ivy = await signIn('ivy@acme.test');
        const accepted = await json(`/invites/${link.split('/invites/')[1]}/accept`, ivy.cookie, 'POST');

        // Assert
        expect(toPushed.status).toBe(409);
        expect(((await toPushed.json()) as { message: string }).message).toBe(SCIM_GROUP);
        expect(invite.ok).toBe(true);
        expect(accepted.status).toBe(200);
        expect(await magnetic.orgs.role(orgId, ivy.userId)).toBe('member');
    });

    it('should join nobody unpushed by autoJoin while SCIM is on', async () => {
        // Arrange
        await magnetic.policies.set(aliceId, orgId, { autoJoin: true });

        // Act
        const nora = await signIn('nora@acme.test');

        // Assert
        expect(await magnetic.orgs.role(orgId, nora.userId)).toBeUndefined();
        await magnetic.policies.set(aliceId, orgId, { autoJoin: false });
    });

    it('should keep members and make pushed groups ordinary when turned off', async () => {
        // Arrange
        const held = (await (await scim('POST', '/Users', oktaUser('max@acme.test', 'Max'))).json()) as { id: string };
        await scim('POST', '/Groups', { schemas: [GROUP], displayName: 'Support', members: [{ value: held.id }] });
        const newToken = tokenOf(await (await form(`/settings/orgs/${orgId}`, alice, { do: 'scimToken' })).text()) as string;
        const oldToken = await scim('GET', '/Users');
        token = newToken;
        const kimId = (await magnetic.database.query<{ id: string }>("SELECT id FROM app_user WHERE email = 'kim@acme.test'")).rows[0]?.id as string;

        // Act
        const off = await form(`/settings/orgs/${orgId}`, alice, { do: 'scimOff' });
        const afterOff = await scim('GET', '/Users');
        const groups = await magnetic.orgs.groups(aliceId, orgId);
        const heldRows = (await magnetic.database.query('SELECT 1 FROM scim_user WHERE org_id = $1', [orgId])).rows.length;
        const page = await (await get(`/settings/orgs/${orgId}`, alice)).text();

        // Assert
        expect(oldToken.status).toBe(401);
        expect(off.status).toBe(303);
        expect(afterOff.status).toBe(401);
        expect(heldRows).toBe(0);
        expect(groups.find((group) => group.name === 'Support')?.scim).toBeUndefined();
        expect(groups.find((group) => group.name === 'Field Ops')).toBeDefined();
        expect(await magnetic.orgs.role(orgId, kimId)).toBe('builder');
        expect(page).toContain('Turn on SCIM');
    });
});
