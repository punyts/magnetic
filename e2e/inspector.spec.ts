import type { Page } from '@playwright/test';
import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('The inspector', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'inspect'));
        await editor.ask('One');
        await editor.ask('Two');
        await editor.button('Close the chat').click();
        await editor.closeLibrary();
    });

    /** Selects a part of the app by its text with the Select tool */
    async function select(page: Page, text: string): Promise<void> {
        if ((await editor.tool()) !== 'select') await editor.button('Select a part of the app (S)').click();
        const box = await editor.app.getByText(text, { exact: true }).boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + 4, box.y + box.height / 2);
        await expect(page.locator('.inspect-layer .overlay .box.selected')).toBeVisible();
        await expect(editor.editor.getByRole('tabpanel').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(text);
    }
    /** The top of a part's text, once it is shown; NaN while it is drawn again, so a poll tries again */
    const yOf = async (text: string): Promise<number> => {
        const part = editor.app.getByText(text, { exact: true });
        await expect(part).toBeVisible();
        return (await part.boundingBox())?.y ?? Number.NaN;
    };

    test("Delete in the inspector removes the part from the app", async ({ page }) => {
        // Arrange
        await select(page, 'One');

        // Act
        await editor.editor.getByRole('tabpanel').getByRole('button', { name: 'Delete' }).click();

        // Assert: gone, the other part kept, nothing selected
        await expect(editor.app.getByText('One', { exact: true })).toHaveCount(0);
        await expect(editor.app.getByText('Two', { exact: true })).toBeVisible();
        await expect(page.locator('.inspect-layer .overlay .box.selected')).toHaveCount(0);
    });

    test('the Delete key removes the selected part, and it stays removed', async ({ page }) => {
        // Arrange
        await select(page, 'Two');

        // Act
        await page.keyboard.press('Delete');

        // Assert
        await expect(editor.app.getByText('Two', { exact: true })).toHaveCount(0);
        await page.reload();
        await editor.ready();
        await expect(editor.app.getByText('One', { exact: true })).toBeVisible();
        await expect(editor.app.getByText('Two', { exact: true })).toHaveCount(0);
    });

    test('Alt+Up moves the selected part before the one above it, and Alt+Down back', async ({ page }) => {
        // Arrange
        await expect.poll(async () => (await yOf('Two')) - (await yOf('One'))).toBeGreaterThan(0);
        await select(page, 'Two');

        // Act and Assert
        await page.keyboard.press('Alt+ArrowUp');
        await expect.poll(async () => (await yOf('One')) - (await yOf('Two'))).toBeGreaterThan(0);
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(async () => (await yOf('Two')) - (await yOf('One'))).toBeGreaterThan(0);
    });

    test('Add to chat puts the part in what the next request is about, and Clear empties it', async ({ page }) => {
        // Arrange
        await select(page, 'One');
        const about = editor.editor.getByText('About:', { exact: true });
        await expect(about).toBeHidden();

        // Act
        await editor.editor.getByRole('tabpanel').getByRole('button', { name: 'Add to chat' }).click();

        // Assert: said, and listed above the request
        await expect(editor.editor.getByText('Added to the chat: the agent sees it with your next request')).toBeVisible();
        await expect(about).toBeVisible();
        await editor.button('Close the inspector').click();
        await editor.button('Clear').click();
        await expect(about).toBeHidden();
    });

    test('a part added to the chat goes with the next request, and the list empties after', async ({ page }) => {
        // Arrange
        await select(page, 'Two');
        await editor.editor.getByRole('tabpanel').getByRole('button', { name: 'Add to chat' }).click();
        const about = editor.editor.getByText('About:', { exact: true });
        await expect(about).toBeVisible();
        const sent = page.waitForRequest((request) => request.url().endsWith('/turns') && request.method() === 'POST');

        // Act
        await editor.button('Close the inspector').click();
        await editor.button('Show the chat').click();
        await editor.ask('About two');

        // Assert
        const body = (await sent).postDataJSON() as { focus?: string[] };
        expect(body.focus).toHaveLength(1);
        expect(body.focus?.[0]).toContain('home');
        await expect(about).toBeHidden();
    });

    test('Escape lets go of the selection, and the inspector says how to select', async ({ page }) => {
        // Arrange
        await select(page, 'One');

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(page.locator('.inspect-layer .overlay .box.selected')).toHaveCount(0);
        await expect(editor.editor.getByText('Press S, then click a part of the app to see its properties.')).toBeVisible();
    });
});
