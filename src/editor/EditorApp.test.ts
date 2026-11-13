import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { EDITOR_APP, EDITOR_KEYS, EditorApps } from './EditorApp.js';

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

describe('EditorApps', () => {
    let dataDir: string;
    let magnetic: RunningMagnetic;

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-editor-app-'));
        magnetic = await startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    it("should make a person's editor in every language, keep it, keep their changes and reset it to Magnetic's", async () => {
        // Arrange
        const services = await magnetic.workspaces.get('7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01');
        const tools = createStateUiTools(services);
        const editors = new EditorApps(() => tools, join(dataDir, 'users'));

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
