import { fileURLToPath } from 'node:url';
import { STATEUI_PG_MIGRATIONS } from '@punyts/stateui-pg';
import type { MigrationSet } from '@punyts/stateui-pg';

/** Magnetic's own tables: people, orgs, access, links, spend, chats and the audit log */
export const MAGNETIC_MIGRATIONS: MigrationSet = { owner: 'magnetic', dir: fileURLToPath(new URL('../../migrations', import.meta.url)) };

/** Every migration set a Magnetic database needs, in the order they apply */
export const ALL_MIGRATIONS: readonly MigrationSet[] = [STATEUI_PG_MIGRATIONS, MAGNETIC_MIGRATIONS];

/**
 * The tables the aggregate's role reads besides people's state: which workspace an address is in, the grant keys it
 * gives the relays, and the migrations it checks at start
 */
export const AGGREGATE_READS: readonly string[] = ['statenet_namespace', 'owner_key', 'schema_migration'];
