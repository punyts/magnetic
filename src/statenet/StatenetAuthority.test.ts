import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretBox } from '../auth/secrets.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { STATENET_AUTHORITY } from './directoryView.js';
import { StatenetAuthority } from './StatenetNode.js';

const SECRET = 'statenet-authority-test-secret-key-0123456789';

describe('StatenetAuthority', () => {
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
    }, 60_000);

    afterAll(async () => {
        await test.drop();
    });

    it('should make one key when several processes ask at once on an empty database, and give each of them that key', async () => {
        // Arrange: each authority queues and locks on its own, as each server and relay-certificate does
        const authorities = [1, 2, 3, 4].map(() => new StatenetAuthority(test.db, new SecretBox(SECRET)));

        // Act
        const pairs = await Promise.all(authorities.map((authority) => authority.keys()));
        const rows = (await test.db.query<{ public_key: string }>('SELECT public_key FROM owner_key WHERE owner_id = $1', [STATENET_AUTHORITY])).rows;
        const later = await new StatenetAuthority(test.db, new SecretBox(SECRET)).keys();

        // Assert
        expect(rows).toHaveLength(1);
        expect(new Set(pairs.map((pair) => pair.publicKey))).toEqual(new Set([rows[0]?.public_key]));
        expect(new Set(pairs.map((pair) => pair.privateKey)).size).toBe(1);
        expect(later).toEqual(pairs[0]);
    }, 60_000);
});
