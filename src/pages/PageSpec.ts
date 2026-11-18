import { createHash } from 'node:crypto';
import type { UiToolDefinition } from '@punyts/stateui-mcp';
import { textsOf } from '../http/text.js';
import { writeLocales } from '../stateui/localize.js';
import { run } from '../stateui/run.js';
import { ensureMagneticTheme, MAGNETIC_THEME, THEME_STAMP } from '../stateui/theme.js';

/** The operations of a model, as `ui_model_write` takes them */
export type ModelOperations = readonly Record<string, unknown>[];

/**
 * One of Magnetic's own pages as a StateUI app (docs/design/magnetic-editable.md): its app name, the models of its
 * data, its definition in English (the other languages are locales), and its contract with the page that runs it.
 * The page drives it only through `$.data` and its emits, so an edited copy keeps working wherever its nodes are
 */
export interface PageSpec {
    /** The app's name, in every workspace that has it */
    readonly name: string;
    /** What the admin's Pages list calls it */
    readonly title: string;
    readonly models: Readonly<Record<string, ModelOperations>>;
    /** The definition in English, as `ui_app_create` takes it (without its name and themes) */
    readonly definition: () => Record<string, unknown>;
    /** Whether the app uses Magnetic's theme */
    readonly themed: boolean;
    /** The emits a published copy must still raise, each from at least one node */
    readonly required: readonly string[];
    /** The node keys a published copy must still have, wherever they are */
    readonly keys?: readonly string[];
    /** Data an admin's draft starts with, by state path, so what a page shows only sometimes is there to edit */
    readonly sample?: Readonly<Record<string, unknown>>;
}

/** Changes when Magnetic ships a new definition of the page: its models, its theme, its words in every language */
export function pageStamp(spec: PageSpec): string {
    return createHash('sha256')
        .update(JSON.stringify({ models: spec.models, theme: spec.themed ? THEME_STAMP : null, definition: spec.definition(), texts: ['de', 'fr', 'es'].map((language) => textsOf(language as 'de')) }))
        .digest('hex')
        .slice(0, 16);
}

/** Writes every field of a page's models, so a workspace with an older version gets the new fields too */
export async function ensureModels(tools: readonly UiToolDefinition[], models: Readonly<Record<string, ModelOperations>>): Promise<void> {
    for (const [model, operations] of Object.entries(models)) {
        const existing = await run(tools, 'ui_get', { kind: 'models', name: model }).catch(() => undefined);
        let revision = existing === undefined ? undefined : existing['revision'];
        // The tool takes at most 50 operations a call
        for (let start = 0; start < operations.length; start += 50) {
            const written = await run(tools, 'ui_model_write', { model, operations: operations.slice(start, start + 50), ...(typeof revision === 'number' && { expectedRevision: revision }) });
            revision = written['revision'];
        }
    }
}

/**
 * Makes a page app from Magnetic's definition in a workspace, with the tools the agent uses: its models, its theme, the
 * app in English and every other language as locales. Answers its id and the revision it was left at
 */
export async function makePage(tools: readonly UiToolDefinition[], spec: PageSpec, name: string = spec.name): Promise<{ id: string; revision: number }> {
    await ensureModels(tools, spec.models);
    if (spec.themed) await ensureMagneticTheme(tools);
    const made = spec.definition();
    const created = await run(tools, 'ui_app_create', { name, ...(spec.themed && { themes: [MAGNETIC_THEME] }), ...made });
    if (typeof created['id'] !== 'string') throw new Error('ui_app_create gave no id');
    const screens = Object.fromEntries(
        Object.entries((made['screens'] as Record<string, { root?: unknown }> | undefined) ?? { home: { root: made['home'] } }).map(([screen, body]) => [screen, (body as { root?: unknown }).root ?? body])
    );
    const revision = await writeLocales(tools, name, screens, typeof created['revision'] === 'number' ? created['revision'] : 1);
    return { id: created['id'], revision };
}

/** Each emit target raised anywhere in a tree, and each node key in it */
function walk(tree: unknown, emits: Set<string>, keys: Set<string>): void {
    if (typeof tree !== 'object' || tree === null) return;
    if (Array.isArray(tree)) {
        for (const item of tree) walk(item, emits, keys);
        return;
    }
    const record = tree as Record<string, unknown>;
    if (record['command'] === 'emit' && typeof record['target'] === 'string') emits.add(record['target']);
    for (const [key, value] of Object.entries(record)) {
        if (key === 'children' && typeof value === 'object' && value !== null) for (const child of Object.keys(value)) keys.add(child);
        walk(value, emits, keys);
    }
}

/**
 * What a copy of a page lacks of its contract: each required emit no node raises and each required key no node has,
 * in words for the admin. Empty when it may be published
 */
export function contractGaps(spec: PageSpec, document: unknown): string[] {
    const emits = new Set<string>();
    const keys = new Set<string>();
    walk(document, emits, keys);
    return [
        ...spec.required.filter((emit) => !emits.has(emit)).map((emit) => `Nothing raises "${emit}"`),
        ...(spec.keys ?? []).filter((key) => !keys.has(key)).map((key) => `No part is called "${key}"`)
    ];
}
