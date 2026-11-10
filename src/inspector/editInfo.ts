import { logicRunOrder } from '@punyts/stateui-mcp';
import type { LogicDocument } from '@punyts/stateui-mcp';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A path of a node as the runtime names it: `$.app…` or `$.screens.<screen>…`, keys of letters, digits, `_` and `-` */
const NODE_PATH = /^\$\.(app|screens\.[A-Za-z_][\w-]*)(\.[A-Za-z_][\w-]*)*$/;

/** The tree `ui_nodes_write` writes for a node path: `app`, or the screen's name; undefined for any other path */
export function treeOf(path: string): string | undefined {
    if (!NODE_PATH.test(path)) return undefined;
    if (path === '$.app' || path.startsWith('$.app.')) return 'app';
    return path.split('.')[2];
}

/** The value at a node path of the assembled document, or undefined */
export function nodeAt(document: JsonRecord, path: string): JsonRecord | undefined {
    if (!NODE_PATH.test(path)) return undefined;
    const [top, screen, ...rest] = path.slice(2).split('.');
    // The runtime path of a screen's root node is `$.screens.<name>`; the document keeps it as `screens.<name>.root`
    let current: unknown = top === 'app' ? document['app'] : screenRoot(document, screen as string);
    for (const key of top === 'app' ? [screen, ...rest].filter((step): step is string => step !== undefined) : rest) {
        if (!isRecord(current)) return undefined;
        current = current[key];
    }
    return isRecord(current) && typeof current['component'] === 'string' ? current : undefined;
}

/** The root node of a screen of the assembled document */
function screenRoot(document: JsonRecord, screen: string): unknown {
    const screens = document['screens'];
    const entry = isRecord(screens) ? screens[screen] : undefined;
    return isRecord(entry) ? entry['root'] : undefined;
}

/** A node's own settings: its properties, links and events, without its children and the nodes of its slots */
export function ownSettings(node: JsonRecord): JsonRecord {
    return Object.fromEntries(Object.entries(node).filter(([key, value]) => key !== 'children' && !(isRecord(value) && typeof value['component'] === 'string')));
}

/** A link of a node to a state path: the node, the property and the path it reads (`<-`) or keeps in step (`<->`) */
export interface StateBinding {
    readonly path: string;
    readonly node: string;
    readonly property: string;
    readonly twoWay: boolean;
}

/** The links of the app's nodes to `$.data`, found by walking the assembled document */
export function bindingsOf(document: JsonRecord, limit = 500): StateBinding[] {
    const found: StateBinding[] = [];
    const visit = (value: unknown, path: string): void => {
        if (!isRecord(value) || found.length >= limit) return;
        const isNode = typeof value['component'] === 'string';
        for (const [key, inner] of Object.entries(value)) {
            if (isNode && typeof inner === 'string' && inner.startsWith('$.data') && key.startsWith('<-')) {
                const twoWay = key.startsWith('<->');
                found.push({ path: inner, node: path, property: key.slice(twoWay ? 3 : 2), twoWay });
            } else if (isRecord(inner)) {
                visit(inner, `${path}.${key}`);
            }
        }
    };
    visit(document['app'], '$.app');
    if (isRecord(document['screens'])) for (const name of Object.keys(document['screens'])) visit(screenRoot(document, name), `$.screens.${name}`);
    return found;
}

/** One unit of the app's logic with the paths it reads and writes, which may hold `*` and `{name}` segments */
export interface LogicUse {
    readonly kind: string;
    readonly name: string;
    readonly reads: readonly string[];
    readonly writes: readonly string[];
}

/** The units of the app's logic (its modules included), in run order; none when it has no logic */
export function logicOf(document: JsonRecord): LogicUse[] {
    const logic = document['logic'];
    if (!isRecord(logic)) return [];
    try {
        return logicRunOrder(logic as unknown as LogicDocument).map((unit) => ({ kind: unit.kind, name: unit.name, reads: unit.reads, writes: unit.writes }));
    } catch {
        return [];
    }
}

export type { Json };
