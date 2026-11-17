import { randomUUID } from 'node:crypto';
import type { PreviewBrowser, UiPart } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const silent = { info: (message: string, fields?: unknown) => (process.env['STATENET_DEBUG'] === undefined ? undefined : console.log('REPORT', message, JSON.stringify(fields))) };
const SECRET = 'statenet-test-secret-key-0123456789';
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

type Frame = { type: string; [key: string]: unknown };

/** A view socket: every frame it was sent, and the next frame of a type */
interface View {
    readonly ws: WebSocket;
    readonly frames: Frame[];
    next(type: string, where?: (frame: Frame) => boolean): Promise<Frame>;
    readonly closed: Promise<number>;
}

function openView(magnetic: RunningMagnetic, appId: string, cookie: string): Promise<View> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, { headers: { Origin: magnetic.origin, Cookie: cookie } });
        const frames: Frame[] = [];
        const waiting: Array<{ type: string; where: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
        ws.on('message', (data) => {
            const frame = JSON.parse(data.toString()) as Frame;
            frames.push(frame);
            for (const wait of [...waiting]) {
                if (wait.type !== frame.type || !wait.where(frame)) continue;
                waiting.splice(waiting.indexOf(wait), 1);
                wait.resolve(frame);
            }
        });
        const closed = new Promise<number>((done) => ws.once('close', (code) => done(code)));
        ws.once('open', () =>
            resolve({
                ws,
                frames,
                closed,
                next: (type, where = () => true) => {
                    const seen = frames.find((frame) => frame.type === type && where(frame));
                    return seen !== undefined ? Promise.resolve(seen) : new Promise((done) => waiting.push({ type, where, resolve: done }));
                }
            })
        );
        ws.once('error', reject);
    });
}

const namespaceOf = (html: string): string => /data-namespace="([^"]+)"/.exec(html)?.[1] as string;

async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

describe('several Magnetic servers on one database', () => {
    let test: TestDatabase;
    let one: RunningMagnetic;
    let two: RunningMagnetic;
    let cookie: string;
    let aliceId: string;

    const start = (): Promise<RunningMagnetic> =>
        startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser, secretKey: SECRET, statenet: { meshPort: 0, heartbeatMs: 150, leaseMs: 1_500 } });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        one = await start();
        two = await start();
        await one.statenet?.refresh();
        await two.statenet?.refresh();
        cookie = await signIn(one.origin, 'alice');
        aliceId = ((await one.sessions.find(cookie.split('=')[1] as string)) as { userId: string }).userId;
    });

    afterAll(async () => {
        await one?.stop();
        await two?.stop();
        await test?.drop();
    });

    /** A new app in alice's workspace, made at a server */
    async function newApp(at: RunningMagnetic, name: string): Promise<UiPart<'apps'>> {
        const services = await at.workspaces.get(aliceId);
        const created = await services.useCases.createPartApp.execute({ name });
        if (created.kind !== 'created') throw new Error(created.kind);
        return (await services.parts.findById('apps', created.id)) as UiPart<'apps'>;
    }

    /** A view at a server of alice's instance of the app, welcomed */
    async function viewAt(at: RunningMagnetic, app: UiPart<'apps'>): Promise<View> {
        const namespace = namespaceOf(await (await fetch(`${at.origin}/apps/${app.id}`, { headers: { Cookie: cookie } })).text());
        const view = await openView(at, app.id, cookie);
        view.ws.send(JSON.stringify({ type: 'hello', namespace, revision: 0, clientId: randomUUID(), protocol: 2 }));
        await view.next('welcome');
        return view;
    }

    it("should give a view at one server the instance another server runs, and take its changes to that server", async () => {
        // Arrange: server one runs the instance, as a tool there made it
        const app = await newApp(one, 'ledger');
        const address = `${aliceId}/${app.id}/user`;
        const authority = await (await one.workspaces.get(aliceId)).instanceViews.authority(app);
        authority.write({ op: 'set', path: '$.app.note', value: 'from one' });

        // Act
        const view = await viewAt(two, app);
        const base = (await view.next('welcome'))['revision'] as number;
        view.ws.send(JSON.stringify({ type: 'change', change: { id: 'c-two', op: 'set', path: '$.app.fromTwo', value: true, base } }));
        const ack = await view.next('ack');

        // Assert
        expect(JSON.stringify(view.frames.find((frame) => frame.type === 'welcome'))).toContain('from one');
        expect(ack).toMatchObject({ id: 'c-two', result: 'applied' });
        expect(authority.get('$.app.fromTwo')).toBe(true);
        expect(one.statenet?.mesh.node.owned()).toContain(address);
        expect(two.statenet?.mesh.node.owned()).not.toContain(address);
        view.ws.close();
    });

    it('should show a view at one server a part another server changed, and restart the instance over it where it runs', async () => {
        // Arrange
        const app = await newApp(one, 'board');
        await (await one.workspaces.get(aliceId)).instanceViews.authority(app);
        const view = await viewAt(two, app);
        const before = view.frames.filter((frame) => frame.type === 'view').length;

        // Act: server one changes the app's definition
        const services = await one.workspaces.get(aliceId);
        const current = (await services.parts.findById('apps', app.id)) as UiPart<'apps'>;
        const written = await services.parts.write('apps', current.name, { ...current.body, screens: { ...(current.body as { screens: object }).screens, extra: { root: { component: 'text', _text: 'Added at one' } } } } as never, current.revision);

        // Assert: one restarted the instance over the new definition, which closed the view at two; it connects again
        // and is sent the new document, as two's part index heard of the change
        expect(written.kind).toBe('written');
        await view.closed;
        const again = await viewAt(two, app);
        expect(JSON.stringify(again.frames.filter((frame) => frame.type === 'view'))).toContain('Added at one');
        expect(before).toBeGreaterThan(0);
        again.ws.close();
    });

    it('should move an instance to the server whose tools act on it, keeping its state', async () => {
        // Arrange
        const app = await newApp(one, 'notes');
        const address = `${aliceId}/${app.id}/user`;
        (await (await one.workspaces.get(aliceId)).instanceViews.authority(app)).write({ op: 'set', path: '$.app.kept', value: 'yes' });
        const viewAtOne = await viewAt(one, app);

        // Act: a tool at server two
        const atTwo = await (await two.workspaces.get(aliceId)).instanceViews.authority(app);

        // Assert
        expect(atTwo.get('$.app.kept')).toBe('yes');
        expect(two.statenet?.mesh.node.owned()).toContain(address);
        expect(one.statenet?.mesh.node.owned()).not.toContain(address);
        // the view at one lost its session with one's instance, and connects again (to two, through the mesh)
        await viewAtOne.closed;
        const again = await viewAt(one, app);
        expect(JSON.stringify(again.frames.find((frame) => frame.type === 'welcome'))).toContain('yes');
        again.ws.close();
    });

    it('should wait out the lease of a server that went away without letting go, as after a deploy, instead of failing', async () => {
        // Arrange: the instance is held, for a while yet, by a server that is no longer there
        const app = await newApp(two, 'accounts');
        const address = `${aliceId}/${app.id}/user`;
        await two.database.query(
            "INSERT INTO namespace_owner (address, node, epoch, lease_until) VALUES ($1, 'gone-in-the-deploy', 7, now() + interval '1 second') ON CONFLICT (address) DO UPDATE SET node = EXCLUDED.node, epoch = EXCLUDED.epoch, lease_until = EXCLUDED.lease_until",
            [address]
        );

        // Act: what Your apps does, as the first request after the restart
        const authority = await (await two.workspaces.get(aliceId)).instanceViews.authority(app);
        authority.write({ op: 'set', path: '$.app.after', value: 'the deploy' });

        // Assert
        expect(two.statenet?.mesh.node.owned()).toContain(address);
        expect(authority.get('$.app.after')).toBe('the deploy');
    });

    it("should make a person's editor again after a deploy at one server while the old one is open at the other", async () => {
        // Arrange: alice's editor, open at server one, and a deploy that shipped a new editor
        const editorAt = async (at: RunningMagnetic): Promise<{ id: string; fallback?: boolean }> => (await fetch(`${at.origin}/assets/editor.json`, { headers: { Cookie: cookie } })).json() as Promise<{ id: string; fallback?: boolean }>;
        const before = await editorAt(one);
        const old = (await (await one.workspaces.get(aliceId)).parts.findById('apps', before.id)) as UiPart<'apps'>;
        const view = await viewAt(one, old);
        await two.database.query("UPDATE workspace_stamp SET value = jsonb_set(value::jsonb, '{stamp}', '\"before-the-deploy\"') WHERE workspace_id = $1 AND name = 'editor'", [aliceId]);

        // Act: the page asks server two for it
        const after = await editorAt(two);

        // Assert
        expect(after.fallback).toBeUndefined();
        expect(after.id).not.toBe(before.id);
        view.ws.close();
    });

    it('should let another server take over the instances of a server that stops, at once', async () => {
        // Arrange
        const app = await newApp(one, 'diary');
        const address = `${aliceId}/${app.id}/user`;
        (await (await one.workspaces.get(aliceId)).instanceViews.authority(app)).write({ op: 'set', path: '$.app.before', value: 'stopped' });

        // Act
        await one.stop();
        await two.statenet?.refresh();
        const view = await viewAt(two, app);

        // Assert
        expect(JSON.stringify(view.frames.find((frame) => frame.type === 'welcome'))).toContain('stopped');
        expect(two.statenet?.mesh.node.owned()).toContain(address);
        view.ws.close();
    });
});
