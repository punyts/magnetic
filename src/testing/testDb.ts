import { createDatabase, grantAggregateRole, grantAppRole } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';
import { createTestDatabase } from '@punyts/stateui-pg/testing';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { ALL_MIGRATIONS } from '../storage/db.js';

/** A schema of its own in the test database (`PUNYTS_TEST_DATABASE_URL`) with Magnetic's tables, dropped by `drop` */
export function magneticTestDatabase(): Promise<TestDatabase> {
    return createTestDatabase(ALL_MIGRATIONS);
}

/** The roles the hosted servers and the aggregate connect as, made in the test database once */
export const TEST_ROLES = { server: 'magnetic_app_test', aggregate: 'magnetic_aggregate_test' } as const;

/** Connections to a test schema as the hosted roles hold it */
export interface RoleDatabases {
    /** As a server: every table, but only reading people's state */
    readonly server: Database;
    /** As the aggregate: writing people's state, and little else */
    readonly aggregate: Database;
    close(): Promise<void>;
}

/**
 * Connections to a test schema as the roles `magnetic migrate --app-role … --aggregate-role …` grants
 * (docs/design/statenet-network.md, S11): neither bypasses row-level security, and only the aggregate writes the
 * state tables. The roles are made once in the database (roles are not per schema); the grants go with the schema
 */
export async function roleDatabases(test: TestDatabase): Promise<RoleDatabases> {
    for (const role of Object.values(TEST_ROLES)) await test.db.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    await grantAppRole(test.db, TEST_ROLES.server, { readOnlyState: true });
    await grantAggregateRole(test.db, TEST_ROLES.aggregate, ['statenet_namespace', 'owner_key']);
    const as = (role: string): Database => createDatabase({ url: test.url, config: { options: `${test.config.options} -c role=${role}`, max: 5 } });
    const server = as(TEST_ROLES.server);
    const aggregate = as(TEST_ROLES.aggregate);
    return {
        server,
        aggregate,
        close: async () => {
            await server.close();
            await aggregate.close();
        }
    };
}
