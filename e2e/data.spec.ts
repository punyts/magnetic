import type { Browser } from '@playwright/test';
import { expect, seedDataset, signIn, test } from './fixtures.js';

const nameOf = (stem: string): string => `${stem}-${Date.now().toString(36)}`;

/** A page of another dev user, signed in on a context of its own */
async function pageOf(browser: Browser, user: string) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? null });
    await signIn(context, user);
    return { context, page: await context.newPage() };
}

test.describe('Data', () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test('home opens the Data page', async ({ home, page }) => {
        await home.goto();
        await home.app.getByRole('button', { name: 'Data', exact: true }).click();
        await page.waitForURL(/\/settings\/data$/);
        await expect(page.getByRole('heading', { name: 'Data', level: 1 })).toBeVisible();
        await expect(page.getByRole('heading', { name: "This workspace's datasets" })).toBeVisible();
    });

    test('a dataset is shared by email, shows for the other person, and stops being shared', async ({ browser, page }) => {
        // Arrange: alice has a dataset; bob has signed in once and has a verified email
        const bob = await pageOf(browser, 'bob');
        await seedDataset({ user: 'bob', email: 'bob-data@example.test', dataset: nameOf('bobs'), records: { a: { name: 'A' } } });
        const dataset = nameOf('prices');
        await seedDataset({ user: 'alice', email: 'alice-data@example.test', dataset, records: { tea: { name: 'Tea' }, coffee: { name: 'Coffee' } } });

        // Act: alice shares it with bob
        await page.goto('/settings/data');
        const section = page.getByRole('region', { name: dataset });
        await expect(section.getByText(`2 records · model ${dataset}-item`)).toBeVisible();
        await expect(section.getByText('Not shared with anyone.')).toBeVisible();
        await section.getByLabel("Share with (an email, or an org's short name)").fill('bob-data@example.test');
        await section.getByRole('button', { name: 'Share', exact: true }).click();

        // Assert: both sides see it
        await expect(page.getByRole('status')).toHaveText(`${dataset} is shared with bob (bob-data@example.test). Their apps can read it now.`);
        await expect(page.getByRole('region', { name: dataset }).getByText('bob (bob-data@example.test)')).toBeVisible();
        await bob.page.goto('/settings/data');
        const row = bob.page.getByRole('row').filter({ hasText: dataset });
        await expect(row).toContainText('alice (alice-data@example.test)');
        await expect(row).toContainText(`"dataset":"${dataset}"`);

        // Act: alice stops sharing it
        await page.getByRole('button', { name: `Stop sharing ${dataset} with bob (bob-data@example.test)` }).click();

        // Assert
        await expect(page.getByRole('status')).toHaveText(`${dataset} is no longer shared with bob (bob-data@example.test).`);
        await expect(page.getByRole('region', { name: dataset }).getByText('Not shared with anyone.')).toBeVisible();
        await bob.page.reload();
        await expect(bob.page.getByRole('row').filter({ hasText: dataset })).toHaveCount(0);
        await bob.context.close();
    });

    test('an email nobody has is refused with the reason', async ({ page }) => {
        const dataset = nameOf('lonely');
        await seedDataset({ user: 'alice', email: 'alice-data@example.test', dataset, records: { a: { name: 'A' } } });
        await page.goto('/settings/data');
        const section = page.getByRole('region', { name: dataset });
        await section.getByLabel("Share with (an email, or an org's short name)").fill('nobody@example.test');
        await section.getByRole('button', { name: 'Share', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('No one in Magnetic has the verified email nobody@example.test.');
    });
});
