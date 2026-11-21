import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

test.describe("The editor's chat", () => {
    let editor: EditorPage;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        editor = await home.makeApp(uniqueName(info, 'chat'));
    });

    test('Stop ends a turn before it changes the app, and the chat says it stopped', async ({ page }) => {
        // Arrange
        const text = 'Never written';
        await editor.request.fill(text);

        // Act: Stop as soon as the turn shows it
        await editor.button('Send').click();
        await editor.button('Stop').click();

        // Assert
        await expect(editor.editor.getByText('Stopped.')).toBeVisible({ timeout: 30_000 });
        await expect(editor.button('Stop')).toBeHidden();
        await page.reload();
        await editor.ready();
        await editor.button('Show the chat').click();
        await expect(editor.editor.getByText('Stopped.')).toBeVisible();
        await expect(editor.app.getByText(text, { exact: true })).toHaveCount(0);
    });

    test('the model picker offers the three models, keeps the one chosen, and the turn names it', async ({ page }, info) => {
        test.skip(info.project.name === 'phone', 'A phone has no model picker: the editor hides it below the phone width');
        // Arrange
        const picker = editor.editor.getByRole('combobox', { name: 'Model', exact: true });
        await expect(picker.locator('option')).toHaveText(['Haiku 5.5 · fastest, lowest cost', 'Sonnet 5.5 · balanced', 'Opus 5.5 · strongest, highest cost']);

        // Act
        await picker.selectOption({ label: 'Opus 5.5 · strongest, highest cost' });
        await page.reload();
        await editor.ready();

        // Assert: kept in this browser, and sent with the next request
        await expect(picker).toHaveValue('claude-opus-5-5');
        const sent = page.waitForRequest((request) => request.url().endsWith('/turns') && request.method() === 'POST');
        await editor.ask('Built by Opus');
        expect((await sent).postDataJSON()).toMatchObject({ text: 'Built by Opus', model: 'claude-opus-5-5' });
    });

    test('a second turn adds to what the first built, and the chat keeps both', async () => {
        await editor.ask('First words');
        await editor.ask('Second words');
        await expect(editor.app.getByText('First words', { exact: true })).toBeVisible();
        await expect(editor.app.getByText('Second words', { exact: true })).toBeVisible();
        await expect(editor.editor.getByRole('img', { name: 'You' })).toHaveCount(2);
        await expect(editor.editor.getByText('Done: your words are on the first screen.', { exact: false })).toHaveCount(2);
    });

    test('Open opens the app on its own in a new tab', async ({ page }, info) => {
        test.skip(info.project.name === 'phone', 'On a phone the Open button wraps under the tool rail and cannot be pressed (reported as a bug)');
        // Arrange
        await editor.ask('On its own');

        // Act
        const [opened] = await Promise.all([page.waitForEvent('popup'), editor.button('Open').click()]);

        // Assert
        await opened.waitForURL(new RegExp(`/apps/${editor.appId}$`));
        await expect(opened.locator('#alone').getByText('On its own')).toBeVisible();
        await expect(opened.locator('body')).not.toHaveClass(/(^| )editing( |$)/);
        await opened.close();
    });

    test('an empty request sends nothing', async ({ page }) => {
        // Arrange
        let sent = 0;
        page.on('request', (request) => { if (request.url().endsWith('/turns') && request.method() === 'POST') sent += 1; });

        // Act
        await editor.request.fill('   ');
        await editor.button('Send').click();

        // Assert: still blank, and no turn asked for
        await expect(editor.editor.getByText('This app is blank')).toBeVisible();
        await expect(editor.button('Stop')).toBeHidden();
        expect(sent).toBe(0);
    });
});

test.describe('An app on its own', () => {
    test('says once, in a new browser, how to open the editor', async ({ browser, context, page }, info) => {
        // Arrange: an app of alice's, made without opening its editor
        await signIn(context, 'alice');
        await page.goto('/privacy');
        const answer = await page.request.post('/new', { headers: { Accept: 'application/json', Origin: new URL(page.url()).origin }, form: { name: uniqueName(info, 'hint') } });
        const { id } = (await answer.json()) as { id: string };
        const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? null });
        await signIn(fresh, 'alice');
        const alone = await fresh.newPage();

        // Act
        await alone.goto(`/apps/${id}`);

        // Assert: the hint, then gone; not again on the next visit
        const hint = alone.locator('#hint');
        await expect(hint).toBeVisible();
        await expect(hint).toContainText('to edit');
        await expect(hint).toBeHidden({ timeout: 15_000 });
        await alone.reload();
        await expect(alone.locator('#alone')).toBeVisible();
        await expect(hint).toBeHidden();
        await fresh.close();
    });
});
