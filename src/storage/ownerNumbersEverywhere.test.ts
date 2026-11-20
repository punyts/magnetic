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

const column = async (sql: string): Promise<string[]> => (await test.db.query<{ v: string }>(sql)).rows.map((row) => row.v);

describe('migration 0017 (owner numbers everywhere)', () => {
    it("should name every owner by its number in addresses, grants and beside keys, an org's subject and workspace included, leave what is no owner's, and change nothing the second time", async () => {
        // Arrange: a person, an org with its workspace, and what was stored by their ids
        const ana = await new Accounts(test.db).signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });
        const [org, orgSpace, app, stranger] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        await test.db.query('INSERT INTO org (id, slug, name, created_by) VALUES ($1, $2, $3, $4)', [org, 'acme', 'Acme', ana.id]);
        await test.db.query("INSERT INTO workspace (id, kind, org_id) VALUES ($1, 'org', $2)", [orgSpace, org]);
        const number = async (table: string, id: string): Promise<string> => (await test.db.query<{ n: string }>(`SELECT owner_number::text AS n FROM ${table} WHERE id = $1`, [id])).rows[0]!.n;
        const [anaNo, orgNo] = [await number('app_user', ana.id), await number('org', org)];
        const mine = `${ana.id}/apps/${app}`;
        await test.db.query("INSERT INTO state_node (workspace_id, address, path, parent, position, kind, value, revision) VALUES ($1, $2, 'form', '', 0, 'value', '1', 1)", [ana.id, mine]);
        await test.db.query("INSERT INTO state_change (workspace_id, address, revision, seq, path, op, value) VALUES ($1, $2, 1, 0, 'form', 'set', '1')", [ana.id, mine]);
        await test.db.query('INSERT INTO namespace_head (address, workspace_id, revision) VALUES ($1, $2, 1), ($3, $2, 1)', [mine, ana.id, `${stranger}/apps/${app}`]);
        await test.db.query("INSERT INTO namespace_owner (address, node, epoch, lease_until) VALUES ($1, 'n1', 1, now())", [mine]);
        await test.db.query("INSERT INTO embedding_job (workspace_id, source_kind, source_id) VALUES ($1, 'persona-record', $2), ($1, 'part', $3)", [ana.id, `${mine}/people/k1`, `${ana.id}/x`]);
        await test.db.query('INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2)', [mine, ana.id]);
        const grant = "INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights) VALUES ($1, $2, $3, $4, $5, '$', '{read}')";
        await test.db.query(grant, [randomUUID(), 'share', ana.id, 'someone', mine]);
        await test.db.query(grant, [randomUUID(), 'org-read', ana.id, `org:${org}`, `${ana.id}/apps/*`]);
        await test.db.query(grant, [randomUUID(), 'share', orgSpace, ana.id, `${orgSpace}/data/prices`]);
        await test.db.query("INSERT INTO owner_key (kid, owner_id, public_key, private_key) VALUES ('k1', $1, 'p', 's'), ('k2', 'statenet', 'p', 's')", [ana.id]);
        const sql = await readFile(join(MAGNETIC_MIGRATIONS.dir, '0017_owner_numbers_everywhere.sql'), 'utf8');

        // Act
        await test.db.query(sql);
        await test.db.query(sql);

        // Assert
        const now = `${anaNo}/apps/${app}`;
        expect(await column('SELECT address AS v FROM state_node')).toEqual([now]);
        expect(await column('SELECT address AS v FROM state_change')).toEqual([now]);
        expect(await column('SELECT address AS v FROM namespace_head ORDER BY address')).toEqual([now, `${stranger}/apps/${app}`].sort());
        expect(await column('SELECT address AS v FROM namespace_owner')).toEqual([now]);
        expect(await column('SELECT source_id AS v FROM embedding_job ORDER BY source_id')).toEqual([`${now}/people/k1`, `${ana.id}/x`].sort());
        expect(await column('SELECT address AS v FROM statenet_namespace')).toEqual([now]);
        expect((await column("SELECT issuer || ' ' || subject || ' ' || address AS v FROM state_grant")).sort()).toEqual([
            `${anaNo} org:${orgNo} ${anaNo}/apps/*`,
            `${orgNo} ${anaNo} ${orgNo}/data/prices`,
            `${anaNo} someone ${now}`
        ].sort());
        expect(await column('SELECT owner_id AS v FROM owner_key ORDER BY kid')).toEqual([anaNo, 'statenet']);
    });
});
