import { randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

/** What a person can send from the editor's bug button */
export const FEEDBACK_KINDS = ['bug', 'comment', 'feature'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The longest a message may be, in characters */
export const MAX_FEEDBACK_LENGTH = 4000;
/** How many messages one person may send in an hour */
export const FEEDBACK_PER_HOUR = 20;

export interface FeedbackInput {
    readonly userId: string;
    readonly kind: FeedbackKind;
    readonly text: string;
    readonly workspaceId?: string;
    readonly appId?: string;
    readonly appName?: string;
    readonly context?: Readonly<Record<string, string>>;
    readonly userAgent?: string;
}

/** One message, as the operator reads it */
export interface FeedbackEntry {
    readonly id: string;
    readonly kind: FeedbackKind;
    readonly text: string;
    readonly userId: string;
    readonly userName: string;
    readonly email: string | null;
    readonly appId: string | null;
    readonly appName: string | null;
    readonly context: Readonly<Record<string, string>>;
    readonly userAgent: string | null;
    readonly at: Date;
}

/** Bugs, comments and feature requests sent from the editor (`feedback`, docs/design/magnetic-feedback.md) */
export class Feedback {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** How many the person sent in the last hour */
    async sentLastHour(userId: string): Promise<number> {
        const since = new Date(this.now().getTime() - 3_600_000);
        return (await this.db.query<{ sent: number }>('SELECT count(*)::int AS sent FROM feedback WHERE user_id = $1 AND at > $2', [userId, since])).rows[0]?.sent ?? 0;
    }

    /** Keeps a message; its id */
    async add(input: FeedbackInput): Promise<string> {
        const id = randomUUID();
        await this.db.query(
            'INSERT INTO feedback (id, user_id, kind, text, workspace_id, app_id, app_name, context, user_agent, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
            [id, input.userId, input.kind, input.text, input.workspaceId ?? null, input.appId ?? null, input.appName ?? null, JSON.stringify(input.context ?? {}), input.userAgent?.slice(0, 400) ?? null, this.now()]
        );
        return id;
    }

    /** The latest messages, the newest first, with who sent them */
    async latest(limit = 50): Promise<FeedbackEntry[]> {
        const rows = (
            await this.db.query<{ id: string; kind: FeedbackKind; text: string; user_id: string; name: string; email: string | null; app_id: string | null; app_name: string | null; context: Record<string, string>; user_agent: string | null; at: Date }>(
                `SELECT f.id, f.kind, f.text, f.user_id, u.name, u.email, f.app_id, f.app_name, f.context, f.user_agent, f.at
                   FROM feedback f JOIN app_user u ON u.id = f.user_id
                  ORDER BY f.at DESC LIMIT $1`,
                [limit]
            )
        ).rows;
        return rows.map((row) => ({ id: row.id, kind: row.kind, text: row.text, userId: row.user_id, userName: row.name, email: row.email, appId: row.app_id, appName: row.app_name, context: row.context, userAgent: row.user_agent, at: row.at }));
    }
}
