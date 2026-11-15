import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('The editor', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'editor'));
    });

    test('has the top bar, the tools, the Show toggles, the zoom and the chat bar', async () => {
        for (const name of ['All your apps', 'Open', 'Share', 'Use the app (V)', 'Move the canvas (H, or hold Space)', 'Select a part of the app (S)', 'Theme', 'Layout', 'Data', 'Logic', 'Screens', 'Zoom out (-)', 'Zoom in (+)', 'Fit the app (1)', 'Send'])
            await expect(editor.button(name), name).toBeVisible();
        await expect(editor.request).toBeVisible();
        await expect(editor.zoomButton).toBeVisible();
    });

    test('a blank app offers ideas, and an idea is sent to the agent', async () => {
        const idea = editor.button(/^A reading list/);
        await expect(idea).toBeVisible();
        await idea.click();
        await expect(editor.app.getByText(/^A reading list/)).toBeVisible({ timeout: 30_000 });
        await expect(editor.editor.getByText('This app is blank')).toBeHidden();
    });

    test('the agent builds what is asked, and the chat shows the turn', async () => {
        await editor.ask('Hello from the suite');
        await expect(editor.app.getByText('Hello from the suite')).toBeVisible();
        await expect(editor.editor.getByRole('img', { name: 'You' })).toBeVisible();
        await expect(editor.editor.getByRole('img', { name: 'Agent' })).toBeVisible();
        await editor.button('Close the chat').click();
        await expect(editor.editor.getByRole('img', { name: 'You' })).toBeHidden();
        await editor.button('Show the chat').click();
        await expect(editor.editor.getByRole('img', { name: 'You' })).toBeVisible();
    });

    test('the frame starts at the size of the screen, and takes the desktop, tablet and phone sizes', async ({ page }) => {
        // A phone opens the frame at Phone size, a wider screen at Desktop
        const narrow = (page.viewportSize()?.width ?? 1440) < 760;
        await expect(editor.artboardSize).toHaveText(narrow ? /390\s*×\s*844/ : /1280\s*×\s*800/);
        for (const [label, size] of [['Tablet', /834\s*×\s*1112/], ['Phone', /390\s*×\s*844/], ['Desktop', /1280\s*×\s*800/]] as const) {
            await editor.sizeSelect.selectOption({ label });
            await expect(editor.artboardSize).toHaveText(size);
        }
    });

    test('the canvas zooms in, out and to fit', async () => {
        const percent = async (): Promise<number> => Number(((await editor.zoomButton.textContent()) ?? '').replace('%', ''));
        const fitted = await percent();
        await editor.button('Zoom in (+)').click();
        await expect.poll(percent).toBeGreaterThan(fitted);
        await editor.button('Zoom out (-)').click();
        await editor.button('Zoom out (-)').click();
        await expect.poll(percent).toBeLessThan(fitted);
        await editor.zoomButton.click();
        await expect.poll(percent).toBe(100);
        await editor.button('Fit the app (1)').click();
        await expect.poll(percent).toBe(fitted);
    });

    test('Select opens the inspector, and a part of the app shows its properties', async ({ page }) => {
        await editor.ask('Select me');
        await editor.button('Select a part of the app (S)').click();
        for (const tab of ['Properties', 'Add', 'State']) await expect(editor.editor.getByRole('tab', { name: tab })).toBeVisible();
        const text = editor.app.getByText('Select me');
        const box = await text.boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.locator('#overlay .box.selected')).toBeVisible();
        const panel = editor.editor.getByRole('tabpanel');
        for (const name of ['Add to chat', 'Delete']) await expect(panel.getByRole('button', { name })).toBeVisible();
        // The Text property, changed by hand, changes the app
        const field = panel.getByRole('textbox').first();
        await expect(field).toHaveValue("Select me");
        await field.fill("Changed by hand");
        await field.press("Enter");
        await expect(editor.app.getByText('Changed by hand')).toBeVisible();
        await editor.button('Close the inspector').click();
        await expect(editor.editor.getByRole('tab', { name: 'Properties' })).toBeHidden();
    });

    test('the library narrows to what is searched for, once Enter is pressed', async () => {
        // The search box raises change on Enter or when it is left, not as each letter is typed: N2 narrows as you type
        await editor.button('Select a part of the app (S)').click();
        await editor.editor.getByRole('tab', { name: 'Add' }).click();
        await expect(editor.editor.getByText('accordion', { exact: true })).toBeVisible();
        await editor.editor.getByPlaceholder('Find a component').fill('button');
        await editor.editor.getByPlaceholder('Find a component').press('Enter');
        await expect(editor.editor.getByText('accordion', { exact: true })).toBeHidden();
        await expect(editor.editor.getByText('button', { exact: true }).first()).toBeVisible();
    });

    test('a component from the library is placed where the app is clicked', async ({ page }) => {
        await editor.ask('Place below');
        await editor.button('Select a part of the app (S)').click();
        await editor.editor.getByRole('tab', { name: 'Add' }).click();
        await editor.button('Close the chat').click();
        await editor.editor.getByPlaceholder('Find a component').fill('button');
        await editor.editor.getByText('button', { exact: true }).first().click();
        await expect.poll(() => page.evaluate('window.magneticShell.tool()')).toBe('place');
        const box = await editor.app.getByText('Place below').boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height + 4);
        await expect(editor.app.getByRole('button')).toHaveCount(1);
    });

    test('Ctrl+Shift+E leaves the editor for the app, and brings it back', async ({ page }) => {
        const appId = editor.appId;
        await page.locator('main').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+Shift+E');
        await page.waitForURL(new RegExp(`/apps/${appId}$`));
        await expect(page.locator('body')).not.toHaveClass(/(^| )editing( |$)/);
        await page.keyboard.press('Control+Shift+E');
        await page.waitForURL(new RegExp(`/edit/${appId}$`));
        await expect(page.locator('body')).toHaveClass(/(^| )editing( |$)/);
    });

    test('All your apps goes home', async ({ page }) => {
        await editor.button('All your apps').click();
        await page.waitForURL((url) => url.pathname === '/');
    });
});
