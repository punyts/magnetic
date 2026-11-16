import type { Page } from '@playwright/test';
import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** Adds a screen from the Screens panel by its name */
async function addScreen(editor: EditorPage, name: string): Promise<void> {
    const field = editor.editor.getByRole('textbox', { name: 'New screen', exact: true });
    await field.fill(name);
    await field.press('Tab');
    await editor.button('Add').click();
    await expect(editor.editor.getByText(name, { exact: true }).first()).toBeVisible();
}

const preview = (page: Page, screen: string) => page.locator(`.preview[data-screen="${screen}"]`);

test.describe('Screens', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home, page }, info) => {
        test.skip((page.viewportSize()?.width ?? 1440) < 760, 'Screens side by side are a wide-window view; on a phone the panel is a sheet over them');
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'screens'));
        await editor.ask('Home words');
        await editor.button('Close the chat').click();
        await editor.button('Screens (P)').click();
        await expect(editor.editor.getByText('Press a screen, here or on the canvas, to work on it.')).toBeVisible();
    });

    test('the panel lists the screens and adds one; each screen is a frame of its own, in order', async ({ page }) => {
        await expect(editor.editor.getByText('Home', { exact: true })).toBeVisible();
        await addScreen(editor, 'about');
        // The new screen is the one worked on; the home screen is a preview to its left
        await expect(page.locator('#artboard-size').locator('xpath=..')).toContainText('About');
        await expect(preview(page, 'home')).toHaveCount(1);
        const homeBox = await preview(page, 'home').boundingBox();
        const liveBox = await page.locator('#artboard').boundingBox();
        expect(homeBox!.x).toBeLessThan(liveBox!.x);
        // The preview shows the home screen as the app draws it
        await expect(page.frameLocator('.preview[data-screen="home"] iframe').getByText('Home words')).toBeVisible();
    });

    test('pressing a preview makes its screen the live one, in its place', async ({ page }) => {
        await addScreen(editor, 'about');
        await editor.button('Zoom out (-)').click();
        await editor.button('Zoom out (-)').click();
        // The zoom glides: measure once it has settled
        await page.waitForTimeout(600);
        const was = await preview(page, 'home').boundingBox();
        await preview(page, 'home').locator('.preview-cover').click();
        await expect(page.locator('#artboard-size').locator('xpath=..')).toContainText('Home');
        const live = await page.locator('#artboard').boundingBox();
        expect(Math.abs(live!.x - was!.x)).toBeLessThan(3);
        await expect(editor.app.getByText('Home words')).toBeVisible();
        await expect(preview(page, 'about')).toHaveCount(1);
        await expect(preview(page, 'home')).toHaveCount(0);
        // The panel marks it as the one worked on
        await expect(editor.editor.getByRole('textbox', { name: 'Rename', exact: true })).toHaveValue('home');
    });

    test('a screen is copied with its parts, renamed, opened on, and the other deleted', async ({ page }) => {
        await editor.button('Copy').click();
        await expect(editor.editor.getByText('Home copy', { exact: true })).toBeVisible();
        await expect(editor.app.getByText('Home words')).toBeVisible();
        const rename = editor.editor.getByRole('textbox', { name: 'Rename', exact: true });
        await expect(rename).toHaveValue('home-copy');
        await rename.fill('welcome');
        await rename.press('Tab');
        // A new revision reloads the list after the name was typed (on a slow machine, the copy's): what was typed stays
        const reloaded = page.waitForResponse((answer) => answer.url().endsWith('/screens') && answer.request().method() === 'GET');
        await page.evaluate(() => { document.body.dataset.revision = 'typed-' + Date.now(); });
        await reloaded;
        await editor.button('Rename').click();
        // The server's answer: the list names the screen anew (the field alone shows what was typed)
        await expect(editor.editor.getByText('welcome', { exact: true })).toBeVisible();
        await expect(rename).toHaveValue('welcome');
        await editor.button('Open on it').click();
        await expect(editor.editor.getByText('The app opens on it', { exact: true })).toBeVisible();
        await expect(editor.button('Delete')).toBeHidden();
        // The old home screen can go now
        await preview(page, 'home').locator('.preview-cover').click();
        page.once('dialog', (dialog) => void dialog.accept());
        await editor.button('Delete').click();
        await expect(preview(page, 'home')).toHaveCount(0);
        await expect(editor.editor.getByText('Home', { exact: true })).toBeHidden();
        await expect(rename).toHaveValue('welcome');
    });

    test('a name that is not a screen name is refused with the rule', async () => {
        const field = editor.editor.getByRole('textbox', { name: 'New screen', exact: true });
        await field.fill('Not A Name');
        await field.press('Tab');
        await editor.button('Add').click();
        await expect(editor.editor.getByText('A screen name is lower-case letters, digits and dashes, starting with a letter.')).toBeVisible();
    });

    test('only the previews in view run; one out of view shows its name', async ({ page }) => {
        for (const name of ['one', 'two', 'three']) await addScreen(editor, name);
        await preview(page, 'home').locator('.preview-cover').click();
        await editor.zoomButton.click();
        await expect.poll(() => page.locator('.preview').count()).toBe(3);
        await expect.poll(() => page.locator('.preview iframe').count()).toBeLessThan(3);
        await expect(preview(page, 'three').locator('.preview-idle')).toHaveText('Three');
    });
});
