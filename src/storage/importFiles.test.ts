import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { Sessions } from '../accounts/Sessions.js';
import { Budgets } from '../agent/Budgets.js';
import { Chats } from '../agent/Chats.js';
import { Grants } from '../sharing/Grants.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { importPeople } from './importFiles.js';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-10T12:00:00Z');

let test: TestDatabase;
let dir: string;

beforeEach(async () => {
    test = await magneticTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'magnetic-import-'));
    const json = (name: string, value: unknown): Promise<void> => writeFile(join(dir, name), JSON.stringify(value));
    await json('accounts.json', {
        users: {
            [ANA]: { id: ANA, name: 'Ana', email: 'ana@example.com', createdAt: '2026-10-01T00:00:00.000Z' },
            [BEN]: { id: BEN, name: 'Ben', createdAt: '2026-10-02T00:00:00.000Z' }
        },
        identities: { 'linkedin:abc': ANA, 'dev:ben': BEN, 'dev:ghost': '44444444-4444-4444-8444-444444444444' }
    });
    await json('sessions.json', {
        livehash: { userId: ANA, createdAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z' },
        oldhash: { userId: BEN, createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z' }
    });
    await json('grants.json', {
        g1: {
            id: '55555555-5555-4555-8555-555555555555',
            token: 'a'.repeat(32),
            ownerId: ANA,
            appId: APP,
            appName: 'notes',
            right: 'use',
            createdAt: '2026-11-02T00:00:00.000Z',
            members: { [BEN]: '2026-11-03T00:00:00.000Z' }
        }
    });
    await json('budgets.json', { days: { '2026-11-10': { [ANA]: 0.25 } }, months: { '2026-11': 0.75 } });
    await mkdir(join(dir, 'users', ANA, 'magnetic', 'chats'), { recursive: true });
    await json(join('users', ANA, 'magnetic', 'chats', `${APP}.json`), [
        { role: 'person', text: 'Make a list', at: '2026-11-04T00:00:00.000Z' },
        { role: 'agent', text: 'Done.', at: '2026-11-04T00:00:05.000Z', tools: [{ name: 'ui_tree', summary: 'Read', ok: true, result: 'ok' }], outcome: 'finished' }
    ]);
});

afterEach(async () => {
    await test.drop();
    await rm(dir, { recursive: true, force: true });
});

describe('importPeople', () => {
    it('should copy users, identities, live sessions, links, spend and chats, once', async () => {
        // Act
        const first = await importPeople(test.db, dir, NOW);
        const second = await importPeople(test.db, dir, NOW);

        // Assert
        expect(first).toMatchObject({ users: 2, identities: 2, sessions: 1, grants: 1, spend: 2, chats: 2 });
        expect(first.skipped).toEqual(['identity dev:ghost: no such user']);
        expect(second).toMatchObject({ users: 0, identities: 0, sessions: 0, grants: 0, spend: 0, chats: 0 });
        const accounts = new Accounts(test.db);
        expect(await accounts.user(ANA)).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
        expect((await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana S' })).id).toBe(ANA);
        expect(await new Sessions(test.db, () => NOW).find(undefined)).toBeUndefined();
        expect((await test.db.query('SELECT token_hash FROM session')).rows).toEqual([{ token_hash: 'livehash' }]);
        const grants = new Grants(test.db);
        expect(await grants.access(APP, BEN)).toEqual({ live: expect.objectContaining({ appName: 'notes', ownerId: ANA }) });
        expect(await new Budgets(test.db, undefined, () => NOW).spent(ANA)).toEqual({ today: 0.25, month: 0.75 });
        const chat = await new Chats(test.db).read(ANA, APP);
        expect(chat).toEqual([
            { role: 'person', text: 'Make a list', at: '2026-11-04T00:00:00.000Z' },
            { role: 'agent', text: 'Done.', at: '2026-11-04T00:00:05.000Z', tools: [{ name: 'ui_tree', summary: 'Read', ok: true, result: 'ok' }], outcome: 'finished' }
        ]);
    });
});
