import { isBlankApp, onlyPanels, starterScreen } from './StarterScreen.js';

describe('starterScreen', () => {
    it('should lay out a header row, a growing body column and a footer row, in that order', () => {
        // Act
        const root = starterScreen(true);
        const children = root['children'] as Record<string, Record<string, unknown>>;

        // Assert
        expect(Object.keys(children)).toEqual(['header', 'body', 'footer']);
        expect(root['layout']).toEqual({ type: 'column' });
        expect(root['placement']).toEqual({ grow: 1 });
        expect((children['header']?.['layout'] as Record<string, unknown>)['type']).toBe('row');
        expect((children['body']?.['layout'] as Record<string, unknown>)['type']).toBe('column');
        expect(children['body']?.['placement']).toEqual({ grow: 1 });
        expect((children['footer']?.['layout'] as Record<string, unknown>)['type']).toBe('row');
    });

    it('should leave out the screen grow for an app node without a layout', () => {
        // Act
        const root = starterScreen(false);

        // Assert
        expect(root['placement']).toBeUndefined();
    });
});

describe('isBlankApp', () => {
    it('should call an app blank while its screens hold only empty panels, the starter too', () => {
        // Arrange
        const starter = { screens: { home: { root: starterScreen(true) } } };
        const bare = { screens: { home: { root: { component: 'panel' } } } };

        // Assert
        expect(isBlankApp(starter)).toBe(true);
        expect(isBlankApp(bare)).toBe(true);
        expect(onlyPanels(starterScreen(false))).toBe(true);
    });

    it('should not call an app blank once a section holds a component', () => {
        // Arrange
        const root = starterScreen(true);
        const body = (root['children'] as Record<string, Record<string, unknown>>)['body'] as Record<string, unknown>;
        body['children'] = { title: { component: 'text', _text: 'Hello' } };

        // Assert
        expect(isBlankApp({ screens: { home: { root } } })).toBe(false);
    });
});
