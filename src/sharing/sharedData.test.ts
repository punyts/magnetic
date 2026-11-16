import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser, UiToolDefinition } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { sharedDataFacts } from './facts.js';

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

describe("An app reading another owner's dataset through a share", () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    const people: Record<string, { id: string; cookie: string; tools: readonly UiToolDefinition[] }> = {};

    /** A form posted to the Data page as a person: the page's status and text */
    async function post(who: string, fields: Record<string, string>): Promise<{ status: number; text: string }> {
        const answer = await fetch(`${magnetic.origin}/settings/data`, { method: 'POST', headers: { cookie: people[who]?.cookie ?? '', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
        return { status: answer.status, text: await answer.text() };
    }

    /** What bob's menu app reads at $.external */
    const external = async (): Promise<unknown> => ((await tool(people['bob']?.tools ?? [], 'ui_state_get', { app: 'menu', path: '$.external' })) as { value?: unknown }).value ?? {};

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob', 'carol'], starter: 'none', browser: noBrowser, secretKey: 'a-test-secret-key-of-length' });
        for (const name of ['alice', 'bob', 'carol']) {
            const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `user=${name}`, redirect: 'manual' });
            const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
            const id = (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string;
            // Development users have no email: these are verified, as a provider's would be
            await test.db.query('UPDATE app_user SET email = $2, email_verified = true WHERE id = $1', [id, `${name}@example.test`]);
            people[name] = { id, cookie, tools: createStateUiTools(await magnetic.workspaces.get(id)) };
        }
        // Alice's price list, the dataset she shares
        const alice = people['alice']?.tools ?? [];
        await tool(alice, 'ui_model_write', { model: 'price', operations: [{ op: 'set', field: 'name', type: 'string' }, { op: 'set', field: 'price', type: 'number' }] });
        await tool(alice, 'ui_data_write', { dataset: 'price-list', model: 'price', operations: [{ op: 'set', path: 'tea', value: { name: 'Tea', price: 3 } }] });
        await tool(alice, 'ui_data_write', { dataset: 'secret-list', model: 'price', operations: [{ op: 'set', path: 'gold', value: { name: 'Gold', price: 900 } }] });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it("should share alice's dataset with bob by email, and show it on both sides of the Data page", async () => {
        // Act
        const shared = await post('alice', { w: people['alice']?.id ?? '', do: 'share', dataset: 'price-list', to: 'BOB@example.test' });

        // Assert
        expect(shared.status).toBe(200);
        expect(shared.text).toContain('price-list is shared with bob (bob@example.test). Their apps can read it now.');
        const again = await post('alice', { w: people['alice']?.id ?? '', do: 'share', dataset: 'price-list', to: 'bob@example.test' });
        expect(again.text).toContain('price-list is already shared with bob');
        const bobsPage = await (await fetch(`${magnetic.origin}/settings/data`, { headers: { cookie: people['bob']?.cookie ?? '' } })).text();
        expect(bobsPage).toContain('Shared with this workspace');
        expect(bobsPage).toContain('<code>price-list</code></td><td>alice (alice@example.test)</td>');
        expect(bobsPage).toContain(`{&quot;owner&quot;:&quot;${people['alice']?.id}&quot;,&quot;dataset&quot;:&quot;price-list&quot;}`);
        // Shared by me lists it too, as every grant
        const sharedByMe = await (await fetch(`${magnetic.origin}/settings/shared`, { headers: { cookie: people['alice']?.cookie ?? '' } })).text();
        expect(sharedByMe).toContain('<td>the dataset price-list</td>');
    });

    it('should refuse sharing with an unknown email, a dataset the workspace lacks, and a workspace the person does not manage', async () => {
        expect((await post('alice', { w: people['alice']?.id ?? '', do: 'share', dataset: 'price-list', to: 'nobody@example.test' })).text).toContain('No one in Magnetic has the verified email nobody@example.test.');
        expect((await post('alice', { w: people['alice']?.id ?? '', do: 'share', dataset: 'missing', to: 'bob@example.test' })).text).toContain('This workspace has no dataset missing.');
        const notTheirs = await post('carol', { w: people['alice']?.id ?? '', do: 'share', dataset: 'price-list', to: 'carol@example.test' });
        expect(notTheirs.status).toBe(400);
        expect(notTheirs.text).toContain('You do not manage the data of that workspace.');
    });

    it("should show the shared records in bob's app, live, and nothing of a dataset not shared with him", async () => {
        // Arrange: bob's app reads alice's price list, and her secret list that is not shared
        const created = await tool(people['bob']?.tools ?? [], 'ui_app_create', { name: 'menu', home: { component: 'panel' } });
        await tool(people['bob']?.tools ?? [], 'ui_app_configure', {
            name: 'menu',
            expectedRevision: created['revision'],
            uses: { external: { prices: { owner: people['alice']?.id, dataset: 'price-list' }, secrets: { owner: people['alice']?.id, dataset: 'secret-list' } } }
        });

        // Act / Assert: what is there now, then a change alice makes
        await expect.poll(external, { timeout: 10_000 }).toEqual({ prices: { tea: { name: 'Tea', price: 3 } } });
        await tool(people['alice']?.tools ?? [], 'ui_data_write', { dataset: 'price-list', operations: [{ op: 'set', path: 'coffee', value: { name: 'Coffee', price: 4 } }] });
        await expect.poll(external, { timeout: 10_000 }).toEqual({ prices: { tea: { name: 'Tea', price: 3 }, coffee: { name: 'Coffee', price: 4 } } });
    });

    it("should tell bob's agent what it can read, with the fields, and tell carol's nothing", async () => {
        const facts = await sharedDataFacts(magnetic.stateGrants!, test.db, (id) => magnetic.workspaces.get(id), people['bob']?.id ?? '');
        expect(facts).toContain(`- price-list, shared by alice: records of model price (name string, price number). Read it with uses.external.<alias> = { owner: "${people['alice']?.id}", dataset: "price-list" }`);
        expect(facts).not.toContain('secret-list');
        expect(await sharedDataFacts(magnetic.stateGrants!, test.db, (id) => magnetic.workspaces.get(id), people['carol']?.id ?? '')).toBeUndefined();
    });

    it("should clear what bob's app shows at once when alice stops sharing", async () => {
        // Arrange
        const share = (await magnetic.stateGrants!.datasetShares(people['alice']?.id ?? ''))[0];

        // Act
        const stopped = await post('alice', { w: people['alice']?.id ?? '', do: 'stop', id: share?.id ?? '' });

        // Assert
        expect(stopped.text).toContain('price-list is no longer shared with bob (bob@example.test).');
        await expect.poll(external, { timeout: 10_000 }).toEqual({});
        expect(await (await fetch(`${magnetic.origin}/settings/data`, { headers: { cookie: people['bob']?.cookie ?? '' } })).text()).toContain('No one has shared a dataset with Yours.');
    });

    it("should keep an org's datasets in the org when its policy says so", async () => {
        // Arrange: an org of alice's that keeps grants in the org, with a dataset
        const org = await magnetic.orgs.create(people['alice']?.id ?? '', { name: 'Acme', slug: `acme-${Date.now().toString(36)}` });
        await magnetic.policies.set(people['alice']?.id ?? '', org.id, { grantsInOrg: true });
        const orgTools = createStateUiTools(await magnetic.workspaces.get(org.workspaceId));
        await tool(orgTools, 'ui_model_write', { model: 'price', operations: [{ op: 'set', field: 'name', type: 'string' }] });
        await tool(orgTools, 'ui_data_write', { dataset: 'catalog', model: 'price', operations: [{ op: 'set', path: 'a', value: { name: 'A' } }] });

        // Act
        const outside = await post('alice', { w: org.workspaceId, do: 'share', dataset: 'catalog', to: 'bob@example.test' });

        // Assert
        expect(outside.status).toBe(403);
        expect(outside.text).toContain("The org&#39;s policy keeps grants of its apps&#39; state in the org.");
    });
});
