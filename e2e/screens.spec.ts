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
        // The old home screen goes
        await preview(page, 'home').locator('.preview-cover').click();
        await editor.button('Delete').click();
        await page.getByRole('dialog', { name: 'Screen Home' }).getByRole('button', { name: 'Delete' }).click();
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

    test('the screens are laid out in rows of five, and of as many as chosen', async ({ page }) => {
        for (const name of ['one', 'two', 'three', 'four', 'five']) await addScreen(editor, name);
        await preview(page, 'home').locator('.preview-cover').click();
        const columns = editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true });
        await expect(columns).toHaveValue('n5');
        const at = async (screen: string) => (await page.locator(`.preview[data-screen="${screen}"]`).evaluate((element) => ({ left: element.style.left, top: element.style.top })));
        // Six screens: five in the first row, the sixth under the first
        expect(await at('four')).toEqual({ left: expect.not.stringMatching(/^0px$/), top: '0px' });
        expect((await at('five')).left).toBe('0px');
        expect((await at('five')).top).not.toBe('0px');

        // Act
        await columns.selectOption({ label: '2' });

        // Assert: two to a row, the live frame where it was, and the choice kept for the next editor
        expect((await at('two')).left).toBe('0px');
        expect((await at('two')).top).toBe((await at('three')).top);
        await page.reload();
        await editor.button('Screens (P)').click();
        await expect(editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true })).toHaveValue('n2');
    });

    test('only the previews in view run; one out of view shows its name', async ({ page }) => {
        for (const name of ['one', 'two', 'three']) await addScreen(editor, name);
        await preview(page, 'home').locator('.preview-cover').click();
        await editor.zoomButton.click();
        await expect.poll(() => page.locator('.preview').count()).toBe(3);
        await expect.poll(() => page.locator('.preview iframe').count()).toBeLessThan(3);
        await expect(preview(page, 'three').locator('.preview-idle')).toHaveText('Three');
    });

    test('with more than four screens in view, the previews show only their names', async ({ page }) => {
        // Arrange: six screens two to a row, the home screen live, and the board fitted to it
        await zoomedOutOnSix(page);
        await editor.button('Fit the app (1)').click();
        await expect.poll(() => page.locator('.preview iframe').count()).toBeGreaterThan(0);

        // Act: zoomed out until every screen is in view
        await zoomOut(page);

        // Assert: nothing renders: no preview runs and the live frame hides, its screen a tile like the others, with no
        // name above; fitting the live frame again shows it and runs the previews in view
        await expect.poll(() => page.locator('.preview iframe').count()).toBe(0);
        await expect(page.locator('#artboard')).toBeHidden();
        await expect(preview(page, 'home').locator('.preview-idle')).toHaveText('Home');
        await expect(preview(page, 'five').locator('.preview-idle')).toHaveText('Five');
        await expect(preview(page, 'five').locator('.artboard-label')).toBeHidden();
        await editor.button('Fit the app (1)').click();
        await expect(page.locator('#artboard')).toBeVisible();
        await expect(preview(page, 'home')).toHaveCount(0);
        await expect.poll(() => page.locator('.preview iframe').count()).toBeGreaterThan(0);
    });

    test('a name dragged to another slot moves its screen there', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);
        const from = (await preview(page, 'three').boundingBox())!;
        const to = (await preview(page, 'one').boundingBox())!;

        // Act: three onto one's slot
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 3 });
        await expect(page.locator('.drop-slot')).toBeVisible();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();

        // Assert: the order is home, three, one, two, four, five, on the board and in the panel
        await expect.poll(() => order(page)).toEqual(['home', 'three', 'one', 'two', 'four', 'five']);
        const titles = editor.editor.getByText(/^(Home|One|Two|Three|Four|Five)$/);
        await expect(titles).toHaveText(['Home', 'Three', 'One', 'Two', 'Four', 'Five']);
    });

    test('a preview\'s menu retitles its screen and moves it earlier', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);

        // Act
        await preview(page, 'two').locator('.preview-cover').click({ button: 'right' });
        const menu = page.getByRole('dialog', { name: 'Screen Two' });
        await menu.getByLabel('Title').fill('Pricing');
        await menu.getByRole('button', { name: 'Save' }).first().click();
        await expect(menu).toBeHidden();
        await preview(page, 'two').locator('.preview-cover').click({ button: 'right' });
        await page.getByRole('dialog', { name: 'Screen Pricing' }).getByRole('button', { name: 'Move earlier' }).click();

        // Assert
        await expect(preview(page, 'two').locator('.preview-idle')).toHaveText('Pricing');
        await expect.poll(() => order(page)).toEqual(['home', 'two', 'one', 'three', 'four', 'five']);
    });

    test('a tile pressed in names shows its screen until it is deselected', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);

        // Act: select two
        await preview(page, 'two').locator('.preview-cover').click();

        // Assert: the live frame shows two in its slot, the others stay names; its × and Escape go back to names
        await expect(page.locator('#artboard')).toBeVisible();
        await expect(page.locator('#artboard-size').locator('xpath=..')).toContainText('Two');
        await expect(preview(page, 'two')).toHaveCount(0);
        await expect(page.locator('.preview iframe')).toHaveCount(0);
        await page.getByRole('button', { name: 'Show only its name' }).click();
        await expect(page.locator('#artboard')).toBeHidden();
        await expect(preview(page, 'two').locator('.preview-idle')).toHaveText('Two');
        await preview(page, 'three').locator('.preview-cover').click();
        await expect(page.locator('#artboard')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#artboard')).toBeHidden();
    });

    test('a tile has only its ⋯, whose menu deletes any screen once confirmed, the start one too', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);
        await expect(page.locator('.preview .preview-tool')).toHaveCount(await page.locator('.preview').count());

        // Act: two, then home, the screen the app opens on
        for (const [screen, title] of [['two', 'Two'], ['home', 'Home']] as const) {
            await preview(page, screen).hover();
            await preview(page, screen).getByRole('button', { name: 'More for ' + title }).click();
            const menu = page.getByRole('dialog', { name: 'Screen ' + title });
            await menu.getByRole('button', { name: 'Delete' }).click();
            await expect(menu).toContainText('Delete the screen ' + title + '?');
            await menu.getByRole('button', { name: 'Delete' }).click();
            await expect(preview(page, screen)).toHaveCount(0);
        }

        // Assert: both gone, and the app opens on the next screen
        await expect(editor.editor.getByText('Two', { exact: true })).toBeHidden();
        await expect(editor.editor.getByText('Home', { exact: true })).toBeHidden();
        const answer = await page.evaluate(async () => (await fetch(location.pathname + '/screens')).json());
        expect(answer.start).toBe('one');
    });

    test('the last screen deleted leaves one tile, Add a screen, which adds home and works on it', async ({ page }) => {
        // Act
        await editor.button('Delete').click();
        await page.getByRole('dialog', { name: 'Screen Home' }).getByRole('button', { name: 'Delete' }).click();

        // Assert: no live frame, only the tile; pressed, it adds home, the screen the app opens on
        const add = page.getByRole('button', { name: 'Add a screen' });
        await expect(add).toBeVisible();
        await expect(page.locator('#artboard')).toBeHidden();
        await add.click();
        await expect(page.locator('#artboard')).toBeVisible();
        await expect(page.locator('#artboard')).toHaveAttribute('data-screen', 'home');
        await expect(add).toBeHidden();
        const answer = await page.evaluate(async () => (await fetch(location.pathname + '/screens')).json());
        expect(answer.start).toBe('home');
    });
});

/** Six screens two to a row, home live, and zoomed out until all six are in view */
async function zoomedOutOnSix(page: Page): Promise<void> {
    const editor = new EditorPage(page);
    for (const name of ['one', 'two', 'three', 'four', 'five']) await addScreen(editor, name);
    await preview(page, 'home').locator('.preview-cover').click();
    await editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true }).selectOption({ label: '2' });
    await zoomOut(page);
}

async function zoomOut(page: Page): Promise<void> {
    const editor = new EditorPage(page);
    for (let step = 0; step < 6; step += 1) await editor.button('Zoom out (-)').click();
    // The zoom glides: wait for it to settle on names
    await expect(page.locator('body.screen-names')).toHaveCount(1);
    await page.waitForTimeout(400);
}

/** The tiles' screens in the order of their slots, left to right and down */
async function order(page: Page): Promise<string[]> {
    const placed = await page.locator('.preview').evaluateAll((elements) => elements.map((element) => ({
        name: (element as HTMLElement).dataset['screen'] ?? '',
        left: parseFloat((element as HTMLElement).style.left),
        top: parseFloat((element as HTMLElement).style.top)
    })));
    return placed.sort((a, b) => a.top - b.top || a.left - b.left).map((item) => item.name);
}
