import { describe, expect, it } from 'vitest';
import { hiddenBy, ownTree, ownWrites, pathOfId } from './own.js';

const MODELS = {
    page: [
        { op: 'set', field: 'notice', type: 'string', default: '' },
        { op: 'set', field: 'noNotice', type: 'boolean', default: true },
        { op: 'set', field: 'look', type: 'object', default: { save: 'ghost', open: 'soft' } },
        { op: 'set', field: 'narrow', type: 'boolean', default: false }
    ]
};

const definition = (): Record<string, unknown> => ({
    title: 'Page',
    home: {
        component: 'panel',
        children: {
            notice: { component: 'alert', '<-_text': '$.data.page.notice', 'own:hidden': '$.data.page.noNotice' },
            bar: {
                component: 'panel',
                children: {
                    save: { component: 'button', 'own:variant': 'look.save', '@id': 'save' },
                    open: { component: 'button', 'own:variant': 'look.open', 'own:hidden': 'narrow' },
                    notice: { component: 'text', 'own:hidden': 'narrow' }
                }
            }
        }
    }
});

describe("a node's own state in a page", () => {
    it('should give each marked node the first value and an id, take the fields out of the model and list where each goes', () => {
        // Act
        const owned = ownTree(definition(), MODELS, '$.data.page', 'page');

        // Assert
        const home = owned.definition['home'] as { children: Record<string, Record<string, unknown> & { children: Record<string, Record<string, unknown>> }> };
        expect(home.children['notice']).toEqual({ component: 'alert', '<-_text': '$.data.page.notice', hidden: true, '@id': 'noticePart' });
        expect(home.children['bar']?.children['save']).toEqual({ component: 'button', variant: 'ghost', '@id': 'save' });
        expect(home.children['bar']?.children['open']).toEqual({ component: 'button', variant: 'soft', hidden: false, '@id': 'openPart' });
        expect(home.children['bar']?.children['notice']?.['@id']).toBe('barNoticePart');
        expect(owned.own).toEqual({
            '$.data.page.noNotice': ['noticePart.hidden'],
            '$.data.page.look.save': ['save.variant'],
            '$.data.page.look.open': ['openPart.variant'],
            '$.data.page.narrow': ['openPart.hidden', 'barNoticePart.hidden']
        });
        expect(owned.paths['openPart.hidden']).toBe('$.screens.home.children.bar.children.open.hidden');
        expect(owned.models['page']?.map((operation) => operation['field'])).toEqual(['notice']);
    });

    it('should refuse a field that is both a node’s own state and linked as data, and a field its model lacks', () => {
        // Arrange
        const both = { home: { component: 'panel', children: { a: { component: 'text', 'own:hidden': 'narrow' }, b: { component: 'switchField', '<-checked': '$.data.page.narrow' } } } };
        const unknown = { home: { component: 'text', 'own:hidden': 'missing' } };

        // Act
        const linked = (): unknown => ownTree(both, MODELS, '$.data.page', 'page');
        const lacking = (): unknown => ownTree(unknown, MODELS, '$.data.page', 'page');

        // Assert
        expect(linked).toThrow('narrow');
        expect(lacking).toThrow('missing');
    });

    it('should take a write of a field to its nodes by id, and split a record written above such fields', () => {
        // Arrange
        const { own } = ownTree(definition(), MODELS, '$.data.page', 'page');
        const writes = [
            { path: '$.data.page', value: { notice: 'Full', noNotice: false, look: { save: 'solid', open: 'ghost' } } },
            { path: '$.data.page.narrow', value: true },
            { path: '$.data.other', value: 1 }
        ];

        // Act
        const placed = ownWrites(own, writes);

        // Assert
        expect(placed).toEqual([
            { path: '$.data.page', value: { notice: 'Full', look: {} } },
            { path: '#noticePart.hidden', value: false },
            { path: '#save.variant', value: 'solid' },
            { path: '#openPart.variant', value: 'ghost' },
            { path: '#openPart.hidden', value: true },
            { path: '#barNoticePart.hidden', value: true },
            { path: '$.data.other', value: 1 }
        ]);
    });

    it('should find a node by its id in a document and in an app’s state, and link a row’s field instead of owning it', () => {
        // Arrange
        const owned = ownTree(definition(), MODELS, '$.data.page', 'page');
        const state = { screens: { home: owned.definition['home'] } };
        const document = { screens: { home: { root: owned.definition['home'] } } };

        // Act
        const inState = pathOfId(state, 'openPart');
        const inDocument = pathOfId(document, 'openPart');

        // Assert
        expect(inState).toBe('$.screens.home.children.bar.children.open');
        expect(inDocument).toBe('$.screens.home.children.bar.children.open');
        expect(pathOfId(state, 'nobody')).toBeUndefined();
        expect(hiddenBy('$row.done')).toEqual({ '<-hidden': '$row.done' });
        expect(hiddenBy('$.data.page.narrow')).toEqual({ 'own:hidden': '$.data.page.narrow' });
    });
});
