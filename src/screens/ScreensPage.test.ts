import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { SCREENS_HEARING, SCREENS_KEYS } from './ScreensPage.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

interface Node {
    component: string;
    children?: Record<string, Node>;
    content?: Node;
    card?: Node;
    on?: Record<string, unknown>;
}

describe('The screens board page', () => {
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

    it('should serve a signed-in person the canvas around the board of screens, in every language, with the node ids the page script hears', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/screens.json`);
        const served = await fetch(`${magnetic.origin}/assets/screens.json`, { headers: { Cookie: alice } });
        const body = (await served.json()) as { document: { screens: { home: { root: Node; locales?: Record<string, unknown> } } } };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        const home = body.document.screens.home;
        expect(Object.keys(home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        const canvas = home.root.children?.[SCREENS_KEYS.canvas] as Node;
        expect(canvas).toMatchObject({ component: 'viewport', '<-zoom': '$.data.screens.view.zoom', '<-inset': '$.data.screens.inset' });
        expect(canvas).toMatchObject({ '@id': 'canvas' });
        const board = canvas.content as Node;
        expect(board).toMatchObject({ component: 'board', key: 'id', columnField: 'column', orderField: 'row', bare: true, '<-records': '$.data.screens.tiles', '<-movable': '$.data.screens.names' });
        expect(board).toMatchObject({ '@id': 'board' });
        const card = (board.card as Node).children?.['tile'] as Node;
        expect(card.children?.['app']).toMatchObject({ component: 'embeddedApp', '<-live': '$row.live', '<-active': '$row.active', '<-appScreen': '$row.id' });
        expect(card.children?.['app']).toMatchObject({ '@id': 'app' });
        expect(Object.keys(SCREENS_HEARING).filter((key) => key.startsWith('app.')).sort()).toEqual(['app.menu', 'app.navigated', 'app.press']);
    }, 60_000);
});
