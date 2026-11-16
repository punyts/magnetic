import type { Page } from '@playwright/test';
import { expect, signIn, test } from './fixtures.js';

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
});
