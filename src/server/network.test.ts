import { request } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { WebSocket } from 'ws';
import { magneticTestDatabase } from '../testing/testDb.js';
import { localTls } from './localTls.js';
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

/** An address of this machine other than 127.0.0.1, standing in for its address on the local network */
const NETWORK_HOST = '127.0.0.2';

interface Answer {
    readonly status: number;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: string;
}

describe('Magnetic on the local network', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let dir: string;
    let authority: string;

    /** A request to the network listener, trusting only the local authority */
    const https = (path: string, options: { method?: string; cookie?: string; form?: Record<string, string> } = {}): Promise<Answer> =>
        new Promise((resolve, reject) => {
            const url = new URL(path, magnetic.networkOrigin);
            const body = options.form === undefined ? undefined : new URLSearchParams(options.form).toString();
            const outgoing = request(
                {
                    host: url.hostname,
                    port: url.port,
                    path: `${url.pathname}${url.search}`,
                    method: options.method ?? 'GET',
                    ca: [authority],
                    headers: {
                        ...(options.cookie !== undefined && { Cookie: options.cookie }),
                        ...(body !== undefined && { 'Content-Type': 'application/x-www-form-urlencoded', Origin: magnetic.networkOrigin as string })
                    }
                },
                (response) => {
                    let text = '';
                    response.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
                    response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
                }
            );
            outgoing.on('error', reject);
            outgoing.end(body);
        });
    const cookieOf = (answer: Answer): string => ((answer.headers['set-cookie'] as string[] | undefined)?.[0] ?? '').split(';')[0] as string;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'magnetic-network-'));
        const tls = await localTls(dir, 'test', [NETWORK_HOST]);
        authority = await readFile(tls.authorityFile, 'utf8');
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            network: { host: NETWORK_HOST, key: tls.key, cert: tls.cert },
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice'],
            starter: 'none',
            browser: noBrowser,
            secretKey: 'network-test-secret-key-of-enough-length'
        });
    }, 60_000);

    afterAll(async () => {
        await magnetic?.stop();
        await test?.drop();
        await rm(dir, { recursive: true, force: true });
    });

    it('should serve its pages over HTTPS on the network address, with the runtime frame there too', async () => {
        // Act
        const page = await https('/signin');

        // Assert
        expect(magnetic.networkOrigin).toBe(`https://${NETWORK_HOST}:${magnetic.port}`);
        expect(page.status).toBe(200);
        expect(page.body).toContain(`https://${NETWORK_HOST}:${magnetic.runtimePort}/runtime/`);
    });

    it('should offer no development sign-in on the network address, only a link from another device', async () => {
        // Act
        const page = await https('/signin');
        const dev = await https('/signin/dev', { method: 'POST', form: { user: 'alice' } });

        // Assert
        expect(page.body).toContain('"noDevUsers":true');
        expect(page.body).toContain('"noProviders":true');
        expect(page.body).toContain('"noSso":true');
        expect(page.body).toContain('choose Sign in on another device');
        expect(dev.status).toBe(403);
    });

    it('should sign another device in with a link made where the person is signed in, once', async () => {
        // Arrange: alice signs in on this machine, over loopback, and makes a link
        const here = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice' });
        const hereCookie = (here.headers.get('set-cookie') ?? '').split(';')[0] as string;
        const linkPage = await (await fetch(`${magnetic.origin}/settings/device`, { headers: { Cookie: hereCookie } })).text();
        const link = new RegExp(`https://${NETWORK_HOST.replace(/\./g, '\\.')}:\\d+/signin/link/([A-Za-z0-9_-]{43})`).exec(linkPage);
        expect(link).not.toBeNull();
        const token = link?.[1] as string;

        // Act: the other device opens it, which only asks, then confirms
        const asked = await https(`/signin/link/${token}`);
        const confirmed = await https('/signin/link', { method: 'POST', form: { token, next: '/' } });
        const again = await https('/signin/link', { method: 'POST', form: { token, next: '/' } });

        // Assert
        expect(asked.status).toBe(200);
        expect(asked.body).toContain('Continue as alice');
        expect(asked.body).toContain('/signin/link');
        expect(confirmed.status).toBe(303);
        const cookie = cookieOf(confirmed);
        expect((confirmed.headers['set-cookie'] as string[])[0]).toContain('Secure');
        const session = await magnetic.sessions.find(cookie.split('=')[1]);
        const alice = await magnetic.sessions.find(hereCookie.split('=')[1]);
        expect(session?.userId).toBe(alice?.userId);
        expect(again.status).toBe(400);
        expect(again.body).toContain('has been used or has expired');
    });

    it('should open an app on the network address and sync it over a secure socket', async () => {
        // Arrange: a signed-in device on the network, and an app of the person's
        const here = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice' });
        const hereCookie = (here.headers.get('set-cookie') ?? '').split(';')[0] as string;
        const token = /\/signin\/link\/([A-Za-z0-9_-]{43})/.exec(await (await fetch(`${magnetic.origin}/settings/device`, { headers: { Cookie: hereCookie } })).text())?.[1] as string;
        const cookie = cookieOf(await https('/signin/link', { method: 'POST', form: { token, next: '/' } }));
        const made = await fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: hereCookie, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Notes' });
        const appId = ((await made.json()) as { id?: string }).id;
        expect(appId).toBeDefined();

        // Act
        const page = await https(`/apps/${appId}`, { cookie });
        const first = await new Promise<string>((resolve, reject) => {
            const socket = new WebSocket(`wss://${NETWORK_HOST}:${magnetic.port}/apps/${appId}/sync?view=${crypto.randomUUID()}`, { ca: [authority], headers: { Cookie: cookie, Origin: magnetic.networkOrigin as string } });
            socket.on('message', (data) => {
                resolve(String(data));
                socket.close();
            });
            socket.on('error', reject);
            socket.on('unexpected-response', (_request, response) => reject(new Error(`refused: ${response.statusCode}`)));
        });

        // Assert
        expect(page.status).toBe(200);
        expect(page.body).toContain(`https://${NETWORK_HOST}:${magnetic.runtimePort}/runtime/`);
        expect(JSON.parse(first)).toMatchObject({ type: 'view' });
    });
});
