import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Accounts } from './Accounts.js';
import { Sessions } from './Sessions.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

/** Two users to start sessions for */
async function twoUsers(): Promise<[string, string]> {
    const accounts = new Accounts(test.db);
    const one = await accounts.signIn({ provider: 'dev', subject: 'one' }, { name: 'One' });
    const two = await accounts.signIn({ provider: 'dev', subject: 'two' }, { name: 'Two' });
    return [one.id, two.id];
}

describe('Accounts', () => {
    it('should make a user on the first sign-in of an identity and keep it on the next', async () => {
        // Arrange
        const accounts = new Accounts(test.db);

        // Act
        const first = await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana' });
        const second = await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana Silva', picture: 'https://example.com/a.png' });

        // Assert
        expect(second.id).toBe(first.id);
        expect(second.createdAt).toBe(first.createdAt);
        expect(second).toMatchObject({ name: 'Ana Silva', picture: 'https://example.com/a.png' });
        expect(await new Accounts(test.db).user(first.id)).toEqual(second);
    });

    it('should make different users for the same subject at different providers', async () => {
        // Arrange
        const accounts = new Accounts(test.db);

        // Act
        const [a, b, c] = await Promise.all([
            accounts.signIn({ provider: 'linkedin', subject: 'same' }, { name: 'A' }),
            accounts.signIn({ provider: 'dev', subject: 'same' }, { name: 'B' }),
            accounts.signIn({ provider: 'dev', subject: 'same' }, { name: 'B' })
        ]);

        // Assert
        expect(a.id).not.toBe(b.id);
        expect(c.id).toBe(b.id);
        expect(await accounts.user(a.id)).toBeDefined();
        expect(await accounts.user(b.id)).toBeDefined();
    });

    it('should sign in by an email address as one account: made at first, verified, then the same for a provider that verified it', async () => {
        // Arrange
        const accounts = new Accounts(test.db);

        // Act
        const made = await accounts.signInByEmail(' Cleo@Example.com ', 'Cleo Park');
        const again = await accounts.signInByEmail('cleo@example.com');
        const linked = await accounts.signIn({ provider: 'linkedin', subject: 'cleo' }, { name: 'Cleo P.', email: 'CLEO@example.com', emailVerified: true });
        const unverified = await accounts.signIn({ provider: 'google', subject: 'cleo' }, { name: 'Cleo', email: 'cleo@example.com', emailVerified: false });

        // Assert
        expect(made).toMatchObject({ name: 'Cleo Park', email: 'cleo@example.com' });
        expect(again.id).toBe(made.id);
        expect(linked.id).toBe(made.id);
        expect(unverified.id).not.toBe(made.id);
        expect((await accounts.byVerifiedEmail('CLEO@example.com'))?.id).toBe(made.id);
        expect(await accounts.byVerifiedEmail('nobody@example.com')).toBeUndefined();
    });
});

describe('Sessions', () => {
    it('should find a session by its token and keep only the hash in the database', async () => {
        // Arrange
        const [user] = await twoUsers();
        const sessions = new Sessions(test.db);

        // Act
        const token = await sessions.start(user);

        // Assert
        expect((await sessions.find(token))?.userId).toBe(user);
        expect(JSON.stringify((await test.db.query('SELECT * FROM session')).rows)).not.toContain(token);
        expect((await new Sessions(test.db).find(token))?.userId).toBe(user);
    });

    it('should not find an ended, expired, unknown or malformed token', async () => {
        // Arrange
        const [one, two] = await twoUsers();
        let now = new Date('2026-11-01T00:00:00Z');
        const sessions = new Sessions(test.db, () => now);
        const ended = await sessions.start(one);
        const expiring = await sessions.start(two);

        // Act
        await sessions.end(ended);
        now = new Date('2026-12-02T00:00:00Z');

        // Assert
        expect(await sessions.find(ended)).toBeUndefined();
        expect(await sessions.find(expiring)).toBeUndefined();
        expect(await sessions.find('x'.repeat(43))).toBeUndefined();
        expect(await sessions.find('not a token')).toBeUndefined();
        expect(await sessions.find(undefined)).toBeUndefined();
    });
});
