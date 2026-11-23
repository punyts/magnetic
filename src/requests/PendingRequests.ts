import type { Database } from '@punyts/stateui-pg';
import { datasetOf } from '../grants/StateGrants.js';

/** A pending request on a workspace's dataset, as the index lists it: no values */
export interface PendingRequest {
    readonly workspaceId: string;
    readonly dataset: string;
    readonly id: string;
    /** Who asked, by the name the access went by (an owner number, or `org:<number>`) */
    readonly subject: string;
    readonly at: Date;
    readonly until: Date;
}

/** The most requests a list shows */
const LIMIT = 500;

/**
 * The pending requests on the datasets of workspaces, read from stateui-pg's `pending_request`, which each dataset's
 * namespace keeps as it saves (docs/design/statenet-requests.md, R3c). It holds no values: a page asks the dataset's
 * authority for those. Read in a transaction scoped to the workspaces, as its row-level security asks
 */
export class PendingRequests {
    constructor(private readonly db: Database) {}

    /** The pending requests on the datasets of these workspaces that still wait, oldest first */
    async of(workspaceIds: readonly string[], now: Date = new Date()): Promise<PendingRequest[]> {
        if (workspaceIds.length === 0) return [];
        const rows = await this.db.transaction(
            async (tx) =>
                (
                    await tx.query<{ address: string; id: string; workspace_id: string; subject: string; at: Date; until: Date }>(
                        'SELECT address, id, workspace_id::text, subject, at, until FROM pending_request WHERE workspace_id = ANY($1::uuid[]) AND until > $2 ORDER BY at, id LIMIT $3',
                        [workspaceIds, now, LIMIT]
                    )
                ).rows,
            { workspaceIds }
        );
        return rows.flatMap((row) => {
            const data = datasetOf(row.address);
            return data === undefined ? [] : [{ workspaceId: row.workspace_id, dataset: data.dataset, id: row.id, subject: row.subject, at: row.at, until: row.until }];
        });
    }

    /** How many requests wait on the datasets of these workspaces */
    async count(workspaceIds: readonly string[], now: Date = new Date()): Promise<number> {
        if (workspaceIds.length === 0) return 0;
        return this.db.transaction(
            async (tx) => Number((await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM pending_request WHERE workspace_id = ANY($1::uuid[]) AND until > $2', [workspaceIds, now])).rows[0]?.n ?? 0),
            { workspaceIds }
        );
    }
}
