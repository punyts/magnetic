import { graphOf, layoutOf, modesOf, rootOf, screenInfoOf, themeTokensOf, unitsOf } from './viewInfo.js';

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

    it("should draw the app's statenet from what it starts with, what it reads from outside and its own state", () => {
        // Act
        const graph = graphOf({
            appName: 'Tasks',
            uses: {
                themes: ['calm', 'bold'],
                data: { tasks: { dataset: 'tasks' }, mine: { model: 'note', scope: 'persona' } },
                logic: { billing: {} },
                external: { prices: { owner: 'w2', dataset: 'prices' }, stock: { app: 'a2', path: '$.data.stock' } }
            },
            document: DOCUMENT,
            connections: [{ name: 'weather', host: 'api.example.com', endpoints: [{ name: 'today', method: 'GET', path: '/today' }] }, { name: 'mail', host: 'mail.example.com', endpoints: [] }],
            datasetModels: { tasks: 'task' },
            ownerNames: { w2: 'Acme' },
            appNames: { a2: 'Stock' },
            sharedWith: 3
        });

        // Assert
        const node = (id: string) => graph.nodes.find((candidate) => candidate.id === id);
        expect(node('app')).toMatchObject({ label: 'Tasks', column: 2, count: 3 });
        expect([node('theme:calm')?.isDefault, node('theme:bold')?.isDefault]).toEqual([true, false]);
        expect(node('dataset:tasks')).toMatchObject({ note: '$.data.tasks', column: 1 });
        expect(graph.edges).toContainEqual({ from: 'model:task', to: 'dataset:tasks', kind: 'model' });
        expect(node('persona:mine')).toMatchObject({ note: 'note' });
        expect(node('module:billing')).toBeDefined();
        expect(node('component:appHeader')).toBeDefined();
        expect(node('shared:w2/prices')).toMatchObject({ note: 'Acme', outside: true, column: 0 });
        expect(node('otherApp:a2')).toMatchObject({ label: 'Stock', note: '$.data.stock' });
        expect(node('connection:weather')).toMatchObject({ used: true, note: 'api.example.com' });
        expect(node('connection:mail')).toMatchObject({ used: false });
        expect(node('endpoint:weather/alerts')).toMatchObject({ missing: true, note: 'weather' });
        expect(graph.edges).toContainEqual({ from: 'app', to: 'endpoint:weather/today', kind: 'call', label: 'forecast' });
        expect(node('state:$.data.filter')).toMatchObject({ column: 3 });
        expect(node('state:$.data.tasks')).toBeUndefined();
        expect(node('server:$.server')).toBeDefined();
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
