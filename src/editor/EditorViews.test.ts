import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { EditorViews, keptPlaceOf } from './EditorViews.js';

const U1 = '00000000-0000-4000-8000-0000000000d1';
const U2 = '00000000-0000-4000-8000-0000000000d2';

describe('keptPlaceOf', () => {
    it('should take x, y and a zoom in range as finite numbers, and nothing else', () => {
        // Act
        const results = [
            keptPlaceOf({ x: 10, y: -20.5, zoom: 0.5, extra: true }),
            keptPlaceOf({ x: 10, y: 0, zoom: 5 }),
            keptPlaceOf({ x: Number.NaN, y: 0, zoom: 1 }),
            keptPlaceOf({ x: '1', y: 0, zoom: 1 }),
            keptPlaceOf([1, 2, 3]),
            keptPlaceOf(null)
        ];

        // Assert
        expect(results).toEqual([{ x: 10, y: -20.5, zoom: 0.5 }, undefined, undefined, undefined, undefined, undefined]);
    });
});

describe('EditorViews', () => {
    let test: TestDatabase;

    beforeEach(async () => {
        test = await magneticTestDatabase();
    });

    afterEach(async () => {
        await test.drop();
    });

    it('should keep where each person left a view of each app, the last place winning', async () => {
        // Arrange
        const views = new EditorViews(test.db);

        // Act
        const before = await views.of(U1, 'app-1', 'statenet');
        await views.keep(U1, 'app-1', 'statenet', { x: 1, y: 2, zoom: 1 });
        await views.keep(U1, 'app-1', 'statenet', { x: 30, y: -40, zoom: 0.75 });
        await views.keep(U2, 'app-1', 'statenet', { x: 5, y: 5, zoom: 2 });

        // Assert
        expect(before).toBeUndefined();
        expect(await views.of(U1, 'app-1', 'statenet')).toEqual({ x: 30, y: -40, zoom: 0.75 });
        expect(await views.of(U2, 'app-1', 'statenet')).toEqual({ x: 5, y: 5, zoom: 2 });
        expect(await views.of(U1, 'app-2', 'statenet')).toBeUndefined();
    });

    it("should keep the screens board's view apart from Statenet's", async () => {
        // Arrange
        const views = new EditorViews(test.db);

        // Act
        await views.keep(U1, 'app-1', 'statenet', { x: 1, y: 2, zoom: 1 });
        await views.keep(U1, 'app-1', 'screens', { x: -300, y: 40, zoom: 0.25 });

        // Assert
        expect(await views.of(U1, 'app-1', 'screens')).toEqual({ x: -300, y: 40, zoom: 0.25 });
        expect(await views.of(U1, 'app-1', 'statenet')).toEqual({ x: 1, y: 2, zoom: 1 });
    });
});
