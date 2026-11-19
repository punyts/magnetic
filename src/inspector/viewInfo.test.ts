import { layoutOf, modesOf, ownerTreeOf, rootOf, screenInfoOf, themeTokensOf, TREE_RECORDS, unitsOf } from './viewInfo.js';

/** An app with a home screen of a header and a list, a details screen, and logic on both sides */
const DOCUMENT = {
    screens: {
        home: {
            root: {
            component: 'panel',
            layout: { type: 'column', gap: 'md' },
            children: {
                header: { component: 'panel', layout: { type: 'row', align: 'center' }, children: { title: { component: 'text', '<-_text': '$.app.title' } } },
                list: { component: 'list', '<-items': '$.data.tasks', '<->value': '$.data.filter.text', on: { select: [{ command: 'set', target: '$.data.selected', from: '$.event.value' }, { command: 'navigate', target: 'details' }] } },
                weather: { component: 'text', '<-_text': '$.external.weather.today.summary' }
            }
            }
        },
        details: { root: { component: 'panel', children: {} } }
    },
    logic: {
        rules: {
            pick: { when: { path: '$.data.selected' }, do: [{ command: 'navigate', target: 'details' }], runs: 'browser' },
            audit: { when: { path: '$.data.tasks.{id}' }, do: [{ command: 'set', target: '$.server.log.{id}', value: true }] },
            // What the forecast effect calls is the request this rule writes
            ask: { when: { path: '$.data.filter.text' }, do: [{ command: 'set', target: '$.data.forecast.request', value: { connection: 'weather', endpoint: 'today' } }] }
        },
        effects: {
            forecast: { run: 'http', request: '$.data.forecast.request', status: '$.data.forecast.status' },
            alerts: { run: 'http', request: '$.data.alerts.request', status: '$.data.alerts.status' }
        }
    },
    // The alerts effect's request is in the starting data
    data: { tasks: {}, filter: { text: '' }, selected: '', forecast: {}, alerts: { request: { connection: 'weather', endpoint: 'alerts' } } },
    composed: { appHeader: {} }
};

describe("The editor's views of an app", () => {
    it('should lay a screen out as nested boxes with each layout and its settings, and nothing for another screen', () => {
        // Act
        const layout = layoutOf(DOCUMENT, 'home');

        // Assert
        expect(layout).toMatchObject({ path: '$.screens.home', key: 'home', layout: 'column', note: 'gap md' });
        expect(layout?.children.map((child) => [child.key, child.layout])).toEqual([['header', 'row'], ['list', null], ['weather', null]]);
        expect(layout?.children[0]?.children[0]).toMatchObject({ path: '$.screens.home.children.header.children.title', layout: null });
        expect(layoutOf(DOCUMENT, 'nowhere')).toBeUndefined();
    });

    it('should list where each unit runs, the server unless it says the browser', () => {
        // Act
        const units = unitsOf(DOCUMENT);

        // Assert
        expect(units.find((unit) => unit.name === 'pick')).toMatchObject({ group: 'rules', runs: 'browser' });
        expect(units.find((unit) => unit.name === 'audit')).toMatchObject({ group: 'rules', runs: 'server' });
        expect(unitsOf({ screens: {} })).toEqual([]);
    });

    it("should gather a screen's paths, its handlers, the screens it leads to and the units that touch its paths", () => {
        // Act
        const info = screenInfoOf(DOCUMENT, 'home');

        // Assert
        const paths = Object.fromEntries((info?.paths ?? []).map((path) => [path.path, path]));
        expect(Object.keys(paths).sort()).toEqual(['$.app.title', '$.data.filter', '$.data.selected', '$.data.tasks', '$.external.weather'].sort());
        expect(paths['$.data.filter']).toMatchObject({ reads: true, writes: true, outside: false });
        expect(paths['$.data.selected']).toMatchObject({ reads: false, writes: true });
        expect(paths['$.external.weather']).toMatchObject({ reads: true, outside: true });
        expect(info?.handlers).toEqual([{ node: '$.screens.home.children.list', event: 'select', commands: expect.any(Array) }]);
        expect(info?.navigates).toEqual(expect.arrayContaining([{ from: '$.screens.home.children.list', to: 'details' }, { from: 'logic:rules.pick', to: 'details' }]));
        expect(info?.units.map((unit) => unit.name).sort()).toEqual(['ask', 'audit', 'pick']);
        expect(screenInfoOf(DOCUMENT, 'nowhere')).toBeUndefined();
    });

    it('should cut a path at its dataset', () => {
        // Act and Assert
        expect(rootOf('$.data.tasks.r1.done')).toBe('$.data.tasks');
        expect(rootOf('$.external.weather')).toBe('$.external.weather');
    });

    it("should draw the owner's tree by state path: every part under its branch, what the app does not use dimmed, one level below a part", () => {
        // Arrange
        const keys = Array.from({ length: TREE_RECORDS + 2 }, (_, index) => `k${index}`);

        // Act
        const tree = ownerTreeOf({
            app: {
                id: 'a1',
                name: 'tasks',
                title: 'Tasks',
                uses: {
                    themes: ['calm', 'bold'],
                    data: { tasks: { dataset: 'tasks' }, mine: { model: 'note', scope: 'persona' } },
                    logic: { billing: {} },
                    external: { prices: { owner: 'w2', dataset: 'prices' }, stock: { app: 'a2', path: '$.data.stock' } }
                },
                document: DOCUMENT,
                sharedWith: 3
            },
            apps: [{ id: 'a1', name: 'tasks', title: 'Tasks' }, { id: 'a2', name: 'stock', title: 'Stock' }],
            themes: ['bold', 'calm', 'spare'],
            datasets: [{ name: 'tasks', model: 'task', keys }, { name: 'leads', model: 'lead', keys: [] }],
            models: [{ name: 'task', fields: { title: 'string' } }, { name: 'note', fields: {} }, { name: 'lead', fields: {} }],
            modules: [{ name: 'billing', units: [{ group: 'rules', name: 'total' }], needs: [] }, { name: 'spare', units: [], needs: [] }],
            components: ['appHeader', 'footer'],
            patterns: ['cardList'],
            connections: [{ name: 'weather', host: 'api.example.com', endpoints: [{ name: 'today', method: 'GET', path: '/today' }] }, { name: 'mail', host: 'mail.example.com', endpoints: [] }],
            ownerNames: { w2: 'Acme' },
            appNames: { a2: 'Stock' },
            manages: false
        });

        // Assert
        const node = (id: string) => tree.nodes.find((candidate) => candidate.id === id);
        expect(tree.nodes.filter((each) => each.parent === '$').map((each) => each.id)).toEqual(['$.apps', '$.themes', '$.data', '$.models', '$.logic', '$.components', '$.patterns', '$.connections']);
        expect(tree.nodes.every((each) => each.parent === null || (each.id.startsWith(each.parent + '.') && tree.nodes.some((other) => other.id === each.parent)))).toBe(true);
        expect(node('$.apps.tasks')).toMatchObject({ kind: 'app', label: 'Tasks', current: true, count: 3, screens: ['home', 'details'] });
        expect(node('$.apps.stock')).toMatchObject({ used: false, appId: 'a2' });
        expect(node('$.apps.tasks.screens.details')).toMatchObject({ kind: 'screen', parent: '$.apps.tasks.screens' });
        expect(node('$.apps.tasks.uses.data.tasks')).toMatchObject({ kind: 'binding', note: 'tasks' });
        expect(node('$.apps.tasks.uses.data.mine')).toMatchObject({ kind: 'persona', note: 'note' });
        expect(node('$.apps.tasks.data.filter')).toMatchObject({ kind: 'state', note: '$.data.filter' });
        expect(node('$.apps.tasks.data.tasks')).toBeUndefined();
        expect(node('$.apps.tasks.uses.external.prices')).toMatchObject({ kind: 'shared', note: 'Acme', outside: true });
        expect(node('$.apps.tasks.uses.external.stock')).toMatchObject({ kind: 'otherApp', label: 'Stock', note: '$.data.stock' });
        expect(tree.nodes.filter((each) => each.kind === 'theme').map((each) => [each.label, each.used, each.isDefault])).toEqual([['calm', true, true], ['bold', true, false], ['spare', false, false]]);
        expect(node('$.data.tasks')).toMatchObject({ used: true, note: 'task', more: 2, add: 'record' });
        expect(tree.nodes.filter((each) => each.parent === '$.data.tasks')).toHaveLength(TREE_RECORDS);
        expect(node('$.data.leads')).toMatchObject({ used: false });
        expect([node('$.models.task')?.used, node('$.models.note')?.used, node('$.models.lead')?.used]).toEqual([true, true, false]);
        expect(node('$.models.task.fields.title')).toMatchObject({ kind: 'field', note: 'string', parent: '$.models.task' });
        expect(node('$.logic.billing.rules.total')).toMatchObject({ kind: 'unit', note: 'rules' });
        expect([node('$.logic.billing')?.used, node('$.logic.spare')?.used]).toEqual([true, false]);
        expect(node('$.components.appHeader')).toMatchObject({ used: true, screens: [] });
        expect(node('$.components.footer')).toMatchObject({ used: false });
        expect(node('$.patterns.cardList')).toMatchObject({ kind: 'pattern' });
        expect(node('$.connections.weather')).toMatchObject({ used: true, note: 'api.example.com' });
        expect(node('$.connections.mail')).toMatchObject({ used: false });
        expect(node('$.connections.weather.endpoints.alerts')).toMatchObject({ missing: true, note: 'weather' });
        // The +: what each branch makes; none for components and patterns, nor for connections without the right to manage them
        expect(['$.apps', '$.apps.tasks.screens', '$.apps.tasks.uses.data', '$.themes', '$.data', '$.models', '$.logic', '$.models.task', '$.logic.billing'].map((id) => node(id)?.add)).toEqual(['app', 'screen', 'binding', 'theme', 'dataset', 'model', 'module', 'field', 'unit']);
        expect([node('$.components')?.add, node('$.patterns')?.add, node('$.connections')?.add]).toEqual([undefined, undefined, undefined]);
        // The edges: what the app uses, a binding's dataset, a dataset's model, an endpoint the app calls
        expect(tree.edges).toContainEqual({ from: '$.apps.tasks.uses.data.tasks', to: '$.data.tasks', kind: 'binding', label: '$.data.tasks' });
        expect(tree.edges).toContainEqual({ from: '$.models.task', to: '$.data.tasks', kind: 'model' });
        expect(tree.edges).toContainEqual({ from: '$.apps.tasks', to: '$.logic.billing', kind: 'uses' });
        expect(tree.edges).toContainEqual({ from: '$.apps.tasks', to: '$.connections.weather.endpoints.today', kind: 'call', label: 'forecast' });
    });

    it("should give each token its value in every mode and what the theme writes for it, base and per mode", () => {
        // Arrange: the base tokens win over a mode's overlay, as the runtime merges them, so a per-mode value lives in the overlays only
        const theme = { tokens: { color: { text: { base: '#112233' } } }, overlays: { dark: { kind: 'mode', tokens: { color: { accent: { base: '#ff6600' }, text: { base: '#eeeeee' } } } }, dusk: { kind: 'mode', tokens: {} } } };

        // Act
        const { modes, tokens } = themeTokensOf(theme);

        // Assert
        expect(modes).toEqual(expect.arrayContaining(['light', 'dark', 'dusk']));
        expect(modesOf({})).not.toContain('dusk');
        const accent = tokens.find((token) => token.path === 'color.accent.base');
        expect(accent).toMatchObject({ group: 'color', modes: { dark: '#ff6600' } });
        expect(accent?.own).toBeUndefined();
        expect(accent?.values['dark']).toBe('#ff6600');
        expect(accent?.values['light']).not.toBe('#ff6600');
        const text = tokens.find((token) => token.path === 'color.text.base');
        expect(text).toMatchObject({ own: '#112233', modes: { dark: '#eeeeee' }, values: { light: '#112233', dark: '#112233' } });
        // A reference is followed to its value
        expect(String(tokens.find((token) => token.path === 'color.surface.base')?.values['light'])).not.toMatch(/^\{/);
    });
});
