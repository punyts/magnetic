import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { AppPage, EditorPage, expect, signIn, SignInPage, test, uniqueName } from './fixtures.js';

/** A context of its own, at the project's size, signed in as the dev user when one is named */
async function contextOf(browser: Browser, user?: string): Promise<BrowserContext> {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? null });
    if (user !== undefined) await signIn(context, user);
    return context;
}

/** Makes a use link of the app open in the editor, from its Share panel, and reads it back */
async function useLink(editor: EditorPage): Promise<string> {
    await editor.button('Share').click();
    await editor.button('Make link').click();
    await expect(editor.editor.getByText('Link made. Copy it and send it.')).toBeVisible();
    const note = editor.editor.getByText(/\/s\/[A-Za-z0-9_-]+/).first();
    const url = /(https?:\/\/\S+\/s\/[A-Za-z0-9_-]+)/.exec((await note.textContent()) ?? '')?.[1];
    expect(url, 'the link in the Share panel').toBeDefined();
    return url as string;
}

/** The id of a new app of a dev user, made as Your apps makes it */
async function appOf(page: Page, name: string): Promise<string> {
    const answer = await page.request.post('/new', { headers: { Accept: 'application/json', Origin: new URL(page.url() === 'about:blank' ? test.info().project.use.baseURL! : page.url()).origin }, form: { name } });
    expect(answer.status(), await answer.text()).toBe(201);
    return ((await answer.json()) as { id: string }).id;
}

test.describe('Ways in, and ways refused', () => {
    test('a stranger opening an editor is sent to sign in, and comes back to that editor after', async ({ browser, context, page }, info) => {
        // Arrange: an app of alice's
        await signIn(context, 'alice');
        await page.goto('/privacy');
        const appId = await appOf(page, uniqueName(info, 'return'));
        const stranger = await contextOf(browser);
        const visitor = await stranger.newPage();

        // Act
        await visitor.goto(`/edit/${appId}`);
        await visitor.waitForURL(/\/signin\?next=/);
        await new SignInPage(visitor).button('Sign in as alice').click();

        // Assert
        await visitor.waitForURL(new RegExp(`/edit/${appId}$`));
        await new EditorPage(visitor).ready();
        await stranger.close();
    });

    test("an app nobody has is not found, and another person's app is not theirs to edit", async ({ browser, context, page }, info) => {
        // Arrange: an app of alice's, and bob
        await signIn(context, 'alice');
        await page.goto('/privacy');
        const appId = await appOf(page, uniqueName(info, 'mine'));
        const bob = await contextOf(browser, 'bob');
        const other = await bob.newPage();

        // Act and Assert
        expect((await other.goto(`/edit/${randomUUID()}`))?.status()).toBe(404);
        expect((await other.goto(`/edit/${appId}`))?.status()).toBe(404);
        const api = await other.request.get(`/edit/${appId}/screens`);
        expect(api.status()).toBe(404);
        await bob.close();
    });

    test('a path Magnetic does not have answers not found', async ({ context, page }) => {
        await signIn(context, 'bob');
        const answer = await page.request.get('/no-such-page');
        expect(answer.status()).toBe(404);
        expect(await answer.json()).toMatchObject({ error: 'not_found' });
    });

    test('the admin pages send a stranger to sign in, and are not there for someone who is not an admin', async ({ context, page }) => {
        // A stranger
        await page.goto('/admin/people');
        await page.waitForURL(/\/signin\?next=%2Fadmin%2Fpeople/);

        // bob, who is not an admin
        await signIn(context, 'bob');
        for (const path of ['/admin', '/admin/feedback', '/admin/people', '/admin/pages']) expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    });

    test('signed in, the sign-in page goes straight on to where it was asked to', async ({ context, page }) => {
        await signIn(context, 'bob');
        await page.goto('/signin?next=%2Fsettings%2Fdata');
        await page.waitForURL(/\/settings\/data$/);
        await page.goto('/signin');
        await page.waitForURL((url) => url.pathname === '/');
    });

    test('a sign-in that names another site, or the sign-in itself, lands on Your apps', async ({ page, signInPage }) => {
        for (const next of ['//example.com/steal', '/signout']) {
            // Arrange
            await page.context().clearCookies();
            await page.goto(`/signin?next=${encodeURIComponent(next)}`);

            // Act
            await signInPage.button('Sign in as bob').click();

            // Assert
            await page.waitForURL((url) => url.pathname === '/');
            expect(new URL(page.url()).host, next).toBe(new URL(test.info().project.use.baseURL!).host);
        }
    });

    test('a name that is not a development user is refused', async ({ context }) => {
        const answer = await context.request.post('/signin/dev', { form: { user: 'mallory', next: '/' }, maxRedirects: 0 });
        expect(answer.status()).toBe(403);
        expect((await context.cookies()).filter((cookie) => /session/i.test(cookie.name))).toEqual([]);
    });

    test('a work email whose domain no org claims is told to sign in another way', async ({ page, signInPage }) => {
        // Arrange
        await signInPage.goto();

        // Act
        await signInPage.app.getByPlaceholder('Work email').fill('someone@nowhere.example');
        await signInPage.button('Continue').click();

        // Assert
        await page.waitForURL(/\/signin\/sso\?email=/);
        await expect(signInPage.app.getByText("No organisation signs in here with that email's domain. Sign in another way.")).toBeVisible();
        await expect(signInPage.button('Sign in as bob')).toBeVisible();
    });

    test('a sign-in link that was never made says it has been used or has expired', async ({ page, signInPage }) => {
        const answer = await page.goto(`/signin/link/${'A'.repeat(43)}`);
        expect(answer?.status()).toBe(404);
        await expect(signInPage.app.getByText('This sign-in link has been used or has expired. Make a new one on the device where you are signed in.')).toBeVisible();
    });

    test('a share link that does not exist says so, and leads back to Your apps', async ({ context, home, page }) => {
        // Arrange
        await signIn(context, 'bob');

        // Act
        const answer = await page.goto('/s/no-such-link');

        // Assert
        expect(answer?.status()).toBe(404);
        const linkPage = page.locator('#page-app');
        await expect(linkPage.getByText('Link not found')).toBeVisible();
        await expect(linkPage.getByText('This link does not work. Ask the person who sent it for a new one.')).toBeVisible();
        await linkPage.getByRole('button', { name: 'Your apps' }).click();
        await page.waitForURL((url) => url.pathname === '/');
        await expect(home.tab('Apps')).toBeVisible();
    });

    test('a share link opened before signing in leads through sign-in to the app, and its owner to the editor', async ({ browser, context, home, page }, info) => {
        // Arrange: alice shares an app with words on it
        await signIn(context, 'alice');
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'through'));
        await editor.ask('Through sign-in');
        const url = await useLink(editor);
        const stranger = await contextOf(browser);
        const visitor = await stranger.newPage();

        // Act: a stranger opens it, and signs in as bob
        await visitor.goto(url);
        await visitor.waitForURL(/\/signin\?next=%2Fs%2F/);
        await new SignInPage(visitor).button('Sign in as bob').click();

        // Assert: bob is in the app, not its editor
        await visitor.waitForURL(new RegExp(`/apps/${editor.appId}$`));
        await expect(new AppPage(visitor).app.getByText('Through sign-in')).toBeVisible();
        await stranger.close();

        // Act and Assert: alice's own link takes her to her editor
        await page.goto(url);
        await page.waitForURL(new RegExp(`/edit/${editor.appId}$`));
        await editor.ready();
    });

    test("someone given a use link has no way into the app's editor", async ({ browser, context, home }, info) => {
        // Arrange
        await signIn(context, 'alice');
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'no-edit'));
        await editor.ask('Use only');
        const url = await useLink(editor);
        const bob = await contextOf(browser, 'bob');
        const other = await bob.newPage();
        await other.goto(url);
        await expect(new AppPage(other).app.getByText('Use only')).toBeVisible();

        // Act
        const opened = await other.goto(`/edit/${editor.appId}`);

        // Assert: the editor is not there for bob, nor is a change through its API
        expect(opened?.status()).toBe(404);
        const change = await other.request.post(`/edit/${editor.appId}/nodes`, { headers: { Origin: new URL(other.url()).origin }, data: { operations: [] } });
        expect(change.status()).toBe(404);
        await bob.close();
    });
});
