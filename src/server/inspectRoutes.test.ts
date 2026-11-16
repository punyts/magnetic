import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EDITOR_ICONS } from '../editor/EditorApp.js';
import { startMagnetic } from './startMagnetic.js';
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
    const response = await fetch(`${origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return outcome.body as Record<string, unknown>;
}

describe("The editor's inspector routes", () => {
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
    const screens = async (change: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> => {
        const response = await fetch(`${magnetic.origin}/edit/${appId}/screens`, {
            method: 'POST',
            headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' },
            body: JSON.stringify(change)
        });
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const revision = async (): Promise<number> => (await (await magnetic.workspaces.get(aliceUser())).instanceViews.find(appId))?.revision as number;
    let aliceId = '';
    const aliceUser = (): string => aliceId;

    beforeAll(async () => {
        magnetic = await startMagnetic({ database: await freshDb(), host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
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
    });

    it("should serve a signed-in person's editor: their own app, its floating panels, the inspector's tabs, and its icons", async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/editor.json`);
        const served = await fetch(`${magnetic.origin}/assets/editor.json`, { headers: { Cookie: alice } });
        const again = await fetch(`${magnetic.origin}/assets/editor.json`, { headers: { Cookie: alice } });
        const script = await fetch(`${magnetic.origin}/assets/inspect.js`);
        type Node = { component: string; children: Record<string, Node> };
        const body = (await served.json()) as { id: string; document: { screens: { home: { root: Node } }; icons?: unknown }; icons: Record<string, unknown>; fallback?: boolean };
        const stage = body.document.screens.home.root.children['stage'] as Node;

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        expect(body.fallback).toBeUndefined();
        expect(Object.keys(stage.children)).toEqual(expect.arrayContaining(['nameCorner', 'shareCorner', 'rail', 'zoom', 'chat', 'chatBar', 'library', 'inspector', 'share', 'prefs']));
        // The library is a panel of its own beside the rail; the inspector keeps Properties and State
        expect(Object.keys((stage.children['inspector'] as Node).children['tabs']!.children)).toEqual(['properties', 'state']);
        expect((stage.children['library'] as Node).children['body']!.children['cards']).toMatchObject({ component: 'list', row: { component: 'card', draggable: true } });
        expect(typeof body.icons).toBe('object');
        expect(body.document.icons).toEqual(EDITOR_ICONS);
        for (const name of Object.keys(EDITOR_ICONS)) expect(body.icons, name).not.toHaveProperty(name);
        expect(await again.json()).toEqual(body);
        expect(script.headers.get('content-type')).toMatch(/^text\/javascript/);
    });

    it('should serve the logo, and give every page it as an icon', async () => {
        // Act
        const logo = await fetch(`${magnetic.origin}/assets/logo.svg`);
        const signIn = await (await fetch(`${magnetic.origin}/signin`)).text();
        const editor = await (await fetch(`${magnetic.origin}/edit/${appId}`, { headers: { Cookie: alice } })).text();

        // Assert
        expect(logo.status).toBe(200);
        expect(logo.headers.get('content-type')).toBe('image/svg+xml');
        expect(await logo.text()).toContain('<title>Magnetic</title>');
        for (const page of [signIn, editor]) expect(page).toContain('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,');
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

    it("should answer a node's layout: the parent's type for its placement, its children's placements, and whether its component lays out parts", async () => {
        // Arrange: the list becomes a grid whose first part spans two columns
        const placed = await write([
            { op: 'set', path: '$.screens.home.children.list.layout', value: { type: 'grid', cols: 2 } },
            { op: 'set', path: '$.screens.home.children.list.children.a.placement', value: { span: 2 } }
        ]);

        // Act
        const list = await get(`/node?path=${encodeURIComponent('$.screens.home.children.list')}`);
        const alpha = await get(`/node?path=${encodeURIComponent('$.screens.home.children.list.children.a')}`);
        const root = await get(`/node?path=${encodeURIComponent('$.screens.home')}`);
        const { body } = await get('/components');

        // Assert
        expect(placed.status).toBe(200);
        expect(list.body).toMatchObject({ settings: { layout: { type: 'grid', cols: 2 } }, parentLayout: 'column', childPlacements: { a: { span: 2 }, b: {} }, component: { layout: true } });
        expect(alpha.body).toMatchObject({ settings: { placement: { span: 2 } }, parentLayout: 'grid', childPlacements: {}, component: { layout: false } });
        expect(root.body['parentLayout']).toBeNull();
        expect(Object.keys(body['layouts'] as object)).toEqual(['column', 'row', 'grid', 'region', 'adhoc']);
        expect((body['layouts'] as Record<string, { placement: object }>)['grid']!.placement).toHaveProperty('span');

        // Afterwards: the list as it was, for the tests after this one
        await write([
            { op: 'remove', path: '$.screens.home.children.list.layout' },
            { op: 'remove', path: '$.screens.home.children.list.children.a.placement' }
        ]);
    });

    it('should list the screens, and add, copy, rename, delete them and choose the one the app opens on', async () => {
        // Act
        const listed = await get('/screens');
        const added = await screens({ action: 'add', name: 'about' });
        const copied = await screens({ action: 'copy', name: 'home', to: 'home-copy' });
        const renamed = await screens({ action: 'rename', name: 'about', to: 'info' });
        const homed = await screens({ action: 'home', name: 'info' });
        const startRefused = await screens({ action: 'delete', name: 'info' });
        const deleted = await screens({ action: 'delete', name: 'home-copy' });
        const taken = await screens({ action: 'add', name: 'home' });
        const unknown = await screens({ action: 'paint', name: 'home' });
        const back = await screens({ action: 'home', name: 'home' });
        const removed = await screens({ action: 'delete', name: 'info' });

        // Assert
        expect(listed.body).toMatchObject({ start: 'home', screens: [{ name: 'home' }] });
        expect(added.body['screens']).toEqual([expect.objectContaining({ name: 'home' }), { name: 'about', title: 'About' }]);
        expect((copied.body['screens'] as { name: string }[]).map((screen) => screen.name)).toEqual(['home', 'about', 'home-copy']);
        expect((renamed.body['screens'] as { name: string }[]).map((screen) => screen.name)).toEqual(['home', 'info', 'home-copy']);
        expect(homed.body['start']).toBe('info');
        expect(startRefused.status).toBe(400);
        expect((deleted.body['screens'] as { name: string }[]).map((screen) => screen.name)).toEqual(['home', 'info']);
        expect(taken.status).toBe(400);
        expect(unknown.status).toBe(400);
        expect(back.body['start']).toBe('home');
        expect(removed.body).toMatchObject({ start: 'home', screens: [{ name: 'home' }] });
        // The copy had the home screen's nodes
        const copy = (await get(`/node?path=${encodeURIComponent('$.screens.home')}`)).body;
        expect(copy['children']).toEqual(['title', 'list']);
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
