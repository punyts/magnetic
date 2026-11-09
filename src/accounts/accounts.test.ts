import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Accounts } from './Accounts.js';
import { Sessions } from './Sessions.js';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'magnetic-accounts-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('Accounts', () => {
    it('should make a user on the first sign-in of an identity and keep it on the next', async () => {
        // Arrange
        const accounts = new Accounts(join(dir, 'accounts.json'));

        // Act
        const first = await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana' });
        const second = await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana Silva', picture: 'https://example.com/a.png' });

        // Assert
        expect(second.id).toBe(first.id);
        expect(second.createdAt).toBe(first.createdAt);
        expect(second).toMatchObject({ name: 'Ana Silva', picture: 'https://example.com/a.png' });
        expect(await new Accounts(join(dir, 'accounts.json')).user(first.id)).toEqual(second);
    });

    it('should make different users for the same subject at different providers', async () => {
        // Arrange
        const accounts = new Accounts(join(dir, 'accounts.json'));

        // Act
        const [a, b] = await Promise.all([
            accounts.signIn({ provider: 'linkedin', subject: 'same' }, { name: 'A' }),
            accounts.signIn({ provider: 'dev', subject: 'same' }, { name: 'B' })
        ]);

        // Assert
        expect(a.id).not.toBe(b.id);
        expect(await accounts.user(a.id)).toBeDefined();
        expect(await accounts.user(b.id)).toBeDefined();
    });
});

describe('Sessions', () => {
    it('should find a session by its token and keep only the hash on disk', async () => {
        // Arrange
        const sessions = new Sessions(join(dir, 'sessions.json'));

        // Act
        const token = await sessions.start('user-1');

        // Assert
        expect((await sessions.find(token))?.userId).toBe('user-1');
        expect(await readFile(join(dir, 'sessions.json'), 'utf8')).not.toContain(token);
        expect((await new Sessions(join(dir, 'sessions.json')).find(token))?.userId).toBe('user-1');
    });

    it('should not find an ended, expired, unknown or malformed token', async () => {
        // Arrange
        let now = new Date('2026-11-01T00:00:00Z');
        const sessions = new Sessions(join(dir, 'sessions.json'), () => now);
        const ended = await sessions.start('user-1');
        const expiring = await sessions.start('user-2');

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
