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
import { HOME, HOME_APP, HomeApps } from './HomeApp.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;
const ALICE = '7c1f3a52-9b0d-4e7a-8c11-2f9e6d4b5a01';

/** The places a field of the page's data goes, each `<id>.<property>` as its id and its property */
function placesOf(field: string): { id: string; property: string }[] {
    const targets = HOME.own[`$.data.home.${field}`] ?? [];
    if (targets.length === 0) throw new Error(`Your apps keeps no node's own state for ${field}`);
    return targets.map((target) => ({ id: target.slice(0, target.indexOf('.')), property: target.slice(target.indexOf('.') + 1) }));
}

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
