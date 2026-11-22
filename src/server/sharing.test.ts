import { randomUUID } from 'node:crypto';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { homeOf } from '../testing/homeOf.js';
import { REVOKED_MESSAGE, startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';
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

async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user }).toString(),
        redirect: 'manual'
    });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

/** A connected view: the frames it received, in order, and a way to wait for one */
interface View {
    readonly ws: WebSocket;
    readonly frames: { type: string; [key: string]: unknown }[];
    next(type: string): Promise<{ type: string; [key: string]: unknown }>;
    readonly closed: Promise<{ code: number; reason: string }>;
}

function connect(magnetic: RunningMagnetic, appId: string, cookie: string): Promise<View | number> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, { headers: { Origin: magnetic.origin, Cookie: cookie } });
        const frames: View['frames'] = [];
        const waiting: { type: string; resolve: (frame: View['frames'][number]) => void }[] = [];
        ws.on('message', (data) => {
            const frame = JSON.parse(data.toString()) as View['frames'][number];
            frames.push(frame);
            for (const wait of [...waiting]) {
                if (wait.type !== frame.type) continue;
                waiting.splice(waiting.indexOf(wait), 1);
                wait.resolve(frame);
            }
        });
        const closed = new Promise<{ code: number; reason: string }>((done) => ws.once('close', (code, reason) => done({ code, reason: reason.toString() })));
        const view: View = {
            ws,
            frames,
            closed,
            next: (type) => {
                const seen = frames.find((frame) => frame.type === type);
                if (seen !== undefined) return Promise.resolve(seen);
                return new Promise((done) => waiting.push({ type, resolve: done }));
            }
        };
        ws.once('open', () => resolve(view));
        ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        ws.once('error', reject);
    });
}

async function open(magnetic: RunningMagnetic, appId: string, cookie: string): Promise<View> {
    const view = await connect(magnetic, appId, cookie);
    if (typeof view === 'number') throw new Error(`socket refused with ${view}`);
    return view;
}

const hello = (view: View, namespace: string): void => view.ws.send(JSON.stringify({ type: 'hello', namespace, revision: 0, clientId: randomUUID(), protocol: 1 }));

const namespaceOf = (html: string): string => /data-namespace="([^"]+)"/.exec(html)?.[1] as string;

describe('Magnetic sharing', () => {
    let magnetic: RunningMagnetic;
    let db: Database;
    let alice: string;
    let bob: string;
    let carol: string;
    let aliceId: string;
    let bobId: string;

    const get = (path: string, cookie: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const post = (path: string, cookie: string, body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, {
            method: 'POST',
            redirect: 'manual',
            headers: { Cookie: cookie, Origin: magnetic.origin, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
            ...(body !== undefined && { body: JSON.stringify(body) })
        });

    async function createApp(name: string): Promise<string> {
        const services = await magnetic.workspaces.get(aliceId);
        const created = await services.useCases.createPartApp.execute({ name });
        if (created.kind !== 'created') throw new Error(`created ${name}: ${created.kind}`);
        return created.id;
    }

    /** Alice makes a link to her app; the link's grant id and token */
    async function share(appId: string, right: string): Promise<{ id: string; token: string }> {
        const response = await post(`/edit/${appId}/share`, alice, { right });
        expect(response.status).toBe(201);
        const { id, url } = (await response.json()) as { id: string; url: string };
        return { id, token: url.split('/s/')[1] as string };
    }

    beforeAll(async () => {
        db = await freshDb();
        magnetic = await startMagnetic({ database: db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob', 'carol'], starter: 'none', browser: noBrowser });
        alice = await signIn(magnetic.origin, 'alice');
        bob = await signIn(magnetic.origin, 'bob');
        carol = await signIn(magnetic.origin, 'carol');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
    });

    afterAll(async () => {
        await magnetic.stop();
    });

    it('should give a person who opens a use link their own instance of the app, and list it on their home page', async () => {
        // Arrange
        const appId = await createApp('tasks');
        const link = await share(appId, 'use');

        // Act
        const opened = await get(`/s/${link.token}`, bob);
        const page = await get(`/apps/${appId}`, bob);
        const owners = await get(`/apps/${appId}`, alice);
        const home = await homeOf(magnetic, bob);

        // Assert
        expect(opened.status).toBe(303);
        expect(opened.headers.get('location')).toBe(`/apps/${appId}`);
        expect(page.status).toBe(200);
        const mine = namespaceOf(await page.text());
        expect(mine).toContain(bobId);
        expect(mine).not.toBe(namespaceOf(await owners.text()));
        // The share waits on bob's Your apps, marked as not his, for Accept or Reject
        expect(home.apps).toEqual([{ id: appId, name: 'tasks', note: 'alice · use', own: false, answered: false }]);
        // Someone who never opened the link still finds nothing
        expect((await get(`/apps/${appId}`, carol)).status).toBe(404);
    });

    it('should keep an accepted share among the apps, drop a rejected one with its link, and make it wait again when the link is opened anew', async () => {
        // Arrange
        const kept = await createApp('kept');
        const dropped = await createApp('dropped');
        const keptLink = await share(kept, 'view');
        const droppedLink = await share(dropped, 'use');
        await get(`/s/${keptLink.token}`, bob);
        await get(`/s/${droppedLink.token}`, bob);

        // Act
        const accepted = await post(`/shares/${kept}/accept`, bob, {});
        const rejected = await post(`/shares/${dropped}/reject`, bob, {});
        const after = await homeOf(magnetic, bob);
        const closed = await get(`/apps/${dropped}`, bob);
        await get(`/s/${droppedLink.token}`, bob);
        const reopened = await homeOf(magnetic, bob);

        // Assert
        expect([accepted.status, rejected.status]).toEqual([200, 200]);
        expect(after.apps.find((app) => app.id === kept)).toMatchObject({ own: false, answered: true });
        expect(after.apps.some((app) => app.id === dropped)).toBe(false);
        expect(closed.status).toBe(404);
        expect(reopened.apps.find((app) => app.id === dropped)).toMatchObject({ own: false, answered: false });
        // A waiting share comes before the apps already answered
        expect(reopened.apps[0]?.answered).toBe(false);
    });

    it("should send someone without a session to sign in and back to the link, and say when a link is unknown", async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/s/${'a'.repeat(32)}`, { redirect: 'manual' });
        const unknown = await get(`/s/${'a'.repeat(32)}`, bob);

        // Assert
        expect(anonymous.status).toBe(303);
        expect(anonymous.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/s/${'a'.repeat(32)}`)}`);
        expect(unknown.status).toBe(404);
    });

    it('should list the links of an app to its owner only, and refuse a right that does not exist', async () => {
        // Arrange
        const appId = await createApp('listed');
        await share(appId, 'view');

        // Act
        const listed = (await (await get(`/edit/${appId}/share`, alice)).json()) as { grants: { right: string; url: string; members: number }[] };
        const bad = await post(`/edit/${appId}/share`, alice, { right: 'own' });
        const bobs = await get(`/edit/${appId}/share`, bob);

        // Assert
        expect(listed.grants).toHaveLength(1);
        expect(listed.grants[0]).toMatchObject({ right: 'view', members: 0 });
        expect(listed.grants[0]?.url).toMatch(/\/s\/[A-Za-z0-9_-]{32}$/);
        expect(bad.status).toBe(400);
        expect(bobs.status).toBe(404);
    });

    it('should let a view link look at the owner instance live, but reject its changes and keep its files read only', async () => {
        // Arrange
        const appId = await createApp('board');
        const link = await share(appId, 'view');
        await get(`/s/${link.token}`, bob);
        const namespace = namespaceOf(await (await get(`/apps/${appId}`, bob)).text());
        const view = await open(magnetic, appId, bob);
        hello(view, namespace);
        await view.next('welcome');

        // Act
        view.ws.send(JSON.stringify({ type: 'change', change: { id: 'c1', op: 'set', path: '$.app.note', value: 'mine' } }));
        const ack = await view.next('ack');
        const upload = await fetch(`${magnetic.origin}/apps/${appId}/files`, { method: 'POST', headers: { Cookie: bob, Origin: magnetic.origin, 'Content-Type': 'text/plain' }, body: 'x' });

        // Assert
        expect(namespace).toBe(namespaceOf(await (await get(`/apps/${appId}`, alice)).text()));
        expect(ack).toMatchObject({ id: 'c1', result: 'rejected' });
        expect(upload.status).toBe(403);
        view.ws.close();
    });

    it('should close the socket of a use link when it is revoked, telling the browser to delete what it kept', async () => {
        // Arrange
        const appId = await createApp('journal');
        const link = await share(appId, 'use');
        await get(`/s/${link.token}`, bob);
        const namespace = namespaceOf(await (await get(`/apps/${appId}`, bob)).text());
        const view = await open(magnetic, appId, bob);
        hello(view, namespace);
        await view.next('welcome');
        const owners = await open(magnetic, appId, alice);

        // Act
        const revoked = await post(`/edit/${appId}/share/${link.id}/revoke`, alice, {});
        const error = await view.next('error');
        const ended = await view.closed;

        // Assert
        expect(revoked.status).toBe(200);
        expect(error).toEqual({ type: 'error', code: 'revoked', message: REVOKED_MESSAGE });
        expect(ended.code).toBe(1008);
        expect(owners.ws.readyState).toBe(WebSocket.OPEN);
        owners.ws.close();
    });

    it('should scrub a browser that was away when the link was revoked, on its next visit and its next connection', async () => {
        // Arrange
        const appId = await createApp('diary');
        const link = await share(appId, 'use');
        await get(`/s/${link.token}`, bob);
        const namespace = namespaceOf(await (await get(`/apps/${appId}`, bob)).text());
        await post(`/edit/${appId}/share/${link.id}/revoke`, alice, {});

        // Act
        const page = await get(`/apps/${appId}`, bob);
        const html = await page.text();
        const view = await open(magnetic, appId, bob);
        const error = await view.next('error');
        const ended = await view.closed;
        const again = await get(`/s/${link.token}`, bob);

        // Assert
        expect(page.status).toBe(200);
        expect(html).toContain(`data-revoked="${REVOKED_MESSAGE}"`);
        expect(namespaceOf(html)).toBe(namespace);
        expect(error).toMatchObject({ code: 'revoked' });
        expect(ended.code).toBe(1008);
        expect(again.status).toBe(410);
        expect(await (await get('/', bob)).text()).not.toContain(`href="/apps/${appId}"`);
    });

    it('should name a revoked app neither on its link page nor on its own page', async () => {
        // Arrange
        const appId = await createApp('secret-plans');
        const link = await share(appId, 'use');
        await get(`/s/${link.token}`, bob);
        await post(`/edit/${appId}/share/${link.id}/revoke`, alice, {});

        // Act
        const linkPage = await get(`/s/${link.token}`, bob);
        const linkHtml = await linkPage.text();
        const appHtml = await (await get(`/apps/${appId}`, bob)).text();

        // Assert
        expect(linkPage.status).toBe(410);
        expect(linkHtml).toContain('Link revoked');
        expect(linkHtml).not.toContain('secret-plans');
        expect(appHtml).toContain('data-revoked');
        expect(appHtml).not.toContain('secret-plans');
    });

    it("should have the browser delete a person's own instance when their use link is revoked and a view link is left", async () => {
        // Arrange
        const appId = await createApp('ledger');
        const use = await share(appId, 'use');
        const view = await share(appId, 'view');
        await get(`/s/${use.token}`, bob);
        await get(`/s/${view.token}`, bob);
        const before = await (await get(`/apps/${appId}`, bob)).text();
        const own = namespaceOf(before);

        // Act
        await post(`/edit/${appId}/share/${use.id}/revoke`, alice, {});
        const after = await (await get(`/apps/${appId}`, bob)).text();

        // Assert
        expect(before).not.toContain('data-forget');
        expect(after).toContain(`data-forget="${own}"`);
        expect(namespaceOf(after)).toBe(namespaceOf(await (await get(`/apps/${appId}`, alice)).text()));
        expect(after).not.toContain('data-revoked');
    });

    it("should revoke the links of a deleted app and remove each person's instance of it", async () => {
        // Arrange
        const appId = await createApp('trip');
        const link = await share(appId, 'use');
        await get(`/s/${link.token}`, bob);
        const namespace = namespaceOf(await (await get(`/apps/${appId}`, bob)).text());
        const view = await open(magnetic, appId, bob);
        hello(view, namespace);
        const welcome = await view.next('welcome');
        view.ws.send(JSON.stringify({ type: 'change', change: { id: 'c1', op: 'set', path: '$.app.note', value: 'mine', base: welcome['revision'] as number } }));
        await view.next('ack');
        const heads = async (): Promise<number> => (await db.query("SELECT 1 FROM namespace_head WHERE address LIKE '%/apps/' || $1", [appId])).rowCount ?? 0;
        await vi.waitFor(async () => expect(await heads()).toBeGreaterThan(0), { timeout: 5000 });
        const services = await magnetic.workspaces.get(aliceId);
        const part = await services.parts.findByName('apps', 'trip');

        // Act
        const deleted = await services.useCases.deletePart.execute({ kind: 'apps', name: 'trip', expectedRevision: part?.revision ?? 0 });
        view.ws.close();
        const linkPage = await get(`/s/${link.token}`, bob);
        const appPage = await (await get(`/apps/${appId}`, bob)).text();

        // Assert
        expect(deleted.kind).toBe('deleted');
        expect(await heads()).toBe(0);
        expect(linkPage.status).toBe(410);
        expect(await linkPage.text()).toContain('This app was deleted.');
        expect(appPage).toContain('data-revoked');
        expect((await magnetic.grants.forApp(aliceId, appId)).every((grant) => grant.revokedAt !== undefined)).toBe(true);
    });

    it('should keep a remix working after its link is revoked', async () => {
        // Arrange
        const appId = await createApp('recipes');
        const link = await share(appId, 'remix');
        const offer = await get(`/s/${link.token}`, bob);

        // Act
        const remixed = await post(`/s/${link.token}/remix`, bob);
        const copyId = (remixed.headers.get('location') ?? '').split('/edit/')[1] as string;
        await post(`/edit/${appId}/share/${link.id}/revoke`, alice, {});
        const copy = await get(`/apps/${copyId}`, bob);
        const editor = await get(`/edit/${copyId}`, bob);
        const original = await get(`/apps/${appId}`, bob);

        // Assert
        expect(offer.status).toBe(200);
        expect(await offer.text()).toContain(`"post":"/s/${link.token}/remix"`);
        expect(remixed.status).toBe(303);
        expect(copyId).not.toBe(appId);
        expect(copy.status).toBe(200);
        expect(await copy.text()).not.toContain('data-revoked');
        expect(editor.status).toBe(200);
        // A remix link never shows the original
        expect(original.status).toBe(404);
        expect((await get(`/s/${link.token}`, bob)).status).toBe(410);
    });

    it("should refuse to revoke another owner's link", async () => {
        // Arrange
        const appId = await createApp('private');
        const link = await share(appId, 'use');

        // Act
        const response = await post(`/edit/${appId}/share/${link.id}/revoke`, bob, {});

        // Assert
        expect(response.status).toBe(404);
        expect((await magnetic.grants.byToken(link.token))?.revokedAt).toBeUndefined();
    });
});
