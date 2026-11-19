import type { Page } from '@playwright/test';
import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** Picks a view with the selector: a segmented control at a wide window, a menu below 760px */
async function pickView(editor: EditorPage, page: Page, name: 'Screens' | 'Statenet' | 'Theme' | 'Logic'): Promise<void> {
    if (isPhone(page)) await editor.editor.getByRole('combobox', { name: 'View' }).selectOption({ label: name });
    else await editor.editor.getByRole('radio', { name }).click();
    await expect(page.locator('body')).toHaveAttribute('data-view', name.toLowerCase());
}

const sheet = (page: Page) => page.locator('#view-sheet');

test.describe("The editor's views", () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'views'));
        await editor.ask('Home words');
        // The chat floats over every view: closed, so the sheet takes the pointer
        await editor.button('Close the chat').click();
    });

    test('the selector switches between the screens and the app views, and the view is kept for the app', async ({ page }) => {
        await expect(sheet(page)).toBeHidden();
        await pickView(editor, page, 'Statenet');
        await expect(sheet(page)).toBeVisible();
        // The app itself is a card of the graph, with the parts it uses beside it
        await expect(sheet(page).locator('[data-node="app"]')).toBeVisible();
        // The screens' tools are for the screens: hidden in an app view
        await expect(editor.button('Zoom in (+)')).toBeHidden();
        await page.reload();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'statenet');
        await expect(sheet(page)).toBeVisible();
        await pickView(editor, page, 'Screens');
        await expect(sheet(page)).toBeHidden();
        await expect(editor.app.getByText('Home words')).toBeVisible();
    });

    test("the Theme view makes a theme and edits a token's value in one mode", async ({ page }, info) => {
        // Theme names are the owner's: each run and project makes its own
        const name = uniqueName(info, 'theme');
        await pickView(editor, page, 'Theme');
        page.once('dialog', (dialog) => void dialog.accept(name));
        await sheet(page).getByRole('button', { name: 'New theme' }).click();
        await expect(sheet(page).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
        // The specimens show the theme in each mode, the table each token
        await expect(sheet(page).locator('.specimen')).not.toHaveCount(0);
        await sheet(page).getByRole('button', { name: 'color.accent.base dark' }).click();
        const field = sheet(page).getByRole('textbox', { name: 'color.accent.base' });
        await field.fill('#ff6600');
        await field.press('Enter');
        await expect(sheet(page).getByRole('button', { name: 'color.accent.base dark' })).toContainText('#ff6600');
        await expect(sheet(page).getByRole('button', { name: 'color.accent.base light' })).not.toContainText('#ff6600');
    });

    test('the Logic view makes a rule on the server and moves it to the browser', async ({ page }) => {
        await pickView(editor, page, 'Logic');
        await expect(sheet(page).getByText('The app has no logic yet.')).toBeVisible();
        await sheet(page).getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Rule' });
        page.once('dialog', (dialog) => void dialog.accept('remember'));
        await sheet(page).getByRole('button', { name: 'New', exact: true }).click();
        const text = sheet(page).getByRole('textbox', { name: 'rules.remember' });
        await text.fill(JSON.stringify({ when: { path: '$.data.picked' }, do: [{ command: 'set', target: '$.data.seen', value: true }] }));
        await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
        const server = sheet(page).locator('.lane[data-runs="server"]');
        const browser = sheet(page).locator('.lane[data-runs="browser"]');
        await expect(server.locator('[data-unit="rules.remember"]')).toBeVisible();
        await server.locator('[data-unit="rules.remember"]').click();
        await sheet(page).getByRole('button', { name: 'Move to the browser' }).click();
        await expect(browser.locator('[data-unit="rules.remember"]')).toBeVisible();
        await expect(server.locator('[data-unit="rules.remember"]')).toHaveCount(0);
    });

    test('the chat bar shows what the view tells the agent: the view, and in Screens each layer that is on', async ({ page }) => {
        // Arrange
        const told = editor.editor.getByRole('list', { name: 'What the view shown tells the agent' }).getByRole('listitem');
        await expect(told).toHaveText(['Screens']);

        // Act and Assert: each view, and a layer of the screens, is a fixed chip with no ×
        if (!isPhone(page)) {
            await editor.button('Layout').click();
            await expect(told).toHaveText(['Screens', 'Layout']);
            await editor.button('Layout').click();
        }
        await pickView(editor, page, 'Theme');
        await expect(told).toHaveText(['Theme']);
        await expect(told.getByRole('button')).toHaveCount(0);
        await pickView(editor, page, 'Statenet');
        await expect(told).toHaveText(['Statenet']);
    });

    test("the layers draw a screen's layout and data on its tile", async ({ page }) => {
        test.skip(isPhone(page), 'The layers are drawn on the tiles of the wide canvas');
        await editor.button('Layout').click();
        await expect(page.locator('.tile-layer .lbox, .tile-layer .schematic').first()).toBeVisible();
        await editor.button('Data').click();
        await editor.button('Layout').click();
        await expect(page.locator('.tile-layer .lbox')).toHaveCount(0);
    });
});
