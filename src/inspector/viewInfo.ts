import { buildOverlayCatalog, composeOverlays, DEFAULT_TOKENS, flattenTokens, mergeOverDefaults, mergeTokenTrees, OVERLAY_KINDS, SHIPPED_OVERLAYS, tokenTypeOf } from '@punyts/stateui-app/core';
import type { JsonObject, ThemeSource } from '@punyts/stateui-app/core';
import { logicRunOrder } from '@punyts/stateui-mcp';
import type { LogicDocument } from '@punyts/stateui-mcp';

/**
 * What the editor's views show of an app, read from its assembled document and its parts, never from the frame: a
 * screen's layout tree, the state and outside data it uses, its handlers and where it leads (the Screens view's
 * layers); the app's statenet as a graph (Statenet); its logic units and where each runs (Logic); and its theme's token
 * values in each mode (Theme). See docs/design/magnetic-show-views.md.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys of a node that hold nodes of its own besides `children`: its slots */
function slotsOf(node: JsonRecord): [string, JsonRecord][] {
    return Object.entries(node).filter((entry): entry is [string, JsonRecord] => entry[0] !== 'children' && isRecord(entry[1]) && typeof entry[1]['component'] === 'string');
}

function childrenOf(node: JsonRecord): [string, JsonRecord][] {
    const children = isRecord(node['children']) ? node['children'] : {};
    return Object.entries(children).filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]) && typeof entry[1]['component'] === 'string');
}

/** The root node of a screen of the assembled document */
function screenRoot(document: JsonRecord, screen: string): JsonRecord | undefined {
    const screens = isRecord(document['screens']) ? document['screens'] : {};
    const entry = screens[screen];
    return isRecord(entry) && isRecord(entry['root']) ? entry['root'] : undefined;
}

/** Each node of a tree with its runtime path, the root first */
function walkNodes(root: JsonRecord, path: string, visit: (node: JsonRecord, path: string) => void): void {
    visit(root, path);
    for (const [key, child] of childrenOf(root)) walkNodes(child, `${path}.children.${key}`, visit);
    for (const [key, slot] of slotsOf(root)) walkNodes(slot, `${path}.${key}`, visit);
}

// ---- Layout --------------------------------------------------------------------------------------------------------

/** One part of a screen's layout: a node that lays out others (named), or one that lays out nothing (a leaf) */
export interface LayoutBox {
    readonly path: string;
    /** The node's key in its parent, or the screen's name for its root */
    readonly key: string;
    readonly component: string;
    /** Its layout type, `column` when it has children and no layout; null for a leaf */
    readonly layout: string | null;
    /** The layout's settings in words, such as "gap md · align center" */
    readonly note: string;
    readonly children: readonly LayoutBox[];
}

/** The settings of a layout in a few words, `type` left out */
function layoutNote(layout: unknown): string {
    if (!isRecord(layout)) return '';
    return Object.entries(layout)
        .filter(([name]) => name !== 'type')
        .map(([name, value]) => (value === true ? name : `${name} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`))
        .join(' · ');
}

function boxOf(node: JsonRecord, path: string, key: string, depth: number): LayoutBox {
    const layout = node['layout'];
    const children = [...childrenOf(node).map(([childKey, child]) => ({ child, path: `${path}.children.${childKey}`, key: childKey })), ...slotsOf(node).map(([slot, child]) => ({ child, path: `${path}.${slot}`, key: slot }))];
    const type = isRecord(layout) && typeof layout['type'] === 'string' ? layout['type'] : children.length > 0 ? 'column' : null;
    return {
        path,
        key,
        component: String(node['component']),
        layout: type,
        note: layoutNote(layout),
        // A tree is bounded: a screen is never deeper than this in practice, and the schematic stays drawable
        children: depth >= 24 ? [] : children.map((entry) => boxOf(entry.child, entry.path, entry.key, depth + 1))
    };
}

/** A screen's layout as nested boxes, its root first; undefined when there is no such screen */
export function layoutOf(document: JsonRecord, screen: string): LayoutBox | undefined {
    const root = screenRoot(document, screen);
    return root === undefined ? undefined : boxOf(root, `$.screens.${screen}`, screen, 0);
}

// ---- A screen's data and logic -------------------------------------------------------------------------------------

/** A state path a screen uses: read by a link, written by a two-way link or a handler; outside when it is `$.external` */
export interface ScreenPath {
    readonly path: string;
    reads: boolean;
    writes: boolean;
    readonly outside: boolean;
    /** The nodes that use it, by path */
    readonly nodes: string[];
}

/** A node's handler of one event: the commands it runs, in the browser */
export interface Handler {
    readonly node: string;
    readonly event: string;
    readonly commands: readonly JsonRecord[];
}

/** A move from a node's handler or a logic unit to another screen */
export interface Navigate {
    /** A node path, or `logic:<group>.<name>` */
    readonly from: string;
    readonly to: string;
}

/** Where a unit of the app's logic runs: on the app's server (its authority), or in the browser of each person */
export type Runs = 'server' | 'browser';

/** One unit of the app's logic: its kind, group, name, place in the run order, the paths it reads and writes, and where it runs */
export interface UnitInfo {
    readonly kind: string;
    readonly group: string;
    readonly name: string;
    readonly position?: number;
    readonly reads: readonly string[];
    readonly writes: readonly string[];
    readonly runs: Runs;
    /** The module it comes from (`module:unit` names), when it is not the app's own */
    readonly module?: string;
}

export interface ScreenInfo {
    readonly screen: string;
    readonly layout: LayoutBox;
    readonly paths: readonly ScreenPath[];
    readonly handlers: readonly Handler[];
    readonly navigates: readonly Navigate[];
    /** The app's units that read or write a path the screen uses */
    readonly units: readonly UnitInfo[];
}

const GROUP_OF: Record<string, string> = { machine: 'machines', rule: 'rules', guard: 'rules', table: 'tables', compute: 'computes', effect: 'effects' };

/** The commands of a handler entry: one command or a list */
function commandsOf(entry: unknown): JsonRecord[] {
    return (Array.isArray(entry) ? entry : [entry]).filter(isRecord);
}

/** Every command in a value, however deep (a machine's transitions, a rule's `do`, a handler) */
function commandsIn(value: unknown, found: JsonRecord[] = []): JsonRecord[] {
    if (Array.isArray(value)) for (const item of value) commandsIn(item, found);
    else if (isRecord(value)) {
        if (typeof value['command'] === 'string') found.push(value);
        for (const inner of Object.values(value)) if (typeof inner === 'object') commandsIn(inner, found);
    }
    return found;
}

/** A path as far as a dataset or a value of `$.data`, `$.external` or `$.app`: `$.data.tasks.r1.done` is `$.data.tasks` */
export function rootOf(path: string): string {
    return path.split('.').slice(0, 3).join('.');
}

/** Whether two paths, which may hold `*` and `{name}` segments, meet: one is the other or lies under it */
function meets(a: string, b: string): boolean {
    const left = a.split('.');
    const right = b.split('.');
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const x = left[index] as string;
        const y = right[index] as string;
        if (x === y || x === '*' || y === '*' || /^\{.*\}$/.test(x) || /^\{.*\}$/.test(y)) continue;
        return false;
    }
    return true;
}

/** The app's logic units in run order, with where each runs and the module it comes from */
export function unitsOf(document: JsonRecord): UnitInfo[] {
    const logic = document['logic'];
    if (!isRecord(logic)) return [];
    let places: ReturnType<typeof logicRunOrder>;
    try {
        places = logicRunOrder(logic as unknown as LogicDocument);
    } catch {
        return [];
    }
    return places.map((place) => {
        const group = GROUP_OF[place.kind] ?? `${place.kind}s`;
        const records = logic[group];
        const unit = isRecord(records) ? records[place.name] : undefined;
        const colon = place.name.indexOf(':');
        return {
            kind: place.kind,
            group,
            name: place.name,
            ...(place.position !== undefined && { position: place.position }),
            reads: place.reads,
            writes: place.writes,
            runs: isRecord(unit) && unit['runs'] === 'browser' ? 'browser' : 'server',
            ...(colon > 0 && { module: place.name.slice(0, colon) })
        };
    });
}

/** The screens each `navigate` of the app's logic leads to, by unit */
function logicNavigates(document: JsonRecord): Navigate[] {
    const logic = document['logic'];
    if (!isRecord(logic)) return [];
    const found: Navigate[] = [];
    for (const [group, records] of Object.entries(logic)) {
        if (!isRecord(records)) continue;
        for (const [name, unit] of Object.entries(records)) {
            for (const command of commandsIn(unit)) {
                if (command['command'] === 'navigate' && typeof command['target'] === 'string') found.push({ from: `logic:${group}.${name}`, to: command['target'] });
            }
        }
    }
    return found;
}

/**
 * What a screen uses and does: its layout, the state paths its nodes link to and its handlers write (each with the
 * nodes that use it), its handlers, the screens it leads to (from its handlers, and from the app's units that read or
 * write its paths), and those units. Undefined when there is no such screen
 */
export function screenInfoOf(document: JsonRecord, screen: string): ScreenInfo | undefined {
    const root = screenRoot(document, screen);
    if (root === undefined) return undefined;
    const paths = new Map<string, ScreenPath>();
    const use = (path: string, node: string, how: 'reads' | 'writes'): void => {
        if (!/^\$\.(data|external|app)\./.test(path)) return;
        const key = rootOf(path);
        const entry = paths.get(key) ?? { path: key, reads: false, writes: false, outside: key.startsWith('$.external.'), nodes: [] };
        entry[how] = true;
        if (!entry.nodes.includes(node)) entry.nodes.push(node);
        paths.set(key, entry);
    };
    const handlers: Handler[] = [];
    const navigates: Navigate[] = [];
    walkNodes(root, `$.screens.${screen}`, (node, path) => {
        for (const [key, value] of Object.entries(node)) {
            if (typeof value !== 'string') continue;
            if (key.startsWith('<->')) {
                use(value, path, 'reads');
                use(value, path, 'writes');
            } else if (key.startsWith('<-')) use(value, path, 'reads');
        }
        const on = node['on'];
        if (!isRecord(on)) return;
        for (const [event, entry] of Object.entries(on)) {
            const commands = commandsOf(entry);
            handlers.push({ node: path, event, commands });
            for (const command of commands) {
                if (command['command'] === 'navigate' && typeof command['target'] === 'string') navigates.push({ from: path, to: command['target'] });
                else if (typeof command['target'] === 'string') use(command['target'], path, 'writes');
                if (typeof command['from'] === 'string') use(command['from'], path, 'reads');
            }
        }
    });
    const used = [...paths.keys()];
    const units = unitsOf(document).filter((unit) => [...unit.reads, ...unit.writes].some((path) => used.some((mine) => meets(path, mine))));
    const touching = new Set(units.map((unit) => `logic:${unit.group}.${unit.name}`));
    navigates.push(...logicNavigates(document).filter((navigate) => touching.has(navigate.from)));
    return { screen, layout: boxOf(root, `$.screens.${screen}`, screen, 0), paths: [...paths.values()], handlers, navigates, units };
}

// ---- The statenet graph --------------------------------------------------------------------------------------------

/** The kinds of node of the Statenet view */
export type GraphKind = 'app' | 'state' | 'server' | 'dataset' | 'persona' | 'model' | 'theme' | 'module' | 'component' | 'connection' | 'endpoint' | 'shared' | 'otherApp';

export interface GraphNode {
    readonly id: string;
    readonly kind: GraphKind;
    readonly label: string;
    /**
     * Data, never words (the view writes those in the person's language): a dataset's binding path, a persona's model,
     * a shared dataset's owner, another app's path, a connection's host, an endpoint's method and path (or, missing,
     * its connection)
     */
    readonly note: string;
    /** The app: how many links share it */
    readonly count?: number;
    /** A theme: the app's default */
    readonly isDefault?: boolean;
    /** An endpoint the logic calls that its connection does not have */
    readonly missing?: boolean;
    /** 0 outside sources, 1 datasets, models and parts, 2 the app, 3 its own state */
    readonly column: 0 | 1 | 2 | 3;
    /** Drawn as outside the app: dashed, with its icon */
    readonly outside: boolean;
    /** False for a connection of the workspace the app does not call: drawn dimmed */
    readonly used: boolean;
}

export interface GraphEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: 'binding' | 'read' | 'call' | 'model' | 'uses';
    readonly label?: string;
}

/** A connection of the workspace as the graph sees it: never a secret, only whether one is set */
export interface GraphConnection {
    readonly name: string;
    readonly host: string;
    readonly endpoints: readonly { readonly name: string; readonly method: string; readonly path: string }[];
}

export interface GraphInput {
    readonly appName: string;
    /** The app part's `uses` */
    readonly uses: JsonRecord;
    /** The assembled document: its `data`, `logic` and `composed` */
    readonly document: JsonRecord;
    readonly connections: readonly GraphConnection[];
    /** The model of each dataset the app binds, by dataset name */
    readonly datasetModels: Readonly<Record<string, string | undefined>>;
    /** The name of each workspace that shares a dataset, by its id */
    readonly ownerNames: Readonly<Record<string, string>>;
    /** The name of each other app the app reads, by its id */
    readonly appNames: Readonly<Record<string, string>>;
    /** The people the app is shared with: links and grants */
    readonly sharedWith: number;
}

/** The value at a `$.data…` path of the document's starting data */
function dataAt(document: JsonRecord, path: string): unknown {
    if (!path.startsWith('$.data.')) return undefined;
    let value: unknown = document['data'];
    for (const key of path.split('.').slice(2)) value = isRecord(value) ? value[key] : undefined;
    return value;
}

/**
 * The connection and endpoint each `http` effect of the app's logic calls. An effect's request is a state path; what it
 * calls is in the request written there: by a command of a handler or a unit (`set` with a value naming the connection
 * and endpoint), or in the app's starting data
 */
export function callsOf(document: JsonRecord): { effect: string; connection: string; endpoint: string }[] {
    const logic = document['logic'];
    const effects = isRecord(logic) && isRecord(logic['effects']) ? logic['effects'] : {};
    const commands = commandsIn([document['screens'], logic]);
    const found: { effect: string; connection: string; endpoint: string }[] = [];
    for (const [name, effect] of Object.entries(effects)) {
        if (!isRecord(effect) || effect['run'] !== 'http' || typeof effect['request'] !== 'string') continue;
        const request = effect['request'];
        const values = [dataAt(document, request), ...commands.filter((command) => command['target'] === request).map((command) => command['value'])];
        const seen = new Set<string>();
        for (const value of values) {
            if (!isRecord(value) || typeof value['connection'] !== 'string' || typeof value['endpoint'] !== 'string') continue;
            const key = `${value['connection']}/${value['endpoint']}`;
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ effect: name, connection: value['connection'], endpoint: value['endpoint'] });
        }
    }
    return found;
}

/**
 * The app's statenet: every part it starts from (themes, datasets and their models, persona models, logic modules,
 * composed components), what it reads from outside (shared datasets, other apps' state, the connections its effects
 * call, with their endpoints), its own state (`$.data` keys no binding holds, `$.app`, `$.server`), and the edges
 * between them. Only what exists: no relay or peer is drawn
 */
export function graphOf(input: GraphInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const add = (node: GraphNode): void => {
        if (!nodes.has(node.id)) nodes.set(node.id, node);
    };
    const app = 'app';
    add({ id: app, kind: 'app', label: input.appName, note: '', column: 2, outside: false, used: true, count: input.sharedWith });

    const uses = input.uses;
    const themes = Array.isArray(uses['themes']) ? uses['themes'].filter((name): name is string => typeof name === 'string') : [];
    themes.forEach((theme, index) => {
        add({ id: `theme:${theme}`, kind: 'theme', label: theme, note: '', column: 1, outside: false, used: true, isDefault: index === 0 });
        edges.push({ from: `theme:${theme}`, to: app, kind: 'uses' });
    });

    const bound = new Set<string>();
    const data = isRecord(uses['data']) ? uses['data'] : {};
    for (const [binding, use] of Object.entries(data)) {
        if (!isRecord(use)) continue;
        bound.add(binding);
        if (typeof use['dataset'] === 'string') {
            const dataset = use['dataset'];
            add({ id: `dataset:${dataset}`, kind: 'dataset', label: dataset, note: `$.data.${binding}`, column: 1, outside: false, used: true });
            edges.push({ from: `dataset:${dataset}`, to: app, kind: 'binding', label: `$.data.${binding}` });
            const model = input.datasetModels[dataset];
            if (model !== undefined) {
                add({ id: `model:${model}`, kind: 'model', label: model, note: '', column: 1, outside: false, used: true });
                edges.push({ from: `model:${model}`, to: `dataset:${dataset}`, kind: 'model' });
            }
        } else if (typeof use['model'] === 'string') {
            const model = use['model'];
            add({ id: `persona:${binding}`, kind: 'persona', label: binding, note: model, column: 1, outside: false, used: true });
            edges.push({ from: `persona:${binding}`, to: app, kind: 'binding', label: `$.data.${binding}` });
            add({ id: `model:${model}`, kind: 'model', label: model, note: '', column: 1, outside: false, used: true });
            edges.push({ from: `model:${model}`, to: `persona:${binding}`, kind: 'model' });
        }
    }

    const modules = isRecord(uses['logic']) ? Object.keys(uses['logic']) : [];
    for (const module of modules) {
        add({ id: `module:${module}`, kind: 'module', label: module, note: '', column: 1, outside: false, used: true });
        edges.push({ from: `module:${module}`, to: app, kind: 'uses' });
    }

    const composed = isRecord(input.document['composed']) ? Object.keys(input.document['composed']) : [];
    for (const component of composed) {
        add({ id: `component:${component}`, kind: 'component', label: component, note: '', column: 1, outside: false, used: true });
        edges.push({ from: `component:${component}`, to: app, kind: 'uses' });
    }

    const external = isRecord(uses['external']) ? uses['external'] : {};
    for (const [alias, use] of Object.entries(external)) {
        if (!isRecord(use)) continue;
        if (typeof use['owner'] === 'string' && typeof use['dataset'] === 'string') {
            const id = `shared:${use['owner']}/${use['dataset']}`;
            add({ id, kind: 'shared', label: use['dataset'], note: input.ownerNames[use['owner']] ?? '', column: 0, outside: true, used: true });
            edges.push({ from: id, to: app, kind: 'read', label: `$.external.${alias}` });
        } else if (typeof use['app'] === 'string') {
            const id = `otherApp:${use['app']}`;
            add({ id, kind: 'otherApp', label: input.appNames[use['app']] ?? use['app'], note: typeof use['path'] === 'string' ? use['path'] : '$.data', column: 0, outside: true, used: true });
            edges.push({ from: id, to: app, kind: 'read', label: `$.external.${alias}` });
        }
    }

    const calls = callsOf(input.document);
    const called = new Set(calls.map((call) => call.connection));
    for (const connection of input.connections) {
        const used = called.has(connection.name);
        add({ id: `connection:${connection.name}`, kind: 'connection', label: connection.name, note: connection.host, column: 0, outside: true, used });
        for (const endpoint of connection.endpoints) {
            const id = `endpoint:${connection.name}/${endpoint.name}`;
            add({ id, kind: 'endpoint', label: endpoint.name, note: `${endpoint.method} ${endpoint.path}`, column: 0, outside: true, used });
            edges.push({ from: `connection:${connection.name}`, to: id, kind: 'uses' });
        }
    }
    for (const call of calls) {
        const id = `endpoint:${call.connection}/${call.endpoint}`;
        if (!nodes.has(id)) add({ id, kind: 'endpoint', label: call.endpoint, note: call.connection, column: 0, outside: true, used: true, missing: true });
        edges.push({ from: app, to: id, kind: 'call', label: call.effect });
    }

    const state = isRecord(input.document['data']) ? Object.keys(input.document['data']) : [];
    for (const key of state) {
        if (bound.has(key)) continue;
        add({ id: `state:$.data.${key}`, kind: 'state', label: `$.data.${key}`, note: '', column: 3, outside: false, used: true });
        edges.push({ from: app, to: `state:$.data.${key}`, kind: 'binding' });
    }
    if (unitsOf(input.document).some((unit) => [...unit.reads, ...unit.writes].some((path) => path.startsWith('$.server')))) {
        add({ id: 'server:$.server', kind: 'server', label: '$.server', note: '', column: 3, outside: false, used: true });
        edges.push({ from: app, to: 'server:$.server', kind: 'binding' });
    }
    return { nodes: [...nodes.values()], edges };
}

// ---- Theme ---------------------------------------------------------------------------------------------------------

/** A theme part's body: its base tokens and its named overlays */
export interface ThemeBody {
    readonly tokens?: JsonRecord;
    readonly overlays?: Record<string, { readonly kind: string; readonly tokens: JsonRecord }>;
}

/** The mode overlays a theme can show: the shipped ones and its own, light first */
export function modesOf(theme: ThemeBody): string[] {
    const own = Object.entries(theme.overlays ?? {})
        .filter(([, overlay]) => overlay.kind === 'mode')
        .map(([name]) => name);
    return [...new Set([...Object.keys(SHIPPED_OVERLAYS['mode'] ?? {}), ...own])];
}

/** A token's value made plain: a reference to another token followed to its value, a few steps at most */
function resolveValue(value: unknown, flat: ReadonlyMap<string, unknown>, depth = 0): unknown {
    if (typeof value !== 'string' || depth > 8) return value;
    const whole = /^\{([\w.-]+)\}$/.exec(value);
    if (whole !== null) return resolveValue(flat.get(whole[1] as string), flat, depth + 1);
    return value.replace(/\{([\w.-]+)\}/g, (match, path: string) => {
        const inner = resolveValue(flat.get(path), flat, depth + 1);
        return typeof inner === 'string' || typeof inner === 'number' ? String(inner) : match;
    });
}

/** One token of the Theme view: its path, type, group, its value in each mode, and where it is set */
export interface ThemeToken {
    readonly path: string;
    readonly type: string;
    readonly group: string;
    /** The value as written in the base tokens, when the theme sets it */
    readonly own?: unknown;
    /** The value as written in each mode overlay of the theme that sets it, by mode */
    readonly modes: Record<string, unknown>;
    /** The plain value in each mode, references followed */
    readonly values: Record<string, unknown>;
}

function flatOf(tree: JsonRecord): Map<string, unknown> {
    return new Map(flattenTokens(tree as never).map((leaf) => [leaf.path, leaf.value as unknown]));
}

/**
 * The tokens of a theme as the app shows them in each mode: the mode's overlay (shipped, refined by the theme's own of
 * the name) and the brand and motion given, under the theme's base tokens, over the defaults, as the runtime merges
 * them (`themeTokens` in stateui-app). Each token has its plain value per mode and what the theme writes for it
 */
export function themeTokensOf(theme: ThemeBody, active: { brand?: string; motion?: string } = {}): { modes: string[]; tokens: ThemeToken[] } {
    const source = { tokens: (theme.tokens ?? {}) as JsonObject, ...(theme.overlays !== undefined && { overlays: theme.overlays }) } as unknown as ThemeSource;
    const { overlays } = buildOverlayCatalog(source.overlays);
    const modes = modesOf(theme);
    const perMode = new Map<string, Map<string, unknown>>();
    for (const mode of modes) {
        const names: Record<string, string> = { mode, brand: active.brand ?? 'default', motion: active.motion ?? 'full' };
        perMode.set(mode, flatOf(mergeOverDefaults(mergeTokenTrees(composeOverlays(overlays, names), source.tokens)) as JsonRecord));
    }
    const own = flatOf(theme.tokens ?? {});
    const ownModes = new Map<string, Map<string, unknown>>();
    for (const [name, overlay] of Object.entries(theme.overlays ?? {})) if (overlay.kind === 'mode') ownModes.set(name, flatOf(overlay.tokens));
    const paths = [...flatOf(DEFAULT_TOKENS as unknown as JsonRecord).keys()];
    for (const path of own.keys()) if (!paths.includes(path)) paths.push(path);
    const tokens = paths.map((path): ThemeToken => {
        const values: Record<string, unknown> = {};
        for (const [mode, flat] of perMode) values[mode] = resolveValue(flat.get(path), flat);
        const modesSet: Record<string, unknown> = {};
        for (const [mode, flat] of ownModes) if (flat.has(path)) modesSet[mode] = flat.get(path);
        return {
            path,
            type: tokenTypeOf(path) ?? 'unknown',
            group: path.split('.')[0] as string,
            ...(own.has(path) && { own: own.get(path) }),
            modes: modesSet,
            values
        };
    });
    return { modes, tokens };
}

/** The overlay kinds, for the Theme view's choice of brand and motion */
export const THEME_OVERLAY_KINDS = OVERLAY_KINDS;
