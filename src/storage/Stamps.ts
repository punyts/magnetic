import type { Database } from '@punyts/stateui-pg';

/**
 * What Magnetic last made of each of its own apps in a workspace (`workspace_stamp`): Your apps, the editor and the
 * pages are made again when their definition changes. A stamp is a small JSON object, such as `{ stamp, revision }`
 */
export class Stamps {
    constructor(private readonly db: Database) {}

    async get<T extends object>(workspaceId: string, name: string): Promise<T | undefined> {
        return (await this.db.query<{ value: T }>('SELECT value FROM workspace_stamp WHERE workspace_id = $1 AND name = $2', [workspaceId, name])).rows[0]?.value;
    }

    async set(workspaceId: string, name: string, value: object): Promise<void> {
        await this.db.query('INSERT INTO workspace_stamp (workspace_id, name, value) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, name) DO UPDATE SET value = EXCLUDED.value', [workspaceId, name, JSON.stringify(value)]);
    }
}
