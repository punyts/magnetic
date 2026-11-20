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

describe('migration 0018 (namespace workspaces)', () => {
    it("should record the workspace of every namespace with state, set one recorded elsewhere to its head's, and change nothing the second time", async () => {
        // Arrange
        const [one, two, app] = [randomUUID(), randomUUID(), randomUUID()];
        const [unrecorded, moved, recorded] = [`1/apps/${app}`, `2/apps/${app}`, `3/apps/${app}`];
        await test.db.query('INSERT INTO namespace_head (address, workspace_id, revision) VALUES ($1, $2, 1), ($3, $4, 1), ($5, $2, 1)', [unrecorded, one, moved, two, recorded]);
        await test.db.query('INSERT INTO statenet_namespace (address, workspace_id) VALUES ($1, $2), ($3, $2)', [moved, one, recorded]);
        const sql = await readFile(join(MAGNETIC_MIGRATIONS.dir, '0018_namespace_workspaces.sql'), 'utf8');

        // Act
        await test.db.query(sql);
        await test.db.query(sql);

        // Assert
        const rows = (await test.db.query<{ address: string; workspace_id: string }>('SELECT address, workspace_id::text AS workspace_id FROM statenet_namespace ORDER BY address')).rows;
        expect(rows.map((row) => [row.address, row.workspace_id])).toEqual([
            [unrecorded, one],
            [moved, two],
            [recorded, one]
        ]);
    });
});
