import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pathOfId } from '../pages/own.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { run } from '../stateui/run.js';
import { Stamps } from '../storage/Stamps.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { HOME, HOME_APP, HOME_FIELDS, HOME_HEARING, HomeApps } from './HomeApp.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;
const ALICE = '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01';

/** The places a field of the page's data goes, each `<id>.<property>` as its id and its property */
function placesOf(field: string): { id: string; property: string }[] {
    const targets = HOME.own[HOME_FIELDS[field] ?? ''] ?? [];
    if (targets.length === 0) throw new Error(`Your apps keeps no node's own state for ${field}`);
    return targets.map((target) => ({ id: target.slice(0, target.indexOf('.')), property: target.slice(target.indexOf('.') + 1) }));
}

describe("the data of Your apps", () => {
    it('should keep each field in one namespace with a model and a binding of its own, beside the lists of cards', () => {
        // Arrange
        const definition = HOME.definition() as { data: Record<string, { model: string }> };
        const lists = ['apps', 'orgs', 'invites'];
        const namespaces = Object.keys(definition.data).filter((name) => !lists.includes(name));

        // Act
        const linked = [...new Set(JSON.stringify(definition).match(/\$\.data\.[A-Za-z]+/g) ?? [])].map((path) => path.slice('$.data.'.length));

        // Assert
        expect(namespaces).toEqual(['page', 'newApp', 'waiting', 'person', 'usage']);
        expect(linked.filter((name) => definition.data[name] === undefined)).toEqual([]);
        expect(JSON.stringify(definition)).not.toContain('$.data.home');
        expect(HOME_FIELDS['tab']).toBe('$.data.page.tab');
        expect(HOME_FIELDS['mode']).toBe('$.data.person.mode');
        expect(HOME_FIELDS['usedCents']).toBe('$.data.usage.usedCents');
        expect(HOME_HEARING['make.change']).toEqual({ keep: '$.data.newApp.make' });
        expect(HOME_HEARING['create.press']).toEqual({ name: 'create', from: '$.data.newApp.make' });
        for (const [field, path] of Object.entries(HOME_FIELDS)) {
            const [, , namespace, name] = path.split('.');
            expect(name, path).toBe(field);
            expect(namespaces, path).toContain(namespace);
            // A field is in its namespace's model, or it is a node's own state and left the model
            const inModel = HOME.models[definition.data[namespace as string]?.model ?? '']?.some((operation) => operation['field'] === field) === true;
            expect(inModel || HOME.own[path] !== undefined, path).toBe(true);
        }
        for (const namespace of namespaces) expect(HOME.models[definition.data[namespace]?.model ?? '']?.length, namespace).toBeGreaterThan(0);
        expect(Object.keys(HOME.sample ?? {}).filter((path) => path.startsWith('$.data.')).sort()).toEqual(['$.data.apps', '$.data.invites', '$.data.newApp', '$.data.orgs', '$.data.page', '$.data.person', '$.data.usage', '$.data.waiting']);
    });
});

describe('HomeApps', () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser });
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    /** What the person's instance holds for each place of a field, with where the node of the first place is in their copy */
    async function held(homes: HomeApps, field: string): Promise<{ values: unknown[]; path: string | undefined }> {
        const services = await magnetic.workspaces.get(ALICE);
        const app = await services.instanceViews.find(await homes.id(services, ALICE));
        const own = await services.instanceViews.authority(app!, ALICE);
        const { document } = await services.instanceViews.message(app!, 'attach');
        const places = placesOf(field);
        return {
            values: places.map((place) => {
                const path = pathOfId(document, place.id);
                return path === undefined ? undefined : own.get(`${path}.${place.property}`);
            }),
            path: pathOfId(document, places[0]!.id)
        };
    }

    it("should write each field that is a node's own state to the node in the person's copy, whose state holds only what was written", async () => {
        // Arrange
        const services = await magnetic.workspaces.get(ALICE);
        const homes = new HomeApps(() => createStateUiTools(services), new Stamps(test.db));
        const refused: string[] = [];
        const heard = (_message: string, fields: Record<string, unknown>): void => void refused.push(String(fields['path']));

        // Act
        await homes.show(services, ALICE, { apps: [], invites: [{ id: 'invite-one', name: 'Join an org', note: 'As a builder' }], admin: true, requests: 2 }, undefined, heard);
        const admin = await held(homes, 'notAdmin');
        const invites = await held(homes, 'noInvites');
        const requests = await held(homes, 'noRequests');
        await homes.show(services, ALICE, { apps: [], invites: [], admin: false, requests: 0 }, undefined, heard);
        const adminAfter = await held(homes, 'notAdmin');
        const invitesAfter = await held(homes, 'noInvites');

        // Assert
        expect(refused).toEqual([]);
        expect(admin.path).toMatch(/^\$\.screens\.home\./);
        expect(admin.values).toEqual([false]);
        expect(invites.values.length).toBeGreaterThan(0);
        expect(invites.values).toEqual(invites.values.map(() => false));
        expect(requests.values).toEqual(requests.values.map(() => false));
        expect(adminAfter.values).toEqual([true]);
        expect(invitesAfter.values).toEqual(invites.values.map(() => true));
    }, 60_000);

    it('should write each record of the page in its namespace and keep the tab the person left', async () => {
        // Arrange
        const services = await magnetic.workspaces.get(ALICE);
        const homes = new HomeApps(() => createStateUiTools(services), new Stamps(test.db));
        const refused: string[] = [];
        const heard = (_message: string, fields: Record<string, unknown>): void => void refused.push(String(fields['path']));
        const usage = { line: 'You have used $1.20 of $5.00.', today: 'Today: $0.20', usedCents: 120, totalCents: 500, tone: 'accent' as const };
        const app = await services.instanceViews.find(await homes.id(services, ALICE));
        const own = await services.instanceViews.authority(app!, ALICE);

        // Act
        await homes.show(services, ALICE, { apps: [], requests: 2, usage, person: { name: 'Alice', email: 'alice@example.com' } }, { mode: 'dark', language: 'de' }, heard);
        const first = structuredClone(own.get('$.data')) as Record<string, unknown>;
        own.write({ op: 'set', path: '$.data.page.tab', value: 'usage' } as Parameters<typeof own.write>[0]);
        own.write({ op: 'set', path: '$.data.newApp.make', value: 'Typed' } as Parameters<typeof own.write>[0]);
        await homes.show(services, ALICE, { apps: [], usage, person: { name: 'Alice', email: 'alice@example.com' } }, { mode: 'dark', language: 'de' }, heard);
        const second = structuredClone(own.get('$.data')) as Record<string, unknown>;

        // Assert
        expect(refused).toEqual([]);
        expect(first['home']).toBeUndefined();
        expect(first['page']).toEqual({ tab: 'apps' });
        expect(first['newApp']).toEqual({ make: '' });
        expect(first['person']).toMatchObject({ name: 'Alice', email: 'alice@example.com', mode: 'dark', language: 'de' });
        expect(first['usage']).toMatchObject({ usageLine: 'You have used $1.20 of $5.00.', usageToday: 'Today: $0.20', usedCents: 120, totalCents: 500 });
        expect((first['waiting'] as Record<string, unknown>)['requestsLine']).toContain('2');
        expect(second['page']).toEqual({ tab: 'usage' });
        expect(second['newApp']).toEqual({ make: '' });
        expect((second['waiting'] as Record<string, unknown>)['requestsLine']).toBe('');
    }, 60_000);

    it("should drop the write of a node's own state when the person's copy no longer has the node", async () => {
        // Arrange
        const services = await magnetic.workspaces.get(ALICE);
        const tools = createStateUiTools(services);
        const homes = new HomeApps(() => tools, new Stamps(test.db));
        const before = await held(homes, 'notAdmin');
        const app = await services.instanceViews.find(await homes.id(services, ALICE));
        await run(tools, 'ui_nodes_write', { app: HOME_APP, screen: 'home', expectedRevision: app!.revision, operations: [{ op: 'remove', path: `root${(before.path as string).slice('$.screens.home'.length)}` }] });
        const refused: string[] = [];
        const heard = (_message: string, fields: Record<string, unknown>): void => void refused.push(String(fields['path']));

        // Act
        await homes.show(services, ALICE, { apps: [], admin: true }, undefined, heard);
        const after = await held(homes, 'notAdmin');

        // Assert
        expect(before.path).toBeDefined();
        expect(after.path).toBeUndefined();
        expect(refused).toEqual([]);
    }, 60_000);
});
