import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_PERSONA } from '@punyts/stateui-mcp';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import type { User } from '../accounts/Accounts.js';
import type { Connections } from '../connections/Connections.js';
import { CallRefused } from '../connections/guard.js';
import { isKeptView, keptPlaceOf } from '../editor/EditorViews.js';
import type { EditorViews } from '../editor/EditorViews.js';
import { ownerTreeOf, screenInfoOf, themeTokensOf, unitsOf } from '../inspector/viewInfo.js';
import type { GraphConnection, ThemeBody } from '../inspector/viewInfo.js';

type JsonRecord = Record<string, unknown>;
type AppPart = NonNullable<Awaited<ReturnType<Services['instanceViews']['find']>>>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the view routes need of the server */
export interface ViewRouteContext {
    readonly toolsOf: (services: Services) => readonly UiToolDefinition[];
    readonly readJson: (request: IncomingMessage) => Promise<unknown>;
    readonly sendJson: (response: ServerResponse, status: number, body: unknown) => void;
    readonly connections: Connections;
    /** The Connections page's own change, from a form's fields (`do`, `w`, `id`, …) */
    readonly changeConnection: (user: User, form: URLSearchParams) => Promise<{ readonly tried?: { readonly status: string; readonly body: string }; readonly continueTo?: { readonly url: string; readonly host: string } }>;
    /** The datasets other owners shared with a workspace */
    readonly sharedDatasets: (workspaceId: string) => Promise<readonly { readonly owner: string; readonly ownerName: string; readonly dataset: string; readonly fields: readonly string[] }[]>;
    /** The apps a persona has state in, by the id its state is kept under, the most recently used first */
    readonly personaApps: (workspaceId: string, ownerId: string) => Promise<readonly { readonly id: string; readonly updatedAt: string }[]>;
    /** How many links the app is shared through */
    readonly sharedCount: (workspaceId: string, appId: string) => Promise<number>;
    /** Where each person left a view of the editor */
    readonly kept: Pick<EditorViews, 'of' | 'keep'>;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

/** The app being edited and who edits it, as the editor's route found them */
export interface ViewPlace {
    readonly services: Services;
    readonly app: AppPart;
    readonly workspaceId: string;
    readonly user: User;
    /** Whether the person manages the workspace's connections (their own, or an org's as its admin or owner) */
    readonly manages: boolean;
}

/** The theme presets `ui_theme_create` makes a theme from */
const PRESETS = ['clean', 'moody', 'playful', 'professional'];
/** The most records of a dataset or a state value a view shows */
const MOST_RECORDS = 200;
const NAME = /^[a-z][a-z0-9-]*$/;
/** The groups of a logic module's units */
const UNIT_GROUPS = ['machines', 'rules', 'tables', 'computes', 'effects'];

/** A refusal the view shows: a status and a message (a tool's message, which names paths, never values) */
class Refused extends Error {
    constructor(readonly status: number, message: string, readonly errors: unknown = []) {
        super(message);
    }
}

/**
 * The routes of the editor's views, `/edit/<id>/views/<what>` (docs/design/magnetic-show-views.md), each through the
 * person's own tools as the agent's are, or the Connections page's code for a connection:
 *
 * - `GET screen?screen=`: a screen's layout tree, the paths it uses, its handlers, where it leads and the units
 *   touching it (the Screens view's layers).
 * - `GET graph`: the owner's tree of state paths (`ownerTreeOf`). `GET part?kind=data|models|logic&name=`: one
 *   dataset, model or logic module. `POST add`: what a + of the tree makes (`addPart`). `GET state?path=` and
 *   `POST state`: a path of the running state. `POST data`: a dataset's records or a model's fields.
 *   `POST connections`: a change to a connection, for those who manage them.
 * - `GET theme?theme=` and `POST theme`: the app's themes and one theme's tokens in each mode; its changes.
 * - `GET logic` and `POST logic`: the app's units with where each runs; one unit set or removed.
 * - `GET kept?view=statenet` and `POST kept`: where the person left the view of this app (`EditorViews`).
 */
export function viewRoutes(context: ViewRouteContext) {
    async function call(services: Services, name: string, args: JsonRecord): Promise<JsonRecord> {
        const tool = context.toolsOf(services).find((candidate) => candidate.name === name);
        if (tool === undefined) throw new Refused(500, `No tool ${name}`);
        const outcome = await tool.run(args as never);
        const body = (outcome.body ?? {}) as JsonRecord;
        if (outcome.isError) throw new Refused(body['error'] === 'conflict' ? 409 : 400, typeof body['message'] === 'string' ? body['message'] : 'The change was refused.', body['errors'] ?? []);
        return body;
    }

    async function documentOf(place: ViewPlace): Promise<JsonRecord> {
        const { document } = await place.services.instanceViews.message(place.app, 'attach');
        return document as JsonRecord;
    }

    /** The app part as it is now: a write may have moved it on since the route found it */
    async function appNow(place: ViewPlace): Promise<AppPart> {
        return ((await place.services.parts.findById('apps', place.app.id)) as AppPart | undefined) ?? place.app;
    }

    function usesOf(app: AppPart): JsonRecord {
        const body = app.body as unknown as JsonRecord;
        return isRecord(body['uses']) ? body['uses'] : {};
    }

    function themesOf(app: AppPart): string[] {
        const themes = usesOf(app)['themes'];
        return Array.isArray(themes) ? themes.filter((name): name is string => typeof name === 'string') : [];
    }

    /** The other apps of the workspace that use each theme, by theme name */
    async function themeReaders(place: ViewPlace): Promise<Map<string, string[]>> {
        const readers = new Map<string, string[]>();
        for (const summary of await place.services.parts.list('apps')) {
            if (summary.id === place.app.id) continue;
            const part = await place.services.parts.findById('apps', summary.id);
            const body = part === undefined ? {} : (part.body as unknown as JsonRecord);
            const uses = isRecord(body['uses']) ? body['uses'] : {};
            const title = typeof body['title'] === 'string' ? body['title'] : summary.name;
            for (const theme of Array.isArray(uses['themes']) ? uses['themes'] : []) {
                if (typeof theme === 'string') readers.set(theme, [...(readers.get(theme) ?? []), title]);
            }
        }
        return readers;
    }

    /** A part's body, or an empty one when it went away while the tree was read */
    async function bodyOf(place: ViewPlace, kind: string, name: string): Promise<JsonRecord> {
        const found = await place.services.parts.findByName(kind as never, name);
        return found === undefined ? {} : (found.body as unknown as JsonRecord);
    }

    /** The owner's tree: every part of the workspace by kind, with the app being edited and what it holds */
    async function graph(place: ViewPlace): Promise<JsonRecord> {
        const app = await appNow(place);
        const uses = usesOf(app);
        const document = await documentOf(place);
        const names = async (kind: string): Promise<string[]> => (await place.services.parts.list(kind as never)).map((summary) => summary.name);
        const apps = await Promise.all(
            (await place.services.parts.list('apps')).map(async (summary) => {
                const title = (await bodyOf(place, 'apps', summary.name))['title'];
                return { id: summary.id, name: summary.name, title: typeof title === 'string' ? title : summary.name };
            })
        );
        const datasets = await Promise.all(
            (await names('data')).map(async (name) => {
                const body = await bodyOf(place, 'data', name);
                return { name, ...(typeof body['model'] === 'string' && { model: body['model'] }), keys: isRecord(body['records']) ? Object.keys(body['records']) : [] };
            })
        );
        const models = await Promise.all(
            (await names('models')).map(async (name) => {
                const fields = (await bodyOf(place, 'models', name))['fields'];
                const types = isRecord(fields) ? Object.entries(fields).map(([field, value]) => [field, isRecord(value) && typeof value['type'] === 'string' ? value['type'] : '']) : [];
                return { name, fields: Object.fromEntries(types) as Record<string, string> };
            })
        );
        const modules = await Promise.all(
            (await names('logic')).map(async (name) => {
                const body = await bodyOf(place, 'logic', name);
                const units = UNIT_GROUPS.flatMap((group) => (isRecord(body[group]) ? Object.keys(body[group] as JsonRecord).map((unit) => ({ group, name: unit })) : []));
                return { name, units, needs: isRecord(body['needs']) ? Object.keys(body['needs']) : [] };
            })
        );
        const appNames: Record<string, string> = {};
        const external = isRecord(uses['external']) ? uses['external'] : {};
        for (const use of Object.values(external)) {
            if (!isRecord(use) || typeof use['app'] !== 'string') continue;
            const part = await place.services.parts.findById('apps', use['app']).catch(() => undefined);
            if (part !== undefined) appNames[use['app']] = part.name;
        }
        const ownerNames: Record<string, string> = {};
        for (const shared of await context.sharedDatasets(place.workspaceId)) ownerNames[shared.owner] = shared.ownerName;
        // Hosts and endpoint paths only: never a key, a token or a query secret
        const connections: GraphConnection[] = (await context.connections.list(place.workspaceId)).map((connection) => ({
            name: connection.name,
            host: new URL(connection.baseUrl).host,
            endpoints: connection.endpoints.map((endpoint) => ({ name: endpoint.name, method: endpoint.method, path: endpoint.path }))
        }));
        const title = (app.body as unknown as JsonRecord)['title'];
        const built = ownerTreeOf({
            app: { id: app.id, name: app.name, title: typeof title === 'string' ? title : app.name, uses, document, sharedWith: await context.sharedCount(place.workspaceId, app.id) },
            apps,
            themes: await names('themes'),
            datasets,
            models,
            modules,
            components: await names('components'),
            patterns: await names('patterns'),
            connections,
            ownerNames,
            appNames,
            manages: place.manages,
            // Their own persona only, never another person's. Magnetic gives each person the default persona, whose state
            // it keeps under their id
            persona: { name: DEFAULT_PERSONA, owner: place.workspaceId, apps: await context.personaApps(place.workspaceId, place.user.id) },
            // The functions this server runs: the host's and the component library's, shown as hard IP
            functions: place.services.functions
        });
        return { revision: app.revision, manages: place.manages, app: app.name, ...built };
    }

    /** A binding name for a dataset: its name in camel case, made free among the app's bindings */
    function bindingFor(dataset: string, taken: JsonRecord): string {
        const stem = dataset.replace(/-([a-z0-9])/g, (_whole, letter: string) => letter.toUpperCase());
        let name = stem;
        for (let index = 2; Object.hasOwn(taken, name); index++) name = `${stem}${index}`;
        return name;
    }

    /** The app's `uses` with one more data binding or logic module, written through `ui_app_configure` */
    async function useInApp(place: ViewPlace, change: (uses: JsonRecord) => JsonRecord): Promise<void> {
        const app = await appNow(place);
        await call(place.services, 'ui_app_configure', { name: app.name, expectedRevision: app.revision, uses: change(usesOf(app)) });
    }

    /**
     * What a + of the tree makes, through the person's tools, and puts to use in the app: a dataset with its first
     * record (bound in the app), a model with its first field, a logic module (used by the app), a binding of a dataset
     * the owner has, or the app's use of a part it does not use yet
     */
    async function addPart(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        const what = typeof body['what'] === 'string' ? body['what'] : '';
        const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
        const named = (words: string): void => {
            if (!NAME.test(name)) throw new Refused(400, `A ${words} name is lower case letters, digits and dashes, starting with a letter.`);
        };
        switch (what) {
            case 'dataset': {
                named('dataset');
                const model = typeof body['model'] === 'string' ? body['model'] : '';
                const record = isRecord(body['record']) ? body['record'] : {};
                if ((await place.services.parts.findByName('data', name)) !== undefined) throw new Refused(409, 'A dataset with that name exists.');
                await call(place.services, 'ui_data_write', { dataset: name, model, operations: [{ op: 'add', value: record }] });
                await useInApp(place, (uses) => {
                    const data = isRecord(uses['data']) ? uses['data'] : {};
                    return { ...uses, data: { ...data, [bindingFor(name, data)]: { dataset: name } } };
                });
                return { path: `$.data.${name}` };
            }
            case 'model': {
                named('model');
                const field = typeof body['field'] === 'string' ? body['field'].trim() : '';
                const type = typeof body['type'] === 'string' ? body['type'] : 'string';
                if (field === '') throw new Refused(400, 'A model starts with a field: give it a name.');
                if ((await place.services.parts.findByName('models', name)) !== undefined) throw new Refused(409, 'A model with that name exists.');
                await call(place.services, 'ui_model_write', { model: name, operations: [{ op: 'set', field, type }] });
                return { path: `$.models.${name}` };
            }
            case 'module': {
                named('module');
                if ((await place.services.parts.findByName('logic', name)) !== undefined) throw new Refused(409, 'A logic module with that name exists.');
                // A module works on the data it needs: one of the app's dataset bindings, by the same name, with its model
                const need = typeof body['need'] === 'string' ? body['need'] : '';
                const use = usesOf(await appNow(place))['data'];
                const bound = isRecord(use) && isRecord(use[need]) ? use[need] : undefined;
                const dataset = bound !== undefined && typeof bound['dataset'] === 'string' ? await place.services.parts.findByName('data', bound['dataset']) : undefined;
                const model = dataset === undefined ? undefined : (dataset.body as unknown as JsonRecord)['model'];
                if (typeof model !== 'string') throw new Refused(400, 'A module works on a dataset the app binds: name one of its bindings.');
                await call(place.services, 'ui_logic_write', { module: name, needs: { [need]: { model } }, params: {}, operations: [] });
                await useInApp(place, (uses) => ({ ...uses, logic: { ...(isRecord(uses['logic']) ? uses['logic'] : {}), [name]: {} } }));
                return { path: `$.logic.${name}` };
            }
            case 'binding': {
                // A dataset the owner has, bound in the app; a module of the owner, used by it
                const dataset = typeof body['dataset'] === 'string' ? body['dataset'] : '';
                if ((await place.services.parts.findByName('data', dataset)) === undefined) throw new Refused(404, 'No dataset with that name.');
                let binding = '';
                await useInApp(place, (uses) => {
                    const data = isRecord(uses['data']) ? uses['data'] : {};
                    binding = typeof body['binding'] === 'string' && body['binding'] !== '' ? body['binding'] : bindingFor(dataset, data);
                    if (Object.hasOwn(data, binding)) throw new Refused(409, `The app already has a binding named ${binding}.`);
                    return { ...uses, data: { ...data, [binding]: { dataset } } };
                });
                return { path: `$.data.${binding}` };
            }
            case 'useModule': {
                if ((await place.services.parts.findByName('logic', name)) === undefined) throw new Refused(404, 'No logic module with that name.');
                await useInApp(place, (uses) => ({ ...uses, logic: { ...(isRecord(uses['logic']) ? uses['logic'] : {}), [name]: {} } }));
                return { path: `$.logic.${name}` };
            }
            default:
                throw new Refused(400, 'Say dataset, model, module, binding or useModule.');
        }
    }

    /** A connection as its editor shows it: whether its secrets are set, never what they are */
    async function connectionInfo(place: ViewPlace, name: string): Promise<JsonRecord> {
        const connection = (await context.connections.list(place.workspaceId)).find((each) => each.name === name);
        if (connection === undefined) throw new Refused(404, 'No such connection.');
        const auth: JsonRecord = { ...connection.auth };
        return {
            id: connection.id,
            name: connection.name,
            baseUrl: connection.baseUrl,
            auth,
            keySet: connection.keySet,
            clientSecretSet: connection.clientSecretSet,
            connected: connection.connected,
            endpoints: connection.endpoints.map((endpoint) => ({ name: endpoint.name, method: endpoint.method, path: endpoint.path, query: endpoint.query ?? {}, ...(endpoint.body !== undefined && { body: endpoint.body }), records: endpoint.records ?? '' })),
            manages: place.manages
        };
    }

    async function part(place: ViewPlace, kind: string, name: string): Promise<JsonRecord> {
        if (kind === 'connections') return connectionInfo(place, name);
        if (kind === 'logic') {
            const found = await place.services.parts.findByName('logic', name);
            if (found === undefined) throw new Refused(404, `No logic module named ${name}.`);
            return { kind, name, revision: found.revision, body: found.body };
        }
        if (kind !== 'data' && kind !== 'models') throw new Refused(400, 'Say data, models, logic or connections.');
        const found = await place.services.parts.findByName(kind, name);
        if (found === undefined) throw new Refused(404, `No ${kind === 'data' ? 'dataset' : 'model'} named ${name}.`);
        const body = found.body as unknown as JsonRecord;
        if (kind === 'models') return { kind, name, revision: found.revision, fields: isRecord(body['fields']) ? body['fields'] : {} };
        const records = isRecord(body['records']) ? body['records'] : {};
        const model = typeof body['model'] === 'string' ? body['model'] : undefined;
        const modelPart = model === undefined ? undefined : await place.services.parts.findByName('models', model);
        const keys = Object.keys(records);
        return {
            kind,
            name,
            revision: found.revision,
            ...(model !== undefined && { model }),
            fields: modelPart !== undefined && isRecord((modelPart.body as unknown as JsonRecord)['fields']) ? (modelPart.body as unknown as JsonRecord)['fields'] : {},
            records: Object.fromEntries(keys.slice(0, MOST_RECORDS).map((key) => [key, records[key]])),
            count: keys.length
        };
    }

    async function theme(place: ViewPlace, wanted: string | null): Promise<JsonRecord> {
        const app = await appNow(place);
        const themes = themesOf(app);
        const readers = await themeReaders(place);
        const workspaceThemes = (await place.services.parts.list('themes')).map((summary) => summary.name);
        const name = wanted !== null && themes.includes(wanted) ? wanted : themes[0];
        const base = { appRevision: app.revision, themes: themes.map((each, index) => ({ name: each, isDefault: index === 0, usedBy: readers.get(each) ?? [] })), workspaceThemes, presets: PRESETS };
        if (name === undefined) return { ...base, theme: null };
        const found = await place.services.parts.findByName('themes', name);
        if (found === undefined) return { ...base, theme: null };
        const body = found.body as unknown as ThemeBody;
        const { modes, tokens } = themeTokensOf(body);
        const overlays = Object.fromEntries(Object.entries(body.overlays ?? {}).map(([overlay, value]) => [overlay, { kind: value.kind }]));
        return { ...base, theme: name, revision: found.revision, usedBy: readers.get(name) ?? [], modes, overlays, tokens };
    }

    async function changeTheme(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        const app = await appNow(place);
        const themes = themesOf(app);
        const action = typeof body['action'] === 'string' ? body['action'] : 'write';
        const name = typeof body['theme'] === 'string' ? body['theme'] : '';
        const configure = (next: string[]): Promise<JsonRecord> => call(place.services, 'ui_app_configure', { name: app.name, expectedRevision: app.revision, uses: { ...usesOf(app), themes: next } });
        switch (action) {
            case 'write': {
                const operations = Array.isArray(body['operations']) ? body['operations'] : [];
                if (!themes.includes(name)) throw new Refused(404, 'The app does not use that theme.');
                if (operations.length === 0) throw new Refused(400, 'Send the operations to make.');
                const written = await call(place.services, 'ui_theme_write', { theme: name, expectedRevision: typeof body['revision'] === 'number' ? body['revision'] : undefined, operations });
                return { revision: written['revision'], contrast: written['contrast'] ?? [], warnings: written['warnings'] ?? [] };
            }
            case 'clone': {
                // The app gets its own copy: the clone takes the theme's place in the app's list
                const to = typeof body['to'] === 'string' ? body['to'] : '';
                if (!NAME.test(to)) throw new Refused(400, 'A theme name is lower case letters, digits and dashes, starting with a letter.');
                if (!themes.includes(name)) throw new Refused(404, 'The app does not use that theme.');
                await call(place.services, 'ui_theme_create', { name: to, from: name });
                await configure(themes.map((each) => (each === name ? to : each)));
                return { theme: to };
            }
            case 'create': {
                const preset = typeof body['preset'] === 'string' && PRESETS.includes(body['preset']) ? body['preset'] : 'clean';
                if (!NAME.test(name)) throw new Refused(400, 'A theme name is lower case letters, digits and dashes, starting with a letter.');
                await call(place.services, 'ui_theme_create', { name, preset });
                await configure([...themes, name]);
                return { theme: name };
            }
            case 'add':
                if (themes.includes(name)) return { theme: name };
                if ((await place.services.parts.findByName('themes', name)) === undefined) throw new Refused(404, 'No theme with that name.');
                await configure([...themes, name]);
                return { theme: name };
            case 'default':
                if (!themes.includes(name)) throw new Refused(404, 'The app does not use that theme.');
                await configure([name, ...themes.filter((each) => each !== name)]);
                return { theme: name };
            case 'remove':
                if (!themes.includes(name)) throw new Refused(404, 'The app does not use that theme.');
                await configure(themes.filter((each) => each !== name));
                return { theme: themes.find((each) => each !== name) ?? null };
            default:
                throw new Refused(400, 'Say write, clone, create, add, default or remove.');
        }
    }

    async function logic(place: ViewPlace): Promise<JsonRecord> {
        const app = await appNow(place);
        const document = await documentOf(place);
        const own = isRecord((app.body as unknown as JsonRecord)['logic']) ? ((app.body as unknown as JsonRecord)['logic'] as JsonRecord) : {};
        const assembled = isRecord(document['logic']) ? document['logic'] : {};
        const units = unitsOf(document).map((unit) => {
            const records = assembled[unit.group];
            return { ...unit, value: isRecord(records) ? (records[unit.name] ?? null) : null, own: isRecord(own[unit.group]) && unit.name in (own[unit.group] as JsonRecord) };
        });
        // Units the run order leaves out (an invalid one is not run) are still the app's to edit
        for (const [group, records] of Object.entries(own)) {
            if (!isRecord(records)) continue;
            for (const [name, value] of Object.entries(records)) {
                if (units.some((unit) => unit.group === group && unit.name === name)) continue;
                units.push({ kind: group.replace(/s$/, ''), group, name, reads: [], writes: [], runs: isRecord(value) && value['runs'] === 'browser' ? 'browser' : 'server', value: value as JsonRecord, own: true });
            }
        }
        const screens = isRecord(document['screens']) ? Object.keys(document['screens']) : [];
        const handlers = screens.flatMap((screen) => (screenInfoOf(document, screen)?.handlers ?? []).map((handler) => ({ screen, ...handler })));
        const connections = (await context.connections.list(place.workspaceId)).map((connection) => ({ name: connection.name, endpoints: connection.endpoints.map((endpoint) => endpoint.name) }));
        return { revision: app.revision, units, handlers, screens, connections };
    }

    async function changeLogic(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        const app = await appNow(place);
        const unit = typeof body['unit'] === 'string' ? body['unit'] : '';
        if (!/^(machines|rules|tables|computes|effects)\.[A-Za-z_][\w-]*$/.test(unit)) throw new Refused(400, 'Name the unit as machines, rules, tables, computes or effects, a dot and its name.');
        const operation = body['remove'] === true ? { op: 'remove', unit } : { op: 'set', unit, value: body['value'] };
        if (operation.op === 'set' && !isRecord(body['value'])) throw new Refused(400, 'A unit is an object.');
        if (typeof body['module'] === 'string') {
            // A unit of a logic module: the module's own revision, which a new module's first write leaves out
            const written = await call(place.services, 'ui_logic_write', { module: body['module'], ...(typeof body['revision'] === 'number' && { expectedRevision: body['revision'] }), operations: [operation] });
            return { revision: written['revision'], units: written['units'] ?? [], warnings: written['warnings'] ?? [] };
        }
        const written = await call(place.services, 'ui_logic_write', { app: app.name, expectedRevision: typeof body['revision'] === 'number' ? body['revision'] : app.revision, operations: [operation] });
        return { revision: written['revision'], units: written['units'] ?? [], warnings: written['warnings'] ?? [] };
    }

    async function changeData(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        const operations = Array.isArray(body['operations']) ? body['operations'] : [];
        const revision = typeof body['revision'] === 'number' ? body['revision'] : undefined;
        if (operations.length === 0) throw new Refused(400, 'Send the operations to make.');
        if (typeof body['dataset'] === 'string') {
            const written = await call(place.services, 'ui_data_write', { dataset: body['dataset'], ...(revision !== undefined && { expectedRevision: revision }), operations });
            return { revision: written['revision'] };
        }
        if (typeof body['model'] === 'string') {
            const written = await call(place.services, 'ui_model_write', { model: body['model'], ...(revision !== undefined && { expectedRevision: revision }), operations });
            return { revision: written['revision'], readers: written['readers'] ?? [] };
        }
        throw new Refused(400, 'Name a dataset or a model.');
    }

    async function changeState(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        const path = typeof body['path'] === 'string' ? body['path'] : '';
        if (!/^\$\.data\.[A-Za-z_][\w-]*/.test(path)) throw new Refused(400, 'Only paths under $.data are changed here.');
        const written = await call(place.services, 'ui_state_set', { app: place.app.name, path, ...(body['remove'] === true ? { remove: true } : { value: body['value'] }) });
        return { revision: written['revision'] ?? null };
    }

    /** A connection change from the graph, in the Connections page's terms, for those who manage the workspace's connections */
    async function changeConnection(place: ViewPlace, body: JsonRecord): Promise<JsonRecord> {
        if (!place.manages) throw new Refused(403, 'You do not manage the connections of this workspace.');
        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
            if (value === undefined || value === null) continue;
            form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        form.set('w', place.workspaceId);
        try {
            const outcome = await context.changeConnection(place.user, form);
            if (outcome.continueTo !== undefined) return { continueTo: outcome.continueTo };
            return outcome.tried === undefined ? { done: true } : { tried: { status: outcome.tried.status, body: outcome.tried.body } };
        } catch (error) {
            if (error instanceof CallRefused) throw new Refused(400, error.message);
            throw error;
        }
    }

    /** Answers `/views/<what>`; true when it was one */
    return async (request: IncomingMessage, response: ServerResponse, method: string, what: string, place: ViewPlace): Promise<boolean> => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const body = async (): Promise<JsonRecord> => {
            const read = await context.readJson(request);
            return isRecord(read) ? read : {};
        };
        try {
            let answer: unknown;
            const key = `${method} ${what}`;
            switch (key) {
                case 'GET screen': {
                    const info = screenInfoOf(await documentOf(place), url.searchParams.get('screen') ?? '');
                    if (info === undefined) throw new Refused(404, 'No such screen.');
                    answer = { revision: place.app.revision, ...info };
                    break;
                }
                case 'GET graph':
                    answer = await graph(place);
                    break;
                case 'GET part':
                    answer = await part(place, url.searchParams.get('kind') ?? '', url.searchParams.get('name') ?? '');
                    break;
                case 'GET state': {
                    const path = url.searchParams.get('path') ?? '$.data';
                    if (!path.startsWith('$.data') && !path.startsWith('$.external')) throw new Refused(400, 'Only $.data and $.external are read here.');
                    const read = await call(place.services, 'ui_state_get', { app: place.app.name, path, full: true });
                    answer = { path, value: read['value'] ?? null };
                    break;
                }
                case 'POST state':
                    answer = await changeState(place, await body());
                    break;
                case 'POST data':
                    answer = await changeData(place, await body());
                    break;
                case 'POST add':
                    answer = await addPart(place, await body());
                    break;
                case 'POST connections':
                    answer = await changeConnection(place, await body());
                    break;
                case 'GET theme':
                    answer = await theme(place, url.searchParams.get('theme'));
                    break;
                case 'POST theme':
                    answer = await changeTheme(place, await body());
                    break;
                case 'GET logic':
                    answer = await logic(place);
                    break;
                case 'POST logic':
                    answer = await changeLogic(place, await body());
                    break;
                case 'GET kept': {
                    const view = url.searchParams.get('view');
                    if (!isKeptView(view)) throw new Refused(400, 'No such view.');
                    answer = { place: (await context.kept.of(place.user.id, place.app.id, view)) ?? null };
                    break;
                }
                case 'POST kept': {
                    const read = await body();
                    const kept = keptPlaceOf(read['place']);
                    if (!isKeptView(read['view']) || kept === undefined) throw new Refused(400, 'A view and a place { x, y, zoom } are needed.');
                    await context.kept.keep(place.user.id, place.app.id, read['view'], kept);
                    context.sendJson(response, 200, { kept: true });
                    return true;
                }
                default:
                    return false;
            }
            if (method === 'POST') context.report('Editor view changed', { app: place.app.id, view: what });
            context.sendJson(response, 200, answer);
        } catch (error) {
            if (!(error instanceof Refused)) throw error;
            context.sendJson(response, error.status, { message: error.message, errors: error.errors });
        }
        return true;
    };
}
