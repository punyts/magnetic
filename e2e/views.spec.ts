import type { Locator, Page } from '@playwright/test';
import { BOARD, EditorPage, canvasPage, changeEditor, expect, seedDataset, seedModule, signIn, test, uniqueName } from './fixtures.js';

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

/** Picks a view with the selector: a segmented control at a wide window, a menu below 760px */
async function pickView(editor: EditorPage, page: Page, name: 'Screens' | 'Statenet' | 'Theme' | 'Logic'): Promise<void> {
    if (isPhone(page)) await editor.editor.getByRole('combobox', { name: 'View' }).selectOption({ label: name });
    else await editor.editor.getByRole('radio', { name }).click();
    await expect(page.locator('body')).toHaveAttribute('data-view', name.toLowerCase());
}

/** The side panel: Magnetic's page magnetic-side, which the editor places */
const sidePanel = (page: Page) => page.getByRole('region', { name: 'Details' });
/** The Theme or Logic view's page on the board */
/** The page of the Theme or the Logic view, whichever shows */
const viewPage = (page: Page) => page.locator('#editor .stateui-panel[role="region"]:is([aria-label="Theme"], [aria-label="Logic"]):visible');
/** The theme the Theme view shows */
const chosenTheme = (page: Page) => viewPage(page).getByRole('combobox', { name: 'Theme', exact: true });
/** Makes a theme of the app's own from the Theme view's page, named as the prompt is answered */
/**
 * A token's value cell in the Theme view's table. The table draws only the rows in view, so its scroller (in the shadow
 * roots of the table and its list) is moved down until the row is drawn, and the row is brought into the window before
 * it is used: a scroll while a cell has focus draws other rows in the table's slots, the focused one too
 */
async function tokenCell(page: Page, label: string): Promise<Locator> {
    const cell = viewPage(page).getByRole('textbox', { name: label, exact: true });
    for (let step = 0; step < 60 && (await cell.count()) === 0; step += 1) {
        await viewPage(page).locator('ui-table').evaluate((table) => {
            const scrollers: Element[] = [];
            const walk = (root: Element | ShadowRoot): void => {
                for (const each of Array.from(root.querySelectorAll('*'))) {
                    if (each.scrollHeight > each.clientHeight + 1 && getComputedStyle(each).overflowY !== 'hidden' && getComputedStyle(each).overflowY !== 'visible') scrollers.push(each);
                    if (each.shadowRoot) walk(each.shadowRoot);
                }
            };
            walk(table.shadowRoot ?? table);
            for (const scroller of scrollers) scroller.scrollTop += scroller.clientHeight;
        });
        await page.waitForTimeout(50);
    }
    for (let step = 0; step < 5; step += 1) {
        await cell.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        const box = await cell.boundingBox();
        const window = page.viewportSize();
        if (box && window && box.y >= 0 && box.y + box.height <= window.height) break;
    }
    return cell;
}

async function newTheme(page: Page, name: string): Promise<void> {
    page.once('dialog', (dialog) => void dialog.accept(name));
    await viewPage(page).getByRole('button', { name: 'New theme' }).click();
    await expect(chosenTheme(page)).toHaveValue(name);
}
/** Statenet's page, a frame on the board */
const graph = (page: Page) => canvasPage(page, 'Statenet');
/** A card or a pill of the Statenet tree by its state path */
const node = (page: Page, path: string) => graph(page).locator(`[role="treeitem"][data-id="${path}"]`);
/** The card chosen in the tree */
const chosen = (page: Page) => graph(page).locator('[role="treeitem"][aria-selected="true"]');
/**
 * Chooses a card as the keyboard does (Space on the focused card). A pointer can reach only the cards the canvas shows,
 * and on a phone the side panel covers half of it; the diagram's own tests cover the press
 */
const press = async (card: Locator): Promise<void> => {
    await card.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await card.page().keyboard.press('Space');
};

/** Presses a branch's + as the keyboard does: the editor's panels may lie over it where the canvas shows it */
const add = async (button: Locator): Promise<void> => {
    await button.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await button.page().keyboard.press('Enter');
};

test.describe("The editor's views", () => {
    let editor: EditorPage;
    let appName: string;
    /** The app being edited: its card under $.apps */
    const appCard = (page: Page) => node(page, `$.apps.${appName}`);

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
        await expect(graph(page)).toBeHidden();
        await pickView(editor, page, 'Statenet');
        // Statenet's page shows on the editor's stage in place of the screens, and the editor's zoom drives its canvas:
        // the app itself is a card under $.apps
        await expect(appCard(page)).toBeVisible();
        await expect(page.locator(BOARD)).toBeHidden();
        await expect(editor.button('Zoom in (+)')).toBeVisible();
        await page.reload();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'statenet');
        await expect(appCard(page)).toBeVisible();
        // The board's tools are for the board: hidden in a view without it
        await pickView(editor, page, 'Theme');
        await expect(editor.button('Zoom in (+)')).toBeHidden();
        await expect(graph(page)).toBeHidden();
        await pickView(editor, page, 'Screens');
        await expect(viewPage(page)).toHaveCount(0);
        await expect(editor.app.getByText('Home words')).toBeVisible();
    });

    test("Statenet's view is the person's: it opens where it was left, in a new browser", async ({ page, browser }) => {
        const percent = async (from: EditorPage): Promise<number> => Number(((await from.zoomButton.textContent()) ?? '').replace('%', ''));
        await pickView(editor, page, 'Statenet');
        await expect(appCard(page)).toBeVisible();
        await editor.button('Zoom in (+)').click();
        await editor.button('Zoom in (+)').click();
        const left = await percent(editor);
        // Kept on the server once the run of zooms ends
        await expect.poll(async () => (await (await page.request.get(`/edit/${editor.appId}/views/kept?view=statenet`)).json()).place?.zoom).toBeCloseTo(left / 100, 1);

        const other = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: page.viewportSize() });
        try {
            await signIn(other, 'alice');
            const elsewhere = new EditorPage(await other.newPage());
            await elsewhere.goto(editor.appId);
            await pickView(elsewhere, elsewhere.page, 'Statenet');
            await expect(node(elsewhere.page, `$.apps.${appName}`)).toBeAttached();
            await expect.poll(() => percent(elsewhere)).toBe(left);
        } finally {
            await other.close();
        }
    });

    test("the Statenet graph is the owner's tree by state path: its branches on both sides of $, each part under its branch, nothing covering anything", async ({ page }, info) => {
        // Arrange: a theme of the app's own
        const name = uniqueName(info, 'tree');
        await pickView(editor, page, 'Theme');
        await newTheme(page, name);

        // Act
        await pickView(editor, page, 'Statenet');

        // Assert: $ in the middle, its branches either side, then the parts in them; the app's screens under it
        const theme = node(page, `$.themes.${name}`);
        await expect(theme).toBeVisible();
        await expect(theme).not.toContainText('Not used by this app');
        const appPath = `$.apps.${appName}`;
        await expect(appCard(page)).toBeVisible();
        await expect(node(page, `${appPath}.screens.home`)).toBeVisible();
        // The person's own persona, and no one else's
        await expect(node(page, '$.personas.default')).toContainText('Persona');
        await expect(graph(page).locator('[role="treeitem"][data-id^="$.personas."]').filter({ hasText: 'Persona' })).toHaveCount(1);
        // Read from one layout at once: a change to the app may draw a new one. The branches of $ share its two sides,
        // the first ones right in order and the rest left; on each side a part stands further out than its branch
        const paths = ['$', '$.apps', '$.themes', '$.data', '$.models', '$.logic', '$.connections', `$.themes.${name}`, appPath];
        // Until a card is placed it stands on the right; wait for the layout
        await expect.poll(() => graph(page).locator('[role="treeitem"][data-placed]').evaluateAll((cards, wanted) => wanted.filter((path) => cards.some((each) => (each as HTMLElement).dataset['id'] === path)).length, paths)).toBe(paths.length);
        const places = await graph(page).locator('[role="treeitem"]').evaluateAll((cards, wanted) => wanted.map((path) => {
            const card = cards.find((each) => (each as HTMLElement).dataset['id'] === path) as HTMLElement;
            const box = card.getBoundingClientRect();
            return [box.left + box.width / 2, card.hasAttribute('data-left') ? -1 : 1] as const;
        }), paths);
        const root = places[0]![0];
        const rest = places.slice(1);
        const ways = rest.slice(0, 6).map(([x, way]) => { expect(Math.sign(x - root)).toBe(way); return way; });
        expect(ways).toContain(1);
        expect(ways).toContain(-1);
        expect(ways.indexOf(-1)).toBe(ways.lastIndexOf(1) + 1);
        const [apps, appsWay] = rest[0]!;
        const [themes, themesWay] = rest[1]!;
        const [themeX, themeWay] = rest[6]!;
        const [appX, appWay] = rest[7]!;
        expect([themeWay, appWay]).toEqual([themesWay, appsWay]);
        expect((themeX - themes) * themesWay).toBeGreaterThan(0);
        expect((appX - apps) * appsWay).toBeGreaterThan(0);
        // Of the owner's other apps the first six show, and a pill shows the rest
        expect(await graph(page).locator('[role="treeitem"][data-id^="$.apps."]').filter({ hasText: 'Another app of yours' }).count()).toBeLessThanOrEqual(6);
        const boxes = await graph(page).locator('[role="treeitem"][data-placed]').evaluateAll((all) => all.map((each) => { const box = each.getBoundingClientRect(); return [box.left, box.top, box.width, box.height] as const; }));
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
        const appPath = `$.apps.${appName}`;
        const side = sidePanel(page);

        // Act: a screen
        await add(graph(page).getByRole('button', { name: `Add to ${appPath}.screens` }));
        await side.getByRole('textbox', { name: 'Name' }).fill('second');
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert
        await expect(node(page, `${appPath}.screens.second`)).toBeVisible();

        // Act: the dataset bound in the app
        await add(graph(page).getByRole('button', { name: `Add to ${appPath}.uses.data` }));
        await side.getByRole('combobox', { name: 'Dataset' }).selectOption(dataset);
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert: its binding under the app, and the dataset no longer dimmed
        await expect(graph(page).locator(`[role="treeitem"][data-id^="${appPath}.uses.data."]`)).toHaveCount(1);
        await expect(node(page, `$.data.${dataset}`)).not.toContainText('Not used by this app');

        // Act: a module working on it, then a rule in it from the form's template
        await add(graph(page).getByRole('button', { name: 'Add to $.logic', exact: true }));
        await side.getByRole('textbox', { name: 'Name' }).fill(module);
        await side.getByRole('button', { name: 'Create' }).click();
        await expect(node(page, `$.logic.${module}`)).toBeVisible();
        await expect(node(page, `$.logic.${module}`)).not.toContainText('Not used by this app');
        await add(graph(page).getByRole('button', { name: `Add to $.logic.${module}` }));
        await side.getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Rule' });
        await side.getByRole('textbox', { name: 'Its name' }).fill('ping');
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert: the rule's card, and its editor at the side
        await expect(node(page, `$.logic.${module}.rules.ping`)).toBeVisible();
        await expect(side.getByRole('heading', { name: 'rules.ping' })).toBeVisible();
        await expect(side.getByRole('textbox', { name: 'rules.ping' })).toBeVisible();
    });

    test("a dataset is made from Statenet's + with its first record, and a record's value is edited in the side panel", async ({ page }, info) => {
        // Arrange: a model of alice's, from a dataset made as the agent would
        const seeded = uniqueName(info, 'parts');
        const dataset = uniqueName(info, 'bins');
        await seedDataset({ user: 'alice', email: 'alice-views@example.test', dataset: seeded, records: { bolt: { name: 'Bolt' } } });
        await pickView(editor, page, 'Statenet');
        const side = sidePanel(page);

        // Act: the dataset, of that model, with its first record
        await add(graph(page).getByRole('button', { name: 'Add to $.data', exact: true }));
        await expect(side.getByRole('heading', { name: 'New dataset' })).toBeVisible();
        await side.getByRole('textbox', { name: 'Name', exact: true }).fill(dataset);
        await side.getByRole('combobox', { name: 'Model' }).selectOption(`${seeded}-item`);
        await side.getByRole('textbox', { name: 'name', exact: true }).fill('Nut');
        await side.getByRole('button', { name: 'Create' }).click();

        // Assert: its card, and its record in its panel
        const card = node(page, `$.data.${dataset}`);
        await expect(card).toBeVisible();
        await press(card);
        await expect(side.getByRole('heading', { name: dataset })).toBeVisible();
        const value = side.getByRole('textbox', { name: /^\S+ name$/ });
        await expect(value).toHaveValue('Nut');

        // Act: the value edited in place
        await value.fill('Washer');
        await value.press('Tab');
        await expect(graph(page)).toContainText('Saved');

        // Assert: read again when the card is opened again
        await side.getByRole('button', { name: 'Close' }).click();
        await press(card);
        await expect(side.getByRole('textbox', { name: /^\S+ name$/ })).toHaveValue('Washer');
    });

    test('a card of the graph opens its editor beside it: the app leads to its screens, a theme to the Theme view and back', async ({ page }, info) => {
        // Arrange: a theme of the app's own
        const name = uniqueName(info, 'card');
        await pickView(editor, page, 'Theme');
        await newTheme(page, name);
        await pickView(editor, page, 'Statenet');
        const side = sidePanel(page);

        // Act and Assert: the app's card lists its screens, and one shows that screen
        await press(appCard(page));
        await expect(side.getByRole('heading', { name: 'Screens' })).toBeVisible();
        await expect(side).not.toContainText('null');
        await side.getByRole('button', { name: 'home', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'screens');

        // A theme's card: removing asks first, and the Theme view has the way back
        await pickView(editor, page, 'Statenet');
        await press(node(page, `$.themes.${name}`));
        page.once('dialog', (dialog) => void dialog.dismiss());
        await side.getByRole('button', { name: 'Remove from the app' }).click();
        await expect(node(page, `$.themes.${name}`)).toBeVisible();
        await side.getByRole('button', { name: 'Edit in the Theme view' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'theme');
        await expect(chosenTheme(page)).toHaveValue(name);
        await viewPage(page).getByRole('button', { name: '← Statenet' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', 'statenet');
        // Picked from the selector, the Theme view has no way back
        await pickView(editor, page, 'Theme');
        await expect(chosenTheme(page)).toBeVisible();
        await expect(viewPage(page).getByRole('button', { name: '← Statenet' })).toBeHidden();
    });
    test("a function is hard IP: the host's under $.functions and a component's under its component, each with a panel of what it does and nothing to edit", async ({ page }) => {
        // Arrange
        await pickView(editor, page, 'Statenet');
        const side = sidePanel(page);
        const http = node(page, '$.functions.host.http');

        // Act
        await press(http);

        // Assert: labelled hard IP, with no +; the panel shows its kind, where it runs, its summary and schemas, and no editor
        await expect(http).toContainText('Hard IP');
                await expect(http.getByRole('button')).toHaveCount(0);
        await expect(side.getByRole('heading', { name: 'http' })).toBeVisible();
        await expect(side).toContainText('Effect · runs on server');
        await expect(side.getByRole('heading', { name: 'Inputs' })).toBeVisible();
        await expect(side.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0);

        // A component's function belongs to it and cannot be turned off. The app does not place the component, so the
        // board leaves its functions out and its panel lists them
        const component = node(page, '$.components.treeDiagram');
        await expect(component).toContainText('Library component');
        await press(component);
        await side.getByRole('button', { name: 'layoutTree' }).click();
        await expect(side.getByRole('heading', { name: 'layoutTree' })).toBeVisible();
        await expect(side).toContainText('Compute · runs on server, browser');
        await expect(side).toContainText('Part of the treeDiagram component');
    });

    test("a chosen card is let go by the panel's ×, by pressing it again, and by a press on the empty canvas, not by a drag", async ({ page }) => {
        // Arrange
        await pickView(editor, page, 'Statenet');
        const side = sidePanel(page);
        const card = appCard(page);
        await expect(card).toBeVisible();
        /** A point of the page over the canvas, or the diagram between its cards, with no head or panel of the editor over it, and away from `from` */
        const empty = async (from?: { x: number; y: number }): Promise<{ x: number; y: number }> => {
            const points = await page.evaluate(() => {
                const deepest = (x: number, y: number): Element | null => {
                    let found = document.elementFromPoint(x, y);
                    while (found?.shadowRoot) {
                        const inner = found.shadowRoot.elementFromPoint(x, y);
                        if (inner === null || inner === found) break;
                        found = inner;
                    }
                    return found;
                };
                const find = (root: Document | ShadowRoot, selector: string): Element | null => {
                    const found = root.querySelector(selector);
                    if (found !== null) return found;
                    for (const each of Array.from(root.querySelectorAll('*'))) {
                        const inner = each.shadowRoot === null ? null : find(each.shadowRoot, selector);
                        if (inner !== null) return inner;
                    }
                    return null;
                };
                // Statenet's page, and whether an element is in it through the shadow roots around it
                const net = find(document, '.stateui-panel[role="region"][aria-label="Statenet"]');
                const inNet = (element: Element): boolean => {
                    let at: Element | null = element;
                    while (at !== null) {
                        if (net?.contains(at)) return true;
                        const root = at.getRootNode();
                        at = root instanceof ShadowRoot ? root.host : null;
                    }
                    return false;
                };
                const out: { x: number; y: number }[] = [];
                for (let y = 20; y < innerHeight - 20; y += 16) {
                    for (let x = 20; x < innerWidth - 20; x += 16) {
                        const hit = deepest(x, y);
                        if (hit !== null && inNet(hit) && (['viewport', 'world', 'diagram', 'edges'].some((name) => hit.classList.contains(name)) || hit.closest('svg') !== null)) out.push({ x, y });
                    }
                }
                return out;
            });
            const point = points.find((each) => from === undefined || Math.hypot(each.x - from.x, each.y - from.y) > 80);
            if (point === undefined) throw new Error('No empty point on the canvas');
            return point;
        };

        // Act and Assert: the ×
        await press(card);
        await expect(side).toBeVisible();
        await expect(chosen(page)).toHaveCount(1);
        await side.getByRole('button', { name: 'Close' }).click();
        await expect(side).toBeHidden();
        await expect(chosen(page)).toHaveCount(0);

        // The card pressed again
        await press(card);
        await expect(side).toBeVisible();
        await press(card);
        await expect(side).toBeHidden();
        await expect(chosen(page)).toHaveCount(0);

        // A drag of the canvas keeps it; a press on the empty canvas lets it go
        await press(card);
        await expect(side).toBeVisible();
        const point = await empty();
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + 40, point.y + 30, { steps: 4 });
        await page.mouse.up();
        await expect(side).toBeVisible();
        // Away from where the drag began: a press there at once would count as its second click
        const again = await empty(point);
        await page.mouse.click(again.x, again.y);
        await expect(side).toBeHidden();
        await expect(chosen(page)).toHaveCount(0);
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
        await press(node(page, `$.logic.${module}`));
        await sidePanel(page).getByRole('button', { name: 'Open in the Logic view' }).click();

        // Assert
        await expect(page.locator('body')).toHaveAttribute('data-view', 'logic');
        await expect(viewPage(page).locator('ui-card').filter({ hasText: 'seen' })).toBeVisible();
        await viewPage(page).getByRole('button', { name: '← Statenet' }).click();
        await expect(node(page, `$.logic.${module}`)).toBeVisible();
    });

    test('with the editor hidden the app fills the window, whatever view the editor last showed', async ({ page }) => {
        // Arrange
        await pickView(editor, page, 'Theme');

        // Act
        await page.goto(page.url().replace('/edit/', '/apps/'));

        // Assert
        await expect(page.locator('#alone')).toBeVisible();
        await expect(graph(page)).toBeHidden();
        await expect(page.locator('#alone').getByText('Home words')).toBeVisible();
    });

    test("the Theme view makes a theme and edits a token's value in one mode", async ({ page }, info) => {
        // Arrange: theme names are the owner's, so each run and project makes its own
        const name = uniqueName(info, 'theme');
        await pickView(editor, page, 'Theme');
        await newTheme(page, name);
        const cell = (label: string) => tokenCell(page, `color.accent.base ${label}`);
        // A specimen of the theme for each mode above the tokens
        await expect(viewPage(page).locator('ui-drawing')).toHaveCount(3);
        // A token no mode may set has one value, for all modes
        await expect(viewPage(page).getByRole('textbox', { name: 'palette.neutral.50 Dark', exact: true })).toBeDisabled();
        await expect(viewPage(page).getByRole('textbox', { name: 'palette.neutral.50 All modes', exact: true })).toBeEnabled();

        // Act
        await (await cell('Dark')).fill('#ff6600');
        await (await cell('Dark')).blur();

        // Assert: saved in that mode alone, and shown so once the theme is read again
        await expect(viewPage(page)).toContainText('Saved');
        await expect(await cell('Dark')).toHaveValue('#ff6600');
        await expect(await cell('Light')).not.toHaveValue('#ff6600');
        await expect(await cell('High contrast')).not.toHaveValue('#ff6600');
    });

    test('the Theme view clones a theme another app uses into one of the app\'s own', async ({ page, home }, info) => {
        // Arrange: a theme of this app's, added to a second app, which then shares it
        const name = uniqueName(info, 'shared');
        const copy = uniqueName(info, 'copy');
        await pickView(editor, page, 'Theme');
        await newTheme(page, name);
        await home.goto();
        const second = await home.makeApp(uniqueName(info, 'second'));
        await second.ask('Home words');
        await second.button('Close the chat').click();
        await pickView(second, page, 'Theme');
        await viewPage(page).getByRole('combobox', { name: 'Add a theme…' }).selectOption(name);
        await expect(chosenTheme(page)).toHaveValue(name);
        await expect(viewPage(page)).toContainText('Other apps use this theme too');
        await expect(viewPage(page).getByRole('textbox', { name: 'palette.neutral.50 All modes', exact: true })).toBeDisabled();

        // Act
        page.once('dialog', (dialog) => void dialog.accept(copy));
        await viewPage(page).getByRole('button', { name: 'Clone for this app' }).first().click();

        // Assert: the copy is the app's, shown and editable; no other app uses it
        await expect(chosenTheme(page)).toHaveValue(copy);
        await expect(viewPage(page)).not.toContainText('Other apps use this theme too');
        await expect(viewPage(page).getByRole('textbox', { name: 'palette.neutral.50 All modes', exact: true })).toBeEnabled();
    });

    test('the Logic view makes a rule on the server, moves it to the browser and deletes it', async ({ page }) => {
        // Arrange
        await pickView(editor, page, 'Logic');
        const logic = viewPage(page);
        const card = (lane: string) => logic.getByRole('group', { name: lane, exact: true }).locator('ui-card').filter({ hasText: 'remember' });
        await expect(logic.getByText('The app has no logic yet.')).toBeVisible();

        // Act: a rule, written in the side panel
        await logic.getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Rule' });
        page.once('dialog', (dialog) => void dialog.accept('remember'));
        await logic.getByRole('button', { name: 'New', exact: true }).click();
        await sidePanel(page).getByRole('textbox', { name: 'rules.remember' }).fill(JSON.stringify({ when: { path: '$.data.picked' }, do: [{ command: 'set', target: '$.data.seen', value: true }] }));
        await sidePanel(page).getByRole('button', { name: 'Save', exact: true }).click();

        // Assert: its card in the Server lane
        await expect(card('Server')).toBeVisible();

        // Act and Assert: its button moves it to the browser
        await card('Server').getByRole('button', { name: 'Move to the browser', exact: true }).click();
        await expect(card('Browser')).toBeVisible();
        await expect(card('Server')).toHaveCount(0);

        // Its delete asks first
        page.once('dialog', (dialog) => void dialog.accept());
        await card('Browser').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(card('Browser')).toHaveCount(0);
        await expect(logic.getByText('The app has no logic yet.')).toBeVisible();
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

test.describe("A person's copy of the editor", () => {
    test('keeps the side panel working where the copy moves it, at the left', async ({ context, home, page }, info) => {
        test.skip(isPhone(page), "One copy of dan's editor, and a wide window's placement");
        // Arrange: dan's editor, made when they first open it, with the side panel moved from the right to the left
        await signIn(context, 'dan');
        await home.goto();
        const appName = uniqueName(info, 'left');
        const editor = await home.makeApp(appName);
        await editor.ask('Home words');
        await editor.button('Close the chat').click();
        await changeEditor({ user: 'dan', path: 'root.children.stage.children.side.placement', value: { x: '12px', y: '64px', bottom: '96px', width: '360px' } });
        await page.reload();
        await pickView(editor, page, 'Statenet');
        const side = sidePanel(page);

        // Act
        await press(node(page, `$.apps.${appName}`));

        // Assert: the app's part at the side, which is now at the left
        await expect(side.getByRole('heading', { name: 'Screens' })).toBeVisible();
        const box = await side.boundingBox();
        expect(box?.x).toBeLessThan(40);

        // Act: a link of the panel still does what it does
        await side.getByRole('button', { name: 'home', exact: true }).click();

        // Assert
        await expect(page.locator('body')).toHaveAttribute('data-view', 'screens');
        await expect(side).toBeHidden();
    });
});
