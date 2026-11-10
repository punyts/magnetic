import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

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

/**
 * The chat of each of a user's apps, one JSON file per app under the user's folder (`magnetic/chats/<appId>.json`).
 * Writes to one file go one at a time
 */
export class Chats {
    private readonly writes = new Map<string, Promise<void>>();

    constructor(private readonly usersDir: string) {}

    private path(userId: string, appId: string): string {
        return join(this.usersDir, userId, 'magnetic', 'chats', `${appId}.json`);
    }

    async read(userId: string, appId: string): Promise<readonly ChatEntry[]> {
        return (await readJson<ChatEntry[]>(this.path(userId, appId))) ?? [];
    }

    append(userId: string, appId: string, entry: ChatEntry): Promise<void> {
        const path = this.path(userId, appId);
        const result = (this.writes.get(path) ?? Promise.resolve()).then(async () => {
            const entries = [...((await readJson<ChatEntry[]>(path)) ?? []), entry];
            await writeJsonAtomic(path, entries.slice(-KEEP));
        });
        this.writes.set(
            path,
            result.catch(() => undefined)
        );
        return result;
    }
}
