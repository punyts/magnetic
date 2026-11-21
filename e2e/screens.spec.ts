import type { Locator, Page } from '@playwright/test';
import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** Adds a screen from the Screens panel by its name */
async function addScreen(editor: EditorPage, name: string): Promise<void> {
    const field = editor.editor.getByRole('textbox', { name: 'New screen', exact: true });
    await field.fill(name);
    await field.press('Tab');
    await editor.button('Add').click();
    await expect(editor.editor.getByText(name, { exact: true }).first()).toBeVisible();
}

const board = (page: Page): Locator => page.locator('#screens');
/** A card that is not the live one: its app's frame, a button named by the screen's title */
const preview = (page: Page, title: string): Locator => board(page).getByRole('button', { name: title, exact: true });
/** The live app's frame, a group named by its screen's title */
const liveFrame = (page: Page, title: string): Locator => board(page).getByRole('group', { name: title, exact: true });
const live = (page: Page): Locator => page.locator('#screens ui-embedded-app[live]');
const runningPreviews = (page: Page): Locator => page.locator('#screens ui-embedded-app[mounted]:not([live])');
const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(4);

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

    test('the panel lists the screens and adds one; each screen is a card of its own, in order', async ({ page }) => {
        await expect(editor.editor.getByText('Home', { exact: true })).toBeVisible();
        await addScreen(editor, 'about');
        // The new screen is the one worked on; the home screen is a preview to its left
        await expect(liveFrame(page, 'About')).toBeVisible();
        await expect(preview(page, 'Home')).toHaveCount(1);
        const at = await boxes(page);
        expect(at['home']!.x).toBeLessThan(at['about']!.x);
        // The preview shows the home screen as the app draws it
        await expect(preview(page, 'Home').getByText('Home words')).toBeVisible();
    });

    test('pressing a preview makes its screen the live one, in its place', async ({ page }) => {
        await addScreen(editor, 'about');
        await editor.button('Zoom out (-)').click();
        await editor.button('Zoom out (-)').click();
        // The zoom glides: measure once it has settled
        await page.waitForTimeout(600);
        const was = await preview(page, 'Home').boundingBox();
        await preview(page, 'Home').click();
        await expect(liveFrame(page, 'Home')).toBeVisible();
        const now = await liveFrame(page, 'Home').boundingBox();
        near(now!.x, was!.x);
        await expect(editor.app.getByText('Home words')).toBeVisible();
        await expect(preview(page, 'About')).toHaveCount(1);
        await expect(preview(page, 'Home')).toHaveCount(0);
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
        await preview(page, 'Home').click();
        await expect(liveFrame(page, 'Home')).toBeVisible();
        await editor.button('Delete').click();
        await page.getByRole('dialog', { name: 'Screen Home' }).getByRole('button', { name: 'Delete' }).click();
        await expect(preview(page, 'Home')).toHaveCount(0);
        await expect(liveFrame(page, 'Home')).toHaveCount(0);
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
        await preview(page, 'Home').click();
        await expect(liveFrame(page, 'Home')).toBeVisible();
        const columns = editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true });
        await expect(columns).toHaveValue('n5');
        // Six screens: five in the first row, the sixth under the first
        let at = await boxes(page);
        expect(at['four']!.x).toBeGreaterThan(at['home']!.x);
        near(at['four']!.y, at['home']!.y);
        near(at['five']!.x, at['home']!.x);
        expect(at['five']!.y).toBeGreaterThan(at['home']!.y);

        // Act
        await columns.selectOption({ label: '2' });

        // Assert: two to a row, and the choice kept for the next editor
        await expect.poll(async () => { const now = await boxes(page); return Math.abs(now['two']!.x - now['home']!.x); }).toBeLessThan(4);
        at = await boxes(page);
        near(at['two']!.y, at['three']!.y);
        await page.reload();
        await editor.button('Screens (P)').click();
        await expect(editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true })).toHaveValue('n2');
    });

    test('only the previews in view run; one out of view shows its name', async ({ page }) => {
        for (const name of ['one', 'two', 'three']) await addScreen(editor, name);
        await preview(page, 'Home').click();
        await editor.zoomButton.click();
        await expect(board(page).getByRole('button', { name: /^(One|Two|Three)$/ })).toHaveCount(3);
        await expect.poll(() => runningPreviews(page).count()).toBeLessThan(3);
        await expect(page.locator('#screens ui-embedded-app:not([mounted])').getByText('Three', { exact: true })).toBeVisible();
    });

    test('with more than four screens in view, the cards show only their names', async ({ page }) => {
        // Arrange: six screens two to a row, the home screen live, and the board fitted to it, then out until a preview runs
        await zoomedOutOnSix(page);
        await fitThenOutToAPreview(page);

        // Act: zoomed out until every screen is in view
        await zoomOut(page);

        // Assert: no app runs, the live one included: each screen is a card with its name; fitting the live app again
        // shows it, and the previews that come into view run
        await expect(page.locator('#screens ui-embedded-app[mounted]')).toHaveCount(0);
        await expect(live(page)).toHaveCount(0);
        await expect(preview(page, 'Home')).toHaveText('Home');
        await expect(preview(page, 'Five')).toHaveText('Five');
        await fitThenOutToAPreview(page);
        await expect(liveFrame(page, 'Home')).toBeVisible();
        await expect(preview(page, 'Home')).toHaveCount(0);
    });

    test('a name dragged to another place moves its screen there', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);
        const from = (await preview(page, 'Three').boundingBox())!;
        const to = (await preview(page, 'One').boundingBox())!;

        // Act: three onto one's place
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 3 });
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();

        // Assert: the order is home, three, one, two, four, five, on the board and in the panel
        await expect.poll(() => order(page)).toEqual(['home', 'three', 'one', 'two', 'four', 'five']);
        // In the order the panel shows them: a record keeps its slot when it moves, and slots are placed by position
        const titles = editor.editor.getByText(/^(Home|One|Two|Three|Four|Five)$/);
        await expect.poll(() => titles.evaluateAll((all) => all
            .map((title) => ({ text: title.textContent, top: title.getBoundingClientRect().top }))
            .sort((a, b) => a.top - b.top)
            .map((title) => title.text))).toEqual(['Home', 'Three', 'One', 'Two', 'Four', 'Five']);
    });

    test('a card\'s menu retitles its screen and moves it earlier', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);

        // Act
        await preview(page, 'Two').click({ button: 'right' });
        const menu = page.getByRole('dialog', { name: 'Screen Two' });
        await menu.getByLabel('Title').fill('Pricing');
        await menu.getByRole('button', { name: 'Save' }).first().click();
        await expect(menu).toBeHidden();
        await preview(page, 'Pricing').click({ button: 'right' });
        await page.getByRole('dialog', { name: 'Screen Pricing' }).getByRole('button', { name: 'Move earlier' }).click();

        // Assert
        await expect(preview(page, 'Pricing')).toHaveText('Pricing');
        await expect.poll(() => order(page)).toEqual(['home', 'two', 'one', 'three', 'four', 'five']);
    });

    test('a card pressed in names shows its screen until it is deselected', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);

        // Act: select two
        await preview(page, 'Two').click();

        // Assert: the live app shows two on its card, the others stay names; its × and Escape go back to names
        await expect(liveFrame(page, 'Two')).toBeVisible();
        await expect(preview(page, 'Two')).toHaveCount(0);
        await expect(runningPreviews(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Show only its name' }).click();
        await expect(live(page)).toHaveCount(0);
        await expect(preview(page, 'Two')).toHaveText('Two');
        await preview(page, 'Three').click();
        await expect(liveFrame(page, 'Three')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(live(page)).toHaveCount(0);
    });

    test('a card in names has its ⋯, whose menu deletes any screen once confirmed, the start one too', async ({ page }) => {
        // Arrange
        await zoomedOutOnSix(page);
        await expect(board(page).getByRole('button', { name: /^More for / })).toHaveCount(6);

        // Act: two, then home, the screen the app opens on
        for (const title of ['Two', 'Home']) {
            await preview(page, title).hover();
            await board(page).getByRole('button', { name: 'More for ' + title }).click();
            const menu = page.getByRole('dialog', { name: 'Screen ' + title });
            await menu.getByRole('button', { name: 'Delete' }).click();
            await expect(menu).toContainText('Delete the screen ' + title + '?');
            await menu.getByRole('button', { name: 'Delete' }).click();
            await expect(preview(page, title)).toHaveCount(0);
        }

        // Assert: both gone, and the app opens on the next screen
        await expect(editor.editor.getByText('Two', { exact: true })).toBeHidden();
        await expect(editor.editor.getByText('Home', { exact: true })).toBeHidden();
        const answer = await page.evaluate(async () => (await fetch(location.pathname + '/screens')).json());
        expect(answer.start).toBe('one');
    });

    test('the last screen deleted leaves one card, Add a screen, which adds home and works on it', async ({ page }) => {
        // Act
        await editor.button('Delete').click();
        await page.getByRole('dialog', { name: 'Screen Home' }).getByRole('button', { name: 'Delete' }).click();

        // Assert: no live app, only the card; pressed, it adds home, the screen the app opens on
        const add = page.getByRole('button', { name: 'Add a screen' });
        await expect(add).toBeVisible();
        await expect(live(page)).toHaveCount(0);
        await add.click();
        await expect(liveFrame(page, 'Home')).toBeVisible();
        await expect(add).toBeHidden();
        const answer = await page.evaluate(async () => (await fetch(location.pathname + '/screens')).json());
        expect(answer.start).toBe('home');
    });
});

/** Six screens two to a row, home live, and zoomed out until all six show only their names */
async function zoomedOutOnSix(page: Page): Promise<void> {
    const editor = new EditorPage(page);
    for (const name of ['one', 'two', 'three', 'four', 'five']) await addScreen(editor, name);
    await preview(page, 'Home').click();
    await expect(liveFrame(page, 'Home')).toBeVisible();
    await editor.editor.getByRole('combobox', { name: 'Screens in a row', exact: true }).selectOption({ label: '2' });
    await zoomOut(page);
}

/** Fits the live app, which then fills the view, and zooms out a step at a time until a preview comes into view and runs */
async function fitThenOutToAPreview(page: Page): Promise<void> {
    const editor = new EditorPage(page);
    await editor.button('Fit the app (1)').click();
    await expect(live(page)).toHaveCount(1);
    for (let step = 0; step < 4 && (await runningPreviews(page).count()) === 0; step += 1) {
        await editor.button('Zoom out (-)').click();
        await page.waitForTimeout(600);
    }
    await expect.poll(() => runningPreviews(page).count()).toBeGreaterThan(0);
}

async function zoomOut(page: Page): Promise<void> {
    const editor = new EditorPage(page);
    for (let step = 0; step < 6; step += 1) await editor.button('Zoom out (-)').click();
    // The zoom glides: wait for it to settle on names, where no app runs
    await expect(page.locator('#screens ui-embedded-app[mounted]')).toHaveCount(0);
    await page.waitForTimeout(400);
}

interface Box { x: number; y: number; width: number; height: number }

/** Where each screen's card is in the page, by the screen's name */
async function boxes(page: Page): Promise<Record<string, Box>> {
    return page.evaluate(() => {
        const screens = (window as unknown as { magneticScreens: { cards(): Array<{ name: string; element: Element }> } }).magneticScreens;
        return Object.fromEntries(screens.cards().map((card) => {
            const box = card.element.getBoundingClientRect();
            return [card.name, { x: box.x, y: box.y, width: box.width, height: box.height }];
        }));
    });
}

/** The cards' screens in the order of their places, left to right and down */
async function order(page: Page): Promise<string[]> {
    const at = await boxes(page);
    return Object.entries(at).sort(([, a], [, b]) => Math.round((a.y - b.y) / 8) || a.x - b.x).map(([name]) => name);
}
