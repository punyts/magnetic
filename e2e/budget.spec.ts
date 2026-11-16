import { expect, signIn, spend, test, uniqueName } from './fixtures.js';

test.describe("The editor's agent use", () => {
    test('shows what is used and left, and once it is spent turns the request off and says to carry on by hand', async ({ context, home }, info) => {
        // Arrange: a person of this project's own, as this spends all they have
        const user = info.project.name === 'phone' ? 'gina' : 'frank';
        await signIn(context, user);
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'budget'));
        await expect(editor.editor.getByText('Agent use: $0.00 of $5.00 used, $5.00 left')).toBeVisible();

        // Act
        await spend(user, 5);
        await editor.goto(editor.appId);

        // Assert
        await expect(editor.editor.getByText('You have used your $5.00 of agent use. You can carry on building by hand: select anything in your app to change it.')).toBeVisible();
        await expect(editor.request).toBeDisabled();
        await expect(editor.button('Send')).toBeDisabled();
    });
});
