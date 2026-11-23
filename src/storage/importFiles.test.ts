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
import { pgWorkspaceStorage } from '@punyts/stateui-pg';
import { datasetStateAddress } from '@punyts/stateui-mcp';
import { importPeople } from './importFiles.js';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const DATASET = '77777777-7777-4777-8777-777777777777';
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
    const ws = join('users', ANA);
    const FILE = '66666666-6666-4666-8666-666666666666';
    await mkdir(join(dir, ws, 'apps'), { recursive: true });
    await json(join(ws, 'apps', `${APP}.json`), { id: APP, kind: 'apps', name: 'notes', revision: 3, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', body: { home: 'home', screens: { home: { root: { component: 'column', children: { zeta: {}, alpha: {} } } } } } });
    await mkdir(join(dir, ws, 'data'), { recursive: true });
    await json(join(ws, 'data', `${DATASET}.json`), { id: DATASET, kind: 'data', name: 'notes', revision: 2, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', body: { model: 'note', records: { n2: { text: 'b' }, n1: { text: 'a' } } } });
    await mkdir(join(dir, ws, 'personas', 'default', 'apps', ANA), { recursive: true });
    await json(join(ws, 'personas', 'default', 'apps', ANA, `${APP}.json`), { route: { screen: 'edit' } });
    await mkdir(join(dir, ws, 'personas', BEN, 'data', APP), { recursive: true });
    await json(join(ws, 'personas', BEN, 'data', APP, 'my^notes.json'), { model: 'note', records: { b: { text: 'two' }, a: { text: 'one' } } });
    await mkdir(join(dir, ws, APP, 'files'), { recursive: true });
    await json(join(ws, APP, 'files.json'), [{ id: FILE, name: 'hello.txt', size: 5, type: 'text/plain', sha256: 'x', createdAt: '2026-10-07T00:00:00.000Z' }]);
    await writeFile(join(dir, ws, APP, 'files', FILE), 'hello');
    await json(join(ws, APP, 'errors.json'), [{ error: { code: 'E1', message: 'broken' } }]);
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
    it('should copy users, identities, live sessions, links, spend, chats and datasets into their namespaces, once', async () => {
        // Act
        const first = await importPeople(test.db, dir, NOW);
        const second = await importPeople(test.db, dir, NOW);

        // Assert
        expect(first).toMatchObject({ users: 2, identities: 2, sessions: 1, grants: 1, spend: 2, chats: 2, workspaces: 1, parts: 2, instances: 1, files: 1 });
        expect(first.skipped).toEqual(['identity dev:ghost: no such user']);
        expect(second).toMatchObject({ users: 0, identities: 0, sessions: 0, grants: 0, spend: 0, chats: 0, workspaces: 0, workspacesSkipped: 1 });
        const storage = pgWorkspaceStorage(test.db, ANA);
        const app = await storage.parts.findById('apps', APP);
        expect(app).toMatchObject({ name: 'notes', revision: 3 });
        expect(Object.keys((app?.body as unknown as { screens: { home: { root: { children: object } } } }).screens.home.root.children)).toEqual(['zeta', 'alpha']);
        expect((await storage.parts.findById('data', DATASET))?.body).toEqual({ model: 'note' });
        expect(((await storage.datasets.load(datasetStateAddress(ANA, 'notes')))?.state['data'] as { records: object }).records).toEqual({ n2: { text: 'b' }, n1: { text: 'a' } });
        expect((await storage.instances('default').get(APP)).value).toEqual({ route: { screen: 'edit' } });
        expect(Object.keys((await storage.instances(BEN).getData(APP, 'myNotes')).value?.records ?? {})).toEqual(['b', 'a']);
        expect(new TextDecoder().decode(await storage.fileStore.read(APP, '66666666-6666-4666-8666-666666666666'))).toBe('hello');
        expect((await storage.errorLog.list(APP)).map((error) => error.code)).toEqual(['E1']);
        const accounts = new Accounts(test.db);
        expect(await accounts.user(ANA)).toMatchObject({ name: 'Ana', email: 'ana@example.com' });
        expect((await accounts.signIn({ provider: 'linkedin', subject: 'abc' }, { name: 'Ana S' })).id).toBe(ANA);
        expect(await new Sessions(test.db, () => NOW).find(undefined)).toBeUndefined();
        expect((await test.db.query('SELECT token_hash FROM session')).rows).toEqual([{ token_hash: 'livehash' }]);
        const grants = new Grants(test.db);
        expect(await grants.access(APP, BEN)).toEqual({ live: expect.objectContaining({ appName: 'notes', ownerId: ANA }) });
        expect(await new Budgets(test.db, undefined, () => NOW).spent(ANA)).toEqual({ today: 0.25, total: 0.25, month: 0.75, bought: 0 });
        const chat = await new Chats(test.db).read(ANA, APP);
        expect(chat).toEqual([
            { role: 'person', text: 'Make a list', at: '2026-11-04T00:00:00.000Z' },
            { role: 'agent', text: 'Done.', at: '2026-11-04T00:00:05.000Z', tools: [{ name: 'ui_tree', summary: 'Read', ok: true, result: 'ok' }], outcome: 'finished' }
        ]);
    });
});
