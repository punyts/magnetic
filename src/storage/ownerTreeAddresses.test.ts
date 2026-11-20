import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { MAGNETIC_MIGRATIONS } from './db.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

describe('migration 0016 (owner tree addresses)', () => {
    it("should move the addresses Magnetic keeps to an owner and a path under its $, an org's read of every app included, and change nothing the second time", async () => {
        // Arrange: a namespace's workspace and three grants, by the addresses of before
        const [user, app, workspace] = [randomUUID(), randomUUID(), randomUUID()];
        await test.db.query('INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2)', [`${user}/${app}/user`, workspace]);
        const grant = "INSERT INTO state_grant (id, kind, issuer, subject, address, prefix, rights, issued_at) VALUES ($1, $2, $3, 'someone', $4, '$', '{read}', now())";
        await test.db.query(grant, [randomUUID(), 'share', user, `${user}/${app}/user`]);
        await test.db.query(grant, [randomUUID(), 'org-read', user, `${user}/*/user`]);
        await test.db.query(grant, [randomUUID(), 'share', workspace, `${workspace}/price-list/data`]);
        await test.db.query(grant, [randomUUID(), 'share', workspace, `${workspace}/data/data`]);
        const sql = await readFile(join(MAGNETIC_MIGRATIONS.dir, '0016_owner_tree_addresses.sql'), 'utf8');

        // Act
        await test.db.query(sql);
        await test.db.query(sql);

        // Assert
        expect((await test.db.query<{ address: string }>('SELECT address FROM statenet_namespace')).rows).toEqual([{ address: `${user}/apps/${app}` }]);
        const grants = (await test.db.query<{ address: string }>('SELECT address FROM state_grant ORDER BY address')).rows.map((row) => row.address);
        expect(grants).toEqual([`${user}/apps/${app}`, `${user}/apps/*`, `${workspace}/data/data`, `${workspace}/data/price-list`].sort());
    });
});
