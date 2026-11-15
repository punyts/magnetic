import type { Browser, Page } from '@playwright/test';
import { AppPage, EditorPage, expect, HomePage, signIn, test, uniqueName } from './fixtures.js';

/** A page of a person of their own, in a context of its own */
async function personPage(browser: Browser, user: string, viewport: { width: number; height: number } | null): Promise<Page> {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, ...(viewport !== null && { viewport }) });
    await signIn(context, user);
    return context.newPage();
}

/** Makes a link with the right picked in the Share panel, and reads it back from the panel's list */
async function makeLink(editor: EditorPage, right: RegExp): Promise<string> {
    await editor.button('Share').click();
    const rights = editor.editor.getByRole('combobox').filter({ hasText: 'use it, with their own data' });
    const option = (await rights.locator('option').allTextContents()).find((text) => right.test(text));
    await rights.selectOption({ label: option as string });
    await editor.button('Make link').click();
    await expect(editor.editor.getByText('Link made. Copy it and send it.')).toBeVisible();
    const note = editor.editor.getByText(/\/s\/[A-Za-z0-9_-]+/).first();
    const url = /(https?:\/\/\S+\/s\/[A-Za-z0-9_-]+)/.exec((await note.textContent()) ?? '')?.[1];
    expect(url, 'the link in the Share panel').toBeDefined();
    return url as string;
}

test.describe('Sharing an app', () => {
    let editor: EditorPage;
    let name: string;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        name = uniqueName(info, 'shared');
        editor = await home.makeApp(name);
        await editor.ask('Shared words');
    });

    test('the Share panel says what each right means', async () => {
        await editor.button('Share').click();
        const rights = editor.editor.getByRole('combobox').filter({ hasText: 'use it, with their own data' });
        await expect(rights.locator('option')).toHaveText(['use it, with their own data', 'look at it, live and read only', 'copy it, to change their copy']);
        await expect(editor.editor.getByText(/Everyone signs in to open a link/)).toBeVisible();
        await editor.button('Close').click();
        await expect(editor.button('Make link')).toBeHidden();
    });

    test('a use link opens the app for another person, until it is revoked', async ({ browser, page }) => {
        const url = await makeLink(editor, /^use/);
        const bob = await personPage(browser, 'bob', page.viewportSize());
        await bob.goto(url);
        await expect(new AppPage(bob).app.getByText('Shared words')).toBeVisible();
        // It shows on bob's Your apps, under Shared with you
        const bobHome = new HomePage(bob);
        await bobHome.goto();
        await expect(bobHome.card(name)).toBeVisible();
        // Revoked, and bob's link no longer opens it
        await editor.goto(editor.appId);
        await editor.button('Share').click();
        page.once('dialog', (dialog) => void dialog.accept());
        await editor.editor.getByRole('button', { name: 'Revoke' }).first().click();
        await expect(editor.editor.getByText('Link revoked.')).toBeVisible();
        await bob.goto(url);
        await expect(bob.frameLocator('iframe').first().getByText('This link was revoked by the person who shared it.')).toBeVisible();
        await bob.context().close();
    });

    test('a remix link gives another person a copy of their own', async ({ browser, page }) => {
        const url = await makeLink(editor, /^copy/);
        const carol = await personPage(browser, 'carol', page.viewportSize());
        await carol.goto(url);
        const offer = carol.frameLocator('iframe').first();
        await expect(offer.getByText(/shared a copy of this app with you/)).toBeVisible();
        await offer.getByRole('button', { name: 'Remix' }).click();
        await carol.waitForURL(/\/(edit|apps)\/[0-9a-f-]+$/);
        await expect(new AppPage(carol).app.getByText('Shared words')).toBeVisible();
        await carol.context().close();
    });
});
