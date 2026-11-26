import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractGaps } from '../pages/PageSpec.js';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { APPS } from './AppsPage.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
const noBrowser = { open: async () => ({ rendered: false }), rendered: async () => [], screenshot: async () => ({}), interact: async () => ({}), closePage: async () => undefined, close: async () => undefined } as unknown as PreviewBrowser;

interface Tile {
    id: string;
    title: string;
    href: string;
}

describe("A workspace's board of apps", () => {
    let magnetic: RunningMagnetic;
    let test: TestDatabase;
    let alice: string;
    let bob: string;
    let carol: string;

    const send = (path: string, cookie: string | undefined, method = 'GET', body?: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method, redirect: 'manual', headers: { ...(cookie !== undefined && { Cookie: cookie }), Origin: magnetic.origin, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const signIn = async (user: string): Promise<string> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', redirect: 'manual', headers: { Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString() });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };
    const idOf = async (cookie: string): Promise<string> => (await magnetic.sessions.find(cookie.split('=')[1]))?.userId as string;
    const tilesOf = (html: string): Tile[] => JSON.parse(/<script type="application\/json" id="apps-tiles">(.*?)<\/script>/s.exec(html)?.[1] ?? 'null') as Tile[];

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob', 'carol'], starter: 'none', browser: noBrowser });
        [alice, bob, carol] = [await signIn('alice'), await signIn('bob'), await signIn('carol')];
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should serve a signed-in person the board page with every node id of its contract', async () => {
        // Act
        const anonymous = await fetch(`${magnetic.origin}/assets/apps.json`);
        const served = await send('/assets/apps.json', alice);
        const body = (await served.json()) as { document: { screens: { home: { locales?: Record<string, unknown> } } } };

        // Assert
        expect(anonymous.status).toBe(401);
        expect(served.status).toBe(200);
        expect(Object.keys(body.document.screens.home.locales ?? {}).sort()).toEqual(['de', 'es', 'fr']);
        expect(contractGaps(APPS, body.document as never)).toEqual([]);
    }, 60_000);

    it("should show an org's members the apps they may open, each zooming in to where they may go, and no one else", async () => {
        // Arrange
        const aliceId = await idOf(alice);
        const bobId = await idOf(bob);
        const org = await magnetic.orgs.create(aliceId, { name: 'Acme', slug: 'acme-board' });
        await magnetic.database.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member')", [org.id, bobId]);
        const made = await send(`/orgs/${org.id}/apps`, alice, 'POST', { name: 'Tickets' });
        const appId = ((await made.json()) as { id: string }).id;
        await send(`/orgs/${org.id}/apps/${appId}/access`, alice, 'POST', { principalKind: 'user', principalId: bobId, permission: 'use' });

        // Act
        const forAlice = await send(`/orgs/${org.id}`, alice);
        const forBob = await send(`/orgs/${org.id}`, bob);
        const forCarol = await send(`/orgs/${org.id}`, carol);
        const signedOut = await send(`/orgs/${org.id}`, undefined);

        // Assert
        expect(forAlice.status).toBe(200);
        const page = await forAlice.text();
        expect(page).toContain('aria-current="page">Acme</span>');
        expect(tilesOf(page)).toEqual([expect.objectContaining({ id: appId, title: 'tickets', href: `/edit/${appId}` })]);
        expect(forBob.status).toBe(200);
        const bobs = tilesOf(await forBob.text());
        expect(bobs).toEqual([expect.objectContaining({ id: appId, href: `/apps/${appId}` })]);
        expect(forCarol.status).toBe(404);
        expect(signedOut.status).toBe(303);
        expect(signedOut.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/orgs/${org.id}`)}`);
    }, 60_000);

    it("should show a person's own space with Magnetic first, then their own apps, and not Your apps", async () => {
        // Arrange
        const made = await fetch(magnetic.origin + '/new', { method: 'POST', redirect: 'manual', headers: { Cookie: carol, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Field+notes' });

        // Act
        const response = await send('/orgs/me', carol);

        // Assert
        expect(response.status).toBe(200);
        const tiles = tilesOf(await response.text());
        expect(tiles.length).toBeGreaterThan(1);
        expect(tiles[0]).toEqual(expect.objectContaining({ title: 'Magnetic', href: `/edit/${tiles[0]?.id}` }));
        expect(tiles.filter((tile) => tile.title === 'Magnetic')).toHaveLength(1);
        expect(tiles.map((tile) => tile.title)).not.toContain('Your apps');
        expect(tiles.every((tile) => tile.href === `/edit/${tile.id}`)).toBe(true);
        expect(made.status).toBeLessThan(400);
    }, 60_000);

    it("should show the Orgs level with the person's own space first and each org they are in, each zooming in to its board", async () => {
        // Arrange
        const bobId = await idOf(bob);
        const org = await magnetic.orgs.create(bobId, { name: 'Bobco', slug: 'bobco-levels' });

        // Act
        const forBob = await send('/orgs', bob);
        const board = await (await send(`/orgs/${org.id}`, bob)).text();
        const signedOut = await send('/orgs', undefined);

        // Assert
        expect(forBob.status).toBe(200);
        const page = await forBob.text();
        expect(page).toContain('data-pick="org"');
        expect(page).not.toContain('data-out=');
        const tiles = tilesOf(page);
        expect(tiles[0]).toEqual(expect.objectContaining({ id: 'me', href: '/orgs/me' }));
        expect(tiles).toContainEqual(expect.objectContaining({ id: org.id, title: 'Bobco', href: `/orgs/${org.id}` }));
        expect(board).toContain(`data-out="/orgs?org=${org.id}"`);
        expect(board).toContain(`<a class="level" href="/orgs?org=${org.id}">Orgs</a>`);
        expect(signedOut.status).toBe(303);
    }, 60_000);
});
