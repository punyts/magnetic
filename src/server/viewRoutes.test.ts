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
    let aliceId: string;
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
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        await tool(tools, 'ui_model_write', { model: 'note', operations: [{ op: 'set', field: 'title', type: 'string', required: true }, { op: 'set', field: 'done', type: 'boolean' }] });
        await tool(tools, 'ui_data_write', { dataset: 'notes', model: 'note', operations: [{ op: 'set', path: 'n1', value: { title: 'First', done: false } }] });
        await tool(tools, 'ui_theme_create', { name: 'calm', preset: 'clean' });
        const created = await tool(tools, 'ui_app_create', {
            name: 'notes',
            themes: ['calm'],
            data: { notes: { dataset: 'notes' }, mine: { model: 'note', scope: 'person' } },
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

    it("should sync the app at its address with the owner's own instance, and the editor with the test run, each page with its own only", async () => {
        // Arrange
        const page = async (path: string): Promise<string> => (await fetch(`${magnetic.origin}${path}`, { headers: { Cookie: alice } })).text();
        const attribute = (html: string, name: string): string | undefined => new RegExp(`${name}="([^"]+)"`).exec(html)?.[1];

        // Act
        const app = await page(`/apps/${appId}`);
        const editor = await page(`/edit/${appId}`);

        // Assert
        const own = `instances.${aliceId}.${aliceId}.${appId}`.toLowerCase();
        const test = `instances.test-${aliceId}.${aliceId}.${appId}`.toLowerCase();
        expect(attribute(app, 'data-namespace')).toBe(own);
        expect(attribute(app, 'data-run')).toBeUndefined();
        expect(attribute(editor, 'data-namespace')).toBe(test);
        expect(attribute(editor, 'data-run')).toBe('test');
        // Each page names only its own instance: a zoom loads the other page
        expect([app.includes(test), editor.includes(own)]).toEqual([false, false]);
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

    it("should answer the owner's statenet by state path: the app with its screens and bindings, its theme, its dataset with its model", async () => {
        // Act
        const answer = await get('graph');

        // Assert
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        const ids = (answer.body['nodes'] as { id: string }[]).map((node) => node.id);
        expect(ids).toEqual(expect.arrayContaining(['$', '$.apps.notes', '$.apps.other', '$.apps.notes.screens.home', '$.apps.notes.uses.data.notes', '$.themes.calm', '$.data.notes', '$.data.notes.n1', '$.models.note', '$.models.note.fields.title']));
        expect(answer.body['nodes']).toContainEqual(expect.objectContaining({ id: '$.apps.notes', current: true }));
        expect(answer.body['nodes']).toContainEqual(expect.objectContaining({ id: '$.apps.other', used: false }));
        expect(answer.body['nodes']).toContainEqual(expect.objectContaining({ id: '$.themes.calm', isDefault: true, used: true }));
        expect(answer.body['edges']).toContainEqual({ from: '$.apps.notes.uses.data.notes', to: '$.data.notes', kind: 'binding', label: '$.data.notes' });
        expect(answer.body['app']).toBe('notes');
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

    it("should read and set a path of the test run's state, write a shared dataset to its copy, and refuse a path outside $.data", async () => {
        // Arrange
        const dataset = (await get('part?kind=data&name=notes')).body['records'];

        // Act
        const set = await post('state', { path: '$.data.mine.m1', value: { title: 'Mine', done: true } });
        const read = await get('state?path=' + encodeURIComponent('$.data.mine.m1.title'));
        const shared = await post('state', { path: '$.data.notes.n1.title', value: 'Open' });
        const copy = await get('state?path=' + encodeURIComponent('$.data.notes.n1.title'));
        const outside = await post('state', { path: '$.theme.active', value: {} });

        // Assert
        expect(set.status, JSON.stringify(set.body)).toBe(200);
        expect(read.body['value']).toBe('Mine');
        expect(shared.status, JSON.stringify(shared.body)).toBe(200);
        expect(copy.body['value']).toBe('Open');
        expect((await get('part?kind=data&name=notes')).body['records']).toEqual(dataset);
        expect(outside.status).toBe(400);
    });

    it("should show the person editing under $.people, at their own id, with the app once they have state in it, and no one else's", async () => {
        // Arrange: state of the person's own in the app, from using it at its address; the editor's test run is not theirs
        const services = await magnetic.workspaces.get(aliceId);
        const app = (await services.parts.findById('apps', appId)) as NonNullable<Awaited<ReturnType<typeof services.parts.findById<'apps'>>>>;
        (await services.instanceViews.authority(app, aliceId)).write({ op: 'set', path: '$.data.mine.m2', value: { title: 'Kept', done: false } });
        await post('state', { path: '$.data.mine.m3', value: { title: 'Tried', done: false } });

        // Act
        const answer = await get('graph');

        // Assert
        const nodes = answer.body['nodes'] as { id: string; parent: string | null; kind: string; current?: boolean; appId?: string }[];
        const person = `$.people.${aliceId.toLowerCase()}`;
        expect(nodes).toContainEqual(expect.objectContaining({ id: person, parent: '$.people', kind: 'person' }));
        expect(nodes.filter((node) => node.parent === '$.people')).toHaveLength(1);
        const instance = nodes.find((node) => node.kind === 'instance' && node.current === true);
        expect(instance?.id).toBe(`${person}.apps.${appId.toLowerCase()}`);
        expect(answer.body['edges']).toContainEqual({ from: '$.apps.notes', to: instance?.id, kind: 'instance' });
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
        expect(graph.body['nodes']).toContainEqual(expect.objectContaining({ id: '$.connections.weather.endpoints.today', used: false }));
    });

    it("should make a model, a dataset bound in the app, a module the app uses, and bind a dataset the owner has, from the tree's +", async () => {
        // Act
        const model = await post('add', { what: 'model', name: 'task', field: 'title', type: 'string' });
        const dataset = await post('add', { what: 'dataset', name: 'open-tasks', model: 'task', record: { title: 'First' } });
        const module = await post('add', { what: 'module', name: 'chores', need: 'notes' });
        await tool(tools, 'ui_data_write', { dataset: 'later', model: 'task', operations: [{ op: 'add', value: { title: 'Later' } }] });
        const bound = await post('add', { what: 'binding', dataset: 'later', binding: 'someday' });
        const taken = await post('add', { what: 'binding', dataset: 'later', binding: 'someday' });
        const badName = await post('add', { what: 'module', name: 'Not A Name', need: 'notes' });
        const noNeed = await post('add', { what: 'module', name: 'loose' });
        const rule = await post('logic', { module: 'chores', unit: 'rules.example', revision: (await get('part?kind=logic&name=chores')).body['revision'], value: { when: { path: '$.data.notes.{id}.title', is: 'example' }, do: [{ command: 'set', target: '$.data.notes.{id}.title', value: '' }] } });
        const machine = await post('logic', { module: 'chores', unit: 'machines.example', revision: rule.body['revision'], value: { state: '$.data.notes.status', initial: 'idle', transitions: [{ from: 'idle', when: { path: '$.data.notes.{id}.title', is: 'example' }, to: 'done' }] } });
        const table = await post('logic', { module: 'chores', unit: 'tables.example', revision: machine.body['revision'], value: { inputs: { value: '$.data.notes.{id}.title' }, outputs: { copy: '$.data.notes.{id}.done' }, rows: [{ copy: '{{ $value }}' }] } });
        const graph = await get('graph');

        // Assert
        expect(model.body, JSON.stringify(model.body)).toEqual({ path: '$.models.task' });
        expect(dataset.body, JSON.stringify(dataset.body)).toEqual({ path: '$.data.open-tasks' });
        expect(module.body, JSON.stringify(module.body)).toEqual({ path: '$.logic.chores' });
        expect(bound.body, JSON.stringify(bound.body)).toEqual({ path: '$.data.someday' });
        expect(taken.status).toBe(409);
        expect(badName.status).toBe(400);
        expect(noNeed.status).toBe(400);
        expect([rule.status, machine.status, table.status], JSON.stringify([rule.body, machine.body, table.body])).toEqual([200, 200, 200]);
        const nodes = graph.body['nodes'] as { id: string; used: boolean }[];
        expect(nodes).toContainEqual(expect.objectContaining({ id: '$.apps.notes.uses.data.openTasks', kind: 'binding', note: 'open-tasks' }));
        expect(nodes).toContainEqual(expect.objectContaining({ id: '$.apps.notes.uses.data.someday', kind: 'binding', note: 'later' }));
        expect(nodes).toContainEqual(expect.objectContaining({ id: '$.data.open-tasks', used: true }));
        expect(nodes).toContainEqual(expect.objectContaining({ id: '$.logic.chores', used: true }));
        expect(nodes).toContainEqual(expect.objectContaining({ id: '$.models.task', used: true }));
    });

    it("should keep where the person left Statenet's view of the app, and refuse a place out of range", async () => {
        // Act
        const before = await get('kept?view=statenet');
        const kept = await post('kept', { view: 'statenet', place: { x: 120, y: -40, zoom: 0.8 } });
        const after = await get('kept?view=statenet');
        const tooFar = await post('kept', { view: 'statenet', place: { x: 0, y: 0, zoom: 9 } });
        const noView = await get('kept?view=elsewhere');

        // Assert
        expect(before).toEqual({ status: 200, body: { place: null } });
        expect(kept.status).toBe(200);
        expect(after).toEqual({ status: 200, body: { place: { x: 120, y: -40, zoom: 0.8 } } });
        expect(tooFar.status).toBe(400);
        expect(noView.status).toBe(400);
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
