import { readGrant } from '@punyts/state-sync/authority';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, Services, UiToolDefinition } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StateGrants } from '../grants/StateGrants.js';
import { PendingRequests } from '../requests/PendingRequests.js';
import { magneticTestDatabase } from '../testing/testDb.js';
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

const DAY = 86_400_000;

async function tool(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await tools.find((candidate) => candidate.name === name)?.run(args as never);
    if (outcome === undefined || outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome?.body)}`);
    return outcome.body as Record<string, unknown>;
}

describe('Requests of people using your apps (docs/design/statenet-requests.md, R3c)', () => {
    let database: TestDatabase;
    let magnetic: RunningMagnetic;
    let grants: StateGrants;
    let services: Services;
    let alice: string;
    let carol: string;
    let aliceId: string;
    let bobId: string;

    const signIn = async (user: string): Promise<string> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString() });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };
    const idOf = async (cookie: string): Promise<string> => (await magnetic.sessions.find(cookie.split('=')[1]))?.userId as string;
    const page = async (path: string, cookie: string, form?: Record<string, string>): Promise<{ status: number; html: string }> => {
        const response = await fetch(`${magnetic.origin}${path}`, {
            method: form === undefined ? 'GET' : 'POST',
            redirect: 'manual',
            headers: { Cookie: cookie, Origin: magnetic.origin, ...(form !== undefined && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
            ...(form !== undefined && { body: new URLSearchParams(form).toString() })
        });
        return { status: response.status, html: await response.text() };
    };
    const address = (): string => `${magnetic.owners.of(aliceId)}/data/menu`;

    /** Bob, using Alice's app, asks to change the price of tea through his bound access, as his binding would */
    const bobAsks = async (price: number): Promise<string> => {
        const access = await grants.boundAccess(bobId, aliceId, 'menu');
        const authority = await services.hostInstance(address());
        if (authority === undefined) throw new Error('the dataset is not hosted');
        const received: Array<{ type: string; id?: string; result?: string }> = [];
        const session = authority.connect({ send: (text) => received.push(JSON.parse(text)), close: () => undefined }, access);
        session.receive(JSON.stringify({ type: 'hello', namespace: address().replaceAll('/', '.'), revision: 0, clientId: `bob-${price}`, protocol: 3 }));
        const id = `ask-${price}`;
        session.receive(JSON.stringify({ type: 'change', change: { id, path: '$.data.records.tea', op: 'set', value: { name: 'Tea', price }, base: authority.revision() } }));
        expect(received.filter((message) => message.type === 'ack')).toEqual([{ type: 'ack', id, result: 'requested' }]);
        session.close();
        return id;
    };

    /** The Requests page once it lists `id`: the dataset saves its requests as it saves its state */
    const listedWith = async (id: string): Promise<string> => {
        for (let attempt = 0; attempt < 50; attempt++) {
            const { html } = await page('/requests', alice);
            if (html.includes(encodeURIComponent(id))) return html;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`request ${id} was never listed`);
    };

    beforeAll(async () => {
        database = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: database.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob', 'carol'], starter: 'none', browser: noBrowser, secretKey: 'a test secret key of some length' });
        grants = magnetic.stateGrants as StateGrants;
        alice = await signIn('alice');
        carol = await signIn('carol');
        aliceId = await idOf(alice);
        bobId = await idOf(await signIn('bob'));
        services = await magnetic.workspaces.get(aliceId);
        const tools = createStateUiTools(services);
        await tool(tools, 'ui_model_write', { model: 'item', operations: [{ op: 'set', field: 'name', type: 'string', required: true }, { op: 'set', field: 'price', type: 'number' }] });
        await tool(tools, 'ui_data_write', { dataset: 'menu', model: 'item', operations: [{ op: 'set', path: 'tea', value: { name: 'Tea', price: 3 } }] });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await database.drop();
    });

    it("should give people using the apps read and request on a dataset set to wait, with the setting's days in the token", async () => {
        // Arrange
        const before = await grants.boundAccess(bobId, aliceId, 'menu');

        // Act
        const saved = await page('/settings/data', alice, { w: aliceId, do: 'setting', dataset: 'menu', rights: 'request', days: '3' });
        const after = await grants.boundAccess(bobId, aliceId, 'menu');

        // Assert
        expect(saved.status).toBe(200);
        expect(saved.html).toContain('Saved for menu');
        expect(saved.html).toMatch(/value="request" checked/);
        expect(readGrant(before.grant as string)?.rights).toEqual(['read', 'write']);
        const claims = readGrant(after.grant as string);
        expect(claims?.rights).toEqual(['read', 'request']);
        expect(claims?.requestMs).toBe(3 * DAY);
        expect(claims?.entry).not.toBe(readGrant(before.grant as string)?.entry);
        expect(await grants.check(before, { address: address(), path: '$.data.records.tea', right: 'write' })).toMatchObject({ ok: false });
    });

    it('should list a change Bob asked for, show it beside the record, and save it when Alice approves', async () => {
        // Arrange
        const id = await bobAsks(4);

        // Act
        const list = await listedWith(id);
        const href = `/requests/${encodeURIComponent(aliceId)}/menu/${encodeURIComponent(id)}`;
        const detail = await page(href, alice);
        const decided = await page(href, alice, { do: 'approve', note: '' });

        // Assert
        expect(list).toContain('<code>menu</code>');
        expect(list).toMatch(/bob/i);
        expect(detail.status).toBe(200);
        expect(detail.html).toContain('The record tea');
        expect(detail.html).toContain('<td><code>price</code></td><td><code>3</code></td><td><code>4</code></td>');
        expect(decided.html).toContain('The change to menu is saved.');
        expect((await services.hostInstance(address()))?.get('$.data.records.tea')).toEqual({ name: 'Tea', price: 4 });
        expect((await page('/settings/data', alice)).html).not.toContain('wait for your approval.');
    }, 30_000);

    it('should reject a change with a note, and refuse the page to someone who does not manage the workspace', async () => {
        // Arrange
        const id = await bobAsks(9);
        await listedWith(id);
        const href = `/requests/${encodeURIComponent(aliceId)}/menu/${encodeURIComponent(id)}`;

        // Act
        const theirs = await page(href, carol);
        const decided = await page(href, alice, { do: 'reject', note: 'Too dear' });
        const again = await page(href, alice);

        // Assert
        expect(theirs.status).toBe(403);
        expect(theirs.html).toContain('You do not manage the data of that workspace.');
        expect(decided.html).toContain('The change to menu is rejected.');
        expect(again.status).toBe(404);
        expect((await services.hostInstance(address()))?.get('$.data.records.tea')).toEqual({ name: 'Tea', price: 4 });
    }, 30_000);

    it('should count the waiting changes on the Data page, and drop the bound entries and their requests when changes are saved at once again', async () => {
        // Arrange
        const id = await bobAsks(5);
        await listedWith(id);
        const asking = await grants.boundAccess(bobId, aliceId, 'menu');

        // Act
        const shown = await page('/settings/data', alice);
        const counted = await new PendingRequests(database.db).count([aliceId]);
        await page('/settings/data', alice, { w: aliceId, do: 'setting', dataset: 'menu', rights: 'write', days: '3' });
        const writing = await grants.boundAccess(bobId, aliceId, 'menu');
        const dropped = await page(`/requests/${encodeURIComponent(aliceId)}/menu/${encodeURIComponent(id)}`, alice);

        // Assert
        expect(shown.html).toContain('1 changes wait for your approval.');
        expect(counted).toBe(1);
        expect(await grants.check(asking, { address: address(), path: '$.data.records.tea', right: 'request' })).toMatchObject({ ok: false });
        expect(readGrant(writing.grant as string)?.rights).toEqual(['read', 'write']);
        expect(dropped.status).toBe(404);
        expect(dropped.html).toContain('That request is no longer waiting.');
    }, 30_000);
});
