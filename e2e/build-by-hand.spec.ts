import type { BrowserContext, Locator, Page } from '@playwright/test';
import { BOARD, EditorPage, HomePage, canvasPage, expect, signInNew, test, uniqueName } from './fixtures.js';

/**
 * A small "Reading list" app built with the editor's own controls alone, as a person would with a mouse and a
 * keyboard at desktop size: no request to the agent, and no call to the server but the ones the editor makes. Each
 * step is checked in the app, and the last test opens the app as a visitor sees it.
 *
 * The tests run in order on one page and one app. A step a person cannot do with the editor's controls today is a
 * `test.fixme` whose comment names what exists, what is missing and where it would go, so this file is the record of
 * what the editor can and cannot do by hand.
 */

const ACCENT = '#aa0055';
const ACCENT_RGB = 'rgb(170, 0, 85)';
const DARK_ACCENT = '#00cc88';
const DARK_ACCENT_RGB = 'rgb(0, 204, 136)';

test.describe('An app built by hand', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(({ viewport }) => (viewport?.width ?? 1440) < 760, 'Built at desktop size: on a phone the panels are sheets over the app, and a part is placed by a press on the sheet under them');

    let context: BrowserContext;
    let page: Page;
    let editor: EditorPage;
    /** A stem no other run uses: themes, models and datasets are the owner's, named once for all their apps */
    let stem: string;
    let appId: string;
    /** The dataset's name, and the name the app binds it under (camel-cased from it by the editor) */
    let dataset: string;
    let binding: string;

    test.beforeAll(async ({ browser }, info) => {
        // A person of their own: an empty workspace, and an editor no other test changed
        context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? null });
        page = await context.newPage();
        await signInNew(page, info, 'builder');
        stem = uniqueName(info, 'x').split('-').pop() as string;
        dataset = `books-${stem}`;
        binding = `books${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
    });

    test.afterAll(async () => {
        await context?.close();
    });

    // ---- What the steps use ---------------------------------------------------------------------------------------

    const inspector = (): Locator => editor.editor.getByRole('tabpanel');
    const field = (name: string): Locator => inspector().getByRole('textbox', { name, exact: true });
    const choice = (name: string): Locator => inspector().getByRole('combobox', { name, exact: true });
    const selection = (): Locator => page.locator('.inspect-layer .overlay .box.selected');
    /** The Screens panel: the innermost element of the editor that holds both its close button and its hint */
    const screensPanel = (): Locator => editor.editor.locator('*')
        .filter({ has: page.getByRole('button', { name: 'Close the screens', exact: true }) })
        .filter({ has: page.getByText('Press a screen, here or on the canvas, to work on it.') })
        .last();
    const side = (): Locator => page.getByRole('region', { name: 'Details' });
    const graph = (): Locator => canvasPage(page, 'Statenet');
    const card = (path: string): Locator => graph().locator(`[role="treeitem"][data-id="${path}"]`);
    const themePage = (): Locator => canvasPage(page, 'Theme');
    const logicPage = (): Locator => canvasPage(page, 'Logic');

    async function pickView(name: 'Screens' | 'Statenet' | 'Theme' | 'Logic'): Promise<void> {
        await editor.editor.getByRole('radio', { name }).click();
        await expect(page.locator('body')).toHaveAttribute('data-view', name.toLowerCase());
    }

    /** Types a value into a field of the inspector and commits it with Enter */
    async function type(name: string, value: string): Promise<void> {
        await field(name).fill(value);
        await field(name).press('Enter');
    }

    /**
     * Places a component from the library: its card is pressed, the library (which lies over the app's left side) is
     * closed, and the app is clicked just under `below`, or at a point of the app when nothing is there yet. The part
     * placed is selected, and the inspector shows it
     */
    async function place(component: string, below: Locator | { x: number; y: number }): Promise<void> {
        await editor.openLibrary();
        await editor.librarySearch.fill(component);
        await editor.card(component).click();
        await expect.poll(() => editor.tool()).toBe('place');
        await editor.closeLibrary();
        if ('x' in below) await page.mouse.click(below.x, below.y);
        else {
            const box = (await below.boundingBox())!;
            await page.mouse.click(box.x + Math.min(box.width / 2, 200), box.y + box.height + 6);
        }
        await expect.poll(() => editor.tool()).toBe('select');
        await expect(selection()).toBeVisible();
        // The inspector is on the part placed, not still on the one selected before: its heading starts with the component
        await expect(inspector().getByText(new RegExp(`^${component.endsWith(' layout') ? 'panel' : component}\. `))).toBeVisible();
    }

    /** Selects a part of the app with the Select tool, by a click on it */
    async function select(part: Locator): Promise<void> {
        if ((await editor.tool()) !== 'select') await editor.button('Select a part of the app (S)').click();
        const box = (await part.boundingBox())!;
        await page.mouse.click(box.x + 4, box.y + box.height / 2);
        await expect(selection()).toBeVisible();
    }

    const yOf = async (part: Locator): Promise<number> => (await part.boundingBox())?.y ?? Number.NaN;

    /** Chooses a card of Statenet as the keyboard does: the editor's panels may lie over it where the canvas shows it */
    async function open(path: string): Promise<void> {
        await card(path).evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
        await page.keyboard.press('Space');
    }
    /** Presses a branch's + as the keyboard does */
    async function add(to: string): Promise<void> {
        await graph().getByRole('button', { name: `Add to ${to}`, exact: true }).evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
        await page.keyboard.press('Enter');
    }

    /** A token's value cell in the Theme view's table, which draws only the rows in view: scrolled to, then brought into the window */
    async function tokenCell(label: string): Promise<Locator> {
        const cell = themePage().getByRole('textbox', { name: label, exact: true });
        for (let step = 0; step < 60 && (await cell.count()) === 0; step += 1) {
            await themePage().locator('ui-table').evaluate((table) => {
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
            if (box && box.y >= 0 && box.y + box.height <= 900) break;
        }
        return cell;
    }

    /** Makes a theme of the app's own from a preset, under the name typed beside the preset */
    async function newTheme(name: string, preset: string): Promise<void> {
        const chosen = themePage().getByRole('combobox', { name: 'Theme', exact: true });
        await expect(async () => {
            if ((await chosen.inputValue({ timeout: 1000 }).catch(() => '')) !== name) {
                await themePage().getByRole('textbox', { name: 'The new theme’s name' }).fill(name);
                await themePage().getByRole('combobox', { name: 'Preset' }).selectOption({ label: preset });
                await themePage().getByRole('button', { name: 'New theme' }).click();
            }
            await expect(chosen).toHaveValue(name, { timeout: 3000 });
        }).toPass({ intervals: [500, 1000, 2000] });
    }

    const background = (part: Locator): Promise<string> => part.evaluate((element) => getComputedStyle(element).backgroundColor);

    // ---- Screens --------------------------------------------------------------------------------------------------

    test('Screens: the app is made, and parts from the library are placed, edited, moved and deleted', async () => {
        // Arrange: the app, from Your apps
        const home = new HomePage(page);
        await home.goto();
        editor = await home.makeApp(`Reading list ${stem}`);
        appId = editor.appId;
        // The blank app's hint lies over the middle of the canvas: closed, so a click there reaches the app
        await editor.button('Close this hint').click();
        const frame = (await editor.app.boundingBox())!;

        // Act: a column in the screen's body, then a heading, a field, a button, a list and a badge in it
        await place('column layout', { x: frame.x + frame.width * 0.6, y: frame.y + frame.height * 0.3 });
        await place('text', { x: frame.x + frame.width * 0.6, y: frame.y + frame.height * 0.3 });
        await type('Text', 'Reading list');
        await choice('Text role').selectOption('heading');
        const heading = editor.app.getByText('Reading list', { exact: true });
        await expect(heading).toBeVisible();

        await place('textField', heading);
        await type('Label', 'Title');
        await type('Placeholder', 'A book to read');
        // A look: the field's variant
        await choice('Variant').selectOption('soft');
        const title = editor.app.getByRole('textbox', { name: 'Title' });
        await expect(title).toHaveAttribute('placeholder', 'A book to read');

        await place('button', editor.app.locator('ui-text-field'));
        await type('Title', 'Add book');
        const button = editor.app.getByRole('button', { name: 'Add book' });
        await expect(button).toBeVisible();

        await place('list', button);
        await type('Empty', 'No books yet');
        const list = editor.app.getByText('No books yet');
        await expect(list).toBeVisible();

        await place('badge', list);
        await type('Text', 'Spare');
        const badge = editor.app.getByText('Spare', { exact: true });
        await expect(badge).toBeVisible();

        // Assert: placed top to bottom in the order they were dropped
        expect(await yOf(title)).toBeGreaterThan(await yOf(heading));
        expect(await yOf(button)).toBeGreaterThan(await yOf(title));
        expect(await yOf(list)).toBeGreaterThan(await yOf(button));

        // Act and Assert: the button moved above the field with Alt+Up. The focus was in a field of the inspector: the
        // click on the app takes it out, so the keys go to the part
        await select(button);
        await expect(field('Title')).toHaveValue('Add book');
        await page.keyboard.press('Alt+ArrowUp');
        await expect.poll(async () => (await yOf(title)) - (await yOf(button))).toBeGreaterThan(0);

        // The badge deleted with the Delete key
        await select(badge);
        await expect(field('Text')).toHaveValue('Spare');
        await page.keyboard.press('Delete');
        await expect(badge).toHaveCount(0);

        // The look chosen is kept: read again when the field is selected
        await select(editor.app.locator('ui-text-field'));
        await expect(choice('Variant')).toHaveValue('soft');
    });

    test('Screens: a second screen is added and renamed, links lead between the two, and the home screen is chosen', async () => {
        // Act: a screen from the Screens panel, then a better name for it
        await editor.button('Screens (P)').click();
        const panel = screensPanel();
        const fresh = editor.editor.getByRole('textbox', { name: 'New screen', exact: true });
        await fresh.fill('extra');
        await fresh.press('Tab');
        await panel.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(panel.getByText('Extra', { exact: true })).toBeVisible();
        const rename = editor.editor.getByRole('textbox', { name: 'Rename', exact: true });
        await expect(rename).toHaveValue('extra');
        await rename.fill('about');
        await rename.press('Tab');
        await panel.getByRole('button', { name: 'Rename', exact: true }).click();

        // Assert: its title follows its name
        await expect(panel.getByText('About', { exact: true })).toBeVisible();
        await expect(panel.getByText('Extra', { exact: true })).toHaveCount(0);
        await expect(page.locator(BOARD).getByRole('group', { name: 'About', exact: true })).toBeVisible();

        // Act: the new screen is the one worked on, and the live app shows it, not the home screen. A text on it, and a
        // link back to home
        await editor.button('Close the screens').click();
        await expect(editor.app.getByText('Reading list', { exact: true })).toBeHidden();
        const frame = (await editor.app.boundingBox())!;
        await place('text', { x: frame.x + frame.width * 0.6, y: frame.y + frame.height * 0.3 });
        await type('Text', 'About this list');
        const words = editor.app.getByText('About this list', { exact: true });
        await expect(words).toBeVisible();
        await place('link', words);
        await type('Text', 'Back to the list');
        await type('Screen', 'home');
        await expect(editor.app.getByText('Back to the list', { exact: true })).toBeVisible();

        // The home screen worked on again, with a link to the new one
        await editor.button('Screens (P)').click();
        await panel.getByText('Home', { exact: true }).click();
        await expect(page.locator(BOARD).getByRole('group', { name: 'Home', exact: true })).toBeVisible();
        await editor.button('Close the screens').click();
        await place('link', editor.app.getByText('No books yet'));
        await type('Text', 'About');
        await type('Screen', 'about');
        await expect(editor.app.getByText('About', { exact: true })).toBeVisible();

        // Act and Assert: the screen the app opens on is chosen, the new one and then home again
        await editor.button('Screens (P)').click();
        await panel.getByText('About', { exact: true }).click();
        await panel.getByRole('button', { name: 'Open on it', exact: true }).click();
        await expect(panel.getByText('The app opens on it', { exact: true })).toBeVisible();
        await panel.getByText('Home', { exact: true }).click();
        await panel.getByRole('button', { name: 'Open on it', exact: true }).click();
        await expect(panel.getByText('The app opens on it', { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Open on it', exact: true })).toBeHidden();
        await editor.button('Close the screens').click();
    });

    // GAP: a button cannot be given what its press does. The inspector's Properties tab (`fieldsOf` in
    // src/http/inspect.ts) draws a field for each string, number, boolean and icon property of the component and
    // nothing for a node's `on` handlers, so `on: { press: { command: 'navigate', target: 'about' } }` is written only
    // by the agent (ui_nodes_write). Only the link component leads to a screen by hand, through its Screen property.
    // An "On press" section would go in the Properties tab beside Layout and Place in its parent: the component's
    // events (the server's /node answer already lists them), each with a command from the closed list and its target.
    test.fixme('Screens: a button leads to another screen when pressed', async () => {});

    // ---- Theme ----------------------------------------------------------------------------------------------------

    test('Theme: a theme is made from a preset, another made the default, and a token changed for all modes and for dark only', async () => {
        // Act: the app's first theme is its default; a second one is made the default with its button
        await pickView('Theme');
        await newTheme(`paper-${stem}`, 'Moody');
        const chosen = themePage().getByRole('combobox', { name: 'Theme', exact: true });
        await expect(chosen.locator('option:checked')).toHaveText(`★ paper-${stem}`);
        await newTheme(`ink-${stem}`, 'Clean');
        await expect(chosen.locator('option:checked')).toHaveText(`ink-${stem}`);
        await themePage().getByRole('button', { name: 'Make it the default' }).click();

        // Assert
        await expect(chosen.locator('option:checked')).toHaveText(`★ ink-${stem}`);
        await expect(themePage().getByRole('button', { name: 'Make it the default' })).toBeHidden();

        // Act: the accent for all modes
        const cell = (mode: string): Promise<Locator> => tokenCell(`color.accent.base ${mode}`);
        await (await cell('All modes')).fill(ACCENT);
        await (await cell('All modes')).blur();
        // Saved, and the page says which text is now hard to read on it: the dark mode's own text on the accent
        const notice = themePage().getByRole('alert');
        await expect(notice).toContainText('hard to read: dark: color.accent.on / color.accent.base');
        await notice.getByRole('button', { name: 'Close' }).click();
        await expect(await cell('All modes')).toHaveValue(ACCENT);

        // Assert: the app's button takes it
        await pickView('Screens');
        const button = editor.app.getByRole('button', { name: 'Add book' });
        await expect.poll(() => background(button)).toBe(ACCENT_RGB);

        // Act: the accent in dark alone
        await pickView('Theme');
        await (await cell('Dark')).fill(DARK_ACCENT);
        await (await cell('Dark')).blur();

        // Assert: dark has its own value, and light keeps the one it showed
        await expect(await cell('Dark')).toHaveValue(DARK_ACCENT);
        await expect(await cell('Light')).toHaveValue(ACCENT);
        await expect(await cell('High contrast')).toHaveValue(ACCENT);
        await expect(await cell('All modes')).toHaveValue('');
        await pickView('Screens');
        await expect.poll(() => background(button)).toBe(ACCENT_RGB);
    });

    // ---- Statenet -------------------------------------------------------------------------------------------------

    test('Statenet: a model with fields of three types, one removed, and a dataset of it with records added and edited, bound to the app', async () => {
        // Act: the model, with its first field, then its other fields in its panel
        const model = `book-${stem}`;
        await pickView('Statenet');
        await add('$.models');
        await expect(side().getByRole('heading', { name: 'New model' })).toBeVisible();
        await side().getByRole('textbox', { name: 'Name', exact: true }).fill(model);
        await side().getByRole('textbox', { name: 'Field name' }).fill('title');
        await side().getByRole('button', { name: 'Create' }).click();
        await expect(card(`$.models.${model}`)).toBeVisible();
        await open(`$.models.${model}`);
        await expect(side().getByRole('heading', { name: model })).toBeVisible();
        for (const [name, type] of [['pages', 'number'], ['read', 'boolean'], ['notes', 'string']] as const) {
            await side().getByRole('textbox', { name: 'Field name' }).fill(name);
            await side().getByRole('combobox', { name: 'Type', exact: true }).selectOption(type);
            await side().getByRole('button', { name: 'Add the field' }).click();
            await expect(side().getByRole('combobox', { name, exact: true })).toHaveValue(type);
        }

        // A field removed, once confirmed
        page.once('dialog', (dialog) => void dialog.accept());
        await side().getByRole('button', { name: 'Remove notes' }).click();
        await expect(side().getByRole('combobox', { name: 'notes', exact: true })).toHaveCount(0);
        await expect(side().getByRole('combobox', { name: 'pages', exact: true })).toHaveValue('number');

        // Act: a dataset of the model with its first record. The form has the fields the model has now
        await add('$.data');
        await expect(side().getByRole('heading', { name: 'New dataset' })).toBeVisible();
        await side().getByRole('textbox', { name: 'Name', exact: true }).fill(dataset);
        await side().getByRole('combobox', { name: 'Model' }).selectOption(model);
        await side().getByRole('textbox', { name: 'title', exact: true }).fill('Dune');
        await side().getByRole('textbox', { name: 'pages', exact: true }).fill('612');
        await side().getByRole('textbox', { name: 'read', exact: true }).fill('true');
        await expect(side().getByRole('textbox', { name: 'notes', exact: true })).toHaveCount(0);
        await side().getByRole('button', { name: 'Create' }).click();

        // Assert: the dataset's card, and the app binds it (uses.data) under a name made from the dataset's
        await expect(card(`$.data.${dataset}`)).toBeVisible();
        await expect(card(`$.data.${dataset}`)).not.toContainText('Not used by this app');
        await expect(graph().locator(`[role="treeitem"][data-id$=".uses.data.${binding}"]`)).toBeVisible();

        // Act: a second record, and the first one's title edited in place
        await open(`$.data.${dataset}`);
        await expect(side().getByRole('heading', { name: dataset })).toBeVisible();
        await expect(side().getByRole('textbox', { name: /^\S+ title$/ })).toHaveValue('Dune');
        await expect(side().getByRole('textbox', { name: /^\S+ pages$/ })).toHaveValue('612');
        await side().getByRole('textbox', { name: 'title', exact: true }).fill('Emma');
        await side().getByRole('textbox', { name: 'pages', exact: true }).fill('474');
        await side().getByRole('button', { name: 'Add', exact: true }).click();
        const titles = side().getByRole('textbox', { name: /^\S+ title$/ });
        await expect(titles).toHaveCount(2);
        await titles.first().fill('Dune Messiah');
        await titles.first().press('Tab');
        await expect(graph()).toContainText('Saved');

        // Assert: read again when the card is opened again
        await side().getByRole('button', { name: 'Close' }).click();
        await open(`$.data.${dataset}`);
        await expect(side().getByRole('textbox', { name: /^\S+ title$/ }).first()).toHaveValue('Dune Messiah');
        await expect(side().getByRole('textbox', { name: /^\S+ title$/ }).nth(1)).toHaveValue('Emma');
        await side().getByRole('button', { name: 'Close' }).click();
    });

    // GAP: no control links a part of the app to state. The inspector's Properties tab shows a linked property as a
    // read-only field ("linked to …", `fieldsOf` in src/http/inspect.ts) and never writes a `<-` or `<->` key; its
    // State tab (`stateTab` in src/editor/EditorApp.ts) lists `$.data` and what reads and writes each path, with one
    // button, Ask the agent about it. A list's `items` and `row` and a table's `columns` are not fields at all (only
    // string, number, boolean and icon properties are drawn), and a text does not read `{{ }}`. So the dataset bound
    // above cannot be shown by the list, nor the field's value kept in state, without the agent. A "Link to state"
    // control would go on each field of the Properties tab (pick a path of the State tab's tree, one way or two way),
    // with an editor for a list's row and a table's columns beside it.
    test.fixme("Statenet: the list's items and the field's value are linked to the dataset from the inspector", async () => {});

    // ---- Logic ----------------------------------------------------------------------------------------------------

    test('Logic: a rule counts the records and runs when one is added; another is moved to the browser and deleted', async () => {
        // Act: a rule on the server, its body typed as JSON in the side panel (the Logic view has no form for one)
        await pickView('Logic');
        const lane = (name: string, unit: string): Locator => logicPage().getByRole('group', { name, exact: true }).locator('ui-card').filter({ hasText: unit });
        const make = async (name: string, body: unknown): Promise<void> => {
            await logicPage().getByRole('combobox', { name: 'Kind' }).selectOption({ label: 'Rule' });
            await logicPage().getByRole('textbox', { name: 'Its name' }).fill(name);
            await logicPage().getByRole('button', { name: 'New', exact: true }).click();
            await side().getByRole('textbox', { name: `rules.${name}` }).fill(JSON.stringify(body));
            await side().getByRole('button', { name: 'Save', exact: true }).click();
            await expect(lane('Server', name)).toBeVisible();
        };
        await make('count', { when: { path: `$.data.${binding}` }, do: [{ command: 'set', target: '$.data.bookCount', value: `{{ size($.data.${binding}) }}` }] });
        await make('scratch', { when: { path: '$.data.picked' }, do: [{ command: 'set', target: '$.data.seen', value: true }] });

        // Assert: both on the server, the first with what it reads and writes
        await expect(lane('Server', 'count')).toContainText(`$.data.${binding}`);
        await expect(lane('Server', 'count')).toContainText('$.data.bookCount');

        // Act and Assert: one moved to the browser, then deleted once confirmed
        await lane('Server', 'scratch').getByRole('button', { name: 'Move to the browser', exact: true }).click();
        await expect(lane('Browser', 'scratch')).toBeVisible();
        await expect(lane('Server', 'scratch')).toHaveCount(0);
        page.once('dialog', (dialog) => void dialog.accept());
        await lane('Browser', 'scratch').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(lane('Browser', 'scratch')).toHaveCount(0);
        await expect(lane('Server', 'count')).toBeVisible();

        // Act: a third record, added in Statenet
        await pickView('Statenet');
        await open(`$.data.${dataset}`);
        await side().getByRole('textbox', { name: 'title', exact: true }).fill('Middlemarch');
        await side().getByRole('button', { name: 'Add', exact: true }).click();
        await expect(side().getByRole('textbox', { name: /^\S+ title$/ })).toHaveCount(3);
        await side().getByRole('button', { name: 'Close' }).click();

        // Assert: the rule ran on the app's state. No part of the app can show the count (see the gap above), so it is
        // read where the editor shows state: the inspector's State tab
        await pickView('Screens');
        await editor.button('Select a part of the app (S)').click();
        await editor.editor.getByRole('tab', { name: 'State' }).click();
        const tree = inspector().getByRole('tree');
        const count = tree.getByText('bookCount: 3', { exact: true });
        await expect(async () => {
            if (!(await count.isVisible())) await tree.getByRole('treeitem').first().press('ArrowRight');
            await expect(count).toBeVisible({ timeout: 2000 });
        }).toPass();
        // The path chosen shows its value and the rule that writes it
        await count.click();
        await expect(inspector().getByText('Value: 3', { exact: true })).toBeVisible();
        await expect(inspector().getByText('Written by: rule count', { exact: true })).toBeVisible();
        await editor.button('Close the inspector').click();
    });

    // GAP: nothing a visitor does in this app reaches its logic. A press of Add book would need an `on` handler (the
    // gap under Screens) and the field's value a two-way link (the gap under Statenet), so "pressing the button saves
    // the form's record into the dataset" cannot be built by hand; the rule above runs only when the dataset changes
    // from the editor. A unit's body is also raw JSON in the side panel (`unitEditor` in src/http/views.ts): a form
    // for a rule's when and do, a machine's states and a table's rows would go there.
    test.fixme('Logic: pressing Add book saves the title typed as a record of the dataset', async () => {});

    // ---- Locale ---------------------------------------------------------------------------------------------------

    // GAP: the editor has no control for an app's languages at all. Appearance and language (src/editor/EditorApp.ts)
    // sets the editor's own language; an app's locales are written only by the agent (ui_locale_write), and neither the
    // inspector nor Statenet's tree (src/server/viewRoutes.ts `graph`) shows them. A Locale view beside Screens,
    // Statenet, Theme and Logic would list the app's languages, add one, and show every content text (`_text`,
    // `_label`, `_title`…) of its nodes in a table with a column for each language, as the Theme view does for
    // tokens and modes; the app on the board would then need a language switch to check it.
    test.fixme("Locale: a second language is added, a label translated, and the app shown in it", async () => {});

    // ---- The app, as a visitor sees it ----------------------------------------------------------------------------

    test('the app runs as it was built: its parts in order, its links between the screens, and its theme in light and in dark', async ({ browser }, info) => {
        // Act: the app on its own, at the screen it opens on
        await page.goto(`/apps/${appId}`);
        const app = page.locator('#alone');

        // Assert: the heading, then the button moved above the field, then the list; the badge deleted is not there
        const heading = app.getByText('Reading list', { exact: true });
        const button = app.getByRole('button', { name: 'Add book' });
        const title = app.getByRole('textbox', { name: 'Title' });
        await expect(heading).toBeVisible();
        await expect(title).toHaveAttribute('placeholder', 'A book to read');
        await expect(app.getByText('No books yet')).toBeVisible();
        await expect(app.getByText('Spare', { exact: true })).toHaveCount(0);
        expect(await yOf(button)).toBeGreaterThan(await yOf(heading));
        expect(await yOf(title)).toBeGreaterThan(await yOf(button));
        // The default theme's accent, as set for all modes
        expect(await background(button)).toBe(ACCENT_RGB);

        // Act and Assert: the links lead to the other screen and back
        await app.getByText('About', { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/apps/${appId}/screens/about$`));
        await expect(app.getByText('About this list', { exact: true })).toBeVisible();
        await expect(heading).toBeHidden();
        await app.getByText('Back to the list', { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/apps/${appId}/screens/home$`));
        await expect(heading).toBeVisible();

        // A visitor whose system is dark sees the accent set for dark alone
        const dark = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? null, colorScheme: 'dark', storageState: await context.storageState() });
        try {
            const night = await dark.newPage();
            await night.goto(`/apps/${appId}/screens/home`);
            const inDark = night.locator('#alone').getByRole('button', { name: 'Add book' });
            await expect(inDark).toBeVisible();
            await expect.poll(() => background(inDark)).toBe(DARK_ACCENT_RGB);
        } finally {
            await dark.close();
        }
    });
});
