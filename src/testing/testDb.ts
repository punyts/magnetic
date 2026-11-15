import { createTestDatabase } from '@punyts/stateui-pg/testing';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { ALL_MIGRATIONS } from '../storage/db.js';

/** A schema of its own in the test database (`PUNYTS_TEST_DATABASE_URL`) with Magnetic's tables, dropped by `drop` */
export function magneticTestDatabase(): Promise<TestDatabase> {
    return createTestDatabase(ALL_MIGRATIONS);
}
