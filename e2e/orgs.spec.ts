import type { Browser, Page } from '@playwright/test';
import { expect, HomePage, mailSent, mockPerson, signIn, test, verifyDomain } from './fixtures.js';

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
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page.getByLabel('Role').selectOption({ label: 'Builder' });
        await page.getByRole('button', { name: 'Make the invite link' }).click();
        const link = /https?:\/\/\S+\/invites\/[A-Za-z0-9_-]{43}/.exec((await page.getByRole('status').locator('code.link').textContent()) ?? '')?.[0];
        expect(link, 'the invite link, shown once').toBeDefined();

        // Ada signs in with the provider, with that email verified, and opens the link
        await mockPerson({ sub: `ada-${slug}`, name: 'Ada Lovelace', email });
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        const ada = await context.newPage();
        await ada.goto(link as string);
        await ada.waitForURL(/\/signin/);
        await ada.locator('#page-app').getByRole('button', { name: 'Sign in with the mock provider' }).click();
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
        await page.getByLabel('Email', { exact: true }).fill(`invited-${slug}@example.com`);
        await page.getByRole('button', { name: 'Make the invite link' }).click();
        const link = /https?:\/\/\S+\/invites\/[A-Za-z0-9_-]{43}/.exec((await page.getByRole('status').locator('code.link').textContent()) ?? '')?.[0] as string;
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

    test('an owner turns on SCIM, sees the token once, and makes a new one', async ({ page }) => {
        const slug = slugOf('scim');
        await makeOrg(page, `Scim ${slug}`, slug);
        const orgId = new URL(page.url()).pathname.split('/').pop() as string;
        await verifyDomain(orgId, `${slug}.test`);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Provisioning (SCIM)' })).toBeVisible();
        await page.getByRole('button', { name: 'Turn on SCIM' }).click();
        const shown = page.getByRole('status').filter({ hasText: 'The token, shown only now' }).locator('code');
        await expect(shown).toHaveText(/^[A-Za-z0-9_-]{43}$/);
        const token = (await shown.textContent()) as string;
        await expect(page.getByText(`/scim/v2/${orgId}`)).toBeVisible();
        const answer = await page.request.get(`/scim/v2/${orgId}/ServiceProviderConfig`, { headers: { Authorization: `Bearer ${token}` } });
        expect(answer.status()).toBe(200);

        await page.goto(`/settings/orgs/${orgId}`);
        await expect(page.getByText(token)).toHaveCount(0);
        await page.getByRole('button', { name: 'Make a new token' }).click();
        await expect(shown).toHaveText(/^[A-Za-z0-9_-]{43}$/);
        expect(await shown.textContent()).not.toBe(token);
        const old = await page.request.get(`/scim/v2/${orgId}/ServiceProviderConfig`, { headers: { Authorization: `Bearer ${token}` } });
        expect(old.status()).toBe(401);
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
        // Your apps, for an org member, lists the org on its Orgs tab, and the org opens its settings
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Orgs');
        await home.app.getByRole('button', { name: new RegExp(`^Apps ${slug}`) }).click();
        await page.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
    });
});

test.describe('Invites on Your apps', () => {
    /** alice makes an org and invites the email as a builder; the page says so */
    async function invited(page: Page, slug: string, email: string): Promise<void> {
        await makeOrg(page, `Waiting ${slug}`, slug);
        await page.getByLabel('Email', { exact: true }).fill(email);
        await page.getByLabel('Role').selectOption({ label: 'Builder' });
        await page.getByRole('button', { name: 'Make the invite link' }).click();
        await expect(page.getByText(`The invite was emailed to ${email}.`, { exact: false })).toBeVisible();
        await expect(page.getByText('If they already use Magnetic, the invite also waits on their Your apps.')).toBeVisible();
    }

    /** A person of their own, signed in with the mock provider with a verified email, on Your apps */
    async function personWith(browser: Browser, email: string, name: string): Promise<{ page: Page; home: HomePage }> {
        await mockPerson({ sub: email, name, email });
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        const page = await context.newPage();
        await page.goto('/signin');
        await page.locator('#page-app').getByRole('button', { name: 'Sign in with the mock provider' }).click();
        await page.waitForURL((url) => url.pathname === '/');
        const home = new HomePage(page);
        await expect(home.makeButton).toBeVisible();
        return { page, home };
    }

    test('an invite is emailed, waits on the invited person\'s Your apps, and joining opens the org', async ({ browser, context, page }) => {
        await signIn(context, 'alice');
        const slug = slugOf('join');
        const email = `joiner-${slug}@example.com`;
        // They signed in once before, so they have an account
        (await personWith(browser, email, 'Joan Joiner')).page.context().close();
        await invited(page, slug, email);
        const mail = (await mailSent()).filter((sent) => sent.to === email);
        expect(mail).toEqual([expect.objectContaining({ orgName: `Waiting ${slug}`, role: 'a builder', link: expect.stringMatching(/\/invites\/[A-Za-z0-9_-]{43}$/) })]);
        const joan = await personWith(browser, email, 'Joan Joiner');
        await expect(joan.home.app.getByText('Orgs have invited you: see Orgs.')).toBeVisible();
        await joan.home.openTab('Orgs');
        await expect(joan.home.app.getByText(`Join Waiting ${slug}`)).toBeVisible();
        await expect(joan.home.app.getByText(/As a builder · from/)).toBeVisible();
        await joan.home.app.getByRole('button', { name: 'Join', exact: true }).click();
        await joan.page.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
        await expect(joan.page.getByText('You are a builder here.')).toBeVisible();
        // Back on Your apps: the org is listed and the invite gone
        await joan.home.goto();
        await expect(joan.home.app.getByText('Orgs have invited you: see Orgs.')).toBeHidden();
        await joan.home.openTab('Orgs');
        await expect(joan.home.app.getByText(`Waiting ${slug}`, { exact: true })).toBeVisible();
        await expect(joan.home.app.getByText(`Join Waiting ${slug}`)).toBeHidden();
        await joan.page.context().close();
    });

    test('a declined invite goes from Your apps', async ({ browser, context, page }) => {
        await signIn(context, 'alice');
        const slug = slugOf('decline');
        const email = `decliner-${slug}@example.com`;
        await invited(page, slug, email);
        const dee = await personWith(browser, email, 'Dee Decliner');
        await dee.home.openTab('Orgs');
        await expect(dee.home.app.getByText(`Join Waiting ${slug}`)).toBeVisible();
        await dee.home.app.getByRole('button', { name: 'Decline', exact: true }).click();
        await expect(dee.home.app.getByText(`Join Waiting ${slug}`)).toBeHidden();
        await expect(dee.home.app.getByText('Invitations', { exact: true })).toBeHidden();
        await dee.page.context().close();
    });

    test('Your apps lists the person\'s orgs; one opens its settings, and Make an org opens the org page', async ({ context, home, page }) => {
        await signIn(context, 'alice');
        const slug = slugOf('listed');
        await makeOrg(page, `Listed ${slug}`, slug);
        await home.goto();
        await home.openTab('Orgs');
        await expect(home.app.getByText('Your orgs', { exact: true })).toBeVisible();
        await home.app.getByRole('button', { name: new RegExp(`^Listed ${slug}`) }).click();
        await page.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
        await expect(page.getByText('You are an owner here.')).toBeVisible();
        // Back on Your apps, on the tab last shown
        await page.goto('/');
        await expect(home.tab('Orgs')).toHaveAttribute('aria-selected', 'true');
        await home.app.getByRole('button', { name: 'Make an org' }).click();
        await page.waitForURL(/\/settings\/orgs$/);
    });
});
