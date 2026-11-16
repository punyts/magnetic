import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { SecretBox } from '../auth/secrets.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Connections } from './Connections.js';
import { CallRefused, checkUrl, guardedCall, isBlockedAddress } from './guard.js';
import { CallLimits, httpEffect, urlOf } from './httpEffect.js';
import { connectionFacts } from './facts.js';

const WORKSPACE = '00000000-0000-4000-8000-0000000000c1';
const USER = '00000000-0000-4000-8000-0000000000c2';
const LOCAL = { allowHttp: true, allowPrivate: true };

/** A stand-in API: what each request asked, and its answers by path */
let api: Server;
let apiUrl = '';
const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let tokensGiven = 0;

beforeAll(async () => {
    api = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
            const path = (request.url ?? '').split('?')[0];
            const json = (status: number, value: unknown): void => {
                response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
            };
            if (path === '/token') {
                tokensGiven += 1;
                const form = new URLSearchParams(body);
                if (form.get('client_secret') !== 'shh') return json(401, { error: 'invalid_client' });
                return json(200, { access_token: `token-${tokensGiven}`, expires_in: 3600 });
            }
            if (path === '/forecast/oslo') return json(200, { city: 'Oslo', days: [{ day: 'mon', c: 3 }, { day: 'tue', c: 5 }] });
            if (path === '/secure') return request.headers.authorization === `Bearer token-${tokensGiven}` ? json(200, { ok: true }) : json(401, { error: 'no' });
            if (path === '/moved') return void response.writeHead(302, { Location: 'http://169.254.169.254/' }).end();
            if (path === '/big') return void response.writeHead(200, { 'Content-Type': 'text/plain' }).end('x'.repeat(1_100_000));
            if (path === '/notes') return json(201, { saved: JSON.parse(body || 'null') });
            json(404, { error: 'not found' });
        });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise((resolve) => api.close(resolve));
});

describe('The guard on outgoing calls', () => {
    it('should refuse this machine, private networks, the metadata service and other blocked ranges, in IPv4 and IPv6', () => {
        for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254'])
            expect(isBlockedAddress(address), address).toBe(true);
        for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(address), address).toBe(false);
    });

    it('should take only https URLs with no user, to a public address', () => {
        expect(checkUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
        for (const url of ['http://api.example.com', 'https://user:pass@api.example.com', 'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://localhost/', 'ftp://example.com', 'not a url'])
            expect(() => checkUrl(url), url).toThrow(CallRefused);
    });

    it('should refuse a name that resolves to a blocked address when the call is made', async () => {
        await expect(guardedCall('https://localtest.me/', { method: 'GET' })).rejects.toThrow(/not on the public internet|failed/);
    });

    it('should follow no redirect, and stop an answer over 1 MB', async () => {
        await expect(guardedCall(`${apiUrl}/moved`, { method: 'GET' }, LOCAL)).rejects.toThrow(/redirect/);
        await expect(guardedCall(`${apiUrl}/big`, { method: 'GET' }, LOCAL)).rejects.toThrow(/larger than 1 MB/);
    });
});

describe('Connections and the http effect', () => {
    let test: TestDatabase;
    let connections: Connections;
    const reports: Record<string, unknown>[] = [];
    const effect = (limits = new CallLimits()) => httpEffect({ connections, workspaceId: WORKSPACE, appId: 'app-1', limits, report: (_message, fields) => reports.push(fields), guard: LOCAL });
    const signal = new AbortController().signal;

    beforeEach(async () => {
        test = await magneticTestDatabase();
        connections = new Connections(test.db, new SecretBox('a-test-secret-key-of-length'), LOCAL);
        seen.length = 0;
        reports.length = 0;
    });

    afterEach(async () => {
        await test.drop();
    });

    it('should call an endpoint with its params and key, and give the records at its path', async () => {
        // Arrange
        const weather = await connections.create(WORKSPACE, USER, { name: 'weather', baseUrl: apiUrl, auth: { kind: 'key', in: 'header', name: 'Authorization', prefix: 'Key ' } });
        await connections.setSecret(weather.id, 'key', 'k-123');
        await connections.setEndpoint(weather.id, { name: 'forecast', method: 'GET', path: '/forecast/{city}', query: { units: '{units}' }, records: 'days' });

        // Act
        const answer = await effect()({ connection: 'weather', endpoint: 'forecast', params: { city: 'oslo', units: 'metric' } }, { signal });

        // Assert
        expect(answer).toEqual({ first: 0, records: [{ day: 'mon', c: 3 }, { day: 'tue', c: 5 }], total: 2 });
        expect(seen[0]).toMatchObject({ method: 'GET', url: '/forecast/oslo?units=metric', headers: { authorization: 'Key k-123' } });
        expect(reports).toEqual([{ workspace: WORKSPACE, app: 'app-1', connection: 'weather', endpoint: 'forecast', status: 200, ms: expect.any(Number) }]);
        // The page sees whether the key is set, never the key
        expect(JSON.stringify(await connections.list(WORKSPACE))).not.toContain('k-123');
        expect((await connections.get(WORKSPACE, 'weather'))?.keySet).toBe(true);
        // The key is sealed in the database
        expect(JSON.stringify((await test.db.query('SELECT secrets FROM connection')).rows)).not.toContain('k-123');
    });

    it('should get a client-credentials token once and use it while it lasts', async () => {
        // Arrange
        const secure = await connections.create(WORKSPACE, USER, { name: 'secure', baseUrl: apiUrl, auth: { kind: 'oauth-client', tokenUrl: `${apiUrl}/token`, clientId: 'magnetic' } });
        await connections.setSecret(secure.id, 'clientSecret', 'shh');
        await connections.setEndpoint(secure.id, { name: 'check', method: 'GET', path: '/secure' });
        const before = tokensGiven;

        // Act
        const first = await effect()({ connection: 'secure', endpoint: 'check' }, { signal });
        const second = await effect()({ connection: 'secure', endpoint: 'check' }, { signal });

        // Assert
        expect(first).toEqual({ value: { ok: true } });
        expect(second).toEqual({ value: { ok: true } });
        expect(tokensGiven - before).toBe(1);
    });

    it('should tell the agent each connection, endpoint and param, and never a key', async () => {
        expect(await connectionFacts(connections, WORKSPACE)).toBeUndefined();
        const weather = await connections.create(WORKSPACE, USER, { name: 'weather', baseUrl: 'https://api.weather.example/v1', auth: { kind: 'key', in: 'header', name: 'X-Api-Key' } });
        await connections.setSecret(weather.id, 'key', 'never-tell');
        await connections.setEndpoint(weather.id, { name: 'forecast', method: 'GET', path: '/forecast/{city}', query: { units: '{units}' }, records: 'days' });
        const facts = (await connectionFacts(connections, WORKSPACE)) as string;
        expect(facts).toContain('- weather (api.weather.example)');
        expect(facts).toContain('  - forecast: GET /forecast/{city}, params city, units; answers records (at days)');
        expect(facts).toContain('run: "http"');
        expect(facts).not.toContain('never-tell');
    });

    it('should send a body with params in it', async () => {
        const notes = await connections.create(WORKSPACE, USER, { name: 'notes', baseUrl: apiUrl, auth: { kind: 'none' } });
        await connections.setEndpoint(notes.id, { name: 'add', method: 'POST', path: '/notes', body: { title: '{title}', done: '{done}', tag: 'from {who}' } });
        const answer = await effect()({ connection: 'notes', endpoint: 'add', params: { title: 'Milk', done: false, who: 'Ana' } }, { signal });
        expect(answer).toEqual({ value: { saved: { title: 'Milk', done: false, tag: 'from Ana' } } });
    });

    it('should refuse an unknown connection or endpoint, a missing param, a non-2xx answer and an app over its calls for the minute', async () => {
        const weather = await connections.create(WORKSPACE, USER, { name: 'weather', baseUrl: apiUrl, auth: { kind: 'none' } });
        await connections.setEndpoint(weather.id, { name: 'forecast', method: 'GET', path: '/forecast/{city}' });
        const run = effect(new CallLimits(2));
        await expect(run({ connection: 'nope', endpoint: 'forecast' }, { signal })).rejects.toThrow('There is no connection "nope".');
        await expect(run({ connection: 'weather', endpoint: 'nope' }, { signal })).rejects.toThrow('has no endpoint "nope"');
        await expect(run({ connection: 'weather', endpoint: 'forecast' }, { signal })).rejects.toThrow('The request has no param "city".');
        await expect(run({ connection: 'weather', endpoint: 'forecast', params: { city: 'paris' } }, { signal })).rejects.toThrow('The API answered 404.');
        await expect(run({ connection: 'weather', endpoint: 'forecast', params: { city: 'oslo' } }, { signal })).rejects.toThrow('calls this minute');
    });

    it('should keep a call on its connection\'s host: a param cannot reach another host or path above', () => {
        const endpoint = { name: 'get', method: 'GET' as const, path: '/items/{id}' };
        expect(urlOf({ baseUrl: 'https://api.example.com/v1' }, endpoint, { id: '../../admin' }).toString()).toBe('https://api.example.com/v1/items/..%2F..%2Fadmin');
        expect(urlOf({ baseUrl: 'https://api.example.com' }, endpoint, { id: '@evil.example.com' }).host).toBe('api.example.com');
    });

    it('should refuse what is not a connection: a bad name, a non-https base URL, a path with a query or dot segments', async () => {
        const strict = new Connections(test.db, new SecretBox('a-test-secret-key-of-length'));
        await expect(strict.create(WORKSPACE, USER, { name: 'Bad Name', baseUrl: 'https://api.example.com', auth: { kind: 'none' } })).rejects.toThrow('lower-case');
        await expect(strict.create(WORKSPACE, USER, { name: 'plain', baseUrl: 'http://api.example.com', auth: { kind: 'none' } })).rejects.toThrow('https');
        await expect(strict.create(WORKSPACE, USER, { name: 'meta', baseUrl: 'https://169.254.169.254', auth: { kind: 'none' } })).rejects.toThrow('public internet');
        const ok = await strict.create(WORKSPACE, USER, { name: 'ok', baseUrl: 'https://api.example.com/v1/', auth: { kind: 'none' } });
        expect(ok.baseUrl).toBe('https://api.example.com/v1');
        await expect(strict.setEndpoint(ok.id, { name: 'q', method: 'GET', path: '/items?all=1' })).rejects.toThrow('no query');
        await expect(strict.setEndpoint(ok.id, { name: 'up', method: 'GET', path: '/../admin' })).rejects.toThrow('dot segments');
        await expect(strict.create(WORKSPACE, USER, { name: 'ok', baseUrl: 'https://api.example.com', auth: { kind: 'none' } })).rejects.toThrow('already');
    });
});
