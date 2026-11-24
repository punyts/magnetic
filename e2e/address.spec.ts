import type { Locator, Page } from '@playwright/test';
import { BOARD, EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** The live app's frame on the board, a group named by its screen's title */
const liveFrame = (page: Page, title: string): Locator => page.locator(BOARD).getByRole('group', { name: title, exact: true });
/** The Screens panel: the innermost element of the editor that holds both its close button and its hint */
const panel = (editor: EditorPage): Locator => editor.editor.locator('*')
    .filter({ has: editor.page.getByRole('button', { name: 'Close the screens', exact: true }) })
    .filter({ has: editor.page.getByText('Press a screen, here or on the canvas, to work on it.') })
    .last();

/** Adds a screen through the editor's own route, as the Screens panel does */
async function addScreen(page: Page, appId: string, name: string): Promise<void> {
    const answer = await page.request.post(`/edit/${appId}/screens`, { headers: { Origin: new URL(page.url()).origin }, data: { action: 'add', name } });
    expect(answer.ok()).toBe(true);
}

test.describe('The address', () => {
    let editor: EditorPage;
    let appId: string;

    test.beforeEach(async ({ context, home, page }, info) => {
        test.skip((page.viewportSize()?.width ?? 1440) < 760, 'The board of screens is a wide-window view');
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'address'));
        appId = editor.appId;
        await addScreen(page, appId, 'about');
    });

    test('should open on the screen the address names, and go back to the screen before one chosen', async ({ page }) => {
        // Arrange
        await page.goto(`/edit/${appId}/screens/about`);
        await editor.ready();
        await expect(liveFrame(page, 'About')).toBeVisible();

        // Act: the panel opens (an entry), Home is chosen (another), then Back twice
        await editor.button('Screens (P)').click();
        await panel(editor).getByText('Home', { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}/screens/home\\?open=screens$`));
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}/screens/about\\?open=screens$`));
        await page.goBack();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}/screens/about$`));
        await expect(liveFrame(page, 'About')).toBeVisible();
    });

    test('should name an open sheet in the address, close it on Back and open it from a link', async ({ page }) => {
        // Arrange
        const sheet = editor.editor.getByText('Share this app', { exact: true });

        // Act
        await editor.button('Share').click();
        await expect(page).toHaveURL(/\?open=share$/);
        await page.goBack();

        // Assert
        await expect(sheet).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}$`));
        await page.goto(`/edit/${appId}?open=share`);
        await editor.ready();
        await expect(sheet).toBeVisible();
    });

    test('should zoom into the running app on the screen worked on, and out again, each an entry Back undoes', async ({ page }) => {
        // Arrange
        await page.goto(`/edit/${appId}/screens/about`);
        await editor.ready();
        await expect(liveFrame(page, 'About')).toBeVisible();

        // Act
        await page.keyboard.press('Control+Shift+Equal');
        await expect(page).toHaveURL(new RegExp(`/apps/${appId}/screens/about$`));
        await expect(page.getByRole('navigation', { name: 'Where you are' })).toContainText('About');
        await page.keyboard.press('Control+Shift+Minus');
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}/screens/about$`));
        await page.goBack();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/apps/${appId}/screens/about$`));
        await expect(page.locator('body')).not.toHaveClass(/(^| )editing( |$)/);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}/screens/about$`));
        await expect(liveFrame(page, 'About')).toBeVisible();
    });

    test('should zoom out of the editor to the board of its workspace\'s apps', async ({ page }) => {
        // Arrange
        await page.goto(`/edit/${appId}`);
        await editor.ready();

        // Act
        await page.locator(BOARD).click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+Shift+Minus');

        // Assert
        await expect(page).toHaveURL(new RegExp(`/orgs/me\\?app=${appId}$`));
    });
});
