import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startMagnetic } from './startMagnetic.js';
import type { MagneticOptions, RunningMagnetic } from './startMagnetic.js';

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

async function start(dataDir: string, extra: Partial<MagneticOptions> = {}): Promise<RunningMagnetic> {
    return startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser, ...extra });
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

/** Opens a view socket; resolves with the socket once open, or with the refusal's status */
function openSocket(magnetic: RunningMagnetic, appId: string, cookie?: string): Promise<WebSocket | number> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${magnetic.origin.replace('http', 'ws')}/apps/${appId}/sync?view=${randomUUID()}`, {
            headers: { Origin: magnetic.origin, ...(cookie !== undefined && { Cookie: cookie }) }
        });
        ws.once('open', () => resolve(ws));
        ws.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        ws.once('error', reject);
    });
}

const closed = (ws: WebSocket): Promise<{ code: number; reason: string }> => new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));

async function createApp(magnetic: RunningMagnetic, cookie: string, name: string): Promise<string> {
    const session = await magnetic.sessions.find(cookie.split('=')[1]);
    if (session === undefined) throw new Error('signed in');
    const services = await magnetic.workspaces.get(session.userId);
    const created = await services.useCases.createPartApp.execute({ name });
    if (created.kind !== 'created') throw new Error(`created ${name}: ${created.kind}`);
    return created.id;
}

describe('Magnetic', () => {
    let dataDir: string;
    let magnetic: RunningMagnetic;
    let alice: string;
    let bob: string;
    let aliceApp: string;

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-'));
        magnetic = await start(dataDir);
        alice = await signIn(magnetic.origin, 'alice');
        bob = await signIn(magnetic.origin, 'bob');
        aliceApp = await createApp(magnetic, alice, 'notes');
    });

    afterAll(async () => {
        await magnetic.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    describe('signing in', () => {
        it('should send a page request without a session to the sign-in page', async () => {
            // Act
            const home = await get(magnetic.origin, '/');
            const app = await get(magnetic.origin, `/apps/${aliceApp}`);

            // Assert
            expect(home.status).toBe(303);
            expect(home.headers.get('location')).toBe('/signin');
            expect(app.status).toBe(303);
            expect(app.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/apps/${aliceApp}`)}`);
        });

        it('should refuse anything else without a session with 401', async () => {
            // Act
            const report = await fetch(`${magnetic.origin}/apps/${aliceApp}/report`, { method: 'POST', body: '{}' });
            const file = await get(magnetic.origin, `/apps/${aliceApp}/files/${randomUUID()}`);

            // Assert
            expect(report.status).toBe(401);
            expect(await report.json()).toMatchObject({ error: 'unauthorized' });
            expect(file.status).toBe(401);
        });

        it('should offer a button for each development user', async () => {
            // Act
            const response = await get(magnetic.origin, '/signin');
            const html = await response.text();

            // Assert
            expect(response.status).toBe(200);
            expect(response.headers.get('content-security-policy')).toContain("form-action 'self'");
            // With no-referrer a browser posts the form with Origin: null, which the same-origin check refuses
            expect(response.headers.get('referrer-policy')).toBe('same-origin');
            expect(html).toContain('Sign in as alice');
            expect(html).toContain('Sign in as bob');
        });

        it('should set an HttpOnly, SameSite=Lax session cookie and keep only its hash on disk', async () => {
            // Act
            const response = await fetch(`${magnetic.origin}/signin/dev`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'user=alice',
                redirect: 'manual'
            });
            const cookie = response.headers.get('set-cookie') ?? '';
            const token = cookie.split(';')[0]?.split('=')[1] as string;

            // Assert
            expect(response.headers.get('location')).toBe('/');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('SameSite=Lax');
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect(await readFile(join(dataDir, 'sessions.json'), 'utf8')).not.toContain(token);
        });

        it('should sign the same development user in as the same user each time', async () => {
            // Act
            const again = await signIn(magnetic.origin, 'alice');

            // Assert
            const first = await magnetic.sessions.find(alice.split('=')[1]);
            const second = await magnetic.sessions.find(again.split('=')[1]);
            expect(second?.userId).toBe(first?.userId);
        });

        it('should refuse a name that is not a development user', async () => {
            // Act
            const response = await fetch(`${magnetic.origin}/signin/dev`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'user=mallory',
                redirect: 'manual'
            });

            // Assert
            expect(response.status).toBe(403);
        });

        it('should refuse a cross-origin sign-in', async () => {
            // Act
            const response = await fetch(`${magnetic.origin}/signin/dev`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://elsewhere.example' },
                body: 'user=alice',
                redirect: 'manual'
            });

            // Assert
            expect(response.status).toBe(403);
        });
    });

    describe('workspaces', () => {
        it("should list only the signed-in user's apps", async () => {
            // Act
            const aliceHome = await (await get(magnetic.origin, '/', alice)).text();
            const bobHome = await (await get(magnetic.origin, '/', bob)).text();

            // Assert
            expect(aliceHome).toContain(`href="/apps/${aliceApp}"`);
            expect(aliceHome).toContain('alice');
            expect(bobHome).not.toContain(aliceApp);
            expect(bobHome).toContain('No apps yet.');
        });

        it("should not find another user's app, page or socket", async () => {
            // Act
            const own = await get(magnetic.origin, `/apps/${aliceApp}`, alice);
            const other = await get(magnetic.origin, `/apps/${aliceApp}`, bob);
            const socket = await openSocket(magnetic, aliceApp, bob);

            // Assert
            expect(own.status).toBe(200);
            expect(other.status).toBe(404);
            expect(socket).toBe(404);
        });

        it("should keep each user's parts in their own folder", async () => {
            // Arrange
            const session = await magnetic.sessions.find(alice.split('=')[1]);

            // Act
            const names = JSON.parse(await readFile(join(dataDir, 'users', session?.userId as string, 'names.json'), 'utf8')) as { apps: Record<string, string> };

            // Assert
            expect(names.apps['notes']).toBe(aliceApp);
        });

        it('should refuse a view socket without a session', async () => {
            // Act
            const socket = await openSocket(magnetic, aliceApp);

            // Assert
            expect(socket).toBe(401);
        });
    });

    describe('signing out', () => {
        it("should close the session's sockets and stop its cookie working", async () => {
            // Arrange
            const cookie = await signIn(magnetic.origin, 'alice');
            const ws = await openSocket(magnetic, aliceApp, cookie);
            if (typeof ws === 'number') throw new Error(`socket refused with ${ws}`);
            const other = await openSocket(magnetic, aliceApp, alice);
            if (typeof other === 'number') throw new Error(`socket refused with ${other}`);
            const ended = closed(ws);

            // Act
            const response = await fetch(`${magnetic.origin}/signout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });

            // Assert
            expect(response.status).toBe(303);
            expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
            expect(await ended).toEqual({ code: 1008, reason: 'Signed out' });
            expect(other.readyState).toBe(WebSocket.OPEN);
            expect((await get(magnetic.origin, '/', cookie)).headers.get('location')).toBe('/signin');
            other.close();
        });
    });
});

describe('Magnetic limits', () => {
    it('should close a view socket that sends more messages than its rate allows', async () => {
        // Arrange
        const dataDir = await mkdtemp(join(tmpdir(), 'magnetic-'));
        const magnetic = await start(dataDir, { socketMessagesPerSecond: 5 });
        try {
            const cookie = await signIn(magnetic.origin, 'alice');
            const appId = await createApp(magnetic, cookie, 'flood');
            const ws = await openSocket(magnetic, appId, cookie);
            if (typeof ws === 'number') throw new Error(`socket refused with ${ws}`);
            const ended = closed(ws);

            // Act
            for (let index = 0; index < 30; index++) ws.send(JSON.stringify({ type: 'emit', name: 'ping' }));

            // Assert
            expect(await ended).toEqual({ code: 1008, reason: 'Too many messages' });
        } finally {
            await magnetic.stop();
            await rm(dataDir, { recursive: true, force: true });
        }
    });

    it('should refuse to offer development users on a host that is not loopback', async () => {
        await expect(start(tmpdir(), { host: '0.0.0.0' })).rejects.toThrow('Development users are only offered on a loopback host');
    });

    it('should give a new workspace the component showcase as its starter', async () => {
        // Arrange
        const dataDir = await mkdtemp(join(tmpdir(), 'magnetic-'));
        const magnetic = await start(dataDir, { starter: 'showcase' });
        try {
            const cookie = await signIn(magnetic.origin, 'bob');

            // Act
            const home = await (await get(magnetic.origin, '/', cookie)).text();

            // Assert
            expect(home).toContain('component-showcase');
        } finally {
            await magnetic.stop();
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});
