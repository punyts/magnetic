import { expect, HomePage, signIn, signInNew, SignInPage, test, uniqueName } from './fixtures.js';

test.describe('Your apps, the profile and the apps', () => {
    test('Sign in on another device gives a link that signs the person in there once', async ({ browser, context, home, page }) => {
        // Arrange: bob asks for a link on the Profile tab
        await signIn(context, 'bob');
        await home.goto();
        await home.openTab('Profile');
        await home.app.getByRole('button', { name: 'Sign in on another device' }).click();
        await page.waitForURL(/\/settings\/device$/);
        const shown = page.locator('#page-app').getByText(/Open this link on the other device within 10 minutes/);
        await expect(shown).toBeVisible();
        const link = /https?:\/\/\S+\/signin\/link\/[A-Za-z0-9_-]{43}/.exec((await shown.textContent()) ?? '')?.[0];
        expect(link, 'the link on the page').toBeDefined();

        // Act: another browser opens it, and is asked first
        const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? null });
        const device = await other.newPage();
        await device.goto(link as string);
        const continueAs = new SignInPage(device).button('Continue as bob');
        await expect(continueAs).toBeVisible();
        await continueAs.click();

        // Assert: signed in as bob there; the link does not work again
        await device.waitForURL((url) => url.pathname === '/');
        await expect(new HomePage(device).tab('Apps')).toBeVisible();
        const third = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        const again = await third.newPage();
        expect((await again.goto(link as string))?.status()).toBe(404);
        await expect(new SignInPage(again).app.getByText('This sign-in link has been used or has expired.', { exact: false })).toBeVisible();
        await other.close();
        await third.close();
    });

    test("an app's name is made from what is typed: lower-case words joined by dashes", async ({ context, home }, info) => {
        // Arrange
        await signIn(context, 'alice');
        await home.goto();
        const stamp = uniqueName(info, 'x').split('-').slice(1).join(' ');

        // Act
        await home.makeApp(`Reading List ${stamp}!`);
        await home.goto();

        // Assert
        await expect(home.card(`reading-list-${stamp.replace(/ /g, '-')}`)).toBeVisible();
    });

    test('a name that does not start with a letter is refused with the reason', async ({ context, home, page }) => {
        await signIn(context, 'alice');
        await home.goto();
        await home.nameField.fill('42 things');
        await home.makeButton.click();
        await expect(home.notice).toHaveText('Give the app a name that starts with a letter.');
        await expect(page).toHaveURL((url) => url.pathname === '/');
    });

    test("a person's new app is the card on Your apps with the day it changed", async ({ page }, info) => {
        // Arrange: someone with no apps yet
        await signInNew(page, info, 'newcomer');
        const home = new HomePage(page);
        await home.goto();
        await expect(home.app.getByRole('button', { name: /^Changed / })).toHaveCount(0);

        // Act
        const name = uniqueName(info, 'first');
        await home.makeApp(name);
        await home.goto();

        // Assert
        await expect(home.card(name)).toBeVisible();
        await expect(home.card(name)).toContainText(/Changed /);
    });

    test("the Usage tab shows a newcomer's allowance, today's use and the ring", async ({ page }, info) => {
        await signInNew(page, info, 'counter');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Usage');
        await expect(home.app.getByText('You have used $0.00 of $5.00.')).toBeVisible();
        await expect(home.app.getByText('Today: $0.00')).toBeVisible();
        await expect(home.app.getByRole('progressbar', { name: 'Agent use' })).toBeVisible();
    });

    test('the Profile tab names the person and their email', async ({ page }, info) => {
        const person = await signInNew(page, info, 'named');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Profile');
        await expect(home.app.getByText(person.name, { exact: true })).toBeVisible();
        await expect(home.app.getByText(person.email, { exact: true })).toBeVisible();
    });

    test('Light is kept as the appearance', async ({ page }, info) => {
        // Arrange
        await signInNew(page, info, 'light');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Profile');

        // Act
        await home.app.getByRole('combobox').nth(0).selectOption({ label: 'Light' });

        // Assert
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
    });

    test("Reset the editor asks first, and once confirmed says the editor is Magnetic's again", async ({ page }, info) => {
        // Arrange
        await signInNew(page, info, 'resetter');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Profile');
        const reset = home.app.getByRole('button', { name: 'Reset the editor' });

        // Act: dismissed, nothing happens
        const asked: string[] = [];
        page.once('dialog', (dialog) => { asked.push(dialog.message()); void dialog.dismiss(); });
        await reset.click();
        await expect.poll(() => asked).toEqual(["Reset the editor? Your changes to it are lost, and it starts again from Magnetic's."]);
        await expect(home.notice).toBeHidden();

        // Act: confirmed
        page.once('dialog', (dialog) => void dialog.accept());
        await reset.click();

        // Assert
        await expect(home.notice).toHaveText("The editor is Magnetic's again.");
    });

    test('Edit the editor opens Magnetic’s editor as an app of the person’s, in the editor', async ({ page }, info) => {
        // Arrange
        await signInNew(page, info, 'tinkerer');
        const home = new HomePage(page);
        await home.goto();
        await home.openTab('Profile');

        // Act
        await home.app.getByRole('button', { name: 'Edit the editor' }).click();

        // Assert: an editor whose live app is itself an editor, with its own request box
        await page.waitForURL(/\/edit\/[0-9a-f-]+$/);
        const live = page.locator('#editor .stateui-panel[role="region"][aria-label="The screens of the app"] ui-embedded-app[live]');
        await expect(live.getByPlaceholder('What shall we build?')).toBeVisible({ timeout: 30_000 });
    });
});
