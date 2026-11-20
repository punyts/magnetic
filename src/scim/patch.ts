import { attributeOf, PATCH_SCHEMA, ScimError } from './schemas.js';

/** One PATCH operation (RFC 7644, 3.5.2) */
export interface PatchOperation {
    readonly op: 'add' | 'replace' | 'remove';
    readonly path?: string;
    readonly value?: unknown;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The most operations one PATCH takes */
const MAX_OPERATIONS = 1000;

/** The operations of a PATCH body; op names in any case, as Entra ID sends `Replace` */
export function patchOperationsOf(body: unknown): PatchOperation[] {
    if (!isObject(body)) throw new ScimError(400, 'The body is not a PatchOp.', 'invalidSyntax');
    const schemas = attributeOf(body, 'schemas');
    if (!Array.isArray(schemas) || !schemas.includes(PATCH_SCHEMA)) throw new ScimError(400, 'The body is not a PatchOp.', 'invalidSyntax');
    const operations = attributeOf(body, 'Operations');
    if (!Array.isArray(operations) || operations.length === 0) throw new ScimError(400, 'Operations is not a list.', 'invalidSyntax');
    if (operations.length > MAX_OPERATIONS) throw new ScimError(413, `A PATCH takes at most ${MAX_OPERATIONS} operations.`, 'tooMany');
    return operations.map((operation) => {
        if (!isObject(operation)) throw new ScimError(400, 'An operation is not an object.', 'invalidSyntax');
        const op = attributeOf(operation, 'op');
        const lower = typeof op === 'string' ? op.toLowerCase() : '';
        if (lower !== 'add' && lower !== 'replace' && lower !== 'remove') throw new ScimError(400, 'An operation is add, replace or remove.', 'invalidSyntax');
        const path = attributeOf(operation, 'path');
        if (path !== undefined && (typeof path !== 'string' || path.length > 500)) throw new ScimError(400, 'A path is not text.', 'invalidPath');
        const value = attributeOf(operation, 'value');
        if (path === undefined || path === '') {
            if (lower === 'remove') throw new ScimError(400, 'A remove needs a path.', 'noTarget');
            if (!isObject(value)) throw new ScimError(400, 'An operation with no path needs an object value.', 'invalidValue');
        }
        return { op: lower, ...(typeof path === 'string' && path !== '' && { path }), ...(value !== undefined && { value }) };
    });
}

/** A parsed path: an attribute, a test on the elements of a list, and a sub-attribute */
interface Path {
    readonly attribute: string;
    readonly filter?: { readonly attribute: string; readonly value: unknown };
    readonly sub?: string;
}

const PATH = /^([A-Za-z][\w$-]*)(?:\[\s*([A-Za-z][\w$-]*)\s+eq\s+("(?:[^"\\]|\\.)*"|true|false)\s*\])?(?:\.([A-Za-z][\w$-]*))?$/i;

/**
 * A path in the core schema given, or `undefined` for one in another schema (an extension such as the enterprise User),
 * which Magnetic does not keep
 */
function pathOf(text: string, schema: string): Path | undefined {
    let rest = text.trim();
    if (/^urn:/i.test(rest)) {
        if (!rest.toLowerCase().startsWith(`${schema.toLowerCase()}:`)) return undefined;
        rest = rest.slice(schema.length + 1);
    }
    const match = PATH.exec(rest);
    if (match === null) throw new ScimError(400, 'The path is not one this server takes.', 'invalidPath');
    const [, attribute, filterAttribute, filterValue, sub] = match;
    let value: unknown;
    if (filterValue !== undefined) {
        try {
            value = filterValue.startsWith('"') ? JSON.parse(filterValue) : filterValue.toLowerCase() === 'true';
        } catch {
            throw new ScimError(400, 'The path is not one this server takes.', 'invalidPath');
        }
    }
    return {
        attribute: attribute as string,
        ...(filterAttribute !== undefined && { filter: { attribute: filterAttribute, value } }),
        ...(sub !== undefined && { sub })
    };
}

/** The key of an attribute as the resource spells it, or the name given when it has none */
function keyOf(resource: Json, name: string): string {
    const lower = name.toLowerCase();
    return Object.keys(resource).find((key) => key.toLowerCase() === lower) ?? name;
}

const same = (a: unknown, b: unknown): boolean => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

const matches = (element: unknown, filter: NonNullable<Path['filter']>): boolean => isObject(element) && same(attributeOf(element, filter.attribute), filter.value);

/** Whether two elements of a list are the same one: by `value` when both have it */
const sameElement = (a: unknown, b: unknown): boolean => (isObject(a) && isObject(b) && attributeOf(a, 'value') !== undefined ? attributeOf(a, 'value') === attributeOf(b, 'value') : JSON.stringify(a) === JSON.stringify(b));

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

/** Applies one operation at a path to a resource, in place */
function applyAt(resource: Json, op: PatchOperation['op'], path: Path, value: unknown): void {
    const key = keyOf(resource, path.attribute);
    const current = resource[key];
    if (path.filter !== undefined) {
        const list = Array.isArray(current) ? current : [];
        const filter = path.filter;
        const hits = list.filter((element) => matches(element, filter));
        if (op === 'remove') {
            resource[key] = path.sub === undefined ? list.filter((element) => !matches(element, filter)) : list.map((element) => (matches(element, filter) && isObject(element) ? Object.fromEntries(Object.entries(element).filter(([name]) => name.toLowerCase() !== path.sub?.toLowerCase())) : element));
            return;
        }
        if (hits.length === 0) {
            // Nothing matches: an add or replace makes the element the path describes (Entra ID's `emails[type eq "work"].value`)
            resource[key] = [...list, path.sub === undefined ? { [filter.attribute]: filter.value, ...(isObject(value) ? value : {}) } : { [filter.attribute]: filter.value, [path.sub]: value }];
            return;
        }
        resource[key] = list.map((element) => {
            if (!matches(element, filter) || !isObject(element)) return element;
            if (path.sub !== undefined) return { ...element, [keyOf(element, path.sub)]: value };
            return op === 'replace' && !isObject(value) ? value : { ...element, ...(isObject(value) ? value : {}) };
        });
        return;
    }
    if (path.sub !== undefined) {
        if (Array.isArray(current)) {
            // A sub-attribute of every element of a list
            resource[key] = current.map((element) => (isObject(element) ? (op === 'remove' ? Object.fromEntries(Object.entries(element).filter(([name]) => name.toLowerCase() !== path.sub?.toLowerCase())) : { ...element, [keyOf(element, path.sub as string)]: value }) : element));
            return;
        }
        const inner: Json = isObject(current) ? { ...current } : {};
        applyAt(inner, op, { attribute: path.sub }, value);
        resource[key] = inner;
        return;
    }
    if (op === 'remove') {
        if (Array.isArray(current) && value !== undefined) {
            // Entra ID removes members by naming them in the value
            const gone = asList(value);
            resource[key] = current.filter((element) => !gone.some((each) => sameElement(element, each)));
        } else delete resource[key];
        return;
    }
    if (op === 'add' && Array.isArray(current)) {
        const added = asList(value).filter((each) => !current.some((element) => sameElement(element, each)));
        resource[key] = [...current, ...added];
        return;
    }
    if (op === 'add' && isObject(current) && isObject(value)) {
        resource[key] = { ...current, ...value };
        return;
    }
    resource[key] = value;
}

/**
 * Applies a PATCH's operations to a resource as Magnetic reads it, returning the changed copy for the caller to check as
 * a whole. An operation with no path takes each attribute of its value as a path (Okta and Entra ID send
 * `{ "active": false }` so); `id`, `schemas` and `meta` there are ignored. A path in another schema changes nothing
 */
export function applyPatch(resource: Json, operations: readonly PatchOperation[], schema: string): Json {
    const changed = structuredClone(resource);
    for (const operation of operations) {
        if (operation.path === undefined) {
            for (const [name, value] of Object.entries(operation.value as Json)) {
                if (/^(id|schemas|meta)$/i.test(name)) continue;
                const path = pathOf(name, schema);
                if (path !== undefined) applyAt(changed, operation.op, path, value);
            }
            continue;
        }
        const path = pathOf(operation.path, schema);
        if (path === undefined) continue;
        if (/^(id|meta|schemas)$/i.test(path.attribute)) throw new ScimError(400, `${path.attribute} cannot be changed.`, 'mutability');
        if (operation.op !== 'remove' && operation.value === undefined) throw new ScimError(400, 'An add or replace needs a value.', 'invalidValue');
        applyAt(changed, operation.op, path, operation.value);
    }
    return changed;
}
