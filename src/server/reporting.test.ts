import { addListener, clearListeners, setCategories } from '@punyts/core';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { MockAgentModel } from '../testing/mockAgentModel.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { listenToLibraries, routeOf } from './reporting.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

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

interface Reported {
    readonly category: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
}

describe('routeOf', () => {
    it('should keep the words of a route and put :id for ids, codes, tokens and names', () => {
        // Act
        const routes = [
            routeOf('/signin/link/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'),
            routeOf('/edit/0b9c2f1e-6a1d-4c8e-9f00-1a2b3c4d5e6f/views/layers'),
            routeOf('/s/sharecode'),
            routeOf('/beta/spring'),
            routeOf('/scim/v2/0b9c2f1e-6a1d-4c8e-9f00-1a2b3c4d5e6f/Users/someone'),
            routeOf('/agent/allow/token'),
            routeOf('/'),
            routeOf('/assets/magnetic.css')
        ];

        // Assert
        expect(routes).toEqual(['/signin/link/:id', '/edit/:id/views/layers', '/s/:id', '/beta/:id', '/scim/v2/:id/Users/:id', '/agent/allow/:id', '/', '/assets/magnetic.css']);
    });
});

describe('Reporting of Magnetic', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    const reported: Reported[] = [];
    const lines: string[] = [];

    beforeAll(async () => {
        // The host's listener, as the CLI adds it, and the test's own for every category
        listenToLibraries('magnetic', ['magnetic.*'], (line) => lines.push(line));
        addListener((_timestamp, category, message, details) => reported.push({ category, message, details: details as Record<string, unknown> }), ['magnetic.*']);
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice'],
            devProfiles: { alice: { name: 'Alice', email: 'alice.reporting@example.com' } },
            starter: 'none',
            browser: noBrowser,
            secretKey: 'reporting-test-secret-key-of-length',
            agent: { model: new MockAgentModel(0) }
        });
    }, 60_000);

    afterAll(async () => {
        await magnetic?.stop();
        await test?.drop();
        setCategories(['info', 'error', 'stack']);
        clearListeners();
    });

    it("should report requests, sign-ins, the agent's turn, budgets, pages, state and locks with ids, names and durations, and no value", async () => {
        // Arrange
        const secretWords = 'xyzzy-plugh-words';
        const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice&next=%2F%3Fq%3Dquery-value' });
        const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
        const token = cookie.split('=')[1] as string;
        const made = await fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Notes' });
        const appId = ((await made.json()) as { id: string }).id;
        const userId = (await magnetic.sessions.find(token))?.userId as string;

        // Act
        await fetch(`${magnetic.origin}/?q=query-value`, { headers: { Cookie: cookie } });
        const turn = await fetch(`${magnetic.origin}/edit/${appId}/turns`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Add a title saying ${secretWords}` }) });
        while (magnetic.turns.isRunning(userId)) await new Promise((resolve) => setTimeout(resolve, 10));
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Assert
        expect(turn.status).toBe(202);
        const of = (category: string, message?: string): Reported[] => reported.filter((each) => each.category === category && (message === undefined || each.message === message));
        expect(of('magnetic.signin')).toContainEqual({ category: 'magnetic.signin', message: 'Sign-in', details: { provider: 'dev', outcome: 'signed-in' } });
        expect(of('magnetic.http').map((each) => each.details)).toContainEqual({ method: 'POST', route: `/edit/:id/turns`, status: 202, ms: expect.any(Number) });
        expect(of('magnetic.http').map((each) => each.details)).toContainEqual({ method: 'GET', route: '/', status: 200, ms: expect.any(Number) });
        expect(of('magnetic.budget', 'Budget checked').map((each) => each.details)).toContainEqual({ userId, decision: 'allowed' });
        expect(of('magnetic.agent', 'Turn started')[0]?.details).toEqual({ appId, model: 'claude-haiku-5-5' });
        const ended = of('magnetic.agent', 'Turn ended')[0]?.details;
        expect(ended).toMatchObject({ appId, model: 'claude-haiku-5-5', outcome: 'finished', ms: expect.any(Number) });
        expect(ended?.['toolCalls']).toContain('ui_tree');
        expect(of('magnetic.agent', 'Tool called')[0]?.details).toMatchObject({ appId, tool: 'ui_tree', ok: true, ms: expect.any(Number) });
        expect(of('magnetic.agent', 'Model answered')[0]?.details).toMatchObject({ appId, stop: 'tool_use', ms: expect.any(Number) });
        expect(of('magnetic.pages').map((each) => each.message)).toContain("Person's copy made");
        expect(of('magnetic.storage', 'Lock taken')[0]?.details).toMatchObject({ key: expect.any(String), waitedMs: expect.any(Number) });
        expect(of('magnetic.statenet', 'State saved')[0]?.details).toEqual({ namespace: expect.stringMatching(/\/apps\//), revision: expect.any(Number), changes: expect.any(Number), epoch: expect.any(Number), ms: expect.any(Number) });
        const everything = JSON.stringify(reported);
        for (const value of [secretWords, token, 'alice.reporting@example.com', 'query-value', 'Notes']) expect(everything).not.toContain(value);
        expect(lines.some((line) => line.startsWith('[magnetic] magnetic.agent Turn ended {'))).toBe(true);
    });
});
