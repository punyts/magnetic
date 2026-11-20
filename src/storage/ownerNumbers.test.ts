import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { MAGNETIC_MIGRATIONS } from './db.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

const numberOf = async (table: 'app_user' | 'org', id: string): Promise<number> => Number((await test.db.query<{ owner_number: string }>(`SELECT owner_number FROM ${table} WHERE id = $1`, [id])).rows[0]?.owner_number);

describe('owner numbers', () => {
    it('should give each person and each org the next number of one sequence, and list every owner with the workspace that is its tree', async () => {
        // Arrange
        const accounts = new Accounts(test.db);
        const ana = await accounts.signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });
        const org = randomUUID();
        const workspace = randomUUID();

        // Act
        await test.db.query('INSERT INTO org (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [org, 'acme', 'Acme', ana.id]);
        await test.db.query("INSERT INTO workspace (id, kind, org_id) VALUES ($1, 'org', $2)", [workspace, org]);
        const ben = await accounts.signIn({ provider: 'dev', subject: 'ben' }, { name: 'Ben' });

        // Assert
        const first = await numberOf('app_user', ana.id);
        expect([await numberOf('org', org), await numberOf('app_user', ben.id)]).toEqual([first + 1, first + 2]);
        const owners = (await test.db.query<{ number: string; kind: string; id: string; workspace_id: string }>('SELECT number, kind, id, workspace_id FROM statenet_owner WHERE id = ANY($1::uuid[]) ORDER BY number', [[ana.id, org, ben.id]])).rows;
        expect(owners.map((owner) => [Number(owner.number), owner.kind, owner.id, owner.workspace_id])).toEqual([
            [first, 'user', ana.id, ana.id],
            [first + 1, 'org', org, workspace],
            [first + 2, 'user', ben.id, ben.id]
        ]);
    });

    it("should number those who were there before it in the order they came, people and orgs in one line after Magnetic's own two, and carry on after them", async () => {
        // Arrange: a database from before the migration, with two people and an org between them
        await test.db.query('DROP VIEW statenet_owner');
        await test.db.query('ALTER TABLE app_user DROP COLUMN owner_number');
        await test.db.query('ALTER TABLE org DROP COLUMN owner_number');
        await test.db.query('DROP TABLE statenet_system_owner');
        await test.db.query('DROP SEQUENCE statenet_owner_number');
        await test.db.query('DELETE FROM org');
        await test.db.query('DELETE FROM app_user');
        const [early, late, org, after] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await test.db.query("INSERT INTO app_user (id, name, created_at) VALUES ($1, 'Late', '2026-03-01'), ($2, 'Early', '2026-01-01')", [late, early]);
        await test.db.query("INSERT INTO org (id, slug, name, created_by, created_at) VALUES ($1, 'acme', 'Acme', $2, '2026-02-01')", [org, early]);

        // Act
        await test.db.query(await readFile(join(MAGNETIC_MIGRATIONS.dir, '0015_owner_numbers.sql'), 'utf8'));
        await test.db.query("INSERT INTO app_user (id, name) VALUES ($1, 'After')", [after]);

        // Assert
        expect([await numberOf('app_user', early), await numberOf('org', org), await numberOf('app_user', late), await numberOf('app_user', after)]).toEqual([3, 4, 5, 6]);
    });
});
