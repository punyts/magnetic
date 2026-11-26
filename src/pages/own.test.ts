import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { hiddenBy, OWN_JS, ownTree, ownWrites, pathOfId } from './own.js';

const MODELS = {
    page: [
        { op: 'set', field: 'notice', type: 'string', default: '' },
        { op: 'set', field: 'noNotice', type: 'boolean', default: true }
    ],
    bar: [
        { op: 'set', field: 'zoom', type: 'string', default: '100%' },
        { op: 'set', field: 'look', type: 'object', default: { save: 'ghost', open: 'soft' } },
        { op: 'set', field: 'narrow', type: 'boolean', default: false }
    ],
    list: [{ op: 'set', field: 'id', type: 'string', required: true }]
};

/** The page's data in two namespaces, each a record with its own model */
const RECORDS = [{ path: '$.data.page', model: 'page' }, { path: '$.data.bar', model: 'bar' }];

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
    it('should give each marked node the first value and an id, take the fields out of the model of their record and list where each goes', () => {
        // Act
        const owned = ownTree(definition(), MODELS, RECORDS);

        // Assert
        const home = owned.definition['home'] as { children: Record<string, Record<string, unknown> & { children: Record<string, Record<string, unknown>> }> };
        expect(home.children['notice']).toEqual({ component: 'alert', '<-_text': '$.data.page.notice', hidden: true, '@id': 'noticePart' });
        expect(home.children['bar']?.children['save']).toEqual({ component: 'button', variant: 'ghost', '@id': 'save' });
        expect(home.children['bar']?.children['open']).toEqual({ component: 'button', variant: 'soft', hidden: false, '@id': 'openPart' });
        expect(home.children['bar']?.children['notice']?.['@id']).toBe('barNoticePart');
        expect(owned.own).toEqual({
            '$.data.page.noNotice': ['noticePart.hidden'],
            '$.data.bar.look.save': ['save.variant'],
            '$.data.bar.look.open': ['openPart.variant'],
            '$.data.bar.narrow': ['openPart.hidden', 'barNoticePart.hidden']
        });
        expect(owned.paths['openPart.hidden']).toBe('$.screens.home.children.bar.children.open.hidden');
        expect(owned.models['page']?.map((operation) => operation['field'])).toEqual(['notice']);
        expect(owned.models['bar']?.map((operation) => operation['field'])).toEqual(['zoom']);
        expect(owned.models['list']).toBe(MODELS.list);
    });

    it('should refuse a field that is both a node’s own state and linked as data, and a field its model lacks', () => {
        // Arrange
        const both = { home: { component: 'panel', children: { a: { component: 'text', 'own:hidden': 'narrow' }, b: { component: 'switchField', '<-checked': '$.data.bar.narrow' } } } };
        const unknown = { home: { component: 'text', 'own:hidden': 'missing' } };

        // Act
        const linked = (): unknown => ownTree(both, MODELS, RECORDS);
        const lacking = (): unknown => ownTree(unknown, MODELS, RECORDS);

        // Assert
        expect(linked).toThrow('narrow');
        expect(lacking).toThrow('missing');
    });

    it('should take a write of a field to its nodes by id, and split a record written above such fields', () => {
        // Arrange
        const { own } = ownTree(definition(), MODELS, RECORDS);
        const writes = [
            { path: '$.data.page', value: { notice: 'Full', noNotice: false } },
            { path: '$.data.bar', value: { zoom: '50%', look: { save: 'solid', open: 'ghost' } } },
            { path: '$.data.bar.narrow', value: true },
            { path: '$.data.other', value: 1 }
        ];

        // Act
        const placed = ownWrites(own, writes);

        // Assert
        expect(placed).toEqual([
            { path: '$.data.page', value: { notice: 'Full' } },
            { path: '#noticePart.hidden', value: false, optional: true },
            { path: '$.data.bar', value: { zoom: '50%', look: {} } },
            { path: '#save.variant', value: 'solid', optional: true },
            { path: '#openPart.variant', value: 'ghost', optional: true },
            { path: '#openPart.hidden', value: true, optional: true },
            { path: '#barNoticePart.hidden', value: true, optional: true },
            { path: '$.data.other', value: 1 }
        ]);
    });

    it('should take a write to the state path a caller gives for a place, and keep what else a write carries', () => {
        // Arrange
        const { own, paths } = ownTree(definition(), MODELS, RECORDS);

        // Act
        const placed = ownWrites(own, [{ path: '$.data.bar.narrow', value: true }, { path: '$.data.other', value: 1, optional: true }], (target) => paths[target] as string);

        // Assert
        expect(placed).toEqual([
            { path: '$.screens.home.children.bar.children.open.hidden', value: true },
            { path: '$.screens.home.children.bar.children.notice.hidden', value: true },
            { path: '$.data.other', value: 1, optional: true }
        ]);
    });

    it('should give the page scripts the text of ownWrites itself, which runs alone and answers the same', () => {
        // Arrange
        const { own } = ownTree(definition(), MODELS, RECORDS);
        const writes = [
            { path: '$.data.page', value: { notice: 'Full', noNotice: false } },
            { path: '$.data.bar', value: { zoom: '50%', look: { save: 'solid', open: 'ghost' } }, optional: true },
            { path: '$.data.bar.narrow', value: true }
        ];

        // Act: the script runs in a context of its own, with nothing of this module or of Node in reach
        const inPage = JSON.parse(runInNewContext(`${OWN_JS}JSON.stringify(ownWrites(${JSON.stringify(own)}, ${JSON.stringify(writes)}))`, {}) as string) as unknown;

        // Assert
        expect(OWN_JS).toMatch(/^function ownWrites\(own, writes, place\) \{/);
        expect(OWN_JS.endsWith('}\n')).toBe(true);
        expect(inPage).toEqual(ownWrites(own, writes));
        expect(inPage).toContainEqual({ path: '#noticePart.hidden', value: false, optional: true });
    });

    it('should find a node by its id in a document and in an app’s state, and link a row’s field instead of owning it', () => {
        // Arrange
        const owned = ownTree(definition(), MODELS, RECORDS);
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
        expect(hiddenBy('$.data.bar.narrow')).toEqual({ 'own:hidden': '$.data.bar.narrow' });
    });
});
