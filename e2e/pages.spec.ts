import type { Page } from '@playwright/test';
import { expect, signIn, SignInPage, test, verifyEmail } from './fixtures.js';

/** Writes nodes of an app the signed-in person may edit, as the editor's inspector does */
async function writeNodes(page: Page, appId: string, operations: unknown[]): Promise<void> {
    const origin = new URL(page.url()).origin;
    const response = await page.request.post(`/edit/${appId}/nodes`, { headers: { Origin: origin }, data: { operations } });
    expect(response.status()).toBe(200);
}

const PAGE = '$.screens.home.children.page.children';

test.describe("Magnetic's own pages", () => {
    test.describe.configure({ mode: 'serial' });

    test('an admin edits sign-in, publishes it for every visitor, and puts it back', async ({ browser, context, page }, info) => {
        // Publishing changes the page for everyone at once: one size is enough
        test.skip(info.project.name !== 'desktop', 'once, at desktop size');

        // Arrange: erin is an admin; a stranger has no way to a draft
        await signIn(context, 'erin');
        await verifyEmail('erin', 'admin@example.test');
        await page.goto('/admin/pages');
        const signInRow = page.locator('li[data-page="magnetic-signin"]');
        await expect(signInRow).toContainText("Magnetic's own");

        // Act: Edit opens the draft in the editor, where its words change
        await signInRow.getByRole('button', { name: 'Edit' }).click();
        await page.waitForURL(/\/edit\/[0-9a-f-]+$/);
        const draft = new URL(page.url()).pathname.split('/').pop() as string;
        await writeNodes(page, draft, [{ op: 'set', path: `${PAGE}.tagline._text`, value: 'Apps, built while you watch.' }]);
        await page.goto('/admin/pages');
        await expect(signInRow).toContainText('The draft has changes not published.');
        await signInRow.getByRole('button', { name: 'Publish' }).click();

        // Assert: published, and a visitor sees it; Magnetic's own is still at ?page=default
        await expect(page.getByText('Published: every visitor gets it now.')).toBeVisible();
        const stranger = await browser.newContext({ baseURL: new URL(page.url()).origin });
        const visitor = await stranger.newPage();
        const signInPage = new SignInPage(visitor);
        await signInPage.goto();
        await expect(signInPage.app.getByText('Apps, built while you watch.')).toBeVisible();
        await expect(signInPage.button('Sign in as bob')).toBeVisible();
        await visitor.goto('/signin?page=default');
        await expect(signInPage.app.getByText('Describe an app, and watch it being built.')).toBeVisible();
        expect((await visitor.request.get(`/edit/${draft}`, { maxRedirects: 0 })).status()).not.toBe(200);

        // Act: a draft without the development sign-in is refused, and Reset puts Magnetic's back
        await writeNodes(page, draft, [{ op: 'remove', path: `${PAGE}.dev` }]);
        await page.goto('/admin/pages');
        await signInRow.getByRole('button', { name: 'Publish' }).click();
        await expect(page.getByText('Nothing raises "dev"')).toBeVisible();
        await page.goto('/admin/pages');
        await signInRow.getByRole('button', { name: "Reset to Magnetic's" }).click();
        await expect(page.getByText("Back to Magnetic's own.")).toBeVisible();

        // Assert
        await signInPage.goto();
        await expect(signInPage.app.getByText('Describe an app, and watch it being built.')).toBeVisible();
        await stranger.close();
    });

    test('a person edits Your apps, keeps it in another language, and resets it', async ({ context, home, page }, info) => {
        // Each size its own person, so neither sees the other's change
        await signIn(context, info.project.name === 'desktop' ? 'frank' : 'gina');
        await home.goto();

        // Act: Edit Your apps, on the Profile tab, opens it in the editor
        await home.openTab('Profile');
        await home.app.getByRole('button', { name: 'Edit Your apps' }).click();
        await page.waitForURL(/\/edit\/[0-9a-f-]+$/);
        const homeId = new URL(page.url()).pathname.split('/').pop() as string;
        await writeNodes(page, homeId, [{ op: 'add', path: '$.screens.home.children.page', key: 'mine', before: 'title', value: { component: 'text', _text: 'My corner of Magnetic' } }]);
        await home.goto();

        // Assert: the change shows, and stays in German
        await expect(home.app.getByText('My corner of Magnetic')).toBeVisible();
        await home.openTab('Profile');
        await home.app.getByRole('combobox').nth(1).selectOption({ label: 'Deutsch' });
        await expect(home.app.getByRole('button', { name: 'Abmelden' })).toBeVisible();
        await expect(home.app.getByText('My corner of Magnetic')).toBeVisible();
        await home.app.getByRole('combobox').nth(1).selectOption({ label: 'English' });
        await expect(home.app.getByRole('button', { name: 'Sign out' })).toBeVisible();

        // Act: Reset, confirmed
        page.once('dialog', (dialog) => void dialog.accept());
        await home.app.getByRole('button', { name: 'Reset Your apps' }).click();

        // Assert
        await expect(home.app.getByRole('button', { name: 'Sign out' })).toBeVisible();
        await expect(home.app.getByText('My corner of Magnetic')).toBeHidden();
    });
});
