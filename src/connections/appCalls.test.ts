import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';

const silent = { info: () => undefined };
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

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return outcome.body as Record<string, unknown>;
}

describe("An app's logic calling an outside API through a connection", () => {
    let test: TestDatabase;
    let api: Server;
    let apiUrl = '';
    let magnetic: RunningMagnetic;
    let aliceId = '';
    let tools: readonly UiToolDefinition[];
    let keySeen: string | undefined;
    let cookie = '';

    beforeAll(async () => {
        api = createServer((request, response) => {
            keySeen = request.headers['x-api-key'] as string | undefined;
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ city: 'Oslo', today: 'snow' }));
        });
        await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
        apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: silent,
            devUsers: ['alice'],
            starter: 'none',
            browser: noBrowser,
            secretKey: 'a-test-secret-key-of-length',
            connectionGuard: { allowHttp: true, allowPrivate: true }
        });
        const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice', redirect: 'manual' });
        cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
        aliceId = (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string;
        tools = createStateUiTools(await magnetic.workspaces.get(aliceId));
        // The state of one call: what is asked, how it goes, and what came back
        await tool(tools, 'ui_model_write', { model: 'api-call', operations: [{ op: 'set', field: 'request', type: 'object' }, { op: 'set', field: 'status', type: 'object' }, { op: 'set', field: 'answer', type: 'object' }] });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
        await new Promise((resolve) => api.close(resolve));
    });

    it("should run the app's http effect against its workspace's connection, with the key the app never sees", async () => {
        // Arrange: a connection with a key, and an app whose logic calls it
        const weather = await magnetic.connections.create(aliceId, aliceId, { name: 'weather', baseUrl: apiUrl, auth: { kind: 'key', in: 'header', name: 'X-Api-Key' } });
        await magnetic.connections.setSecret(weather.id, 'key', 'secret-123');
        await magnetic.connections.setEndpoint(weather.id, { name: 'today', method: 'GET', path: '/today/{city}' });
        const created = await tool(tools, 'ui_app_create', { name: 'weather-board', data: { weather: { model: 'api-call', scope: 'persona' } }, home: { component: 'panel' } });
        await tool(tools, 'ui_logic_write', {
            app: 'weather-board',
            expectedRevision: created['revision'],
            operations: [{ op: 'set', unit: 'effects.today', value: { request: '$.data.weather.request', run: '$.functions.host.http', status: '$.data.weather.status', value: '$.data.weather.answer' } }]
        });

        // Act
        await tool(tools, 'ui_state_set', { app: 'weather-board', path: '$.data.weather.request', value: { connection: 'weather', endpoint: 'today', params: { city: 'oslo' } } });

        // Assert
        const answer = async (): Promise<unknown> => ((await tool(tools, 'ui_state_get', { app: 'weather-board', path: '$.data.weather' })) as { value?: { answer?: unknown } }).value?.answer;
        await expect.poll(answer, { timeout: 10_000 }).toEqual({ city: 'Oslo', today: 'snow' });
        expect(keySeen).toBe('secret-123');
        const state = JSON.stringify(await tool(tools, 'ui_state_get', { app: 'weather-board', path: '$.data' }));
        expect(state).not.toContain('secret-123');
        expect(state).toContain('"state":"ready"');
    });

    it('should put a refusal in the status, with its reason, and call nothing', async () => {
        const created = await tool(tools, 'ui_app_create', { name: 'bad-board', data: { call: { model: 'api-call', scope: 'persona' } }, home: { component: 'panel' } });
        await tool(tools, 'ui_logic_write', {
            app: 'bad-board',
            expectedRevision: created['revision'],
            operations: [{ op: 'set', unit: 'effects.none', value: { request: '$.data.call.request', run: '$.functions.host.http', status: '$.data.call.status', value: '$.data.call.answer' } }]
        });
        await tool(tools, 'ui_state_set', { app: 'bad-board', path: '$.data.call.request', value: { connection: 'missing', endpoint: 'x' } });
        const status = async (): Promise<unknown> => ((await tool(tools, 'ui_state_get', { app: 'bad-board', path: '$.data.call.status' })) as { value?: unknown }).value;
        await expect.poll(status, { timeout: 10_000 }).toMatchObject({ state: 'error', reason: expect.stringContaining('There is no connection "missing"') });
    });

    it("should give the editor's Connections panel the endpoints and their params, and never a key", async () => {
        // Arrange: the weather connection of the first test, with its key, and an app of alice's
        const created = await tool(tools, 'ui_app_create', { name: 'panel-board', home: { component: 'panel' } });

        // Act
        const answer = await fetch(`${magnetic.origin}/edit/${String(created['id'])}/connections`, { headers: { cookie } });

        // Assert
        expect(answer.status).toBe(200);
        const text = await answer.text();
        expect(text).not.toContain('secret-123');
        expect(JSON.parse(text)).toEqual({
            off: false,
            manage: `/settings/connections?w=${aliceId}`,
            connections: [{ name: 'weather', host: new URL(apiUrl).host, endpoints: [{ name: 'today', method: 'GET', path: '/today/{city}', params: ['city'] }] }]
        });
    });

    it("should refuse every call of an org's apps once its connections policy is off, and call again once it is on", async () => {
        // Arrange: an org with a connection, and an app of the org whose logic calls it
        const org = await magnetic.orgs.create(aliceId, { name: 'Acme', slug: `acme-${Date.now().toString(36)}` });
        const orgTools = createStateUiTools(await magnetic.workspaces.get(org.workspaceId));
        await tool(orgTools, 'ui_model_write', { model: 'api-call', operations: [{ op: 'set', field: 'request', type: 'object' }, { op: 'set', field: 'status', type: 'object' }, { op: 'set', field: 'answer', type: 'object' }] });
        const weather = await magnetic.connections.create(org.workspaceId, aliceId, { name: 'weather', baseUrl: apiUrl, auth: { kind: 'none' } });
        await magnetic.connections.setEndpoint(weather.id, { name: 'today', method: 'GET', path: '/today/{city}' });
        const created = await tool(orgTools, 'ui_app_create', { name: 'org-board', data: { weather: { model: 'api-call', scope: 'persona' } }, home: { component: 'panel' } });
        await tool(orgTools, 'ui_logic_write', {
            app: 'org-board',
            expectedRevision: created['revision'],
            operations: [{ op: 'set', unit: 'effects.today', value: { request: '$.data.weather.request', run: '$.functions.host.http', status: '$.data.weather.status', value: '$.data.weather.answer' } }]
        });
        const status = async (): Promise<unknown> => ((await tool(orgTools, 'ui_state_get', { app: 'org-board', path: '$.data.weather.status' })) as { value?: unknown }).value;

        // Act: the policy off, then a call
        expect((await magnetic.policies.get(org.id)).connections).toBe(true);
        await magnetic.policies.set(aliceId, org.id, { connections: false });
        await tool(orgTools, 'ui_state_set', { app: 'org-board', path: '$.data.weather.request', value: { connection: 'weather', endpoint: 'today', params: { city: 'oslo' } } });

        // Assert: refused with the reason; the panel says it is off
        await expect.poll(status, { timeout: 10_000 }).toMatchObject({ state: 'error', reason: expect.stringContaining('turned connections off') });
        const panel = (await (await fetch(`${magnetic.origin}/edit/${String(created['id'])}/connections`, { headers: { cookie } })).json()) as { off: boolean; manage: string };
        expect(panel.off).toBe(true);
        expect(panel.manage).toBe(`/settings/connections?w=${org.workspaceId}`);

        // Act and assert: on again, the same call goes through
        await magnetic.policies.set(aliceId, org.id, { connections: null });
        await tool(orgTools, 'ui_state_set', { app: 'org-board', path: '$.data.weather.request', value: { connection: 'weather', endpoint: 'today', params: { city: 'bergen' } } });
        await expect.poll(status, { timeout: 10_000 }).toMatchObject({ state: 'ready' });
    });
});
