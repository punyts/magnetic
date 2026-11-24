import type { Page } from '@playwright/test';
import { BOARD, EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('The editor', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'editor'));
    });

    test('has the top bar, the view selector, the tools, the layers, the zoom and the chat bar', async () => {
        const phone = test.info().project.name === 'phone';
        for (const name of ['All your apps', 'Open', 'Share', 'Use the app (V)', 'Move the canvas (H, or hold Space)', 'Select a part of the app (S)', 'Layout', 'Data', 'Zoom out (-)', 'Zoom in (+)', 'Fit the app (1)', 'Send'])
            await expect(editor.button(name).filter({ visible: true }).first(), name).toBeVisible();
        // Below 760px the views are a menu rather than a segmented control
        if (phone) await expect(editor.editor.getByRole('combobox', { name: 'View' })).toBeVisible();
        else for (const name of ['Screens', 'Statenet', 'Theme', 'Logic']) await expect(editor.editor.getByRole('radio', { name }), name).toBeVisible();
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

    test('the frame turns between landscape and portrait, and stays turned for the next editor', async ({ page }) => {
        test.skip((page.viewportSize()?.width ?? 1440) < 760, 'Below 760px the corner has no room for the turn button');
        // Arrange
        await editor.sizeSelect.selectOption({ label: 'Desktop' });
        const turn = editor.button('Turn the frame: landscape or portrait');

        // Act
        await turn.click();

        // Assert: the width and height swap, for every size, until it is turned back
        await expect(editor.artboardSize).toHaveText(/800\s*×\s*1280/);
        await editor.sizeSelect.selectOption({ label: 'Phone' });
        await expect(editor.artboardSize).toHaveText(/844\s*×\s*390/);
        await page.reload();
        await expect(editor.artboardSize).toHaveText(/844\s*×\s*390/);
        await turn.click();
        await expect(editor.artboardSize).toHaveText(/390\s*×\s*844/);
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
        for (const tab of ['Properties', 'State']) await expect(editor.editor.getByRole('tab', { name: tab })).toBeVisible();
        // The library is a panel of its own now, not a tab of the inspector
        await expect(editor.editor.getByRole('tab', { name: 'Add' })).toHaveCount(0);
        const text = editor.app.getByText('Select me');
        const box = await text.boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.locator('.inspect-layer .overlay .box.selected')).toBeVisible();
        const panel = editor.editor.getByRole('tabpanel');
        for (const name of ['Add to chat', 'Delete']) await expect(panel.getByRole('button', { name })).toBeVisible();
        // The Text property, changed by hand, changes the app
        const field = panel.getByRole('textbox', { name: 'Text', exact: true });
        await expect(field).toHaveValue("Select me");
        await field.fill("Changed by hand");
        await field.press("Enter");
        await expect(editor.app.getByText('Changed by hand')).toBeVisible();
        await editor.button('Close the inspector').click();
        await expect(editor.editor.getByRole('tab', { name: 'Properties' })).toBeHidden();
    });

    test('Ctrl+Shift+= zooms into the app, and Ctrl+Shift+- out to the editor again', async ({ page }) => {
        const appId = editor.appId;
        // A press on the board's corner, beside every panel, takes the focus out of the chat
        await page.locator(BOARD).click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+Shift+Equal');
        await page.waitForURL(new RegExp(`/apps/${appId}/screens/[a-z][a-z0-9-]*$`));
        await expect(page.locator('body')).not.toHaveClass(/(^| )editing( |$)/);
        await page.keyboard.press('Control+Shift+Minus');
        await page.waitForURL(new RegExp(`/edit/${appId}/screens/[a-z][a-z0-9-]*$`));
        await expect(page.locator('body')).toHaveClass(/(^| )editing( |$)/);
    });

    test('a tip that reaches past its panel is shown whole, above the canvas', async ({ page }) => {
        // Arrange
        const button = editor.button('Select a part of the app (S)');
        const tip = editor.editor.locator('.tip:popover-open');

        // Act
        await button.hover();

        // Assert: the tip is an open popover, in the top layer above the panels and the canvas, and stands out past the
        // button's panel
        await expect(tip).toHaveText('Select a part of the app (S)');
        const [own, shown] = [(await button.boundingBox())!, (await tip.boundingBox())!];
        expect(shown.x + shown.width).toBeGreaterThan(own.x + own.width);
        await page.mouse.move(700, 450);
        await expect(tip).toBeHidden();
    });

    test('All your apps goes home', async ({ page }) => {
        await editor.button('All your apps').click();
        await page.waitForURL((url) => url.pathname === '/');
    });
});

test.describe('The component library', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'library'));
    });

    test('shows beside the rail on a wide window and starts hidden on a phone; its button and A show and hide it', async ({ page }) => {
        const wide = (page.viewportSize()?.width ?? 1440) >= 760;
        await expect(editor.librarySearch).toBeVisible({ visible: wide });
        await editor.button('Components (A)').click();
        await expect(editor.librarySearch).toBeVisible({ visible: !wide });
        // A press on the board's corner, beside every panel, takes the focus out of the chat
        await page.locator(BOARD).click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('a');
        await expect(editor.librarySearch).toBeVisible({ visible: wide });
        await editor.openLibrary();
        await editor.button('Close the components').click();
        await expect(editor.librarySearch).toBeHidden();
    });

    test('narrows to what is typed, letter by letter, and by category', async () => {
        await editor.openLibrary();
        await expect(editor.card('accordion')).toBeVisible();
        await editor.librarySearch.pressSequentially('butt');
        await expect(editor.card('accordion')).toBeHidden();
        await expect(editor.card('button')).toBeVisible();
        await editor.librarySearch.fill('');
        await editor.editor.getByRole('combobox').filter({ hasText: 'All' }).selectOption({ label: 'Feedback' });
        await expect(editor.card('alert')).toBeVisible();
        await expect(editor.card('accordion')).toBeHidden();
    });

    test('a component pressed and then clicked in the app lands there', async ({ page }) => {
        await editor.ask('Place below');
        await editor.button('Close the chat').click();
        await editor.openLibrary();
        await editor.librarySearch.fill('button');
        await editor.card('button').click();
        await expect.poll(() => editor.tool()).toBe('place');
        // While it is placed, the screen's layout sections are outlined with their names, the screen's root first
        await expect(page.locator('.inspect-layer .overlay .box.section').first()).toBeVisible();
        await expect(page.locator('.inspect-layer .overlay .box.section .tag').first()).toContainText('home');
        const box = await editor.app.getByText('Place below').boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height + 4);
        await expect(editor.app.getByRole('button')).toHaveCount(1);
        await expect(page.locator('.inspect-layer .overlay .box.section')).toHaveCount(0);
    });

    test('a component dragged from the library onto the app lands where it is dropped', async ({ page }) => {
        test.skip((page.viewportSize()?.width ?? 1440) < 760, 'On a phone the library is a sheet over the app, and a component is pressed, then placed');
        await editor.ask('Drop below');
        await editor.button('Close the chat').click();
        await editor.librarySearch.fill('badge');
        const card = editor.card('badge');
        const from = await card.boundingBox();
        const target = await editor.app.getByText('Drop below').boundingBox();
        expect(from).not.toBeNull();
        expect(target).not.toBeNull();
        if (from === null || target === null) return;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
        await page.mouse.move(target.x + target.width / 2, target.y + target.height + 4, { steps: 12 });
        await page.mouse.up();
        await expect(editor.app.getByText('Badge', { exact: true })).toHaveCount(1);
        await expect.poll(() => editor.tool()).toBe('select');
    });

    test('a drag dropped outside the app adds nothing', async ({ page }) => {
        test.skip((page.viewportSize()?.width ?? 1440) < 760, 'No drag on a phone');
        await editor.ask('Nothing added');
        await editor.button('Close the chat').click();
        await editor.librarySearch.fill('button');
        const from = await editor.card('button').boundingBox();
        expect(from).not.toBeNull();
        if (from === null) return;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
        // The canvas below the frame, outside the app
        const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.mouse.move(viewport.width - 60, viewport.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => editor.tool()).not.toBe('place');
        await expect(editor.app.getByRole('button')).toHaveCount(0);
    });

});

test.describe('Layout and placement', () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'layout'));
        await editor.ask('One');
        await editor.ask('Two');
        await editor.button('Close the chat').click();
    });

    /** Selects a part of the app by its text, then (with `up`) its parent from the breadcrumb */
    async function selectText(page: Page, text: string, up = false): Promise<void> {
        if ((await editor.tool()) !== 'select') await editor.button('Select a part of the app (S)').click();
        const box = await editor.app.getByText(text, { exact: true }).boundingBox();
        expect(box).not.toBeNull();
        if (box !== null) await page.mouse.click(box.x + 4, box.y + box.height / 2);
        await expect(page.locator('.inspect-layer .overlay .box.selected')).toBeVisible();
        if (up) await editor.editor.getByRole('tabpanel').getByText('home screen').click();
    }
    const field = (name: string) => editor.editor.getByRole('tabpanel').getByRole('combobox', { name, exact: true });
    const number = (name: string) => editor.editor.getByRole('tabpanel').getByRole('spinbutton', { name, exact: true });
    const boxOf = async (text: string) => (await editor.app.getByText(text, { exact: true }).boundingBox()) as { x: number; y: number; width: number; height: number };

    test('a column made a grid of two lays its parts side by side', async ({ page }) => {
        await selectText(page, 'One', true);
        await expect(editor.editor.getByRole('tabpanel').getByText('Layout', { exact: true })).toBeVisible();
        await expect(field('Lays out its parts as')).toHaveValue('column');
        const [one, two] = [await boxOf('One'), await boxOf('Two')];
        expect(two.y).toBeGreaterThan(one.y);
        await field('Lays out its parts as').selectOption('grid');
        await expect(number('Cols')).toBeVisible();
        await number('Cols').fill('2');
        await number('Cols').press('Enter');
        await expect.poll(async () => Math.abs((await boxOf('Two')).y - (await boxOf('One')).y)).toBeLessThan(4);
        await expect.poll(async () => (await boxOf('Two')).x).toBeGreaterThan((await boxOf('One')).x + 20);
    });

    test('a part of a grid takes its place in it: spanning two columns pushes the next part down', async ({ page }) => {
        await selectText(page, 'One', true);
        await field('Lays out its parts as').selectOption('grid');
        await number('Cols').fill('2');
        await number('Cols').press('Enter');
        await expect.poll(async () => Math.abs((await boxOf('Two')).y - (await boxOf('One')).y)).toBeLessThan(4);
        await selectText(page, 'One');
        await expect(editor.editor.getByRole('tabpanel').getByText('Place in its parent')).toBeVisible();
        await number('Span').fill('2');
        await number('Span').press('Enter');
        await expect.poll(async () => (await boxOf('Two')).y).toBeGreaterThan((await boxOf('One')).y + 4);
    });

    test('changing the type keeps the settings both types have', async ({ page }) => {
        await selectText(page, 'One', true);
        await field('Gap').selectOption('lg');
        await expect.poll(async () => (await boxOf('Two')).y - (await boxOf('One')).y).toBeGreaterThan(0);
        await field('Lays out its parts as').selectOption('row');
        await expect(field('Gap')).toHaveValue('lg');
        await expect(field('Wrap').or(editor.editor.getByRole('tabpanel').getByRole('switch', { name: 'Wrap' }))).toBeVisible();
        await expect.poll(async () => Math.abs((await boxOf('Two')).y - (await boxOf('One')).y)).toBeLessThan(4);
    });
});
