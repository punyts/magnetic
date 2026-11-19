import { expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('Your apps', () => {
    test.beforeEach(async ({ context, home }) => {
        await signIn(context, 'alice');
        await home.goto();
    });

    test('shows making an app and the apps, with tabs for orgs, usage and the profile', async ({ home }) => {
        await expect(home.nameField).toBeVisible();
        for (const name of ['Apps', 'Orgs', 'Usage', 'Profile']) await expect(home.tab(name)).toBeVisible();
        await home.openTab('Profile');
        for (const name of ['Sign out', 'Edit the editor', 'Reset the editor']) await expect(home.app.getByRole('button', { name })).toBeVisible();
        await home.openTab('Usage');
        await expect(home.app.getByText(/You have used \$\d+\.\d\d/)).toBeVisible();
    });

    test('keeps the tab last shown', async ({ home, page }) => {
        await home.openTab('Usage');
        await page.reload();
        await expect(home.tab('Usage')).toHaveAttribute('aria-selected', 'true');
        await home.openTab('Apps');
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

    test('Make an org on the Orgs tab opens the org settings', async ({ home, page }) => {
        await home.openTab('Orgs');
        await home.app.getByRole('button', { name: 'Make an org' }).click();
        await page.waitForURL(/\/settings\/orgs$/);
        await expect(page.getByRole('heading', { name: 'Your orgs' })).toBeVisible();
    });

    test('the appearance and the language are kept', async ({ context, home, page }) => {
        // dan's own settings, so no other test sees them change
        await context.clearCookies();
        await signIn(context, 'dan');
        await home.goto();
        await home.openTab('Profile');
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
        await home.openTab('Apps');
    });
});
