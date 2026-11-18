import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const databases: TestDatabase[] = [];
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

type Answer = { status: number; body: Record<string, any> };

describe("The editor's view routes", () => {
    let magnetic: RunningMagnetic;
    let alice: string;
    let appId: string;
    let tools: readonly UiToolDefinition[];

    const get = async (what: string): Promise<Answer> => {
        const response = await fetch(`${magnetic.origin}/edit/${appId}/views/${what}`, { headers: { Cookie: alice } });
        return { status: response.status, body: (await response.json()) as Record<string, any> };
    };
    const post = async (what: string, body: Record<string, unknown>): Promise<Answer> => {
        const response = await fetch(`${magnetic.origin}/edit/${appId}/views/${what}`, {
            method: 'POST',
            headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { status: response.status, body: (await response.json()) as Record<string, any> };
    };

    beforeAll(async () => {
        magnetic = await startMagnetic({ database: await freshDb(), host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser, secretKey: 'a-test-secret-key-of-length' });
        alice = await signIn(magnetic.origin, 'alice');
        const aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        await tool(tools, 'ui_model_write', { model: 'note', operations: [{ op: 'set', field: 'title', type: 'string', required: true }, { op: 'set', field: 'done', type: 'boolean' }] });
        await tool(tools, 'ui_data_write', { dataset: 'notes', model: 'note', operations: [{ op: 'set', path: 'n1', value: { title: 'First', done: false } }] });
        await tool(tools, 'ui_theme_create', { name: 'calm', preset: 'clean' });
        const created = await tool(tools, 'ui_app_create', {
            name: 'notes',
            themes: ['calm'],
            data: { notes: { dataset: 'notes' }, mine: { model: 'note', scope: 'persona' } },
            home: {
                component: 'panel',
                layout: { type: 'column', gap: 'md' },
                children: {
                    title: { component: 'text', '<-_text': '$.data.notes.n1.title' },
                    more: { component: 'button', _title: 'More', on: { press: { command: 'navigate', target: 'home' } } }
                }
            }
        });
        appId = created['id'] as string;
        await tool(tools, 'ui_logic_write', {
            app: 'notes',
            expectedRevision: created['revision'],
            operations: [{ op: 'set', unit: 'rules.finish', value: { when: { path: '$.data.notes.{id}.title' }, do: [{ command: 'set', target: '$.data.notes.{id}.done', value: false }] } }]
        });
        // Another app on the same theme, so it is shared
        await tool(tools, 'ui_app_create', { name: 'other', title: 'Other', themes: ['calm'], home: { component: 'panel', children: {} } });
    });

    afterAll(async () => {
        await magnetic.stop();
    });

    it("should answer a screen's layout, the paths it uses, its handlers and the units touching it", async () => {
        // Act
        const answer = await get('screen?screen=home');

        // Assert
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body['layout']).toMatchObject({ key: 'home', layout: 'column' });
        expect(answer.body['paths']).toContainEqual(expect.objectContaining({ path: '$.data.notes', reads: true, outside: false }));
        expect(answer.body['handlers']).toContainEqual(expect.objectContaining({ event: 'press' }));
        expect(answer.body['units']).toContainEqual(expect.objectContaining({ name: 'finish', runs: 'server' }));
        expect((await get('screen?screen=nowhere')).status).toBe(404);
    });

    it("should answer the app's statenet: its theme, its dataset with its model, and the app", async () => {
        // Act
        const answer = await get('graph');

        // Assert
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        const ids = (answer.body['nodes'] as { id: string }[]).map((node) => node.id);
        expect(ids).toEqual(expect.arrayContaining(['app', 'theme:calm', 'dataset:notes', 'model:note']));
        expect(answer.body['nodes']).toContainEqual(expect.objectContaining({ id: 'theme:calm', isDefault: true }));
        expect(answer.body['edges']).toContainEqual({ from: 'dataset:notes', to: 'app', kind: 'binding', label: '$.data.notes' });
        expect(answer.body['manages']).toBe(true);
    });

    it("should change a dataset's records and a model's fields through the person's tools", async () => {
        // Act
        const written = await post('data', { dataset: 'notes', operations: [{ op: 'set', path: 'n1.title', value: 'Changed' }] });
        const model = await get('part?kind=models&name=note');
        const field = await post('data', { model: 'note', revision: model.body['revision'], operations: [{ op: 'set', field: 'due', type: 'string' }] });
        const refused = await post('data', { dataset: 'notes', operations: [{ op: 'set', path: 'n1.done', value: 'not a boolean' }] });

        // Assert
        expect(written.status, JSON.stringify(written.body)).toBe(200);
        expect((await get('part?kind=data&name=notes')).body['records']).toMatchObject({ n1: { title: 'Changed' } });
        expect(field.status, JSON.stringify(field.body)).toBe(200);
        expect((await get('part?kind=models&name=note')).body['fields']).toHaveProperty('due');
        expect(refused.status).toBe(400);
    });

    it("should read and set a path of the person's state, and refuse a shared dataset or a path outside $.data", async () => {
        // Act
        const set = await post('state', { path: '$.data.mine.m1', value: { title: 'Mine', done: true } });
        const read = await get('state?path=' + encodeURIComponent('$.data.mine.m1.title'));
        const shared = await post('state', { path: '$.data.notes.n1.title', value: 'Open' });
        const outside = await post('state', { path: '$.theme.active', value: {} });

        // Assert
        expect(set.status, JSON.stringify(set.body)).toBe(200);
        expect(read.body['value']).toBe('Mine');
        expect(shared.status).toBe(400);
        expect(outside.status).toBe(400);
    });

    it("should answer a theme's tokens in each mode and the other apps that use it, and write one mode's value", async () => {
        // Arrange
        const before = await get('theme');

        // Act
        const written = await post('theme', {
            action: 'write',
            theme: 'calm',
            revision: before.body['revision'],
            operations: [{ op: 'set', path: 'color.accent.base', value: '#ff6600', overlay: 'dark' }]
        });
        const after = await get('theme?theme=calm');

        // Assert
        expect(before.body['theme']).toBe('calm');
        expect(before.body['usedBy']).toEqual(['Other']);
        expect(before.body['modes']).toEqual(expect.arrayContaining(['light', 'dark']));
        expect(written.status, JSON.stringify(written.body)).toBe(200);
        const accent = (after.body['tokens'] as { path: string; values: Record<string, unknown>; modes: Record<string, unknown> }[]).find((token) => token.path === 'color.accent.base');
        expect(accent?.modes['dark']).toBe('#ff6600');
        expect(accent?.values['dark']).toBe('#ff6600');
        expect(accent?.values['light']).not.toBe('#ff6600');
    });

    it("should clone a shared theme into the app's place for it, make a theme, choose the default and remove one", async () => {
        // Act
        const cloned = await post('theme', { action: 'clone', theme: 'calm', to: 'calm-notes' });
        const made = await post('theme', { action: 'create', theme: 'bold', preset: 'playful' });
        const chosen = await post('theme', { action: 'default', theme: 'bold' });
        const themes = (await get('theme')).body['themes'] as { name: string; isDefault: boolean }[];
        const removed = await post('theme', { action: 'remove', theme: 'bold' });
        const bad = await post('theme', { action: 'clone', theme: 'calm-notes', to: 'Not A Name' });

        // Assert
        expect(cloned.body).toEqual({ theme: 'calm-notes' });
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
        expect(themes.map((theme) => theme.name)).toEqual(['bold', 'calm-notes']);
        expect(themes[0]?.isDefault).toBe(true);
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
        expect(((await get('theme')).body['themes'] as { name: string }[]).map((theme) => theme.name)).toEqual(['calm-notes']);
        expect(bad.status).toBe(400);
    });

    it('should list the units with where each runs, move one to the browser, and refuse a guard there', async () => {
        // Arrange
        const before = await get('logic');

        // Act
        const moved = await post('logic', { unit: 'rules.finish', revision: before.body['revision'], value: { when: { path: '$.data.notes.{id}.title' }, do: [{ command: 'set', target: '$.data.notes.{id}.done', value: false }], runs: 'browser' } });
        const after = await get('logic');
        const guard = await post('logic', { unit: 'rules.keep', revision: after.body['revision'], value: { when: { path: '$.data.notes.{id}' }, do: [{ command: 'reject', value: 'no' }], runs: 'browser' } });
        const removed = await post('logic', { unit: 'rules.finish', revision: after.body['revision'], remove: true });

        // Assert
        expect(before.body['units']).toContainEqual(expect.objectContaining({ group: 'rules', name: 'finish', runs: 'server', own: true }));
        expect(before.body['handlers']).toContainEqual(expect.objectContaining({ screen: 'home', event: 'press' }));
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
        expect(after.body['units']).toContainEqual(expect.objectContaining({ name: 'finish', runs: 'browser' }));
        expect(guard.status).toBe(400);
        expect(JSON.stringify(guard.body)).toContain('server');
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
        expect((await get('logic')).body['units']).toEqual([]);
    });

    it("should make a connection and an endpoint through the Connections page's code, and answer it without a secret", async () => {
        // Act
        const made = await post('connections', { do: 'create', name: 'weather', baseUrl: 'https://api.example.com', kind: 'key', keyName: 'X-Key', secret: 'secret-value' });
        const info = await get('part?kind=connections&name=weather');
        const endpoint = await post('connections', { do: 'endpoint', id: info.body['id'], name: 'today', method: 'GET', path: '/today' });
        const graph = await get('graph');

        // Assert
        expect(made.status, JSON.stringify(made.body)).toBe(200);
        expect(info.body).toMatchObject({ name: 'weather', baseUrl: 'https://api.example.com', keySet: true });
        expect(JSON.stringify(info.body)).not.toContain('secret-value');
        expect(endpoint.status, JSON.stringify(endpoint.body)).toBe(200);
        expect(graph.body['nodes']).toContainEqual(expect.objectContaining({ id: 'endpoint:weather/today', used: false }));
    });

    it('should keep the view routes to signed-in people who may edit the app', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/edit/${appId}/views/graph`);
        const unknown = await get('nothing');

        // Assert
        expect(anonymous.status).toBe(401);
        expect(unknown.status).toBe(405);
    });
});
