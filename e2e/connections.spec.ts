import type { Page } from '@playwright/test';
import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

/** The stand-in outside API and OAuth provider of the test server */
const API = `http://127.0.0.1:${Number(process.env['MAGNETIC_E2E_PORT'] ?? 4390) + 3}`;

const nameOf = (stem: string): string => `${stem}-${Date.now().toString(36)}`;

/** Makes a connection from the page's form */
async function make(page: Page, name: string, kind: string, fields: Record<string, string>): Promise<void> {
    await page.goto('/settings/connections');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Make the connection' }) });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Base URL').fill(API);
    await form.locator('select[name="kind"]').selectOption(kind);
    for (const [label, value] of Object.entries(fields)) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole('button', { name: 'Make the connection' }).click();
    await expect(page.getByText(`The connection ${name} is made. Add its endpoints.`)).toBeVisible();
}

/** Adds an endpoint to a connection */
async function addEndpoint(page: Page, connection: string, name: string, path: string): Promise<void> {
    const section = page.getByRole('region', { name: connection });
    await section.getByText('Add an endpoint').click();
    await section.getByLabel('Name', { exact: true }).fill(name);
    await section.getByLabel('Path', { exact: true }).fill(path);
    await section.getByRole('button', { name: 'Add the endpoint' }).click();
    await expect(page.getByText('The endpoint is added.')).toBeVisible();
}

test.describe('Connections', () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test('Your apps leads to the Connections page', async ({ home, page }) => {
        await home.goto();
        await home.openTab('Profile');
        await home.app.getByRole('button', { name: 'Connections' }).click();
        await page.waitForURL(/\/settings\/connections$/);
        await expect(page.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
    });

    test('a connection with a key: its endpoint tried, and the key never on the page', async ({ page }) => {
        const name = nameOf('weather');
        await make(page, name, 'key', { 'Header or parameter name': 'X-Api-Key', 'Key or client secret': 'k-e2e' });
        const section = page.getByRole('region', { name });
        await expect(section.getByText('A key in the X-Api-Key header: set.')).toBeVisible();
        await addEndpoint(page, name, 'today', '/today/{city}');
        await section.getByLabel('Params of today').fill('city=oslo');
        await section.getByRole('button', { name: 'Try' }).click();
        await expect(page.getByText('Answered 200:')).toBeVisible();
        await expect(page.locator('pre.answer')).toContainText('"today":"snow"');
        expect(await page.content()).not.toContain('k-e2e');
    });

    test('an address that is not allowed, or a bad name, is refused with the reason', async ({ page }) => {
        await page.goto('/settings/connections');
        const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Make the connection' }) });
        await form.getByLabel('Name', { exact: true }).fill(nameOf('ok'));
        await form.getByLabel('Base URL').fill('ftp://files.example.com');
        await form.getByRole('button', { name: 'Make the connection' }).click();
        await expect(page.getByRole('alert')).toHaveText('Only https addresses can be called.');
    });

    test('an OAuth connection is connected through the provider, then called with its token', async ({ page }) => {
        const name = nameOf('profile');
        await make(page, name, 'oauth-code', { 'Client id': 'magnetic', 'Token URL': `${API}/token`, 'Sign-in URL (for Connect)': `${API}/authorize`, 'Key or client secret': 'cs-e2e' });
        const section = page.getByRole('region', { name });
        await expect(section.getByText(/not connected yet/)).toBeVisible();
        await section.getByRole('button', { name: 'Connect' }).click();
        await page.getByRole('link', { name: /^Sign in at 127\.0\.0\.1:/ }).click();
        await expect(page.getByText(`${name} is connected.`)).toBeVisible();
        await expect(page.getByRole('region', { name }).getByText(/; connected\./)).toBeVisible();
        await addEndpoint(page, name, 'me', '/me');
        await page.getByRole('region', { name }).getByRole('button', { name: 'Try' }).click();
        await expect(page.locator('pre.answer')).toContainText('"name":"Ada"');
    });

    test('a connection is deleted only with the box ticked', async ({ page }) => {
        const name = nameOf('gone');
        await make(page, name, 'none', {});
        const section = page.getByRole('region', { name });
        await section.getByRole('checkbox').check();
        await section.getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByText(`The connection ${name} is deleted.`)).toBeVisible();
        await expect(page.getByRole('region', { name })).toHaveCount(0);
    });

    test("the page speaks the browser's language to someone who chose none", async ({ browser }) => {
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'de-DE' });
        await signIn(context, 'carol');
        const page = await context.newPage();
        const name = nameOf('wetter');
        await page.goto('/settings/connections');
        await expect(page.getByRole('heading', { name: 'Verbindungen', level: 1 })).toBeVisible();
        const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Verbindung anlegen' }) });
        await form.getByLabel('Name', { exact: true }).fill(name);
        await form.getByLabel('Basis-URL').fill(API);
        await form.getByRole('button', { name: 'Verbindung anlegen' }).click();
        await expect(page.getByText(`Die Verbindung ${name} ist angelegt. Füge ihre Endpunkte hinzu.`)).toBeVisible();
        await expect(page.getByRole('region', { name }).getByText('Keine Anmeldung.')).toBeVisible();
        await context.close();
    });
});

test.describe('Connections in the editor', () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test('the panel lists the endpoints, and pressing one asks the agent; the top bar names the workspace', async ({ home, page }, info) => {
        const name = nameOf('forecast');
        await make(page, name, 'none', {});
        await addEndpoint(page, name, 'today', '/today/{city}');
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'calls'));
        await expect(editor.editor.getByText('Yours', { exact: true }).filter({ visible: true })).toBeVisible();
        await editor.button('Connections (C)').click();
        await expect(editor.editor.getByText('The outside APIs this app can call.', { exact: false })).toBeVisible();
        const card = editor.editor.getByText(`${name} · today`, { exact: true });
        await expect(card).toBeVisible();
        await expect(editor.editor.getByText(/^GET 127\.0\.0\.1:\d+\/today\/\{city\} · city$/).first()).toBeVisible();
        await expect(editor.button('Manage connections')).toBeVisible();
        expect(await page.content()).not.toContain('k-e2e');
        await card.click();
        // The scripted agent puts the request on the app's first screen
        await expect(editor.app.getByText(`Show what the today endpoint of the ${name} connection answers in this app.`)).toBeVisible({ timeout: 30_000 });
    });
});

test.describe('An org that turns connections off', () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test("its Connections page and its apps' editor say so, and Try is gone", async ({ page }) => {
        const slug = nameOf('quiet');
        await page.goto('/settings/orgs');
        await page.getByLabel('Name', { exact: true }).fill(`Quiet ${slug}`);
        await page.getByLabel(/^Short name/).fill(slug);
        await page.getByRole('button', { name: 'Make', exact: true }).click();
        await page.waitForURL(/\/settings\/orgs\/[0-9a-f-]+$/);
        // The policy, on by default, is turned off
        const allowed = page.getByLabel('The org’s apps may call outside APIs through its connections');
        await expect(allowed).toBeChecked();
        await allowed.uncheck();
        await page.locator('form').filter({ has: allowed }).getByRole('button', { name: 'Save' }).click();
        await expect(page.getByLabel('The org’s apps may call outside APIs through its connections')).not.toBeChecked();
        // The org's connections: an endpoint shows, but cannot be tried
        await page.goto('/settings/connections');
        await page.getByRole('link', { name: `Quiet ${slug}` }).click();
        await expect(page.getByText(`Quiet ${slug} has turned connections off`, { exact: false })).toBeVisible();
        const name = nameOf('blocked');
        const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Make the connection' }) });
        await form.getByLabel('Name', { exact: true }).fill(name);
        await form.getByLabel('Base URL').fill(API);
        await form.getByRole('button', { name: 'Make the connection' }).click();
        await addEndpoint(page, name, 'today', '/today/{city}');
        await expect(page.getByRole('region', { name }).getByRole('button', { name: 'Try' })).toHaveCount(0);
        // An app of the org: the editor names the org, and its panel says connections are off
        await page.goto('/settings/orgs');
        await page.getByRole('link', { name: new RegExp(`Quiet ${slug}`) }).click();
        await page.getByLabel('Make an app in the org').fill(`calls-${slug}`);
        await page.getByRole('button', { name: 'Make', exact: true }).last().click();
        await page.waitForURL(/\/edit\/[0-9a-f-]+$/);
        const editor = new EditorPage(page);
        await editor.ready();
        await expect(editor.editor.getByText(`Quiet ${slug}`, { exact: true }).filter({ visible: true })).toBeVisible();
        await editor.button('Connections (C)').click();
        await expect(editor.editor.getByText('This org has turned connections off: its apps cannot call outside APIs.')).toBeVisible();
        await expect(editor.editor.getByText(`${name} · today`, { exact: true })).toBeVisible();
    });
});
