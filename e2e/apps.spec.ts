import { BOARD, EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** The board of a workspace's apps: `/orgs/me` for the person's own, `/orgs/<org>` for an org's, with the app's tile asked for */
const boardUrl = (appId: string): RegExp => new RegExp(`/orgs/(me|[0-9a-f-]{36})\\?app=${appId}$`);

test.describe("A workspace's apps", () => {
    let editor: EditorPage;
    let appId: string;
    let name: string;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        name = uniqueName(info, 'apps');
        editor = await home.makeApp(name);
        appId = editor.appId;
    });

    test('should zoom out of the editor to the board of apps, on the app, and back in with the chord', async ({ page }) => {
        // Arrange
        await page.locator(BOARD).click({ position: { x: 5, y: 5 } });

        // Act
        await page.keyboard.press('Control+Shift+Minus');
        await expect(page).toHaveURL(boardUrl(appId));
        const levels = page.getByRole('navigation', { name: 'Where you are' });
        const tile = page.locator('#apps').getByText(name, { exact: true });
        await expect(tile).toBeVisible();
        await page.keyboard.press('Control+Shift+Equal');

        // Assert
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}$`));
        await page.goBack();
        await expect(page).toHaveURL(boardUrl(appId));
        await expect(levels.getByRole('link', { name: 'Orgs' })).toHaveAttribute('href', '/orgs?org=me');
    });

    test('should open the app a tile names when it is pressed', async ({ page }) => {
        // Arrange
        await page.goto(`/orgs/me?app=${appId}`);
        const tile = page.locator('#apps').getByText(name, { exact: true });
        await expect(tile).toBeVisible();

        // Act
        await tile.click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}$`));
    });

    test('should zoom out of a workspace to the Orgs level, on its tile, and back in', async ({ page }) => {
        // Arrange
        await page.goto(`/orgs/me?app=${appId}`);
        await expect(page.locator('#apps').getByText(name, { exact: true })).toBeVisible();

        // Act
        await page.keyboard.press('Control+Shift+Minus');
        await expect(page).toHaveURL(/\/orgs\?org=me$/);
        await expect(page.locator('#apps').getByText('Yours', { exact: true })).toBeVisible();
        await page.keyboard.press('Control+Shift+Equal');

        // Assert
        await expect(page).toHaveURL(/\/orgs\/me$/);
        await expect(page.locator('#apps').getByText(name, { exact: true })).toBeVisible();
    });

    test('should grow the editor out of the tile as a view transition, and name the editor page to shrink back', async ({ page }) => {
        // Arrange: each page notes whether the browser ran a view transition as it was left
        await page.addInitScript(() => addEventListener('pageswap', (event) => sessionStorage.setItem('zoomed', String((event as Event & { viewTransition: unknown }).viewTransition !== null))));
        await page.goto(`/orgs/me?app=${appId}`);
        const tile = page.locator('#apps').getByText(name, { exact: true });
        await expect(tile).toBeVisible();
        await expect(page.locator('#zoom-mark')).toHaveClass(/(^| )tile( |$)/);

        // Act
        await tile.click();
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}$`));
        const grown = await page.evaluate(() => sessionStorage.getItem('zoomed'));

        // Assert
        expect(grown).toBe('true');
        expect(await page.evaluate(() => getComputedStyle(document.body).viewTransitionName)).toBe('zoom');
    });
});
