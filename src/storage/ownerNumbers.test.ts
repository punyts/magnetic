import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { Accounts } from '../accounts/Accounts.js';
import { magneticTestDatabase } from '../testing/testDb.js';

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
});
