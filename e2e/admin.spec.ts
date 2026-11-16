import { expect, signIn, test, uniqueName, verifyEmail } from './fixtures.js';

test.describe('The admin pages', () => {
    test.describe.configure({ mode: 'serial' });

    test('Admin shows on Your apps only for an admin', async ({ context, home }) => {
        await signIn(context, 'bob');
        await home.goto();
        await expect(home.app.getByRole('button', { name: 'Agent use' })).toBeVisible();
        await expect(home.app.getByRole('button', { name: 'Admin', exact: true })).toBeHidden();
    });

    test('an admin reads feedback sent from the editor, marks it done, and gives a person agent use', async ({ context, home, page }, info) => {
        // Arrange: erin is an admin, and sends a bug from an editor
        await signIn(context, 'erin');
        await verifyEmail('erin', 'admin@example.test');
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'admin'));
        const text = `The frame jumps when I zoom (${info.project.name})`;
        await editor.button('Report a bug or send feedback').click();
        const box = editor.editor.getByLabel('Tell us');
        await box.fill(text);
        await box.blur();
        await editor.button('Send feedback').click();
        await expect(editor.editor.getByText('Thank you. It was sent.')).toBeVisible();

        // Act: from Your apps to Admin
        await home.goto();
        await home.app.getByRole('button', { name: 'Admin', exact: true }).click();

        // Assert: the overview, then the feedback
        await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
        await expect(page.getByText('Open feedback')).toBeVisible();
        await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Feedback' }).click();
        const item = page.getByRole('listitem').filter({ hasText: text });
        await expect(item).toContainText('Bug');
        await item.getByRole('button', { name: 'Done' }).click();
        await expect(page.getByRole('status')).toHaveText('Marked done.');
        await expect(page.getByText(text)).toBeHidden();
        await page.getByRole('link', { name: 'All', exact: true }).click();
        await expect(page.getByRole('listitem').filter({ hasText: text }).getByRole('button', { name: 'Reopen' })).toBeVisible();

        // Act + Assert: People, and a gift to bob
        await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'People' }).click();
        await page.getByLabel('Dollars to give bob').fill('3');
        await page.getByLabel('Why give bob agent use').fill('Beta tester');
        await page.getByRole('row').filter({ hasText: 'bob' }).getByRole('button', { name: 'Give' }).click();
        await expect(page.getByRole('status')).toHaveText('Gave bob $3.00 of agent use.');
    });
});
