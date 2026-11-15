import { expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('Your apps', () => {
    test.beforeEach(async ({ context, home }) => {
        await signIn(context, 'alice');
        await home.goto();
    });

    test('shows making an app, the apps, the editor and the settings', async ({ home }) => {
        await expect(home.nameField).toBeVisible();
        for (const name of ['Orgs', 'Sign out', 'Edit the editor', 'Reset the editor']) await expect(home.app.getByRole('button', { name })).toBeVisible();
    });

    test('an app needs a name', async ({ home }) => {
        await home.nameField.fill('');
        await home.makeButton.click();
        await expect(home.notice).toHaveText('Give the app a name first.');
    });

    test('making an app opens its editor on a blank app, and its card is on Your apps', async ({ home, page }, info) => {
        const name = uniqueName(info, 'made');
        const editor = await home.makeApp(name);
        await expect(editor.editor.getByText('This app is blank')).toBeVisible();
        const appId = editor.appId;
        await home.goto();
        await expect(home.card(name)).toBeVisible();
        await home.card(name).click();
        await page.waitForURL(new RegExp(`/apps/${appId}$`));
    });

    test('Orgs opens the org settings', async ({ home, page }) => {
        await home.app.getByRole('button', { name: 'Orgs' }).click();
        await page.waitForURL(/\/settings\/orgs$/);
        await expect(page.getByRole('heading', { name: 'Your orgs' })).toBeVisible();
    });

    test('the appearance and the language are kept', async ({ context, home, page }) => {
        // dan's own settings, so no other test sees them change
        await context.clearCookies();
        await signIn(context, 'dan');
        await home.goto();
        const [mode, language] = [home.app.getByRole('combobox').nth(0), home.app.getByRole('combobox').nth(1)];
        await mode.selectOption({ label: 'Dark' });
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
        await language.selectOption({ label: 'Deutsch' });
        await expect(home.app.getByRole('button', { name: 'Abmelden' })).toBeVisible();
        await page.reload();
        await expect(home.app.getByRole('button', { name: 'Abmelden' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
        await home.app.getByRole('combobox').nth(1).selectOption({ label: 'English' });
        await home.app.getByRole('combobox').nth(0).selectOption({ index: 0 });
        await expect(home.app.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });
});
