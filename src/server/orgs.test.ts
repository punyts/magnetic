import { txInstances } from '@punyts/stateui-pg';
import { randomUUID } from 'node:crypto';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startMagnetic } from './startMagnetic.js';
import type { MagneticOptions, RunningMagnetic } from './startMagnetic.js';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';

const databases: TestDatabase[] = [];
/** A database of its own for each server a test starts, dropped after the file */
async function freshDb(): Promise<Database> {
    const test = await magneticTestDatabase();
    databases.push(test);
    return test.db;
}
afterAll(async () => {
    await Promise.all(databases.splice(0).map((test) => test.drop()));
});

const silent = { info: () => undefined };

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

async function start(extra: Partial<MagneticOptions> = {}): Promise<RunningMagnetic> {
    return startMagnetic({ database: await freshDb(), host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser, ...extra });
}

/** Signs a development user in and returns the `Cookie` header that carries the session */
async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user }).toString(),
        redirect: 'manual'
    });
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie') ?? '';
    return cookie.split(';')[0] as string;
}

const get = (origin: string, path: string, cookie?: string): Promise<Response> => fetch(`${origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });

/** Opens a view socket; resolves with the socket once open, or with the refusal's status */
function openSocket(magnetic: RunningMagnetic, appId: string, cookie?: string): Promise<WebSocket | number> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, {
            headers: { Origin: magnetic.origin, ...(cookie !== undefined && { Cookie: cookie }) }
        });
        ws.once('open', () => resolve(ws));
        ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        ws.once('error', reject);
    });
}

describe('Orgs over HTTP', () => {
    let magnetic: RunningMagnetic;
    let alice: string;
    let bob: string;
    let bobId: string;
    let aliceId: string;
    let orgId: string;

    const send = (path: string, cookie: string, method: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, {
            method,
            redirect: 'manual',
            headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json', Accept: 'application/json' },
            ...(body !== undefined && { body: JSON.stringify(body) })
        });

    beforeAll(async () => {
        magnetic = await start();
        alice = await signIn(magnetic.origin, 'alice');
        bob = await signIn(magnetic.origin, 'bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        // Development users have no email; an invite needs a verified one
        await magnetic.database.query("UPDATE app_user SET email = 'bob@acme.test', email_verified = true WHERE id = $1", [bobId]);
        const made = await send('/orgs', alice, 'POST', { name: 'Acme', slug: 'acme' });
        orgId = ((await made.json()) as { id: string }).id;
        const invite = (await (await send(`/orgs/${orgId}/invites`, alice, 'POST', { email: 'bob@acme.test', role: 'member' })).json()) as { link: string };
        const accepted = await send(`/invites/${invite.link.split('/invites/')[1]}/accept`, bob, 'POST');
        expect(accepted.status).toBe(200);
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
    });

    it('should show an org app to a member only as far as their access goes, and close it when they lose it', async () => {
        // Arrange
        const made = await send(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Inventory' });
        const appId = ((await made.json()) as { id: string }).id;

        // Act
        const before = await get(magnetic.origin, `/apps/${appId}`, bob);
        await send(`/orgs/${orgId}/apps/${appId}/access`, alice, 'POST', { principalKind: 'user', principalId: bobId, permission: 'use' });
        const using = await get(magnetic.origin, `/apps/${appId}`, bob);
        const editAsUser = await get(magnetic.origin, `/edit/${appId}`, bob);
        const socket = await openSocket(magnetic, appId, bob);
        const closed = new Promise<number>((resolve) => (socket as WebSocket).once('close', (code) => resolve(code)));
        await send(`/orgs/${orgId}/apps/${appId}/access`, alice, 'POST', { principalKind: 'user', principalId: bobId, permission: 'edit' });
        const editing = await get(magnetic.origin, `/edit/${appId}`, bob);
        const bobLists = (await (await send(`/orgs/${orgId}/apps`, bob, 'GET')).json()) as { apps: Array<{ name: string; permission: string }> };
        const bobShares = await send(`/edit/${appId}/share`, bob, 'GET');
        await send(`/orgs/${orgId}/apps/${appId}/access`, alice, 'POST', { principalKind: 'user', principalId: bobId, permission: null });
        const after = await get(magnetic.origin, `/apps/${appId}`, bob);

        // Assert
        expect(made.status).toBe(201);
        expect(before.status).toBe(404);
        expect(using.status).toBe(200);
        expect(editAsUser.status).toBe(303);
        expect(editAsUser.headers.get('location')).toBe(`/apps/${appId}`);
        expect(typeof socket).not.toBe('number');
        expect(editing.status).toBe(200);
        expect(bobLists.apps).toEqual([{ id: appId, name: 'inventory', permission: 'edit' }]);
        expect(bobShares.status).toBe(403);
        expect(await closed).toBe(1008);
        expect(after.status).toBe(404);
    });

    it("should move an app of one's own into the org, keeping its address", async () => {
        // Arrange
        await magnetic.database.query("UPDATE org_member SET role = 'builder' WHERE org_id = $1 AND user_id = $2", [orgId, bobId]);
        const made = await fetch(`${magnetic.origin}/new`, {
            method: 'POST',
            headers: { Cookie: bob, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'name=diary'
        });
        const appId = ((await made.json()) as { id: string }).id;

        // Act
        const moved = await send(`/apps/${appId}/move`, bob, 'POST', { orgId });
        const own = await get(magnetic.origin, `/edit/${appId}`, bob);
        const forAlice = await get(magnetic.origin, `/edit/${appId}`, alice);
        const listed = (await (await send(`/orgs/${orgId}/apps`, alice, 'GET')).json()) as { apps: Array<{ name: string }> };

        // Assert
        expect(moved.status).toBe(200);
        expect(own.status).toBe(200);
        expect(forAlice.status).toBe(200);
        expect(listed.apps.map((app) => app.name)).toContain('diary');
        expect((await magnetic.orgs.auditLog(aliceId, orgId)).map((event) => event['action'])).toEqual(expect.arrayContaining(['app.moved_in', 'access.set', 'invite.accepted', 'org.created']));
    });

    it("should list who uses an app for its managers, and open a member's instance read only for an admin, audited", async () => {
        // Arrange
        const made = await send(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Tickets' });
        const appId = ((await made.json()) as { id: string }).id;
        await send(`/orgs/${orgId}/apps/${appId}/access`, alice, 'POST', { principalKind: 'user', principalId: bobId, permission: 'use' });
        const workspaceId = (await magnetic.orgs.get(orgId))?.workspaceId as string;
        await magnetic.database.transaction(
            async (tx) => {
                const bobState = txInstances(tx, workspaceId, bobId);
                await bobState.write(appId, {}, { route: { screen: 'list' } } as never);
                await bobState.writeData(appId, 'drafts', { model: 'draft', records: { d1: { title: 'Printer jam' } } } as never);
            },
            { workspaceIds: [workspaceId] }
        );

        // Act
        const listed = await send(`/orgs/${orgId}/apps/${appId}/instances`, alice, 'GET');
        const listedByBob = await send(`/orgs/${orgId}/apps/${appId}/instances`, bob, 'GET');
        const viewed = await send(`/orgs/${orgId}/apps/${appId}/instances/${bobId}`, alice, 'GET');
        const viewedByBob = await send(`/orgs/${orgId}/apps/${appId}/instances/${bobId}`, bob, 'GET');
        const nobody = await send(`/orgs/${orgId}/apps/${appId}/instances/${aliceId}`, alice, 'GET');

        // Assert
        expect(listed.status).toBe(200);
        expect(((await listed.json()) as { instances: unknown[] }).instances).toEqual([{ userId: bobId, name: 'bob', updatedAt: expect.any(String) }]);
        expect(listedByBob.status).toBe(403);
        expect(viewed.status).toBe(200);
        expect(await viewed.json()).toMatchObject({ userId: bobId, name: 'bob', instance: { route: { screen: 'list' } }, data: { drafts: { model: 'draft', records: { d1: { title: 'Printer jam' } } } } });
        expect(viewedByBob.status).toBe(403);
        expect(nobody.status).toBe(404);
        const views = (await magnetic.orgs.auditLog(aliceId, orgId)).filter((event) => event['action'] === 'instance.support_view');
        expect(views).toHaveLength(1);
        expect(views[0]).toMatchObject({ actor_id: aliceId, target_id: appId, detail: { userId: bobId } });
    });

    it("should refuse what a role does not allow, and end a removed member's access at once", async () => {
        // Act
        const bobInvites = await send(`/orgs/${orgId}/invites`, bob, 'POST', { email: 'x@acme.test', role: 'member' });
        const bobAudit = await send(`/orgs/${orgId}/audit`, bob, 'GET');
        const strangerOrg = await send(`/orgs/${randomUUID()}/members`, bob, 'GET');
        const removed = await send(`/orgs/${orgId}/members/${bobId}`, alice, 'DELETE');
        const afterwards = await send(`/orgs/${orgId}/apps`, bob, 'GET');

        // Assert
        expect(bobInvites.status).toBe(403);
        expect(bobAudit.status).toBe(403);
        expect(strangerOrg.status).toBe(404);
        expect(removed.status).toBe(200);
        expect(afterwards.status).toBe(404);
    });
});
