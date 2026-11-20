import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractGaps } from '../pages/PageSpec.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { LANES, LOGIC, UNIT_GROUPS } from './LogicPage.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

interface Node {
    component: string;
    children?: Record<string, Node>;
    columns?: Record<string, unknown>;
    card?: Node;
    options?: Record<string, unknown>;
    on?: Record<string, unknown>;
}

describe("The Logic view's page", () => {
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

    it('should serve a signed-in person the two lanes of units and the handlers, in every language, with every emit of its contract', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/logic.json`);
        const served = await fetch(`${magnetic.origin}/assets/logic.json`, { headers: { Cookie: alice } });
        const body = (await served.json()) as { document: { screens: { home: { root: Node; locales?: Record<string, unknown> } } } };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        const home = body.document.screens.home;
        expect(Object.keys(home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        expect(contractGaps(LOGIC, body.document)).toEqual([]);
        const lanes = home.root.children?.['lanes'] as Node;
        expect(lanes).toMatchObject({ component: 'board', columnField: 'runs', '<-records': '$.data.logic.units', on: { move: { command: 'emit', target: 'move' } } });
        expect(Object.keys(lanes.columns ?? {})).toEqual([...LANES]);
        expect(lanes.card?.on).toEqual({ press: { command: 'emit', target: 'open', from: '$row.id' } });
        expect(Object.keys(home.root.children?.['head']?.children?.['group']?.options ?? {})).toEqual(Object.keys(UNIT_GROUPS));
    }, 60_000);
});
