import type { Page } from '@playwright/test';
import { EditorPage, expect, seedDataset, seedModule, signIn, test, uniqueName } from './fixtures.js';

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** Picks a view with the selector: a segmented control at a wide window, a menu below 760px */
async function pickView(editor: EditorPage, page: Page, name: 'Screens' | 'Statenet' | 'Theme' | 'Logic'): Promise<void> {
    if (isPhone(page)) await editor.editor.getByRole('combobox', { name: 'View' }).selectOption({ label: name });
    else await editor.editor.getByRole('radio', { name }).click();
    await expect(page.locator('body')).toHaveAttribute('data-view', name.toLowerCase());
}

const sheet = (page: Page) => page.locator('#view-sheet');
const graph = (page: Page) => page.locator('#world > .graph');
/** A card or a pill of the Statenet tree by its state path */
const node = (page: Page, path: string) => graph(page).locator(`[data-node="${path}"]`);
/** The app being edited: its card is marked current */
const appCard = (page: Page) => graph(page).locator('.graph-node.current');

test.describe("The editor's views", () => {
    let editor: EditorPage;
    let appName: string;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        appName = uniqueName(info, 'views');
        editor = await home.makeApp(appName);
        await editor.ask('Home words');
        // The chat floats over every view: closed, so the sheet takes the pointer
        await editor.button('Close the chat').click();
    });

    test('the selector switches between the screens and the app views, and the view is kept for the app', async ({ page }) => {
        await expect(sheet(page)).toBeHidden();
        await pickView(editor, page, 'Statenet');
        await expect(sheet(page).getByRole('heading', { name: 'Statenet' })).toBeVisible();
        // The graph is on the board in place of the screens, and pans and zooms with it: the app itself is a card under
        // $.apps
        await expect(appCard(page)).toBeVisible();
        await expect(page.locator('#artboard')).toBeHidden();
        await expect(editor.button('Zoom in (+)')).toBeVisible();
        await page.reload();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'statenet');
        await expect(appCard(page)).toBeVisible();
        // The board's tools are for the board: hidden in a view without it
        await pickView(editor, page, 'Theme');
        await expect(editor.button('Zoom in (+)')).toBeHidden();
        await expect(graph(page)).toHaveCount(0);
        await pickView(editor, page, 'Screens');
        await expect(sheet(page)).toBeHidden();
        await expect(editor.app.getByText('Home words')).toBeVisible();
    });

    test("the Statenet graph is the owner's tree by state path: its branches on both sides of $, each part under its branch, nothing covering anything", async ({ page }, info) => {
        // Arrange: a theme of the app's own
        const name = uniqueName(info, 'tree');
        await pickView(editor, page, 'Theme');
        page.once('dialog', (dialog) => void dialog.accept(name));
        await sheet(page).getByRole('button', { name: 'New theme' }).click();
        await expect(sheet(page).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');

        // Act
        await pickView(editor, page, 'Statenet');

        // Assert: $ in the middle, its branches either side, then the parts in them; the app's screens under it
        const theme = node(page, `$.themes.${name}`);
        await expect(theme).toBeVisible();
        await expect(theme).not.toHaveClass(/unused/);
        const app = appCard(page);
        const appPath = (await app.getAttribute('data-node')) as string;
        expect(appPath).toMatch(/^\$\.apps\./);
        await expect(node(page, `${appPath}.screens.home`)).toBeVisible();
        // Read from one board at once: a change to the app may draw a new one. The branches of $ share its two sides,
        // the first ones right in order and the rest left; on each side a part stands further out than its branch
        const places = await graph(page).evaluate((board, paths) => paths.map((path) => {
            const card = board.querySelector(`[data-node="${path}"]`) as HTMLElement;
            return [card.offsetLeft + card.offsetWidth / 2, card.classList.contains('left') ? -1 : 1] as const;
        }), ['$', '$.apps', '$.themes', '$.data', '$.models', '$.logic', '$.connections', `$.themes.${name}`, appPath]);
        const [[root], ...rest] = places;
        const ways = rest.slice(0, 6).map(([x, way]) => { expect(Math.sign(x - root)).toBe(way); return way; });
        expect(ways).toContain(1);
        expect(ways).toContain(-1);
        expect(ways.indexOf(-1)).toBe(ways.lastIndexOf(1) + 1);
        const [[apps, appsWay], [themes, themesWay]] = rest;
        const [[themeX, themeWay], [appX, appWay]] = rest.slice(6);
        expect([themeWay, appWay]).toEqual([themesWay, appsWay]);
        expect((themeX - themes) * themesWay).toBeGreaterThan(0);
        expect((appX - apps) * appsWay).toBeGreaterThan(0);
        // Of the owner's other apps the first six show, and a pill shows the rest
        expect(await graph(page).locator('.graph-node.unused[data-node^="$.apps."]').count()).toBeLessThanOrEqual(6);
        const boxes = await graph(page).locator('.graph-node, .graph-group').evaluateAll((all) => all.map((each) => { const box = each.getBoundingClientRect(); return [box.left, box.top, box.width, box.height] as const; }));
        boxes.forEach(([x, y, w, h], index) => {
            for (const [x2, y2, w2, h2] of boxes.slice(index + 1)) expect(x + w <= x2 || x2 + w2 <= x || y + h <= y2 || y2 + h2 <= y).toBe(true);
        });
    });

    test("a branch's + makes what it holds: a screen of the app, a binding of a dataset, a module working on it, and a rule in it", async ({ page }, info) => {
        // Arrange: a dataset of alice's that the app does not bind yet
        const module = uniqueName(info, 'plus');
        const dataset = uniqueName(info, 'stock');
        await seedDataset({ user: 'alice', email: 'alice-views@example.test', dataset, records: { bolt: { name: 'Bolt' } } });
        await pickView(editor, page, 'Statenet');
        const appPath = (await appCard(page).getAttribute('data-node')) as string;
        const side = sheet(page).locator('.view-side');

        // Act: a screen
        await graph(page).getByRole('button', { name: `Add to ${appPath}.screens` }).click();
        await side.getByRole('textbox', { name: 'Name' }).fill('second');
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert
        await expect(node(page, `${appPath}.screens.second`)).toBeVisible();

        // Act: the dataset bound in the app
        await graph(page).getByRole('button', { name: `Add to ${appPath}.uses.data` }).click();
        await side.getByRole('combobox', { name: 'Dataset' }).selectOption(dataset);
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert: its binding under the app, and the dataset no longer dimmed
        await expect(graph(page).locator(`[data-node^="${appPath}.uses.data."]`)).toHaveCount(1);
        await expect(node(page, `$.data.${dataset}`)).not.toHaveClass(/unused/);

        // Act: a module working on it, then a rule in it from the form's template
        await graph(page).getByRole('button', { name: 'Add to $.logic', exact: true }).click();
        await side.getByRole('textbox', { name: 'Name' }).fill(module);
        await side.getByRole('button', { name: 'Create' }).click();
        await expect(node(page, `$.logic.${module}`)).toBeVisible();
        await expect(node(page, `$.logic.${module}`)).not.toHaveClass(/unused/);
        await graph(page).getByRole('button', { name: `Add to $.logic.${module}` }).click();
        await side.getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Rule' });
        await side.getByRole('textbox', { name: 'Its name' }).fill('ping');
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert: the rule's card, and its editor at the side
        await expect(node(page, `$.logic.${module}.rules.ping`)).toBeVisible();
        await expect(side.getByRole('heading', { name: 'rules.ping' })).toBeVisible();
        await expect(side.getByRole('textbox', { name: 'rules.ping' })).toBeVisible();
    });

    test('a card of the graph opens its editor beside it: the app leads to its screens, a theme to the Theme view and back', async ({ page }, info) => {
        // Arrange: a theme of the app's own
        const name = uniqueName(info, 'card');
        await pickView(editor, page, 'Theme');
        page.once('dialog', (dialog) => void dialog.accept(name));
        await sheet(page).getByRole('button', { name: 'New theme' }).click();
        await expect(sheet(page).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
        await pickView(editor, page, 'Statenet');
        const side = sheet(page).locator('.view-side');

        // Act and Assert: the app's card lists its screens, and one shows that screen
        await appCard(page).click();
        await expect(side.getByRole('heading', { name: 'Screens' })).toBeVisible();
        await expect(side).not.toContainText('null');
        await side.getByRole('button', { name: 'home', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'screens');

        // A theme's card: removing asks first, and the Theme view has the way back
        await pickView(editor, page, 'Statenet');
        await node(page, `$.themes.${name}`).click();
        page.once('dialog', (dialog) => void dialog.dismiss());
        await side.getByRole('button', { name: 'Remove from the app' }).click();
        await expect(node(page, `$.themes.${name}`)).toBeVisible();
        await side.getByRole('button', { name: 'Edit in the Theme view' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'theme');
        await expect(sheet(page).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
        await sheet(page).getByRole('button', { name: '← Statenet' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'statenet');
        await expect(sheet(page).getByRole('button', { name: '← Statenet' })).toBeHidden();
    });

    test("a logic module added while Statenet shows gets a card, which opens the Logic view with its rule and leads back", async ({ page }, info) => {
        // Arrange
        const dataset = uniqueName(info, 'stock');
        const module = uniqueName(info, 'checks');
        await pickView(editor, page, 'Statenet');
        await expect(appCard(page)).toBeVisible();

        // Act: a dataset of alice's and a module working on it, used by the app, made as the agent would; the graph
        // follows the change with no reload
        await seedDataset({ user: 'alice', email: 'alice-views@example.test', dataset, records: { bolt: { name: 'Bolt' } } });
        await seedModule({ user: 'alice', app: appName, module, dataset });
        await node(page, `$.logic.${module}`).click();
        await sheet(page).locator('.view-side').getByRole('button', { name: 'Open in the Logic view' }).click();

        // Assert
        await expect(page.locator('body')).toHaveAttribute('data-view', 'logic');
        await expect(sheet(page).locator('[data-unit*="seen"]')).toBeVisible();
        await sheet(page).getByRole('button', { name: '← Statenet' }).click();
        await expect(node(page, `$.logic.${module}`)).toBeVisible();
    });

    test('with the editor hidden the app fills the window, whatever view the editor last showed', async ({ page }) => {
        // Arrange
        await pickView(editor, page, 'Theme');

        // Act
        await page.goto(page.url().replace('/edit/', '/apps/'));

        // Assert
        await expect(page.locator('#board')).toBeVisible();
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
