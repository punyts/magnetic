import { expect, feedbackSent, signIn, test, uniqueName } from './fixtures.js';

test.describe("The editor's bug button", () => {
    test.beforeEach(async ({ context }) => {
        await signIn(context, 'alice');
    });

    test('sends a feature request to whoever runs Magnetic, with the app and the frame size, and clears the box', async ({ home }, info) => {
        // Arrange
        await home.goto();
        const name = uniqueName(info, 'feedback');
        const editor = await home.makeApp(name);
        const text = `Let me undo a change from the chat (${info.project.name})`;

        // Act
        await editor.button('Report a bug or send feedback').click();
        await editor.editor.getByLabel('What is it?').selectOption('feature');
        const box = editor.editor.getByLabel('Tell us');
        await box.fill(text);
        await box.blur();
        await editor.button('Send feedback').click();

        // Assert
        await expect(editor.editor.getByText('Thank you. It was sent.')).toBeVisible();
        await expect(box).toHaveValue('');
        await expect.poll(async () => (await feedbackSent()).find((mail) => mail.text === text)).toMatchObject({ to: 'operator@example.com', kind: 'feature', context: { size: expect.any(String) } });
    });

    test('says to write something first, and closes when its button is pressed again', async ({ home }, info) => {
        // Arrange
        await home.goto();
        const editor = await home.makeApp(uniqueName(info, 'empty-feedback'));

        // Act
        await editor.button('Report a bug or send feedback').click();
        await editor.button('Send feedback').click();

        // Assert
        await expect(editor.editor.getByText('Write something first.')).toBeVisible();
        await editor.button('Report a bug or send feedback').click();
        await expect(editor.editor.getByText('Write something first.')).toBeHidden();
    });
});
