import { expect, HomePage, mockPerson, signIn, test } from './fixtures.js';

test.describe('Signing in and out', () => {
    test('offers the providers and the development users', async ({ signInPage }) => {
        await signInPage.goto();
        await expect(signInPage.button('Sign in with the mock provider')).toBeVisible();
        await expect(signInPage.app.getByPlaceholder('Work email')).toBeVisible();
        for (const name of ['alice', 'bob', 'carol']) await expect(signInPage.button(`Sign in as ${name}`)).toBeVisible();
    });

    test('a development user lands on Your apps', async ({ signInPage, page }) => {
        await signInPage.goto();
        await signInPage.button('Sign in as bob').click();
        await page.waitForURL((url) => url.pathname === '/');
        await expect(new HomePage(page).makeButton).toBeVisible();
    });

    test('a provider sign-in lands on Your apps', async ({ signInPage, page }) => {
        await mockPerson({ sub: 'grace-1', name: 'Grace Hopper', email: 'grace@example.com' });
        await signInPage.goto();
        await signInPage.button('Sign in with the mock provider').click();
        await page.waitForURL((url) => url.pathname === '/');
        await expect(new HomePage(page).makeButton).toBeVisible();
    });

    test('a page that needs a person sends a stranger to sign in, and back after', async ({ page, signInPage }) => {
        await page.goto('/settings/orgs');
        await page.waitForURL(/\/signin/);
        await signInPage.button('Sign in as carol').click();
        await page.waitForURL(/\/settings\/orgs$/);
        await expect(page.getByRole('heading', { name: 'Your orgs' })).toBeVisible();
    });

    test('signing out ends the session', async ({ context, home, page }) => {
        await signIn(context, 'bob');
        await home.goto();
        await home.app.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForURL(/\/signin/);
        await page.goto('/');
        await page.waitForURL(/\/signin/);
    });

    test('the privacy page is open to anyone', async ({ page }) => {
        await page.goto('/privacy');
        await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
        for (const section of ['What we keep', 'Why', 'Who else sees it', 'How long', 'Your choices']) await expect(page.getByRole('heading', { name: section })).toBeVisible();
        await expect(page.getByRole('link', { name: 'operator@example.com' }).first()).toBeVisible();
    });
});
