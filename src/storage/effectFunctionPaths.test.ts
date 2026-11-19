import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { MAGNETIC_MIGRATIONS } from './db.js';

const OWNER_ROLE = 'punyts_migration_owner';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

const LOGIC = {
    needs: {},
    params: {},
    effects: {
        orders: { request: '$.runtime.ordersRequest', run: 'http', status: '$.runtime.ordersStatus', value: '$.runtime.orders' },
        moved: { request: '$.runtime.other', run: '$.functions.host.http', status: '$.runtime.otherStatus' }
    },
    machines: {}
};

const APP = {
    home: 'start',
    logic: { effects: { weather: { run: 'http', request: '$.runtime.city', status: '$.runtime.weatherStatus' } }, rules: {} },
    screens: {}
};

const DATA = { records: { first: { run: 'http', label: 'Not an effect' } } };

describe('migration 0013 (effect function paths)', () => {
    it('should point effects that name http at $.functions.host.http, keep the key order, and leave other parts alone', async () => {
        // Arrange: the parts as stored before it, and the table owned by a role that row-level security holds
        const workspace = randomUUID();
        await test.db.transaction(
            async (tx) => {
                for (const [kind, name, body] of [['logic', 'orders', LOGIC], ['apps', 'shop', APP], ['data', 'notes', DATA]] as const) {
                    await tx.query('INSERT INTO part (workspace_id, kind, id, name, revision, body, created_at, updated_at) VALUES ($1, $2, $3, $4, 1, $5, now(), now())', [
                        workspace,
                        kind,
                        randomUUID(),
                        name,
                        JSON.stringify(body)
                    ]);
                }
            },
            { workspaceIds: [workspace] }
        );
        await test.db.query(`DO $$ BEGIN CREATE ROLE ${OWNER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
        await test.db.query(`GRANT USAGE ON SCHEMA ${test.schema} TO ${OWNER_ROLE}`);
        await test.db.query(`ALTER TABLE part OWNER TO ${OWNER_ROLE}`);
        const sql = await readFile(join(MAGNETIC_MIGRATIONS.dir, '0013_effect_function_paths.sql'), 'utf8');

        // Act
        await test.db.transaction(async (tx) => {
            await tx.query(`SET LOCAL ROLE ${OWNER_ROLE}`);
            await tx.query(sql);
        });

        // Assert
        const rows = await test.db.transaction(
            async (tx) => (await tx.query<{ name: string; revision: number; body: Record<string, unknown> }>('SELECT name, revision, body FROM part ORDER BY name')).rows,
            { workspaceIds: [workspace] }
        );
        const byName = new Map(rows.map((row) => [row.name, row]));
        const logic = byName.get('orders')?.body as typeof LOGIC;
        const app = byName.get('shop')?.body as typeof APP;
        expect(logic).toEqual({ ...LOGIC, effects: { ...LOGIC.effects, orders: { ...LOGIC.effects.orders, run: '$.functions.host.http' } } });
        expect(Object.keys(logic)).toEqual(['needs', 'params', 'effects', 'machines']);
        expect(Object.keys(logic.effects.orders)).toEqual(['request', 'run', 'status', 'value']);
        expect(app.logic.effects.weather).toEqual({ run: '$.functions.host.http', request: '$.runtime.city', status: '$.runtime.weatherStatus' });
        expect(Object.keys(app)).toEqual(['home', 'logic', 'screens']);
        expect(Object.keys(app.logic)).toEqual(['effects', 'rules']);
        expect(byName.get('notes')?.body).toEqual(DATA);
        expect(rows.map((row) => [row.name, row.revision])).toEqual([
            ['notes', 1],
            ['orders', 2],
            ['shop', 2]
        ]);
        const forced = await test.db.query<{ forced: boolean }>("SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'part'::regclass");
        expect(forced.rows[0]?.forced).toBe(true);
    });
});
