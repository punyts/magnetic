import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMagnetic } from '../server/startMagnetic.js';
import type { MagneticOptions, RunningMagnetic } from '../server/startMagnetic.js';
import { hashEmbedder } from '@punyts/stateui-pg';
import { Chats } from '../agent/Chats.js';
import { Search } from './Search.js';
import type { Database } from '@punyts/stateui-pg';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';

const databases: TestDatabase[] = [];
/** A database of its own for each server a test starts, dropped after the file */
async function freshDb(): Promise<Database> {
    const test = await magneticTestDatabase();
    databases.push(test);
    return test.db;
}
afterAll(async () => {
    await Promise.all(databases.splice(0).map((test) => test.drop()));
});

const silent = { info: () => undefined };

/** No headless browser: these tests never preview */
const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

async function start(extra: Partial<MagneticOptions> = {}): Promise<RunningMagnetic> {
    return startMagnetic({
        database: await freshDb(),
        host: '127.0.0.1',
        port: 0,
        report: silent,
        devUsers: ['alice', 'bob'],
        starter: 'none',
        browser: noBrowser,
        embedder: hashEmbedder(),
        embedEveryMs: 60_000,
        ...extra
    });
}

/** Signs a development user in and returns the `Cookie` header that carries the session */
async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user }).toString(),
        redirect: 'manual'
    });
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie') ?? '';
    return cookie.split(';')[0] as string;
}

const get = (origin: string, path: string, cookie?: string): Promise<Response> => fetch(`${origin}${path}`, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });

describe('Semantic search', () => {
    let magnetic: RunningMagnetic;
    let alice: string;
    let aliceId: string;
    let bobId: string;

    const make = async (cookie: string, name: string): Promise<string> => {
        const made = await fetch(`${magnetic.origin}/new`, {
            method: 'POST',
            headers: { Cookie: cookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `name=${name}`
        });
        return ((await made.json()) as { id: string }).id;
    };

    beforeAll(async () => {
        magnetic = await start();
        alice = await signIn(magnetic.origin, 'alice');
        const bob = await signIn(magnetic.origin, 'bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        await make(alice, 'customer-orders');
        await make(alice, 'weather-station');
        await make(bob, 'customer-orders-ledger');
        await magnetic.index?.drain();
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
    });

    it("should find a person's apps by meaning, and never another person's", async () => {
        // Act
        const response = await get(magnetic.origin, `/search?q=${encodeURIComponent('orders from customers')}`, alice);
        const body = (await response.json()) as { apps: Array<{ name: string; workspaceId: string }>; semantic: boolean };

        // Assert
        expect(response.status).toBe(200);
        expect(body.semantic).toBe(true);
        expect(body.apps[0]?.name).toBe('customer-orders');
        expect(body.apps.every((app) => app.workspaceId === aliceId)).toBe(true);
        expect(body.apps.map((app) => app.name)).not.toContain('customer-orders-ledger');
    });

    it("should give the agent the workspace's parts and the person's own earlier chats, and nobody else's", async () => {
        // Arrange
        const chats = new Chats(magnetic.database, { embed: true });
        const weather = (await (await magnetic.workspaces.get(aliceId)).instanceViews.list()).find((app) => app.name === 'weather-station')?.id as string;
        await chats.append(aliceId, weather, { role: 'person', text: 'Show the rainfall for the last week as a bar chart', at: new Date().toISOString() });
        await chats.append(bobId, weather, { role: 'person', text: 'Rainfall secrets of bob', at: new Date().toISOString() }, aliceId);
        await magnetic.index?.drain();
        const tools = new Search(magnetic.database, magnetic.index as never, magnetic.access).tools(aliceId, aliceId);
        const run = (name: string, args: Record<string, unknown>): Promise<{ body: object }> => Promise.resolve(tools.find((tool) => tool.name === name)?.run(args) as Promise<{ body: object }>);

        // Act
        const parts = (await run('parts_search', { need: 'weather readings', kind: 'apps' })).body as { parts: Array<{ name: string }> };
        const recalled = (await run('chat_recall', { query: 'rainfall chart' })).body as { entries: Array<{ app: string; text: string }> };

        // Assert
        expect(parts.parts[0]?.name).toBe('weather-station');
        expect(recalled.entries).toEqual([expect.objectContaining({ app: 'weather-station', text: 'Show the rainfall for the last week as a bar chart' })]);
    });
});
