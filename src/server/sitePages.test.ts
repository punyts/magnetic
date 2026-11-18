import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIGN_IN } from '../pages/PageApps.js';
import { contractGaps } from '../pages/PageSpec.js';
import { magneticTestDatabase } from '../testing/testDb.js';
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

const TAGLINE = 'Describe an app, and watch it being built.';
const PAGE = '$.screens.home.children.page.children';

describe("A page's contract", () => {
    it('should name each emit and key a copy no longer has', () => {
        // Arrange
        const document = { screens: { home: { root: { component: 'panel', children: { a: { component: 'button', on: { press: { command: 'emit', target: 'provider' } } } } } } } };

        // Act
        const gaps = contractGaps({ ...SIGN_IN, keys: ['a', 'b'] }, document);

        // Assert
        expect(gaps).toEqual(['Nothing raises "dev"', 'Nothing raises "sso"', 'No part is called "b"']);
    });
});

describe("Magnetic's own pages, edited", () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let admin: string;
    let bob: string;
    let bobId: string;
    let draft: string;
    const signIn = async (user: string): Promise<{ cookie: string; id: string }> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
        return { cookie, id: (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string };
    };
    const get = (path: string, cookie?: string): Promise<Response> => fetch(`${magnetic.origin}${path}`, { redirect: 'manual', headers: cookie === undefined ? {} : { Cookie: cookie } });
    const post = (path: string, cookie: string): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
    const write = (appId: string, cookie: string, operations: unknown[]): Promise<Response> =>
        fetch(`${magnetic.origin}/edit/${appId}/nodes`, { method: 'POST', headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }) });
    /** The document a page serves, as its HTML carries it */
    const served = async (path: string, cookie?: string): Promise<{ document: Record<string, unknown>; published: boolean }> => {
        const html = await (await get(path, cookie)).text();
        const json = /<script type="application\/json" id="page-app-document">(.*?)<\/script>/s.exec(html)?.[1];
        return JSON.parse(json as string) as { document: Record<string, unknown>; published: boolean };
    };

    /** The texts of one of Bob's apps, as its document has them */
    const words = async (appId: string): Promise<string> => {
        const services = await magnetic.workspaces.get(bobId);
        const app = await services.instanceViews.find(appId);
        return app === undefined ? '' : JSON.stringify((await services.instanceViews.message(app, 'attach')).document);
    };

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: { info: () => undefined }, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser, admins: ['ops@example.com'] });
        const alice = await signIn('alice');
        admin = alice.cookie;
        await magnetic.database.query("UPDATE app_user SET email = 'ops@example.com', email_verified = true WHERE id = $1", [alice.id]);
        ({ cookie: bob, id: bobId } = await signIn('bob'));
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should list the pages to an admin and to no one else', async () => {
        // Act
        const list = await get('/admin/pages', admin);
        const refused = await get('/admin/pages', bob);

        // Assert
        expect(list.status).toBe(200);
        const html = await list.text();
        for (const name of ['magnetic-signin', 'magnetic-link', 'your-apps', 'magnetic-editor']) expect(html).toContain(`data-page="${name}"`);
        expect(refused.status).toBe(404);
    });

    it("should open a page's draft in the editor for an admin, and not for anyone else", async () => {
        // Act
        const opened = await post('/admin/pages/magnetic-signin/edit', admin);
        draft = /^\/edit\/(.+)$/.exec(opened.headers.get('location') ?? '')?.[1] as string;
        const editor = await get(`/edit/${draft}`, admin);
        const notBob = await get(`/edit/${draft}`, bob);
        const again = await post('/admin/pages/magnetic-signin/edit', admin);

        // Assert
        expect(opened.status).toBe(303);
        expect(editor.status).toBe(200);
        expect(notBob.status).not.toBe(200);
        expect(again.headers.get('location')).toBe(`/edit/${draft}`);
    });

    it('should serve a published edit to every visitor, drop its stale translations, and keep Magnetic\'s at ?page=default', async () => {
        // Arrange
        const changed = await write(draft, admin, [{ op: 'set', path: `${PAGE}.tagline._text`, value: 'Apps, built while you watch.' }]);

        // Act
        const published = await post('/admin/pages/magnetic-signin/publish', admin);
        const page = await served('/signin');
        const own = await served('/signin?page=default');

        // Assert
        expect(changed.status).toBe(200);
        expect(published.headers.get('location')).toBe('/admin/pages?done=published');
        expect(page.published).toBe(true);
        expect(JSON.stringify(page.document)).toContain('Apps, built while you watch.');
        expect(JSON.stringify(page.document)).not.toContain('Beschreib eine App');
        expect(JSON.stringify(page.document)).toContain('Entwicklungskonten');
        expect(own.published).toBe(false);
        expect(JSON.stringify(own.document)).toContain(TAGLINE);
        expect(await (await get('/admin/pages', admin)).text()).toContain('Published');
    });

    it('should refuse to publish a draft that no longer raises an emit the page needs, and say why', async () => {
        // Arrange
        const removed = await write(draft, admin, [{ op: 'remove', path: `${PAGE}.dev` }]);

        // Act
        const refused = await post('/admin/pages/magnetic-signin/publish', admin);

        // Assert
        expect(removed.status).toBe(200);
        expect(refused.status).toBe(400);
        expect(await refused.text()).toContain('Nothing raises &quot;dev&quot;');
        expect(JSON.stringify((await served('/signin')).document)).toContain('Apps, built while you watch.');
    });

    it("should put a page back to Magnetic's with Reset", async () => {
        // Act
        const reset = await post('/admin/pages/magnetic-signin/reset', admin);
        const page = await served('/signin');

        // Assert
        expect(reset.headers.get('location')).toBe('/admin/pages?done=reset');
        expect(page.published).toBe(false);
        expect(JSON.stringify(page.document)).toContain(TAGLINE);
    });

    it('should keep the change a person makes to Your apps, and make it again on Reset', async () => {
        // Arrange
        await get('/', bob);
        const services = await magnetic.workspaces.get(bobId);
        const home = await magnetic.homes.id(services, bobId);
        const changed = await write(home, bob, [{ op: 'add', path: '$.screens.home.children.page', key: 'hello', value: { component: 'text', _text: 'My own words' } }]);

        // Act
        await get('/', bob);
        const kept = await magnetic.homes.id(services, bobId);
        const shown = await words(kept);
        const reset = await post('/home/reset', bob);
        const after = await magnetic.homes.id(services, bobId);

        // Assert
        expect(changed.status).toBe(200);
        expect(shown).toContain('My own words');
        expect(kept).toBe(home);
        expect(await reset.json()).toEqual({ id: after });
        expect(after).not.toBe(home);
        expect(await words(after)).not.toContain('My own words');
    });

    it("should make a person's unchanged Your apps again from what an admin publishes", async () => {
        // Arrange
        const services = await magnetic.workspaces.get(bobId);
        const before = await magnetic.homes.id(services, bobId);
        const opened = await post('/admin/pages/your-apps/edit', admin);
        const homeDraft = /^\/edit\/(.+)$/.exec(opened.headers.get('location') ?? '')?.[1] as string;
        const changed = await write(homeDraft, admin, [{ op: 'add', path: '$.screens.home.children.page', key: 'welcome', value: { component: 'text', _text: 'Welcome from the team' } }]);

        // Act
        const published = await post('/admin/pages/your-apps/publish', admin);
        await get('/', bob);
        const after = await magnetic.homes.id(services, bobId);

        // Assert
        expect(changed.status).toBe(200);
        expect(published.headers.get('location')).toBe('/admin/pages?done=published');
        expect(after).not.toBe(before);
        expect(await words(after)).toContain('Welcome from the team');
    });
});
