import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { UiToolDefinition } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_COOKIE } from '../agent/AgentSessions.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const installed = existsSync(chromium.executablePath());

/** A GET from this machine with a cookie, which fetch does not let a caller set */
function getWith(port: number, path: string, cookie: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, headers: { Cookie: cookie } }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end();
    });
}

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<{ body: Record<string, unknown>; images: unknown[] }> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return { body: outcome.body as Record<string, unknown>, images: (outcome as { images?: unknown[] }).images ?? [] };
}

describe.skipIf(!installed)("The agent's shared browser (Chromium through Playwright)", () => {
    const databases: TestDatabase[] = [];
    let magnetic: RunningMagnetic;
    let tools: readonly UiToolDefinition[];
    let appId: string;
    let appName: string;

    beforeAll(async () => {
        const database = await magneticTestDatabase();
        databases.push(database);
        // Behind public origins, as hosted: the agent's page still loads over loopback
        magnetic = await startMagnetic({
            database: database.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            starter: 'none',
            agentBrowser: true,
            publicOrigin: 'https://magnetic.example',
            runtimeOrigin: 'https://run.magnetic.example'
        });
        const owner = await magnetic.accounts.signIn({ provider: 'test', subject: 'ana' }, { name: 'Ana' });
        tools = createStateUiTools(await magnetic.workspaces.get(owner.id));
        appName = `seen-${Date.now()}`;
        const created = await tool(tools, 'ui_app_create', { name: appName, home: { component: 'panel', children: { hello: { component: 'text', _text: 'Hello from the agent' } } } });
        appId = created.body['id'] as string;
    }, 60_000);

    afterAll(async () => {
        await magnetic?.stop();
        await Promise.all(databases.splice(0).map((test) => test.drop()));
    });

    it("should let the agent see and use its workspace's app", async () => {
        // Act
        const preview = await tool(tools, 'ui_preview', { app: appName });
        const shot = await tool(tools, 'ui_screenshot', { app: appName });

        // Assert
        expect(preview.body['rendered']).toBe(true);
        expect(shot.images).toHaveLength(1);
    }, 60_000);

    it('should refuse an app page to an agent cookie the server did not make', async () => {
        // Act
        const status = await getWith(magnetic.port, `/apps/${appId}`, `${AGENT_COOKIE}=made-up`);

        // Assert
        expect(status).not.toBe(200);
    });
});
