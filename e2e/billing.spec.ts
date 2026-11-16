import { expect, refundCheckout, signIn, test } from './fixtures.js';

// Only this spec buys agent use, each size as its own person, so a balance is one test's alone
const buyer = (project: string): string => (project === 'phone' ? 'carol' : 'dan');
test.describe.configure({ mode: 'serial' });

test.describe('Agent use', () => {
    test.beforeEach(async ({ context }, info) => {
        await signIn(context, buyer(info.project.name));
    });

    test('home opens the Agent use page, with the allowance and the amounts to add', async ({ home, page }) => {
        await home.goto();
        await home.app.getByRole('button', { name: 'Agent use', exact: true }).click();
        await page.waitForURL(/\/settings\/billing$/);
        await expect(page.getByRole('heading', { name: 'Agent use', level: 1 })).toBeVisible();
        await expect(page.getByRole('definition').first()).toHaveText('$5.00');
        await expect(page.getByRole('button', { name: 'Add $10.00' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add $25.00' })).toBeVisible();
    });

    test('a purchase through the checkout page adds agent use, a refund takes it off, and a cancel charges nothing', async ({ page }) => {
        // Arrange
        await page.goto('/settings/billing');
        const added = page.locator('dl.balance div').filter({ hasText: 'Added' }).getByRole('definition');
        const before = Number((await added.innerText()).replace('$', ''));

        // Act: buy $10 on the stand-in checkout page
        await page.getByRole('button', { name: 'Add $10.00' }).click();
        await expect(page.getByRole('heading', { name: 'Stand-in checkout' })).toBeVisible();
        await expect(page.getByText('Magnetic agent use ($10.00)')).toBeVisible();
        await page.getByRole('button', { name: 'Pay $10.00' }).click();

        // Assert
        await page.waitForURL(/\/settings\/billing\?paid=cs_e2e_/);
        await expect(page.getByRole('status')).toHaveText('$10.00 of agent use is added. Thank you.');
        await expect(added).toHaveText(`$${(before + 10).toFixed(2)}`);
        await expect(page.getByRole('row').nth(1)).toContainText('Payment');
        await expect(page.getByRole('row').nth(1)).toContainText('$10.00');

        // Act: the payment is refunded
        const session = new URL(page.url()).searchParams.get('paid') ?? '';
        await refundCheckout(session, 1000);
        await page.goto('/settings/billing');

        // Assert
        await expect(added).toHaveText(`$${before.toFixed(2)}`);
        await expect(page.getByRole('row').filter({ hasText: 'Refund' }).first()).toContainText('−$10.00');

        // Act: a checkout cancelled on the provider's page
        await page.getByRole('button', { name: 'Add $25.00' }).click();
        await page.getByRole('link', { name: 'Cancel' }).click();

        // Assert
        await expect(page.getByRole('status')).toHaveText('The payment was cancelled. Nothing was charged.');
        await expect(added).toHaveText(`$${before.toFixed(2)}`);
    });
});
