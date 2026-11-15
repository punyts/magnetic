import type { Page } from '@playwright/test';
import { expect, HomePage, mockPerson, signIn, test } from './fixtures.js';

/** A short name for an org, unique to this run */
function slugOf(stem: string): string {
    return `${stem}-${Date.now().toString(36)}`;
}

/** Makes an org from /settings/orgs and waits for its page */
async function makeOrg(page: Page, name: string, slug: string): Promise<void> {
    await page.goto('/settings/orgs');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel(/^Short name/).fill(slug);
    await page.getByRole('button', { name: 'Make', exact: true }).click();
    await page.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
}

test.describe('Orgs', () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test('a person makes an org, and is its owner', async ({ page }) => {
        const slug = slugOf('acme');
        await makeOrg(page, `Acme ${slug}`, slug);
        await expect(page.getByText('You are an owner here.')).toBeVisible();
        for (const section of ['Members', 'Groups', 'Invite someone', 'Apps', 'Audit log']) await expect(page.getByRole('heading', { name: section })).toBeVisible();
        await page.getByRole('link', { name: 'All orgs' }).click();
        await expect(page.getByRole('link', { name: new RegExp(`Acme ${slug}`) })).toBeVisible();
    });

    test('an owner makes a group', async ({ page }) => {
        const slug = slugOf('groups');
        await makeOrg(page, `Groups ${slug}`, slug);
        await page.getByLabel('Group name').fill('Sales');
        await page.getByRole('button', { name: 'Make the group' }).click();
        await expect(page.getByText('Sales').first()).toBeVisible();
    });

    test('an invited person with the email joins with the role they were given', async ({ browser, page }) => {
        const slug = slugOf('invite');
        await makeOrg(page, `Invite ${slug}`, slug);
        const email = `ada-${slug}@example.com`;
        await page.getByLabel('Email').fill(email);
        await page.getByLabel('Role').selectOption({ label: 'Builder' });
        await page.getByRole('button', { name: 'Make the invite link' }).click();
        const link = /https?:\/\/\S+\/invites\/[A-Za-z0-9_-]+/.exec((await page.locator('body').textContent()) ?? '')?.[0];
        expect(link, 'the invite link, shown once').toBeDefined();

        // Ada signs in with the provider, with that email verified, and opens the link
        await mockPerson({ sub: `ada-${slug}`, name: 'Ada Lovelace', email });
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        const ada = await context.newPage();
        await ada.goto(link as string);
        await ada.waitForURL(/\/signin/);
        await ada.frameLocator('#page-app iframe').getByRole('button', { name: 'Sign in with the mock provider' }).click();
        await ada.waitForURL(/\/invites\//);
        await expect(ada.getByText(/as a builder/)).toBeVisible();
        await ada.getByRole('button', { name: 'Join' }).click();
        await ada.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
        await expect(ada.getByText('You are a builder here.')).toBeVisible();
        await context.close();

        // alice sees Ada among the members
        await page.reload();
        await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
    });

    test('an invite does not work for someone with another email', async ({ browser, page }) => {
        const slug = slugOf('wrong');
        await makeOrg(page, `Wrong ${slug}`, slug);
        await page.getByLabel('Email').fill(`invited-${slug}@example.com`);
        await page.getByRole('button', { name: 'Make the invite link' }).click();
        const link = /https?:\/\/\S+\/invites\/[A-Za-z0-9_-]+/.exec((await page.locator('body').textContent()) ?? '')?.[0] as string;
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        await signIn(context, 'bob');
        const bob = await context.newPage();
        await bob.goto(link);
        await bob.getByRole('button', { name: 'Join' }).click();
        await expect(bob.getByText('This invite is for another email address. Sign in with the one it was sent to.')).toBeVisible();
        await bob.goto('/settings/orgs');
        await expect(bob.getByRole('link', { name: new RegExp(`Wrong ${slug}`) })).toBeHidden();
        await context.close();
    });

    test('an app made in the org is on its Apps list and opens', async ({ page }) => {
        const slug = slugOf('apps');
        await makeOrg(page, `Apps ${slug}`, slug);
        await page.getByLabel('Make an app in the org').fill(`stock-${slug}`);
        await page.getByRole('button', { name: 'Make', exact: true }).last().click();
        await page.waitForURL(/\/(edit|settings\/orgs)\//);
        await page.goto('/settings/orgs');
        await page.getByRole('link', { name: new RegExp(`Apps ${slug}`) }).click();
        await expect(page.getByText(`stock-${slug}`).first()).toBeVisible();
        // Your apps, for an org member, can reach the org's settings
        const home = new HomePage(page);
        await home.goto();
        await home.app.getByRole('button', { name: 'Orgs' }).click();
        await page.waitForURL(/\/settings\/orgs$/);
    });
});
