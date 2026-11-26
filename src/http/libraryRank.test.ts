import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { INSPECT_JS } from './inspect.js';
import { LIBRARY_RANK_JS, rankLibrary } from './libraryRank.js';

const LIBRARY = [
    { name: 'codeBlock', category: 'content', summary: 'A block of code as text, with a copy button', purposes: ['show a snippet'] },
    { name: 'colorField', category: 'forms', summary: 'A colour picked or typed as text', purposes: ['pick a colour'] },
    { name: 'richTextField', category: 'forms', summary: 'A formatted note', purposes: ['write a long note'] },
    { name: 'textField', category: 'forms', summary: 'A labelled single-line field', purposes: ['enter a name'] },
    { name: 'text', category: 'content', summary: 'A run of words', purposes: ['show a paragraph'] },
    { name: 'badge', category: 'feedback', summary: 'A small count or state', purposes: ['mark new text messages'] },
    { name: 'Text layout', category: 'layout', summary: 'An empty panel' },
    { name: 'chart', category: 'data', summary: 'Totals as bars or lines', purposes: ['show totals by month'] }
];
const names = (entries: readonly { name: string }[]): string[] => entries.map((entry) => entry.name);

describe('the component library search', () => {
    it('should list the exact name first, then names that start with what is typed, then names that have it, then summaries and purposes', () => {
        // Act
        const shown = rankLibrary(LIBRARY, ' Text ', 'all', 60);

        // Assert
        expect(names(shown)).toEqual(['text', 'textField', 'Text layout', 'richTextField', 'codeBlock', 'colorField', 'badge']);
    });

    it('should keep the category, the library order with nothing typed, and the limit', () => {
        // Act
        const forms = rankLibrary(LIBRARY, 'text', 'forms', 60);
        const all = rankLibrary(LIBRARY, '', 'content', 60);
        const few = rankLibrary(LIBRARY, 'text', 'all', 2);
        const none = rankLibrary(LIBRARY, 'zebra', 'all', 60);

        // Assert
        expect(names(forms)).toEqual(['textField', 'richTextField', 'colorField']);
        expect(names(all)).toEqual(['codeBlock', 'text']);
        expect(names(few)).toEqual(['text', 'textField']);
        expect(none).toEqual([]);
    });

    it('should give the inspector script the text of rankLibrary itself, which runs alone and answers the same', () => {
        // Act: the script text runs in a context of its own
        const inPage = JSON.parse(runInNewContext(`${LIBRARY_RANK_JS}JSON.stringify(rankLibrary(${JSON.stringify(LIBRARY)}, 'text', 'all', 60))`, {}) as string) as unknown;

        // Assert
        expect(LIBRARY_RANK_JS).toMatch(/^function rankLibrary\(library, search, category, limit\) \{/);
        expect(inPage).toEqual(rankLibrary(LIBRARY, 'text', 'all', 60));
        expect(INSPECT_JS).toContain(LIBRARY_RANK_JS);
        expect(INSPECT_JS).toContain('rankLibrary(library, search, category, 60)');
    });
});
