import { buildOverlayCatalog, composeOverlays, DEFAULT_TOKENS, flattenTokens, functionPaths, KIND_GROUPS, mergeOverDefaults, mergeTokenTrees, OVERLAY_KINDS, SHIPPED_OVERLAYS, tokenTypeOf } from '@punyts/stateui-app/core';
import type { FunctionEntry, JsonObject, ThemeSource } from '@punyts/stateui-app/core';
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

// ---- The statenet tree ---------------------------------------------------------------------------------------------

/** The kinds of node of the Statenet view: `$`, a branch (a path that holds others), a part, or what a part holds */
export type TreeKind =
    | 'owner'
    | 'branch'
    | 'app'
    | 'screen'
    | 'binding'
    | 'personal'
    | 'state'
    | 'shared'
    | 'otherApp'
    | 'theme'
    | 'dataset'
    | 'record'
    | 'model'
    | 'field'
    | 'module'
    | 'unit'
    | 'component'
    | 'pattern'
    | 'connection'
    | 'endpoint'
    | 'persona'
    | 'instance'
    | 'library'
    | 'function';

/** What the + of a node makes under it */
export type TreeAdd = 'app' | 'screen' | 'binding' | 'theme' | 'dataset' | 'record' | 'model' | 'field' | 'module' | 'unit' | 'connection';

export interface TreeNode {
    /** Its state path in the owner's tree (`$.themes.calm`, `$.apps.tasks.screens.home`): unique, and the node's id */
    readonly id: string;
    /** The path of the node it hangs from; null for `$` */
    readonly parent: string | null;
    readonly kind: TreeKind;
    /** A part's name, an app's title, or a branch's path below its parent (`$.themes`, `screens`, `uses.data`) */
    readonly label: string;
    /**
     * Data, never words (the view writes those in the person's language): a binding's dataset or model, a dataset's
     * model, a field's type, a unit's group, a state key's path, a shared dataset's owner, another app's path, a
     * connection's host, an endpoint's method and path (or, missing, its connection)
     */
    readonly note: string;
    /** Whether the app being edited uses it: what it does not is drawn dimmed */
    readonly used: boolean;
    /** The app being edited */
    readonly current?: boolean;
    /** Another app: its id, to open it */
    readonly appId?: string;
    /** The app being edited: how many links share it */
    readonly count?: number;
    /** The app being edited: its screens; a composed component: the screens of that app that place it */
    readonly screens?: readonly string[];
    /** A theme: the app's default */
    readonly isDefault?: boolean;
    /** Drawn as outside the owner: dashed */
    readonly outside?: boolean;
    /** An endpoint the app's logic calls that its connection does not have */
    readonly missing?: boolean;
    /** A dataset: how many records it has beyond the ones drawn */
    readonly more?: number;
    /** An instance: when the person's state of the app was last saved */
    readonly updatedAt?: string;
    /** What its + makes; none when there is no + */
    readonly add?: TreeAdd;
    /**
     * A function (hard IP): its GUID, where it runs, what it does and its schemas. `note` is its kind. `fixed` when it
     * belongs to a component, which cannot be turned off on its own
     */
    readonly fn?: { readonly id: string; readonly runs: readonly string[]; readonly summary: string; readonly inputs?: unknown; readonly outputs?: unknown; readonly fixed: boolean };
}

export interface TreeEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: 'binding' | 'read' | 'call' | 'model' | 'uses' | 'instance' | 'run';
    readonly label?: string;
}

/** A connection of the workspace as the tree sees it: never a secret, only its host and endpoints */
export interface GraphConnection {
    readonly name: string;
    readonly host: string;
    readonly endpoints: readonly { readonly name: string; readonly method: string; readonly path: string }[];
}

export interface TreeInput {
    /** The app being edited */
    readonly app: {
        readonly id: string;
        readonly name: string;
        readonly title: string;
        /** The app part's `uses` */
        readonly uses: JsonRecord;
        /** The assembled document: its `screens`, `data`, `logic` and `composed` */
        readonly document: JsonRecord;
        /** The people it is shared with: links and grants */
        readonly sharedWith: number;
    };
    /** Every part of the owner, by kind */
    readonly apps: readonly { readonly id: string; readonly name: string; readonly title: string }[];
    readonly themes: readonly string[];
    readonly datasets: readonly { readonly name: string; readonly model?: string; readonly keys: readonly string[] }[];
    readonly models: readonly { readonly name: string; readonly fields: Readonly<Record<string, string>> }[];
    readonly modules: readonly { readonly name: string; readonly units: readonly { readonly group: string; readonly name: string }[]; readonly needs: readonly string[] }[];
    readonly components: readonly string[];
    readonly patterns: readonly string[];
    readonly connections: readonly GraphConnection[];
    /** The name of each workspace that shares a dataset, by its id */
    readonly ownerNames: Readonly<Record<string, string>>;
    /** The name of each other app the app reads, by its id */
    readonly appNames: Readonly<Record<string, string>>;
    /** Whether the person manages the workspace's connections: only then does `$.connections` have a + */
    readonly manages: boolean;
    /**
     * The person's own persona: its name (a persona is the person's own context, such as `work`; Magnetic gives each
     * person `default` only), the owner of the apps (the workspace), and the apps of it they have state in, the most
     * recently used first. Never another person's. The person themself is `$.user`, not a persona
     */
    readonly persona: {
        readonly name: string;
        readonly owner: string;
        readonly apps: readonly { readonly id: string; readonly updatedAt: string }[];
    };
    /** The functions the server runs: the host's under `$.functions.host`, others under `$.functions.<group>`, and each library component's under `$.components.<component>.functions` */
    readonly functions: readonly FunctionEntry[];
}

/** The most records of a dataset the tree draws */
export const TREE_RECORDS = 8;

/** The value at a `$.data…` path of the document's starting data */
function dataAt(document: JsonRecord, path: string): unknown {
    if (!path.startsWith('$.data.')) return undefined;
    let value: unknown = document['data'];
    for (const key of path.split('.').slice(2)) value = isRecord(value) ? value[key] : undefined;
    return value;
}

/**
 * The connection and endpoint each `$.functions.host.http` effect of the app's logic calls. An effect's request is a state path; what it
 * calls is in the request written there: by a command of a handler or a unit (`set` with a value naming the connection
 * and endpoint), or in the app's starting data
 */
export function callsOf(document: JsonRecord): { effect: string; connection: string; endpoint: string }[] {
    const logic = document['logic'];
    const effects = isRecord(logic) && isRecord(logic['effects']) ? logic['effects'] : {};
    const commands = commandsIn([document['screens'], logic]);
    const found: { effect: string; connection: string; endpoint: string }[] = [];
    for (const [name, effect] of Object.entries(effects)) {
        if (!isRecord(effect) || effect['run'] !== '$.functions.host.http' || typeof effect['request'] !== 'string') continue;
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


/** True when the node or one under it is the component */
function places(node: unknown, component: string): boolean {
    if (Array.isArray(node)) return node.some((child) => places(child, component));
    if (!isRecord(node)) return false;
    if (node['component'] === component) return true;
    // Children, and the slots a node fills (`start`, `row`, `card`)
    return Object.values(node).some((child) => places(child, component));
}


/**
 * The owner's statenet as a tree of state paths: `$`, then `$.apps`, `$.themes`, `$.data`, `$.models`, `$.logic`,
 * `$.components`, `$.patterns`, `$.connections`, `$.functions` and `$.personas`, each holding every part of that kind the owner has. A part the
 * app being edited does not use is drawn dimmed (`used: false`). One level is drawn below a part: the app's screens,
 * bindings (`uses.data`), own state (`data`) and outside reads (`uses.external`); a dataset's records (the first
 * `TREE_RECORDS`); a model's fields; a module's units; a connection's endpoints; the person's own persona with the apps
 * they have state in (`$.personas.<persona>.apps.<owner>.<app id>`); the server's functions by group
 * (`$.functions.<group>.<name>`), and a library component's under it (`$.components.<component>.functions.<name>`). A branch the person can add to has
 * `add`. The edges are what the tree does not show: what the app uses, a binding's dataset, a dataset's model, an
 * endpoint the app calls, the function a unit runs
 */
export function ownerTreeOf(input: TreeInput): { nodes: TreeNode[]; edges: TreeEdge[] } {
    const nodes = new Map<string, TreeNode>();
    const edges: TreeEdge[] = [];
    const add = (node: TreeNode): void => {
        if (!nodes.has(node.id)) nodes.set(node.id, node);
    };
    const branch = (id: string, parent: string, label: string, used: boolean, adds?: TreeAdd): string => {
        add({ id, parent, kind: 'branch', label, note: '', used, ...(adds !== undefined && { add: adds }) });
        return id;
    };
    const { uses, document } = input.app;
    const app = `$.apps.${input.app.name}`;
    const screens = isRecord(document['screens']) ? document['screens'] : {};
    const themes = Array.isArray(uses['themes']) ? uses['themes'].filter((name): name is string => typeof name === 'string') : [];
    const bindings = isRecord(uses['data']) ? uses['data'] : {};
    const modules = isRecord(uses['logic']) ? Object.keys(uses['logic']) : [];
    const composed = isRecord(document['composed']) ? Object.keys(document['composed']) : [];
    const bound = new Map<string, string>();
    for (const [binding, use] of Object.entries(bindings)) if (isRecord(use) && typeof use['dataset'] === 'string') bound.set(use['dataset'], binding);
    const modelOf = new Map(input.datasets.map((dataset) => [dataset.name, dataset.model]));
    const usedModels = new Set<string>();
    for (const [dataset] of bound) { const model = modelOf.get(dataset); if (model !== undefined) usedModels.add(model); }
    for (const use of Object.values(bindings)) if (isRecord(use) && typeof use['model'] === 'string') usedModels.add(use['model']);

    add({ id: '$', parent: null, kind: 'owner', label: '$', note: '', used: true });

    // $.apps: the app being edited with what it holds, and the owner's other apps
    branch('$.apps', '$', '$.apps', true, 'app');
    add({ id: app, parent: '$.apps', kind: 'app', label: input.app.title, note: input.app.name, used: true, current: true, appId: input.app.id, count: input.app.sharedWith, screens: Object.keys(screens) });
    for (const other of input.apps) {
        if (other.id === input.app.id) continue;
        add({ id: `$.apps.${other.name}`, parent: '$.apps', kind: 'app', label: other.title, note: other.name, used: false, appId: other.id });
    }
    const appScreens = branch(`${app}.screens`, app, 'screens', true, 'screen');
    for (const screen of Object.keys(screens)) add({ id: `${appScreens}.${screen}`, parent: appScreens, kind: 'screen', label: screen, note: '', used: true });
    const appData = branch(`${app}.uses.data`, app, 'uses.data', true, 'binding');
    for (const [binding, use] of Object.entries(bindings)) {
        if (!isRecord(use)) continue;
        const id = `${appData}.${binding}`;
        if (typeof use['dataset'] === 'string') {
            add({ id, parent: appData, kind: 'binding', label: binding, note: use['dataset'], used: true });
            edges.push({ from: id, to: `$.data.${use['dataset']}`, kind: 'binding', label: `$.data.${binding}` });
        } else if (typeof use['model'] === 'string') {
            add({ id, parent: appData, kind: 'personal', label: binding, note: use['model'], used: true });
            edges.push({ from: id, to: `$.models.${use['model']}`, kind: 'model' });
        }
    }
    const own = (isRecord(document['data']) ? Object.keys(document['data']) : []).filter((key) => !Object.hasOwn(bindings, key));
    if (own.length > 0) {
        const appState = branch(`${app}.data`, app, 'data', true);
        for (const key of own) add({ id: `${appState}.${key}`, parent: appState, kind: 'state', label: key, note: `$.data.${key}`, used: true });
    }
    const external = isRecord(uses['external']) ? uses['external'] : {};
    if (Object.keys(external).length > 0) {
        const outside = branch(`${app}.uses.external`, app, 'uses.external', true);
        for (const [alias, use] of Object.entries(external)) {
            if (!isRecord(use)) continue;
            const id = `${outside}.${alias}`;
            if (typeof use['owner'] === 'string' && typeof use['dataset'] === 'string') {
                add({ id, parent: outside, kind: 'shared', label: use['dataset'], note: input.ownerNames[use['owner']] ?? '', used: true, outside: true });
            } else if (typeof use['app'] === 'string') {
                add({ id, parent: outside, kind: 'otherApp', label: input.appNames[use['app']] ?? use['app'], note: typeof use['path'] === 'string' ? use['path'] : '$.data', used: true, outside: true });
            }
        }
    }

    // $.themes, the app's first being its default
    branch('$.themes', '$', '$.themes', themes.length > 0, 'theme');
    for (const theme of [...themes, ...input.themes.filter((name) => !themes.includes(name))]) {
        const used = themes.includes(theme);
        add({ id: `$.themes.${theme}`, parent: '$.themes', kind: 'theme', label: theme, note: '', used, isDefault: used && themes[0] === theme });
        if (used) edges.push({ from: app, to: `$.themes.${theme}`, kind: 'uses' });
    }

    // $.data: each dataset with its first records
    branch('$.data', '$', '$.data', bound.size > 0, 'dataset');
    for (const dataset of input.datasets) {
        const id = `$.data.${dataset.name}`;
        const used = bound.has(dataset.name);
        const shown = dataset.keys.slice(0, TREE_RECORDS);
        add({ id, parent: '$.data', kind: 'dataset', label: dataset.name, note: dataset.model ?? '', used, add: 'record', ...(dataset.keys.length > shown.length && { more: dataset.keys.length - shown.length }) });
        for (const key of shown) add({ id: `${id}.${key}`, parent: id, kind: 'record', label: key, note: '', used });
        if (dataset.model !== undefined) edges.push({ from: `$.models.${dataset.model}`, to: id, kind: 'model' });
    }

    // $.models with their fields
    branch('$.models', '$', '$.models', usedModels.size > 0, 'model');
    for (const model of input.models) {
        const id = `$.models.${model.name}`;
        const used = usedModels.has(model.name);
        add({ id, parent: '$.models', kind: 'model', label: model.name, note: '', used, add: 'field' });
        const fields = `${id}.fields`;
        for (const [field, type] of Object.entries(model.fields)) add({ id: `${fields}.${field}`, parent: id, kind: 'field', label: field, note: type, used });
    }

    // $.logic: the modules with their units
    branch('$.logic', '$', '$.logic', modules.length > 0, 'module');
    for (const module of input.modules) {
        const id = `$.logic.${module.name}`;
        const used = modules.includes(module.name);
        add({ id, parent: '$.logic', kind: 'module', label: module.name, note: '', used, add: 'unit' });
        for (const unit of module.units) add({ id: `${id}.${unit.group}.${unit.name}`, parent: id, kind: 'unit', label: unit.name, note: unit.group, used });
        if (used) edges.push({ from: app, to: id, kind: 'uses' });
    }

    // $.components and $.patterns: made from screens by the agent, so no +
    branch('$.components', '$', '$.components', composed.length > 0);
    for (const component of [...composed, ...input.components.filter((name) => !composed.includes(name))]) {
        const used = composed.includes(component);
        const placing = used ? Object.entries(screens).filter(([, screen]) => isRecord(screen) && places(screen['root'], component)).map(([name]) => name) : [];
        add({ id: `$.components.${component}`, parent: '$.components', kind: 'component', label: component, note: '', used, screens: placing });
        if (used) edges.push({ from: app, to: `$.components.${component}`, kind: 'uses' });
    }
    if (input.patterns.length > 0) {
        branch('$.patterns', '$', '$.patterns', false);
        for (const pattern of input.patterns) add({ id: `$.patterns.${pattern}`, parent: '$.patterns', kind: 'pattern', label: pattern, note: '', used: false });
    }

    // $.connections with their endpoints, and an endpoint the logic calls that its connection lacks
    const calls = callsOf(document);
    const called = new Set(calls.map((call) => call.connection));
    branch('$.connections', '$', '$.connections', called.size > 0, input.manages ? 'connection' : undefined);
    for (const connection of input.connections) {
        const id = `$.connections.${connection.name}`;
        const used = called.has(connection.name);
        add({ id, parent: '$.connections', kind: 'connection', label: connection.name, note: connection.host, used });
        for (const endpoint of connection.endpoints) {
            add({ id: `${id}.endpoints.${endpoint.name}`, parent: id, kind: 'endpoint', label: endpoint.name, note: `${endpoint.method} ${endpoint.path}`, used });
        }
    }
    for (const call of calls) {
        const parent = nodes.has(`$.connections.${call.connection}`) ? `$.connections.${call.connection}` : '$.connections';
        const id = `$.connections.${call.connection}.endpoints.${call.endpoint}`;
        if (!nodes.has(id)) add({ id, parent, kind: 'endpoint', label: call.endpoint, note: call.connection, used: true, missing: true });
        edges.push({ from: app, to: id, kind: 'call', label: call.effect });
    }

    // $.functions, and the functions of the library's components under $.components: hard IP, so no + and no editor.
    // A unit links to the function it runs, as it links to data; a run named outside the logic links from the app
    const named = new Set(functionPaths(document));
    const logic = isRecord(document['logic']) ? document['logic'] : {};
    const unitsOf = new Map<string, string>();
    for (const module of input.modules) {
        if (!modules.includes(module.name)) continue;
        for (const unit of module.units) if (!unitsOf.has(`${unit.group}.${unit.name}`)) unitsOf.set(`${unit.group}.${unit.name}`, `$.logic.${module.name}.${unit.group}.${unit.name}`);
    }
    const runners = new Map<string, Set<string>>();
    const runBy = (path: string, from: string): void => {
        const set = runners.get(path) ?? new Set<string>();
        set.add(from);
        runners.set(path, set);
    };
    for (const [group, units] of Object.entries(logic)) {
        if (!isRecord(units)) continue;
        for (const [name, unit] of Object.entries(units)) for (const path of functionPaths(unit)) runBy(path, unitsOf.get(`${group}.${name}`) ?? app);
    }
    for (const path of named) if (!runners.has(path)) runBy(path, app);
    const fnOf = (entry: FunctionEntry, fixed: boolean): NonNullable<TreeNode['fn']> => ({
        id: entry.id,
        runs: [...entry.runs],
        summary: entry.summary,
        ...(entry.inputs !== undefined && { inputs: entry.inputs }),
        ...(entry.outputs !== undefined && { outputs: entry.outputs }),
        fixed
    });
    const served = input.functions.filter((entry) => entry.path.startsWith('$.functions.'));
    const usedFunction = (path: string): boolean => named.has(path);
    branch('$.functions', '$', '$.functions', served.some((entry) => usedFunction(entry.path)));
    for (const entry of served) {
        const [, , group, name] = entry.path.split('.') as [string, string, string, string];
        const parent = `$.functions.${group}`;
        if (!nodes.has(parent)) branch(parent, '$.functions', group, served.some((each) => each.path.startsWith(`${parent}.`) && usedFunction(each.path)));
        add({ id: entry.path, parent, kind: 'function', label: name, note: entry.kind, used: usedFunction(entry.path), fn: fnOf(entry, false) });
    }
    for (const entry of input.functions.filter((each) => each.path.startsWith('$.components.'))) {
        const [, , component, , name] = entry.path.split('.') as [string, string, string, string, string];
        const parent = `$.components.${component}`;
        const placed = Object.entries(screens).filter(([, screen]) => isRecord(screen) && places(screen['root'], component)).map(([screen]) => screen);
        // The component calls its functions itself wherever it is placed
        const used = placed.length > 0 || usedFunction(entry.path);
        if (!nodes.has(parent)) {
            add({ id: parent, parent: '$.components', kind: 'library', label: component, note: '', used, screens: placed });
            if (placed.length > 0) edges.push({ from: app, to: parent, kind: 'uses' });
        }
        add({ id: entry.path, parent, kind: 'function', label: name, note: entry.kind, used, fn: fnOf(entry, true) });
        const components = nodes.get('$.components');
        if (used && components !== undefined && !components.used) nodes.set('$.components', { ...components, used: true });
    }
    for (const [path, from] of runners) {
        if (!nodes.has(path)) continue;
        for (const each of from) edges.push({ from: each, to: path, kind: 'run' });
    }

    // $.personas: the person's own, with their state of each app laid over its definition. Others' state is theirs
    const titles = new Map(input.apps.map((each) => [each.id.toLowerCase(), each]));
    const persona = `$.personas.${input.persona.name}`;
    const mine = input.persona.apps.filter((each) => titles.has(each.id.toLowerCase()));
    branch('$.personas', '$', '$.personas', mine.some((each) => each.id.toLowerCase() === input.app.id.toLowerCase()));
    add({ id: persona, parent: '$.personas', kind: 'persona', label: input.persona.name, note: '', used: true });
    for (const each of mine) {
        const of = titles.get(each.id.toLowerCase()) as { id: string; name: string; title: string };
        const current = of.id.toLowerCase() === input.app.id.toLowerCase();
        const id = `${persona}.apps.${input.persona.owner}.${of.id.toLowerCase()}`;
        add({ id, parent: persona, kind: 'instance', label: current ? input.app.title : of.title, note: of.name, used: current, appId: of.id, updatedAt: each.updatedAt, ...(current && { current: true }) });
        edges.push({ from: `$.apps.${of.name}`, to: id, kind: 'instance' });
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
    /** Whether a mode overlay may set it (its group is one KIND_GROUPS allows a mode); otherwise it is one value in all modes */
    readonly moded: boolean;
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
            moded: KIND_GROUPS.mode.some((group) => path === group || path.startsWith(group + '.')),
            ...(own.has(path) && { own: own.get(path) }),
            modes: modesSet,
            values
        };
    });
    return { modes, tokens };
}

/** The overlay kinds, for the Theme view's choice of brand and motion */
export const THEME_OVERLAY_KINDS = OVERLAY_KINDS;
