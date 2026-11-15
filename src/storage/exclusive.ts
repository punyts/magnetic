import type { Database } from '@punyts/stateui-pg';

/**
 * Runs `work` while no other holder of the same key runs it, on any server of the database: for the check-then-make of
 * Magnetic's own apps (the page apps, the editors, the home apps), which two servers starting at once would otherwise
 * both make, the second failing on the first's revision
 */
export type Exclusive = <T>(key: string, work: () => Promise<T>) => Promise<T>;

/** The lock of the apps Magnetic makes in its system workspace, which share its theme */
export const SYSTEM_APPS_LOCK = 'system-apps';

/** The lock of the apps Magnetic makes in a person's workspace */
export const userAppsLock = (userId: string): string => `user-apps:${userId}`;

/** No other server: `work` runs at once */
export const alone: Exclusive = (_key, work) => work();

/**
 * One holder at a time per key across the servers of `db`: a session advisory lock on a connection of its own, which is
 * closed afterwards rather than returned to the pool, so the lock can never outlive the work
 */
export function databaseExclusive(db: Database): Exclusive {
    return async (key, work) => {
        const client = await db.pool.connect();
        try {
            await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`magnetic:${key}`]);
            return await work();
        } finally {
            client.release(true);
        }
    };
}
