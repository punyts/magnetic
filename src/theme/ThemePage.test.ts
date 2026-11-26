import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractGaps } from '../pages/PageSpec.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { THEME, THEME_HEARING, THEME_MODES } from './ThemePage.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

interface Node {
    component: string;
    children?: Record<string, Node>;
    columns?: Record<string, { cell?: Node }>;
    on?: Record<string, unknown>;
}

describe("The Theme view's page", () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;
    let alice: string;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user: 'alice' }).toString(), redirect: 'manual' });
        alice = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should serve a signed-in person the specimens and the token table, in every language, with every node id of its contract', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/theme.json`);
        const served = await fetch(`${magnetic.origin}/assets/theme.json`, { headers: { Cookie: alice } });
        const body = (await served.json()) as { document: { screens: { home: { root: Node; locales?: Record<string, unknown> } } } };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        const home = body.document.screens.home;
        expect(Object.keys(home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        expect(contractGaps(THEME, body.document)).toEqual([]);
        expect(Object.keys(home.root.children?.['specimens']?.children ?? {})).toEqual([...THEME_MODES]);
        const table = home.root.children?.['tokens'] as Node;
        expect(table).toMatchObject({ component: 'table', '<-items': '$.data.theme.tokens' });
        expect(Object.keys(table.columns ?? {})).toEqual(['group', 'name', 'all', ...THEME_MODES]);
        expect(table.columns?.['dark']?.cell).toMatchObject({ component: 'input', '<-value': '$row.dark', '@id': 'darkValue' });
        expect(THEME_HEARING['darkValue.change']).toEqual({ name: 'token', from: 'row', merge: 'dark' });
    }, 60_000);
});
