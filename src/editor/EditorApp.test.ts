import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { EDITOR, EDITOR_APP, EDITOR_FIELDS, EDITOR_KEYS, EDITOR_PANES, EditorApps } from './EditorApp.js';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Stamps } from '../storage/Stamps.js';
import { magneticTestDatabase } from '../testing/testDb.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

/** The path of the first node kept under a key, anywhere in a tree */
function pathOfKey(node: unknown, key: string, at: string): string | undefined {
    if (typeof node !== 'object' || node === null) return undefined;
    const record = node as Record<string, unknown>;
    for (const slot of ['children', 'start', 'end', 'body']) {
        const inner = record[slot];
        if (typeof inner !== 'object' || inner === null) continue;
        if (slot === 'children') {
            for (const [name, child] of Object.entries(inner)) {
                if (name === key) return `${at}.children.${name}`;
                const found = pathOfKey(child, key, `${at}.children.${name}`);
                if (found !== undefined) return found;
            }
        } else {
            const found = pathOfKey(inner, key, `${at}.${slot}`);
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

describe("the editor's data", () => {
    it('should keep each field in one namespace with a model and a binding of its own, apart from the lists', () => {
        // Arrange
        const definition = EDITOR.definition() as { data: Record<string, { model: string }> };
        const lists = ['messages', 'calls', 'links', 'components', 'screens', 'connections', 'shared', 'paths', 'feed'];
        const namespaces = Object.keys(definition.data).filter((name) => !lists.includes(name));

        // Act
        const paths = Object.entries(EDITOR_FIELDS).filter(([field]) => EDITOR_PANES[field] === undefined);
        const linked = [...new Set(JSON.stringify(definition).match(/$.data.[A-Za-z]+/g) ?? [])].map((path) => path.slice('$.data.'.length));

        // Assert
        expect(namespaces).toEqual(['app', 'chat', 'inspector', 'sharing', 'preferences', 'feedback', 'canvas', 'rail', 'screensPanel', 'connectionsPanel', 'sharedPanel']);
        expect(linked.filter((name) => definition.data[name] === undefined)).toEqual([]);
        expect(EDITOR_FIELDS['status']).toBe('$.data.chat.status');
        expect(EDITOR_FIELDS['inspectorStatus']).toBe('$.data.inspector.inspectorStatus');
        expect(EDITOR_FIELDS['screenColumns']).toBe('$.data.screensPanel.screenColumns');
        for (const [field, path] of paths) {
            const [, , namespace, name] = path.split('.');
            expect(name, path).toBe(field);
            expect(namespaces, path).toContain(namespace);
            expect(/^d+$/.test(field), path).toBe(false);
            // A field is in its namespace's model, or it is a node's own state and left the model
            const inModel = EDITOR.models[definition.data[namespace as string]?.model ?? '']?.some((operation) => operation['field'] === field) === true;
            const own = Object.keys(EDITOR.own).some((owned) => owned === path || owned.startsWith(`${path}.`));
            expect(inModel || own, path).toBe(true);
        }
        for (const namespace of namespaces) expect(EDITOR.models[definition.data[namespace]?.model ?? '']?.length, namespace).toBeGreaterThan(0);
    });

    it("should take each pane's flag to the pane's own hidden by its id", () => {
        // Act
        const places = Object.fromEntries(Object.entries(EDITOR_PANES).map(([flag, id]) => [flag, EDITOR.own[EDITOR_FIELDS[flag] as string]]));

        // Assert
        expect(places['chatHidden']).toEqual(['chatPane.hidden']);
        for (const [flag, id] of Object.entries(EDITOR_PANES)) expect(places[flag], flag).toEqual([`${id}.hidden`]);
    });
});

describe('EditorApps', () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it("should make a person's editor in every language, keep it, keep their changes and reset it to Magnetic's", async () => {
        // Arrange
        const services = await magnetic.workspaces.get('7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');
        const tools = createStateUiTools(services);
        const editors = new EditorApps(() => tools, new Stamps(test.db));

        // Act
        const made = await editors.document(services, '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');
        const again = await editors.id(services, '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');
        const app = await services.instanceViews.find(made.id);
        const changed = await tools.find((tool) => tool.name === 'ui_nodes_write')!.run({ app: EDITOR_APP, screen: 'home', expectedRevision: app!.revision, operations: [{ op: 'set', path: 'root.children.stage.children.zoom.padding', value: 'md' }] } as never);
        const kept = await editors.id(services, '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');
        const reset = await editors.reset(services, '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');

        // Assert
        const document = made.document as { screens: { home: { root: unknown; locales?: Record<string, unknown> } } };
        expect(Object.keys(document.screens.home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        expect(pathOfKey(document.screens.home.root, EDITOR_KEYS.stage, '$.screens.home')).toBeDefined();
        expect(pathOfKey(document.screens.home.root, EDITOR_KEYS.propertyFields, '$.screens.home')).toBeDefined();
        expect(again).toBe(made.id);
        expect(changed.isError).toBe(false);
        expect(kept).toBe(made.id);
        expect(reset).not.toBe(made.id);
    }, 60_000);
});
