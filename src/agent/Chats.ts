import type { Database } from '@punyts/stateui-pg';

/** One tool call of an agent turn, as the activity drawer lists it */
export interface ToolLine {
    readonly name: string;
    readonly summary: string;
    readonly ok: boolean;
    readonly result: string;
}

/** How a turn ended */
export type TurnOutcome = 'finished' | 'stopped' | 'limit' | 'refused' | 'failed' | 'budget';

export type ChatEntry =
    | { readonly role: 'person'; readonly text: string; readonly at: string }
    | { readonly role: 'agent'; readonly text: string; readonly at: string; readonly tools: readonly ToolLine[]; readonly outcome: TurnOutcome; readonly message?: string };

/** The most entries kept per app */
const KEEP = 100;

/** The source kind of chat entries in the embedding index; an entry's source id is its id */
export const CHAT_SOURCE = 'chat';

interface ChatRow {
    role: 'person' | 'agent';
    text: string;
    tools: ToolLine[] | null;
    outcome: TurnOutcome | null;
    message: string | null;
    at: Date;
}

function entryOf(row: ChatRow): ChatEntry {
    const at = row.at.toISOString();
    if (row.role === 'person') return { role: 'person', text: row.text, at };
    return { role: 'agent', text: row.text, at, tools: row.tools ?? [], outcome: row.outcome ?? 'finished', ...(row.message !== null && { message: row.message }) };
}

/**
 * The chat of each person with the agent about each app of a workspace (`chat_entry`). Every entry is kept; a read
 * gives the last 100, oldest first. Today the workspace is the person's own, so both ids are the user's
 */
export class Chats {
    constructor(
        private readonly db: Database,
        /** Queues each new entry's embedding, for the agent's recall of earlier chats */
        private readonly options: { readonly embed?: boolean } = {}
    ) {}

    async read(userId: string, appId: string, workspaceId: string = userId): Promise<readonly ChatEntry[]> {
        const rows = (
            await this.db.query<ChatRow>(
                `SELECT role, text, tools, outcome, message, at FROM (
                    SELECT id, role, text, tools, outcome, message, at FROM chat_entry
                     WHERE workspace_id = $1 AND app_id = $2 AND user_id = $3 ORDER BY id DESC LIMIT $4
                 ) last ORDER BY id`,
                [workspaceId, appId, userId, KEEP]
            )
        ).rows;
        return rows.map(entryOf);
    }

    async append(userId: string, appId: string, entry: ChatEntry, workspaceId: string = userId): Promise<void> {
        const insert = 'INSERT INTO chat_entry (workspace_id, app_id, user_id, role, text, tools, outcome, message, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
        // The entry and its embedding job commit together
        const sql = this.options.embed === true ? `WITH entry AS (${insert} RETURNING id, workspace_id) INSERT INTO embedding_job (workspace_id, source_kind, source_id) SELECT workspace_id, '${CHAT_SOURCE}', id::text FROM entry` : insert;
        await this.db.query(sql, [
            workspaceId,
            appId,
            userId,
            entry.role,
            entry.text,
            entry.role === 'agent' ? JSON.stringify(entry.tools) : null,
            entry.role === 'agent' ? entry.outcome : null,
            entry.role === 'agent' ? (entry.message ?? null) : null,
            entry.at
        ]);
    }
}
