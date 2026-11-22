import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { PreviewBrowser, UiPart } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { generateKeyPair, startRelayNode } from '@punyts/statenet';
import type { RelayNode } from '@punyts/statenet';
import { SecretBox } from '../auth/secrets.js';
import { startMagneticAggregate } from '../statenet/MagneticAggregate.js';
import type { MagneticAggregate } from '../statenet/MagneticAggregate.js';
import { StatenetAuthority } from '../statenet/StatenetNode.js';
import { magneticTestDatabase, roleDatabases } from '../testing/testDb.js';
import type { RoleDatabases } from '../testing/testDb.js';
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

/**
 * The hosted layout (docs/design/statenet-network.md, S11): two servers of one group, linked up to a relay, which links
 * up to the aggregate. The servers connect as a role that may only read people's state; the aggregate as the one that
 * writes it
 */
describe('several Magnetic servers on one database', () => {
    let test: TestDatabase;
    let roles: RoleDatabases;
    let aggregate: MagneticAggregate;
    let relay: RelayNode;
    let one: RunningMagnetic;
    let two: RunningMagnetic;
    let cookie: string;
    let aliceId: string;

    const start = (): Promise<RunningMagnetic> =>
        startMagnetic({
            database: roles.server,
            host: '127.0.0.1',
            port: 0,
            report: silent,
            devUsers: ['alice'],
            starter: 'none',
            browser: noBrowser,
            secretKey: SECRET,
            statenet: { meshPort: 0, heartbeatMs: 150, leaseMs: 1_500, group: 'magnetic', relays: [relay.meshUrl] }
        });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        roles = await roleDatabases(test);
        // The statenet's authority, which the first server would make: the aggregate's role may not
        const authority = new StatenetAuthority(test.db, new SecretBox(SECRET));
        await authority.keys();
        aggregate = await startMagneticAggregate(roles.aggregate, new SecretBox(SECRET), { nodeId: 'aggregate-1', host: '127.0.0.1', port: 0, embedRecords: false, rereadMs: 150, report: silent.info });
        const relayKeys = generateKeyPair();
        const issued = await authority.issue('relay-1', 'relay', relayKeys.publicKey);
        relay = await startRelayNode({ nodeId: 'relay-1', keys: relayKeys, certificate: issued.certificate, authorityPublicKey: issued.authorityPublicKey, parents: [aggregate.url], host: '127.0.0.1', meshPort: 0 });
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
        await relay?.close();
        await aggregate?.close();
        await roles?.close();
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
        await one.owners.ensure(aliceId);
        const address = `${one.owners.of(aliceId)}/apps/${app.id}`;
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
        await one.owners.ensure(aliceId);
        const address = `${one.owners.of(aliceId)}/apps/${app.id}`;
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
        await one.owners.ensure(aliceId);
        const address = `${one.owners.of(aliceId)}/apps/${app.id}`;
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

    it("should save people's state through the relay to the aggregate, and refuse a server that writes it itself", async () => {
        // Arrange
        const app = await newApp(two, 'journal');
        await two.owners.ensure(aliceId);
        const address = `${two.owners.of(aliceId)}/apps/${app.id}`;
        const savesBefore = aggregate.node.aggregate.stats().saves;

        // Act
        (await (await two.workspaces.get(aliceId)).instanceViews.authority(app)).write({ op: 'set', path: '$.app.saved', value: 'through the aggregate' });
        const direct = roles.server.query('DELETE FROM namespace_head WHERE address = $1', [address]).then(
            () => 'deleted',
            (error: unknown) => (error instanceof Error ? error.message : String(error))
        );

        // Assert
        await vi.waitFor(async () => expect((await test.db.query('SELECT 1 FROM state_node WHERE address = $1 AND value::text LIKE $2', [address, '%through the aggregate%'])).rowCount).toBe(1), { timeout: 5_000 });
        expect(aggregate.node.aggregate.stats().saves).toBeGreaterThan(savesBefore);
        expect(await direct).toMatch(/permission denied/);
        expect((await test.db.query('SELECT workspace_id::text AS w FROM statenet_namespace WHERE address = $1', [address])).rows).toEqual([{ w: aliceId }]);
    });

    it('should let another server take over the instances of a server that stops, at once', async () => {
        // Arrange
        const app = await newApp(one, 'diary');
        await one.owners.ensure(aliceId);
        const address = `${one.owners.of(aliceId)}/apps/${app.id}`;
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

/** A port free a moment ago, for a relay whose certificate names where it is reached before it starts */
const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            server.close(() => resolve(port));
        });
    });

/**
 * Two groups (docs/design/statenet-relay-directory.md, S13): each server under a relay of its own, both relays under
 * one aggregate. Nothing writes the directory by hand: the aggregate lists the relays from their certificates and each
 * server lists the relay it linked to
 */
describe('Magnetic servers in two groups', () => {
    let test: TestDatabase;
    let roles: RoleDatabases;
    let aggregate: MagneticAggregate;
    const relays: RelayNode[] = [];
    let east: RunningMagnetic;
    let west: RunningMagnetic;
    let cookie: string;
    let aliceId: string;

    const start = (group: string, relay: RelayNode): Promise<RunningMagnetic> =>
        startMagnetic({
            database: roles.server,
            host: '127.0.0.1',
            port: 0,
            report: silent,
            devUsers: ['alice'],
            starter: 'none',
            browser: noBrowser,
            secretKey: SECRET,
            statenet: { meshPort: 0, heartbeatMs: 150, leaseMs: 1_500, group, relays: [relay.meshUrl] }
        });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        roles = await roleDatabases(test);
        const authority = new StatenetAuthority(test.db, new SecretBox(SECRET));
        await authority.keys();
        aggregate = await startMagneticAggregate(roles.aggregate, new SecretBox(SECRET), { nodeId: 'aggregate-1', host: '127.0.0.1', port: 0, embedRecords: false, rereadMs: 150, report: silent.info });
        for (const id of ['relay-east', 'relay-west']) {
            const keys = generateKeyPair();
            const port = await freePort();
            const issued = await authority.issue(id, 'relay', keys.publicKey, '', undefined, `ws://127.0.0.1:${port}`);
            relays.push(await startRelayNode({ nodeId: id, keys, certificate: issued.certificate, authorityPublicKey: issued.authorityPublicKey, parents: [aggregate.url], host: '127.0.0.1', meshPort: port }));
        }
        east = await start('east', relays[0] as RelayNode);
        west = await start('west', relays[1] as RelayNode);
        cookie = await signIn(east.origin, 'alice');
        aliceId = ((await east.sessions.find(cookie.split('=')[1] as string)) as { userId: string }).userId;
    });

    afterAll(async () => {
        await east?.stop();
        await west?.stop();
        for (const relay of relays) await relay.close();
        await aggregate?.close();
        await roles?.close();
        await test?.drop();
    });

    it('should list the relays under the aggregate and each server under its relay, with no row written by hand', async () => {
        // Arrange
        const rows = async () => (await test.db.query<{ id: string; role: string; parent: string | null; endpoint: string; group_name: string }>('SELECT id, role, parent, endpoint, group_name FROM statenet_node ORDER BY id')).rows;

        // Act
        await vi.waitFor(async () => expect((await rows()).filter((row) => row.parent !== null)).toHaveLength(4), { timeout: 5_000 });
        const listed = await rows();

        // Assert
        const relayRows = listed.filter((row) => row.role === 'relay').map(({ id, parent, endpoint }) => ({ id, parent, endpoint }));
        expect(relayRows).toEqual([
            { id: 'relay-east', parent: 'aggregate-1', endpoint: (relays[0] as RelayNode).meshUrl },
            { id: 'relay-west', parent: 'aggregate-1', endpoint: (relays[1] as RelayNode).meshUrl }
        ]);
        const serverRows = listed.filter((row) => row.role === 'owner').map(({ parent, group_name }) => ({ parent, group_name }));
        expect(serverRows.sort((a, b) => a.group_name.localeCompare(b.group_name))).toEqual([
            { parent: 'relay-east', group_name: 'east' },
            { parent: 'relay-west', group_name: 'west' }
        ]);
    });

    it('should give a view at a server of one group the instance a server of the other group runs, through the relays', async () => {
        // Arrange
        await vi.waitFor(async () => expect((await test.db.query('SELECT 1 FROM statenet_node WHERE parent IS NOT NULL')).rowCount).toBe(4), { timeout: 5_000 });
        await east.statenet?.refresh();
        await west.statenet?.refresh();
        const services = await east.workspaces.get(aliceId);
        const created = await services.useCases.createPartApp.execute({ name: 'atlas' });
        if (created.kind !== 'created') throw new Error(created.kind);
        const app = (await services.parts.findById('apps', created.id)) as UiPart<'apps'>;
        const authority = await services.instanceViews.authority(app);
        authority.write({ op: 'set', path: '$.app.note', value: 'from east' });

        // Act
        const westCookie = await signIn(west.origin, 'alice');
        const namespace = namespaceOf(await (await fetch(`${west.origin}/apps/${app.id}`, { headers: { Cookie: westCookie } })).text());
        const view = await openView(west, app.id, westCookie);
        view.ws.send(JSON.stringify({ type: 'hello', namespace, revision: 0, clientId: randomUUID(), protocol: 2 }));
        const welcome = await view.next('welcome');
        view.ws.send(JSON.stringify({ type: 'change', change: { id: 'c-west', op: 'set', path: '$.app.fromWest', value: true, base: welcome['revision'] as number } }));
        const ack = await view.next('ack');

        // Assert
        expect(JSON.stringify(welcome)).toContain('from east');
        expect(ack).toMatchObject({ id: 'c-west', result: 'applied' });
        expect(authority.get('$.app.fromWest')).toBe(true);
        expect(west.statenet?.mesh.mesh.stats().links.map((link) => link.nodeId)).not.toContain(east.statenet?.mesh.nodeId);
        view.ws.close();
    });
});
