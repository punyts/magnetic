import type { Browser, Page } from '@playwright/test';
import { AppPage, EditorPage, expect, HomePage, seedDataApp, seedDataset, signIn, test } from './fixtures.js';

/** docs/design/statenet-requests.md, R3c: a person using Alice's app asks for a change, and Alice decides it */

const nameOf = (stem: string): string => `${stem}-${Date.now().toString(36)}`;

/** A page of another dev user, signed in on a context of its own */
async function personPage(browser: Browser, user: string, viewport: { width: number; height: number } | null): Promise<Page> {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, ...(viewport !== null && { viewport }) });
    await signIn(context, user);
    return context.newPage();
}

/** A use link to the app, made in its Share panel */
async function useLink(page: Page, appId: string): Promise<string> {
    const editor = new EditorPage(page);
    await editor.goto(appId);
    await editor.button('Share').click();
    const rights = editor.editor.getByRole('combobox').filter({ hasText: 'use it, with their own data' });
    await rights.selectOption({ label: 'use it, with their own data' });
    await editor.button('Make link').click();
    await expect(editor.editor.getByText('Link made. Copy it and send it.')).toBeVisible();
    const url = /(https?:\/\/\S+\/s\/[A-Za-z0-9_-]+)/.exec((await editor.editor.getByText(/\/s\/[A-Za-z0-9_-]+/).first().textContent()) ?? '')?.[1];
    expect(url, 'the link in the Share panel').toBeDefined();
    return url as string;
}

/** Alice's dataset set to wait for her approval on the Data page */
async function waitForApproval(page: Page, dataset: string): Promise<void> {
    await page.goto('/settings/data');
    const section = page.getByRole('region', { name: dataset });
    await section.getByLabel('Their changes wait for your approval').check();
    await section.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Saved for ${dataset}. People using your apps get it with their next change.`);
}

test.describe('Requests', () => {
    let dataset: string;
    let appId: string;
    let bob: Page;
    let bobsApp: AppPage;

    test.beforeEach(async ({ browser, context, page }) => {
        // Arrange: alice's app on her menu, set to wait for her approval, opened by bob through a use link
        await signIn(context, 'alice');
        await page.goto('/');
        dataset = nameOf('menu');
        await seedDataset({ user: 'alice', email: 'alice-requests@example.test', dataset, records: { tea: { name: 'Tea' } } });
        appId = await seedDataApp({ user: 'alice', app: nameOf('menu-app'), dataset, key: 'tea', field: 'name', value: 'Green tea' });
        await waitForApproval(page, dataset);
        const url = await useLink(page, appId);
        bob = await personPage(browser, 'bob', page.viewportSize());
        await bob.goto(url);
        bobsApp = new AppPage(bob);
        await expect(bobsApp.app.getByRole('heading', { name: 'Tea', exact: true })).toBeVisible();
    });

    test.afterEach(async () => {
        await bob.context().close();
    });

    test("bob's change waits, Your apps tells alice, and her approval reaches bob's app", async ({ page, home }) => {
        // Act: bob changes the record
        await bobsApp.app.getByRole('button', { name: 'Change it' }).click();

        // Assert: it is sent for approval and not saved
        await expect(bobsApp.app.getByText('Sent for approval.')).toBeVisible();
        await expect(bobsApp.app.getByRole('heading', { name: 'Tea', exact: true })).toBeVisible();

        // Act: alice follows the alert on Your apps to the request
        await expect(async () => {
            await home.goto();
            await expect(home.app.getByText('1 changes people asked for wait for your approval.')).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 15_000 });
        await home.app.getByRole('button', { name: 'Review them' }).click();
        await page.waitForURL(/\/requests$/);
        const row = page.getByRole('row').filter({ hasText: dataset });
        await expect(row).toContainText('bob');
        await row.getByRole('link', { name: 'Open' }).click();

        // Assert: the record as it is and as asked
        await expect(page.getByRole('heading', { name: 'The record tea' })).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: 'name' })).toContainText('"Tea"');
        await expect(page.getByRole('row').filter({ hasText: 'name' })).toContainText('"Green tea"');

        // Act
        await page.getByRole('button', { name: 'Approve' }).click();

        // Assert: saved, gone from the list, and live in bob's app
        await expect(page.getByRole('status')).toHaveText(`The change to ${dataset} is saved.`);
        await expect(page.getByRole('row').filter({ hasText: dataset })).toHaveCount(0);
        await expect(bobsApp.app.getByRole('heading', { name: 'Green tea', exact: true })).toBeVisible();
    });

    test("a change alice rejects with a note is not saved, and is no longer waiting", async ({ page }) => {
        // Arrange
        await bobsApp.app.getByRole('button', { name: 'Change it' }).click();
        await expect(bobsApp.app.getByText('Sent for approval.')).toBeVisible();
        const row = page.getByRole('row').filter({ hasText: dataset });
        await expect(async () => {
            await page.goto('/requests');
            await expect(row).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 15_000 });
        await row.getByRole('link', { name: 'Open' }).click();
        const href = new URL(page.url()).pathname;

        // Act
        await page.getByLabel('A note for them (optional)').fill('We keep the name');
        await page.getByRole('button', { name: 'Reject' }).click();

        // Assert
        await expect(page.getByRole('status')).toHaveText(`The change to ${dataset} is rejected.`);
        await page.goto(href);
        await expect(page.getByRole('alert')).toHaveText('That request is no longer waiting.');
        await expect(bobsApp.app.getByRole('heading', { name: 'Tea', exact: true })).toBeVisible();
    });
});
