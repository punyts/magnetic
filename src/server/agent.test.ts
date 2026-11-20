import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeClient } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

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

/** Where the agent would listen on the person's computer; nothing listens, the test reads the redirect */
const REDIRECT = 'http://127.0.0.1:53111/callback';

interface Tokens {
    readonly access_token: string;
    readonly refresh_token: string;
    readonly expires_in: number;
}

describe('An agent signed in as a person', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser, secretKey: 'agent-test-secret-key-of-enough-length' });
    }, 60_000);

    afterAll(async () => {
        await magnetic?.stop();
        await test?.drop();
    });

    const signIn = async (user: string): Promise<string> => {
        const answer = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `user=${user}` });
        return (answer.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };

    /** The agent's whole sign-in: the ask, the person allowing it in their browser, and the trade of the code */
    const agentFor = async (cookie: string): Promise<Tokens> => {
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const ask = `/agent/authorize?response_type=code&client_id=stateui-mcp&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=st`;
        const page = await (await fetch(`${magnetic.origin}${ask}`, { headers: { Cookie: cookie } })).text();
        const id = /"id":"([A-Za-z0-9_-]{43})"/.exec(page)?.[1] as string;
        const allowed = await fetch(`${magnetic.origin}/agent/allow/${id}`, { redirect: 'manual', headers: { Cookie: cookie } });
        const back = new URL(allowed.headers.get('location') as string);
        const answer = await fetch(`${magnetic.origin}/agent/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code') as string, code_verifier: verifier, redirect_uri: REDIRECT }).toString()
        });
        return (await answer.json()) as Tokens;
    };

    const call = async (tokens: Tokens, name: string, args: Record<string, unknown>): Promise<{ status: number; outcome: { isError: boolean; body: Record<string, unknown> } }> => {
        const answer = await fetch(`${magnetic.origin}/agent/call`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
        return { status: answer.status, outcome: (await answer.json()) as { isError: boolean; body: Record<string, unknown> } };
    };

    it('should ask a person who is not signed in to sign in first, and refuse an ask that is not an agent\'s', async () => {
        // Act
        const unsigned = await fetch(`${magnetic.origin}/agent/authorize?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&state=`, { redirect: 'manual' });
        const elsewhere = await fetch(`${magnetic.origin}/agent/authorize?response_type=code&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256&state=`, { redirect: 'manual', headers: { Cookie: await signIn('alice') } });
        const plain = await fetch(`${magnetic.origin}/agent/authorize?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${'a'.repeat(43)}&code_challenge_method=plain&state=`, { redirect: 'manual', headers: { Cookie: await signIn('alice') } });

        // Assert
        expect(unsigned.status).toBe(303);
        expect(unsigned.headers.get('location')).toMatch(/^\/signin\?next=%2Fagent%2Fauthorize%3F/);
        expect(elsewhere.status).toBe(400);
        expect(plain.status).toBe(400);
    });

    it('should show the person what the agent asks, and send the agent its code once they allow it', async () => {
        // Arrange
        const cookie = await signIn('alice');
        const ask = `/agent/authorize?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${'b'.repeat(43)}&code_challenge_method=S256&state=xyz`;

        // Act
        const page = await (await fetch(`${magnetic.origin}${ask}`, { headers: { Cookie: cookie } })).text();
        const id = /"id":"([A-Za-z0-9_-]{43})"/.exec(page)?.[1] as string;
        const allowed = await fetch(`${magnetic.origin}/agent/allow/${id}`, { redirect: 'manual', headers: { Cookie: cookie } });
        const again = await fetch(`${magnetic.origin}/agent/allow/${id}`, { redirect: 'manual', headers: { Cookie: cookie } });
        const otherSession = await fetch(`${magnetic.origin}/agent/allow/${id}`, { redirect: 'manual', headers: { Cookie: await signIn('alice') } });

        // Assert
        expect(page).toContain('Allow, as alice');
        expect(page).toContain('stateui-mcp');
        expect(page).toContain('/agent/allow/{id}');
        expect(allowed.status).toBe(303);
        const back = new URL(allowed.headers.get('location') as string);
        expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
        expect(back.searchParams.get('state')).toBe('xyz');
        expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(again.status).toBe(400);
        expect(otherSession.status).toBe(400);
    });

    it("should run the tools in the person's own workspace, where their views read the app", async () => {
        // Arrange
        const cookie = await signIn('alice');
        const made = await fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Notes' });
        const appId = ((await made.json()) as { id: string }).id;
        const tokens = await agentFor(cookie);
        const aliceId = ((await magnetic.sessions.find(cookie.split('=')[1])) as { userId: string }).userId;

        // Act
        const tools = (await (await fetch(`${magnetic.origin}/agent/tools`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json()) as { instructions: string; tools: Array<{ name: string }> };
        const listed = await call(tokens, 'ui_list', { kind: 'apps' });
        const written = await call(tokens, 'ui_screen_create', { app: 'notes', name: 'about', title: 'From the agent', expectedRevision: 1, root: { component: 'panel' } });

        // Assert
        expect(tokens.expires_in).toBe(3600);
        expect(tools.instructions.length).toBeGreaterThan(1000);
        expect(tools.tools.map((tool) => tool.name)).toContain('ui_app_create');
        expect(tools.tools.map((tool) => tool.name)).not.toContain('ui_preview');
        expect(JSON.stringify(listed.outcome.body)).toContain('"notes"');
        expect(written.outcome.isError).toBe(false);
        const screens = await (await magnetic.workspaces.get(aliceId)).useCases.listParts?.execute({ kind: 'screens', app: 'notes' });
        expect(JSON.stringify(screens)).toContain('From the agent');
        expect(appId).toBeDefined();
    });

    it('should not reach another person\'s apps, and should stop when the person signs out', async () => {
        // Arrange
        const aliceCookie = await signIn('alice');
        await fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: aliceCookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Diary' });
        const bobCookie = await signIn('bob');
        const bob = await agentFor(bobCookie);

        // Act
        const listed = await call(bob, 'ui_list', { kind: 'apps' });
        const set = await call(bob, 'ui_state_set', { app: 'diary', path: '$.data.note', value: 'not mine' });
        await fetch(`${magnetic.origin}/signout`, { method: 'POST', redirect: 'manual', headers: { Cookie: bobCookie } });
        const after = await call(bob, 'ui_list', { kind: 'apps' });
        const refreshed = await fetch(`${magnetic.origin}/agent/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: bob.refresh_token }).toString() });

        // Assert
        expect(JSON.stringify(listed.outcome.body)).not.toContain('diary');
        expect(set.outcome.isError).toBe(true);
        expect(after.status).toBe(401);
        expect(refreshed.status).toBe(400);
    });

    it('should let a standalone stateui-mcp sign in as the person in their browser and change their app', async () => {
        // Arrange: alice is signed in in her browser, which allows what the agent asks
        const cookie = await signIn('alice');
        await fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Tasks' });
        const browser = (url: string): void => {
            void (async () => {
                const page = await (await fetch(url, { headers: { Cookie: cookie } })).text();
                const id = /"id":"([A-Za-z0-9_-]{43})"/.exec(page)?.[1] as string;
                const allowed = await fetch(`${magnetic.origin}/agent/allow/${id}`, { redirect: 'manual', headers: { Cookie: cookie } });
                await fetch(allowed.headers.get('location') as string);
            })();
        };
        const dataDir = await mkdtemp(join(tmpdir(), 'magnetic-agent-'));
        const agent = new NodeClient({ url: magnetic.origin, dataDir, report: { info: () => undefined }, openBrowser: browser, signInMs: 10_000 });

        try {
            // Act
            await agent.signIn();
            const tools = await agent.tools();
            const written = await agent.call('ui_screen_create', { app: 'tasks', name: 'done', title: 'Done by the agent', expectedRevision: 1, root: { component: 'panel' } });

            // Assert
            expect(tools.tools.length).toBeGreaterThan(20);
            expect(written.isError).toBe(false);
            const aliceId = ((await magnetic.sessions.find(cookie.split('=')[1])) as { userId: string }).userId;
            expect(JSON.stringify(await (await magnetic.workspaces.get(aliceId)).useCases.listParts?.execute({ kind: 'screens', app: 'tasks' }))).toContain('Done by the agent');
        } finally {
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});
