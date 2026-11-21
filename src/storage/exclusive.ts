import { report } from '@punyts/core';
import type { Database } from '@punyts/stateui-pg';
import { msSince } from '../server/reporting.js';

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
 * closed afterwards rather than returned to the pool, so the lock can never outlive the work. Callers of one key on this
 * server queue here before they take a connection: waiting in `pg_advisory_lock`, each would hold one, and enough of
 * them would leave the holder's own work none.
 */
export function databaseExclusive(db: Database): Exclusive {
    const queues = new Map<string, Promise<unknown>>();
    return (key, work) => {
        const asked = performance.now();
        const before = queues.get(key) ?? Promise.resolve();
        const run = before.then(async () => {
            const client = await db.pool.connect();
            let taken: number | undefined;
            try {
                await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`magnetic:${key}`]);
                taken = performance.now();
                report('magnetic.storage', 'Lock taken', { key, waitedMs: msSince(asked) });
                return await work();
            } finally {
                client.release(true);
                if (taken !== undefined) report('magnetic.storage', 'Lock released', { key, heldMs: msSince(taken) });
            }
        });
        const tail = run.catch(() => undefined);
        queues.set(key, tail);
        void tail.then(() => {
            if (queues.get(key) === tail) queues.delete(key);
        });
        return run;
    };
}
