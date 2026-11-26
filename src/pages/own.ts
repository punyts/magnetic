import type { ModelOperations } from './PageSpec.js';

/**
 * A node's own state that a field of the page decides (docs/design/state-definitions-and-instances.md: a component's
 * state fans out with the components, it is not a field of the data). A definition writes `'own:hidden': 'noNotice'`
 * on a node: `ownTree` gives the node the field's first value as its own `hidden` and an `@id`, takes the field out of
 * the model, and lists where the field goes. The page still says `noNotice`, and its writes reach the node by its id
 */
export const OWN_PREFIX = 'own:';

/** Each field of a page's data that is a node's own state, by its data path, with where it goes: `<id>.<property>` */
export type OwnMap = Readonly<Record<string, readonly string[]>>;

export interface Owned {
    /** The definition with each marked node holding its own state */
    readonly definition: Record<string, unknown>;
    /** The models without the fields that became a node's state */
    readonly models: Readonly<Record<string, ModelOperations>>;
    readonly own: OwnMap;
    /** The state path of each place in `own` (`notice.hidden` to `$.screens.home.children.notice.hidden`) */
    readonly paths: Readonly<Record<string, string>>;
    /** The ids the marked nodes carry, which a copy of the page must keep */
    readonly ids: readonly string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNode = (value: unknown): value is Json => isObject(value) && typeof value['component'] === 'string';
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Every `@id` and every node key of a tree: the names an id made here must differ from */
function namesOf(value: unknown, into: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) namesOf(item, into);
        return;
    }
    if (!isObject(value)) return;
    if (typeof value['@id'] === 'string') into.add(value['@id']);
    for (const [key, inner] of Object.entries(value)) {
        if (isNode(inner)) into.add(key);
        namesOf(inner, into);
    }
}

/** The first value of a field, from the default its model gives it (`toolLook.use` reads `use` of `toolLook`'s default) */
function firstValue(operations: ModelOperations, field: string): unknown {
    const [name, ...rest] = field.split('.');
    const operation = operations.find((each) => each['field'] === name);
    if (operation === undefined) throw new Error(`The page's models have no field ${String(name)} for a node's own state`);
    return rest.reduce<unknown>((value, key) => (isObject(value) ? value[key] : undefined), operation['default']);
}

/** One record of a page's data: its data path (`$.data.signin`) and the name of the model of its fields */
export interface PageRecord {
    readonly path: string;
    readonly model: string;
}

/**
 * Compiles a page's definition. `records` are the records of the page's data, one per namespace. A node names a field by
 * its data path (`$.data.chat.noStatus`), or by its name alone, which is the first record whose model has it. A marked
 * field that the tree also links as data fails: it is one or the other
 */
export function ownTree(definition: Record<string, unknown>, models: Readonly<Record<string, ModelOperations>>, records: readonly PageRecord[]): Owned {
    for (const record of records) if (models[record.model] === undefined) throw new Error(`The page has no model ${record.model}`);
    const operationsOf = (record: PageRecord): ModelOperations => models[record.model] as ModelOperations;
    const names = new Set<string>();
    namesOf(definition, names);
    const own: Record<string, string[]> = {};
    const paths: Record<string, string> = {};
    const ids = new Set<string>();
    /** The fields that became a node's state, by the model they leave */
    const fields = new Map<string, Set<string>>();
    const taken = new Set<string>();

    /** The record a marked field is of, and the field in it */
    const fieldOf = (asked: string): { record: PageRecord; field: string } => {
        const named = records.find((record) => asked.startsWith(`${record.path}.`));
        if (named !== undefined) return { record: named, field: asked.slice(named.path.length + 1) };
        const root = asked.split('.')[0];
        const having = records.find((record) => operationsOf(record).some((operation) => operation['field'] === root));
        if (having === undefined) throw new Error(`The page's models have no field ${String(root)} for a node's own state`);
        return { record: having, field: asked };
    };

    const newId = (keys: readonly string[]): string => {
        let id = '';
        for (let index = keys.length - 1; index >= 0; index -= 1) {
            id = id === '' ? (keys[index] as string) : `${keys[index] as string}${capital(id)}`;
            if (!names.has(`${id}Part`)) break;
        }
        let made = `${id}Part`;
        for (let count = 2; names.has(made); count += 1) made = `${id}Part${count}`;
        names.add(made);
        return made;
    };

    const walk = (value: unknown, keys: readonly string[], path: string): unknown => {
        if (Array.isArray(value)) return value.map((item, index) => walk(item, keys, `${path}.${index}`));
        if (!isObject(value)) return value;
        const marked = isNode(value) && Object.keys(value).some((key) => key.startsWith(OWN_PREFIX));
        const id = marked ? (typeof value['@id'] === 'string' ? value['@id'] : newId(keys)) : undefined;
        const out: Json = {};
        for (const [key, inner] of Object.entries(value)) {
            if (id !== undefined && key.startsWith(OWN_PREFIX)) {
                const property = key.slice(OWN_PREFIX.length);
                const { record, field } = fieldOf(String(inner));
                out[property] = firstValue(operationsOf(record), field);
                (own[`${record.path}.${field}`] ??= []).push(`${id}.${property}`);
                paths[`${id}.${property}`] = `${path}.${property}`;
                let gone = fields.get(record.model);
                if (gone === undefined) fields.set(record.model, (gone = new Set<string>()));
                gone.add(field);
                taken.add(`${record.path}.${field}`);
                continue;
            }
            out[key] = walk(inner, isNode(inner) ? [...keys, key] : keys, `${path}.${key}`);
        }
        if (id !== undefined) {
            out['@id'] = id;
            ids.add(id);
        }
        return out;
    };

    const compiled: Json = {};
    for (const [key, value] of Object.entries(definition)) {
        if (key === 'home') compiled[key] = walk(value, [], '$.screens.home');
        else if (key === 'screens' && isObject(value)) {
            compiled[key] = Object.fromEntries(
                Object.entries(value).map(([screen, body]) => [screen, isObject(body) && isObject(body['root']) ? { ...body, root: walk(body['root'], [], `$.screens.${screen}`) } : walk(body, [], `$.screens.${screen}`)])
            );
        } else compiled[key] = walk(value, [], `$.${key}`);
    }

    const linked = JSON.stringify(compiled);
    for (const path of taken) {
        if (linked.includes(`"${path}"`)) throw new Error(`The field ${path} is a node's own state and is also linked as data`);
    }
    const left = (model: string, operations: ModelOperations): ModelOperations => {
        const gone = fields.get(model);
        if (gone === undefined) return operations;
        return operations.filter((operation) => {
            const name = String(operation['field']);
            if (gone.has(name)) return false;
            const inner = operation['default'];
            return !(isObject(inner) && Object.keys(inner).length > 0 && Object.keys(inner).every((key) => gone.has(`${name}.${key}`)));
        });
    };
    return {
        definition: compiled,
        models: Object.fromEntries(Object.entries(models).map(([model, operations]) => [model, left(model, operations)])),
        own,
        paths,
        ids: [...ids]
    };
}

/** A state write of a page: a path and its value, with whatever else the page's panel takes (`optional`) */
export interface OwnWrite {
    readonly path: string;
    readonly value: unknown;
    readonly optional?: boolean;
}

/**
 * State writes with each field that is a node's own state taken to its node: a write at the field's path goes to each
 * place, and an object written above such fields loses them to their places. A place is `place(target)` when the
 * caller knows the node's state path, or else the node by its id (`#notice.hidden`), marked `optional` because a
 * person's copy may be without the node.
 *
 * This function is also the page scripts' `ownWrites`: `OWN_JS` is its own text. So it must stay self-contained,
 * using nothing of this module or of Node, only its arguments and the language
 */
export function ownWrites(own: OwnMap, writes: readonly OwnWrite[], place?: (target: string) => string): OwnWrite[] {
    const out: OwnWrite[] = [];
    const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    const names = Object.keys(own);
    const split = (path: string, value: unknown): unknown => {
        const places = own[path];
        if (places !== undefined) {
            for (const target of places) out.push(place === undefined ? { path: '#' + target, value, optional: true } : { path: place(target), value });
            return undefined;
        }
        if (!isRecord(value) || !names.some((key) => key.startsWith(path + '.'))) return value;
        const rest: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            const kept = split(path + '.' + key, inner);
            if (kept !== undefined || own[path + '.' + key] === undefined) rest[key] = kept;
        }
        return rest;
    };
    for (const write of writes) {
        const at = out.length;
        const kept = split(write.path, write.value);
        if (own[write.path] === undefined) out.splice(at, 0, { ...write, value: kept });
    }
    return out;
}

/** `ownWrites(own, writes)` in a page script: the text of `ownWrites` itself, so the two cannot differ */
export const OWN_JS = `${ownWrites.toString()}\n`;

/** A node's `hidden` from a path: a field of the page's data is the node's own state, a row's field (`$row.…`) a link */
export function hiddenBy(path: string): Record<string, string> {
    return path.startsWith('$.data.') ? { [`${OWN_PREFIX}hidden`]: path } : { '<-hidden': path };
}

/**
 * The state path of the one node whose `@id` is `id`, in the screens and app node of a document or of an app's state
 * (`$`); undefined when no node carries it. A server that writes a node's own state into a person's copy finds the node
 * with this, wherever the person moved it
 */
export function pathOfId(state: unknown, id: string): string | undefined {
    const visit = (value: unknown, path: string): string | undefined => {
        if (!isObject(value)) return undefined;
        if (isNode(value) && value['@id'] === id) return path;
        for (const [key, inner] of Object.entries(value)) {
            if (!isObject(inner)) continue;
            const found = visit(inner, `${path}.${key}`);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    if (!isObject(state)) return undefined;
    for (const [name, screen] of Object.entries(isObject(state['screens']) ? state['screens'] : {})) {
        const found = visit(isObject(screen) && isObject(screen['root']) ? screen['root'] : screen, `$.screens.${name}`);
        if (found !== undefined) return found;
    }
    return visit(state['app'], '$.app');
}
