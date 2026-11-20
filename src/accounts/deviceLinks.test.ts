import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Accounts } from './Accounts.js';
import { DeviceLinks } from './DeviceLinks.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

describe('DeviceLinks', () => {
    it('should sign in as the user who made the link, once', async () => {
        // Arrange
        const user = await new Accounts(test.db).signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });
        const links = new DeviceLinks(test.db);
        const token = await links.make(user.id);

        // Act
        const peeked = await links.peek(token);
        const used = await links.use(token);
        const again = await links.use(token);

        // Assert
        expect(peeked).toBe(user.id);
        expect(used).toBe(user.id);
        expect(again).toBeUndefined();
        expect(await links.peek(token)).toBeUndefined();
    });

    it('should refuse a link after ten minutes, and a malformed or unknown one', async () => {
        // Arrange
        const user = await new Accounts(test.db).signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });
        let now = new Date('2026-11-20T10:00:00Z');
        const links = new DeviceLinks(test.db, () => now);
        const token = await links.make(user.id);

        // Act
        now = new Date('2026-11-20T10:10:01Z');
        const late = await links.use(token);

        // Assert
        expect(late).toBeUndefined();
        expect(await links.use('not a token')).toBeUndefined();
        expect(await links.use('A'.repeat(43))).toBeUndefined();
        expect(await links.use(undefined)).toBeUndefined();
    });

    it('should keep only the hash of a token', async () => {
        // Arrange
        const user = await new Accounts(test.db).signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });

        // Act
        const token = await new DeviceLinks(test.db).make(user.id);

        // Assert
        const rows = (await test.db.query<{ token_hash: string }>('SELECT token_hash FROM device_link')).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.token_hash).not.toBe(token);
    });
});
