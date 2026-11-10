import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

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
    const response = await fetch(`${origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return outcome.body as Record<string, unknown>;
}

describe("The editor's inspector routes", () => {
    let dataDir: string;
    let magnetic: RunningMagnetic;
    let alice: string;
    let appId: string;
    let tools: readonly UiToolDefinition[];

    const get = async (what: string): Promise<{ status: number; body: Record<string, unknown> }> => {
        const response = await fetch(`${magnetic.origin}/edit/${appId}${what}`, { headers: { Cookie: alice } });
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const write = async (operations: unknown[], revision?: number): Promise<{ status: number; body: Record<string, unknown> }> => {
        const response = await fetch(`${magnetic.origin}/edit/${appId}/nodes`, {
            method: 'POST',
            headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ operations, ...(revision !== undefined && { revision }) })
        });
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const revision = async (): Promise<number> => (await (await magnetic.workspaces.get(aliceUser())).instanceViews.find(appId))?.revision as number;
    let aliceId = '';
    const aliceUser = (): string => aliceId;

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-inspect-'));
        magnetic = await startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
        alice = await signIn(magnetic.origin, 'alice');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        await tool(tools, 'ui_model_write', {
            model: 'note',
            operations: [
                { op: 'set', field: 'title', type: 'string', required: true },
                { op: 'set', field: 'done', type: 'boolean' }
            ]
        });
        await tool(tools, 'ui_data_write', { dataset: 'notes', model: 'note', operations: [{ op: 'set', path: 'n1', value: { title: 'First', done: false } }] });
        const created = await tool(tools, 'ui_app_create', {
            name: 'notes',
            data: { notes: { dataset: 'notes' } },
            home: {
                component: 'panel',
                children: {
                    title: { component: 'text', '<-_text': '$.data.notes.n1.title' },
                    list: { component: 'panel', children: { a: { component: 'text', _text: 'alpha' }, b: { component: 'text', _text: 'beta' } } }
                }
            }
        });
        appId = created['id'] as string;
        await tool(tools, 'ui_logic_write', {
            app: 'notes',
            expectedRevision: created['revision'],
            operations: [{ op: 'set', unit: 'rules.finish', value: { when: { path: '$.data.notes.{id}.title' }, do: [{ command: 'set', target: '$.data.notes.{id}.done', value: false }] } }]
        });
    });

    afterAll(async () => {
        await magnetic.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    it('should serve the inspector app to a signed-in person: its assembled document with tabs, and its icons', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/inspector.json`);
        const served = await fetch(`${magnetic.origin}/assets/inspector.json`, { headers: { Cookie: alice } });
        const again = await fetch(`${magnetic.origin}/assets/inspector.json`, { headers: { Cookie: alice } });
        const script = await fetch(`${magnetic.origin}/assets/inspect.js`);
        const body = (await served.json()) as { document: { screens: { home: { root: { children: { tabs: { component: string; children: Record<string, unknown> } } } } } }; icons: unknown };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        expect(body.document.screens.home.root.children.tabs.component).toBe('tabs');
        expect(Object.keys(body.document.screens.home.root.children.tabs.children)).toEqual(['properties', 'add', 'state']);
        expect(typeof body.icons).toBe('object');
        expect(await again.json()).toEqual(body);
        expect(script.headers.get('content-type')).toMatch(/^text\/javascript/);
    });

    it('should answer a node with its settings, its children and its component, and no node for a path that is not one', async () => {
        // Act
        const panel = await get(`/node?path=${encodeURIComponent('$.screens.home.children.list')}`);
        const text = await get(`/node?path=${encodeURIComponent('$.screens.home.children.title')}`);
        const missing = await get(`/node?path=${encodeURIComponent('$.screens.home.children.nothing')}`);
        const data = await get(`/node?path=${encodeURIComponent('$.data.notes')}`);

        // Assert
        expect(panel.status).toBe(200);
        expect(panel.body).toMatchObject({ path: '$.screens.home.children.list', tree: 'home', settings: { component: 'panel' }, children: ['a', 'b'] });
        expect(text.body['settings']).toEqual({ component: 'text', '<-_text': '$.data.notes.n1.title' });
        expect((text.body['component'] as { properties: Record<string, unknown> }).properties).toHaveProperty('_text');
        expect(missing.status).toBe(404);
        expect(data.status).toBe(404);
    });

    it('should add, set, move and remove nodes, each as one checked write that moves the revision on by one', async () => {
        // Arrange
        const start = await revision();

        // Act
        const added = await write([{ op: 'add', path: '$.screens.home.children.list', key: 'c', value: { component: 'text', _text: 'gamma' }, after: 'a' }]);
        const set = await write([{ op: 'set', path: '$.screens.home.children.list.children.c._text', value: 'Gamma' }]);
        const moved = await write([{ op: 'move', path: '$.screens.home.children.list.children.c', before: 'a' }]);
        const order = (await get(`/node?path=${encodeURIComponent('$.screens.home.children.list')}`)).body['children'];
        const removed = await write([{ op: 'remove', path: '$.screens.home.children.list.children.c' }]);

        // Assert
        expect([added.status, set.status, moved.status, removed.status]).toEqual([200, 200, 200, 200]);
        expect(added.body['revision']).toBe(start + 1);
        expect(removed.body['revision']).toBe(start + 4);
        expect(order).toEqual(['c', 'a', 'b']);
        expect(await revision()).toBe(start + 4);
    });

    it('should refuse a write at an old revision, one over two trees, one that makes the app invalid, and one with no operations', async () => {
        // Arrange
        const start = await revision();

        // Act
        const stale = await write([{ op: 'set', path: '$.screens.home.children.list.children.a._text', value: 'old' }], start - 1);
        const twoTrees = await write([
            { op: 'set', path: '$.screens.home.children.list.children.a._text', value: 'x' },
            { op: 'set', path: '$.app._title', value: 'y' }
        ]);
        const invalid = await write([{ op: 'add', path: '$.screens.home.children.list', key: 'z', value: { component: 'noSuchComponent' } }]);
        const empty = await write([]);

        // Assert
        expect(stale.status).toBe(409);
        expect(twoTrees.status).toBe(400);
        expect(invalid.status).toBe(400);
        expect((invalid.body['errors'] as unknown[]).length).toBeGreaterThan(0);
        expect(empty.status).toBe(400);
        expect(await revision()).toBe(start);
    });

    it('should list the component library by category, without the app node', async () => {
        // Act
        const { body } = await get('/components');
        const components = body['components'] as { name: string; category: string; summary: string }[];

        // Assert
        expect(body['categories']).toContain('forms');
        expect(components.find((component) => component.name === 'button')).toMatchObject({ category: 'forms', summary: expect.any(String) });
        expect(components.some((component) => component.name === 'app')).toBe(false);
    });

    it('should give the state with the nodes that link each path and the logic that reads and writes it', async () => {
        // Act
        const { status, body } = await get('/state');

        // Assert
        expect(status).toBe(200);
        expect(body['data']).toMatchObject({ notes: { n1: { title: 'First' } } });
        expect(body['bindings']).toContainEqual({ path: '$.data.notes.n1.title', node: '$.screens.home.children.title', property: '_text', twoWay: false });
        expect(body['logic']).toContainEqual(expect.objectContaining({ name: 'finish', reads: ['$.data.notes.{id}.title'], writes: ['$.data.notes.{id}.done'] }));
    });

    it('should give the latest logic runs', async () => {
        // Act
        const { status, body } = await get('/trace');

        // Assert
        expect(status).toBe(200);
        expect(Array.isArray(body['runs'])).toBe(true);
    });

    it('should keep the inspector routes to signed-in owners', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/edit/${appId}/state`);

        // Assert
        expect(anonymous.status).toBe(401);
    });
});
