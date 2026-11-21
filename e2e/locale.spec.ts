import type { Browser, BrowserContext } from '@playwright/test';
import { EditorPage, expect, HomePage, signInNew, SignInPage, test, uniqueName } from './fixtures.js';

/** A context of its own whose browser speaks the locale, at the project's size */
async function speaking(browser: Browser, locale: string): Promise<BrowserContext> {
    return browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? null, locale });
}

test.describe('Languages', () => {
    test("the sign-in page speaks the browser's language: French and Spanish", async ({ browser }) => {
        for (const [locale, button] of [['fr-FR', 'Se connecter en tant que bob'], ['es-ES', 'Iniciar sesión como bob']] as const) {
            const context = await speaking(browser, locale);
            const signInPage = new SignInPage(await context.newPage());
            await signInPage.goto();
            await expect(signInPage.button(button), locale).toBeVisible();
            await context.close();
        }
    });

    test("a newcomer whose browser speaks Spanish gets Your apps in Spanish", async ({ browser }, info) => {
        // Arrange
        const context = await speaking(browser, 'es-ES');
        const page = await context.newPage();

        // Act
        await signInNew(page, info, 'nuevo');

        // Assert
        const home = new HomePage(page);
        for (const name of ['Aplicaciones', 'Uso', 'Perfil']) await expect(home.tab(name), name).toBeVisible();
        await home.tab('Uso').click();
        await expect(home.app.getByText(/^Has usado /)).toBeVisible();
        await context.close();
    });

    test('French chosen on the Profile tab is kept, and English puts it back', async ({ page }, info) => {
        // Arrange
        await signInNew(page, info, 'francophone');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Profile');

        // Act
        await home.app.getByRole('combobox').nth(1).selectOption({ label: 'Français' });

        // Assert
        await expect(home.app.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
        await page.reload();
        await expect(home.tab('Applications')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
        await home.app.getByRole('combobox').nth(1).selectOption({ label: 'English' });
        await expect(home.app.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });

    test("the editor's Appearance and language sheet turns the editor German", async ({ page }, info) => {
        // Arrange
        await signInNew(page, info, 'deutsch');
        const home = new HomePage(page);
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'sprache'));

        // Act
        await editor.button('Appearance and language').click();
        await editor.editor.getByRole('combobox', { name: 'Language', exact: true }).selectOption({ label: 'Deutsch' });

        // Assert: the editor again, in German
        await expect(editor.editor.getByPlaceholder('Was sollen wir bauen?')).toBeVisible();
        await expect(editor.button('Teilen')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/edit/${editor.appId}$`));
    });

    test("a share link's page speaks the person's language", async ({ browser }, info) => {
        const context = await speaking(browser, 'de-DE');
        const page = await context.newPage();
        await signInNew(page, info, 'leser');
        await page.goto('/s/kein-link');
        await expect(page.locator('#page-app').getByText('Link nicht gefunden')).toBeVisible();
        await expect(page.locator('#page-app').getByRole('button', { name: 'Deine Apps' })).toBeVisible();
        await context.close();
    });

    test("an editor opened in a browser that speaks French is in French", async ({ browser }, info) => {
        const context = await speaking(browser, 'fr-FR');
        const page = await context.newPage();
        await signInNew(page, info, 'editeur');
        const answer = await page.request.post('/new', { headers: { Accept: 'application/json', Origin: new URL(page.url()).origin }, form: { name: uniqueName(info, 'atelier') } });
        const { id } = (await answer.json()) as { id: string };
        await page.goto(`/edit/${id}`);
        const editor = new EditorPage(page);
        await expect(editor.editor.getByPlaceholder('Que construisons-nous ?')).toBeVisible({ timeout: 30_000 });
        await expect(editor.editor.getByText('Cette application est vide')).toBeVisible();
        await context.close();
    });
});
