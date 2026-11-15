import type { UiToolDefinition } from '@punyts/stateui-mcp';
import { PART_SOURCE } from '@punyts/stateui-pg';
import type { Database, EmbeddingIndex, EmbeddingSource } from '@punyts/stateui-pg';
import { CHAT_SOURCE } from '../agent/Chats.js';
import type { AppAccess } from '../orgs/AppAccess.js';

/** Reads a chat entry for the embedding worker: its text, as its person's own */
export const chatSource: EmbeddingSource = async (tx, job) => {
    if (!/^\d{1,18}$/.test(job.sourceId)) return undefined;
    const row = (await tx.query<{ text: string; user_id: string }>('SELECT text, user_id FROM chat_entry WHERE workspace_id = $1 AND id = $2', [job.workspaceId, job.sourceId])).rows[0];
    return row === undefined ? undefined : { text: row.text, owner: row.user_id };
};

/** An app found by a search, as the home page shows it */
export interface FoundApp {
    readonly id: string;
    readonly name: string;
    readonly workspaceId: string;
    readonly score: number;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * Semantic search over what a person may see: the apps of their workspaces (their own and their orgs', as far as their
 * access goes), the parts of the workspace the agent works in, and their own earlier chats there
 */
export class Search {
    constructor(
        private readonly db: Database,
        private readonly index: EmbeddingIndex,
        private readonly access: AppAccess
    ) {}

    /** The apps a person may open that are closest to the query, best first */
    async apps(userId: string, query: string, limit = 10): Promise<FoundApp[]> {
        const places = await this.access.workspacesOf(userId);
        const hits = await this.index.search({ workspaceIds: places.map((place) => place.workspaceId), sourceKind: PART_SOURCE, query, limit: 50 });
        const found: FoundApp[] = [];
        for (const hit of hits) {
            const [kind, id] = hit.sourceId.split('/');
            if (kind !== 'apps' || id === undefined) continue;
            if (hit.workspaceId !== userId && (await this.access.permission(userId, hit.workspaceId, id)) === undefined) continue;
            const name = await this.db.transaction(
                async (tx) => (await tx.query<{ name: string }>("SELECT name FROM part WHERE workspace_id = $1 AND kind = 'apps' AND id = $2", [hit.workspaceId, id])).rows[0]?.name,
                { workspaceIds: [hit.workspaceId] }
            );
            if (name === undefined || name === 'your-apps') continue;
            found.push({ id, name, workspaceId: hit.workspaceId, score: hit.score });
            if (found.length >= limit) break;
        }
        return found;
    }

    /** The tools the agent searches with, for a turn of one person in one workspace */
    tools(userId: string, workspaceId: string): UiToolDefinition[] {
        return [
            {
                name: 'parts_search',
                description:
                    "Find the parts of this workspace (apps, models, datasets, themes, logic, components, patterns) closest in meaning to a need, best first, to reuse one rather than make another. Gives each part's kind, name and a score from 0 to 1.",
                inputSchema: {
                    type: 'object',
                    properties: {
                        need: { type: 'string', description: 'What the part is for, in plain words' },
                        kind: { type: 'string', description: 'Only parts of this kind, such as models' },
                        limit: { type: 'number', description: 'At most this many, 10 by default' }
                    },
                    required: ['need']
                } as never,
                annotations: READ_ONLY,
                run: async (args) => {
                    const need = typeof args['need'] === 'string' ? args['need'] : '';
                    const kind = typeof args['kind'] === 'string' ? args['kind'] : undefined;
                    const limit = typeof args['limit'] === 'number' ? Math.min(Math.max(Math.round(args['limit']), 1), 25) : 10;
                    const hits = await this.index.search({ workspaceIds: [workspaceId], sourceKind: PART_SOURCE, query: need, limit: kind === undefined ? limit : 50 });
                    const parts: Array<{ kind: string; name: string; score: number }> = [];
                    for (const hit of hits) {
                        const [partKind, id] = hit.sourceId.split('/');
                        if (kind !== undefined && partKind !== kind) continue;
                        const name = await this.db.transaction(
                            async (tx) => (await tx.query<{ name: string }>('SELECT name FROM part WHERE workspace_id = $1 AND kind = $2 AND id = $3', [workspaceId, partKind, id])).rows[0]?.name,
                            { workspaceIds: [workspaceId] }
                        );
                        if (name !== undefined) parts.push({ kind: partKind ?? '', name, score: Math.round(hit.score * 100) / 100 });
                        if (parts.length >= limit) break;
                    }
                    return { isError: false, body: { parts } };
                }
            },
            {
                name: 'chat_recall',
                description:
                    'Find what the person asked for and what you answered in their earlier chats in this workspace, about any app, closest in meaning to the query: "the budget app I did last week". Only this person\'s own chats. Gives each entry\'s app, who said it, when, and its text.',
                inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'What to look for, in plain words' }, limit: { type: 'number', description: 'At most this many entries, 5 by default' } },
                    required: ['query']
                } as never,
                annotations: READ_ONLY,
                run: async (args) => {
                    const query = typeof args['query'] === 'string' ? args['query'] : '';
                    const limit = typeof args['limit'] === 'number' ? Math.min(Math.max(Math.round(args['limit']), 1), 20) : 5;
                    const hits = await this.index.search({ workspaceIds: [workspaceId], sourceKind: CHAT_SOURCE, query, owner: userId, limit });
                    const ids = hits.map((hit) => hit.sourceId);
                    if (ids.length === 0) return { isError: false, body: { entries: [] } };
                    const rows = await this.db.query<{ id: string; app_id: string; role: string; text: string; at: Date }>(
                        'SELECT id::text AS id, app_id, role, text, at FROM chat_entry WHERE workspace_id = $1 AND user_id = $2 AND id = ANY($3::bigint[])',
                        [workspaceId, userId, ids]
                    );
                    const byId = new Map(rows.rows.map((row) => [row.id, row]));
                    const names = new Map<string, string>();
                    for (const appId of new Set(rows.rows.map((row) => row.app_id))) {
                        const name = await this.db.transaction(
                            async (tx) => (await tx.query<{ name: string }>("SELECT name FROM part WHERE workspace_id = $1 AND kind = 'apps' AND id = $2", [workspaceId, appId])).rows[0]?.name,
                            { workspaceIds: [workspaceId] }
                        );
                        if (name !== undefined) names.set(appId, name);
                    }
                    const entries = hits
                        .map((hit) => byId.get(hit.sourceId))
                        .filter((row) => row !== undefined)
                        .map((row) => ({ app: names.get(row.app_id) ?? 'an app that is gone', role: row.role, at: row.at.toISOString(), text: row.text.slice(0, 2000) }));
                    return { isError: false, body: { entries } };
                }
            }
        ];
    }
}
