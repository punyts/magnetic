import type { Page } from '@playwright/test';
import { BOARD, EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** A press on the board's corner, beside every panel, takes the focus out of the chat so a key reaches the editor */
async function focusCanvas(page: Page): Promise<void> {
    await page.locator(BOARD).click({ position: { x: 5, y: 5 } });
}

test.describe("The editor's keys", () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'keys'));
    });

    test('V, H and S pick the tools, and the same letters typed in the request do not', async ({ page }) => {
        // Arrange
        await focusCanvas(page);

        // Act and Assert: each letter picks its tool
        await page.keyboard.press('s');
        await expect.poll(() => editor.tool()).toBe('select');
        await page.keyboard.press('h');
        await expect.poll(() => editor.tool()).toBe('move');
        await page.keyboard.press('v');
        await expect.poll(() => editor.tool()).toBe('use');

        // Typed into the request, they are words, not tools
        await editor.request.fill('');
        await editor.request.pressSequentially('hs');
        await expect(editor.request).toHaveValue('hs');
        expect(await editor.tool()).toBe('use');
    });

    test('0 zooms to 100%, + and - zoom in and out, and 1 fits the app again', async ({ page }) => {
        // Arrange
        const percent = async (): Promise<number> => Number(((await editor.zoomButton.textContent()) ?? '').replace('%', ''));
        const fitted = await percent();
        await focusCanvas(page);

        // Act and Assert
        await page.keyboard.press('0');
        await expect.poll(percent).toBe(100);
        await page.keyboard.press('+');
        await expect.poll(percent).toBeGreaterThan(100);
        await page.keyboard.press('-');
        await page.keyboard.press('-');
        await expect.poll(percent).toBeLessThan(100);
        await page.keyboard.press('1');
        await expect.poll(percent).toBe(fitted);
    });

    test('P, C and D open and close the Screens, Connections and Shared data panels', async ({ page }) => {
        const panels = [
            ['p', 'Press a screen, here or on the canvas, to work on it.'],
            ['c', 'The outside APIs this app can call.'],
            ['d', 'Datasets other people and orgs shared with this workspace']
        ] as const;
        for (const [key, hint] of panels) {
            // Arrange
            await focusCanvas(page);
            const shown = editor.editor.getByText(hint, { exact: false });
            await expect(shown, key).toBeHidden();

            // Act and Assert: the key opens its panel, and again closes it
            await page.keyboard.press(key);
            await expect(shown, key).toBeVisible();
            await focusCanvas(page);
            await page.keyboard.press(key);
            await expect(shown, key).toBeHidden();
        }
    });

    test('Escape closes the chat, and its button shows it again', async ({ page }) => {
        // Arrange: a turn, so the chat has a message to show
        await editor.ask('Escape words');
        const mine = editor.editor.getByRole('img', { name: 'You' });
        await expect(mine).toBeVisible();
        await focusCanvas(page);

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(mine).toBeHidden();
        await editor.button('Show the chat').click();
        await expect(mine).toBeVisible();
    });
});
