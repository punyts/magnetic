import { EditorPage, expect, signIn, test, uniqueName } from './fixtures.js';

test.describe('The level bar', () => {
    let editor: EditorPage;
    let appId: string;
    let name: string;

    test.beforeEach(async ({ context, home }, info) => {
        await signIn(context, 'alice');
        await home.goto();
        name = uniqueName(info, 'levels');
        editor = await home.makeApp(name);
        appId = editor.appId;
    });

    test('should name the workspace, the app and the screen over the running app, and zoom out to the editor from the app', async ({ page }) => {
        // Arrange
        await page.goto(`/apps/${appId}`);
        const bar = page.getByRole('navigation', { name: 'Where you are' });
        await expect(bar.getByText('Home', { exact: true })).toBeVisible();

        // Act
        await bar.getByRole('link', { name }).click();

        // Assert
        await expect(page.locator('body')).toHaveClass(/(^| )editing( |$)/);
        await expect(page).toHaveURL(new RegExp(`/edit/${appId}(/screens/home)?$`));
        await expect(bar).toBeHidden();
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));
        await expect(bar.getByRole('link', { name: 'Yours' })).toHaveAttribute('href', '/');
    });
});
