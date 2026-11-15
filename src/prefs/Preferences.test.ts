import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { languageOf, PreferenceStore } from './Preferences.js';

describe('languageOf', () => {
    it('should take the first language Magnetic speaks, by weight and then order, and English otherwise', () => {
        // Act
        const results = [
            languageOf('de-DE,de;q=0.9,en;q=0.8'),
            languageOf('it-IT, fr;q=0.7, es;q=0.9'),
            languageOf('ja, zh;q=0.5'),
            languageOf('fr;q=0, es'),
            languageOf(undefined)
        ];

        // Assert
        expect(results).toEqual(['de', 'es', 'en', 'es', 'en']);
    });
});

const U1 = '00000000-0000-4000-8000-0000000000c1';
const U2 = '00000000-0000-4000-8000-0000000000c2';

describe('PreferenceStore', () => {
    let test: TestDatabase;

    beforeEach(async () => {
        test = await magneticTestDatabase();
    });

    afterEach(async () => {
        await test.drop();
    });

    it("should follow the system and the browser's language until the person chooses, then keep each choice", async () => {
        // Arrange
        const store = new PreferenceStore(test.db);

        // Act
        const before = await store.read(U1, 'fr-FR');
        const mode = await store.write(U1, 'fr-FR', { mode: 'dark' });
        const language = await store.write(U1, 'fr-FR', { language: 'es' });
        const after = await store.read(U1, 'de');
        const other = await store.read(U2, 'de');

        // Assert
        expect(before).toEqual({ mode: 'system', language: 'fr' });
        expect(mode).toEqual({ mode: 'dark', language: 'fr' });
        expect(language).toEqual({ mode: 'dark', language: 'es' });
        expect(after).toEqual({ mode: 'dark', language: 'es' });
        expect(other).toEqual({ mode: 'system', language: 'de' });
    });
});
