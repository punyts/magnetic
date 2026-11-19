import type { Database } from '@punyts/stateui-pg';

/** What a person said to an app shared with them; an app with no answer waits */
export type ShareAnswer = 'accepted' | 'rejected';

/**
 * Each person's answers to the apps shared with them (`share_answer`, docs/design/magnetic-home.md). Accepting puts the
 * app among theirs on Your apps; rejecting takes it off, and drops them from its links, so the app opens for them
 * again only through a link opened anew (`Grants.join` then forgets the rejection and the app waits again)
 */
export class ShareAnswers {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** The person's answers, by app id */
    async of(userId: string): Promise<Map<string, ShareAnswer>> {
        const rows = (await this.db.query<{ app_id: string; answer: ShareAnswer }>('SELECT app_id, answer FROM share_answer WHERE user_id = $1', [userId])).rows;
        return new Map(rows.map((row) => [row.app_id, row.answer]));
    }

    /** Keeps an app shared with the person among their apps */
    async accept(userId: string, appId: string): Promise<void> {
        await this.answer(userId, appId, 'accepted');
    }

    /** Takes an app shared with the person off their apps, and them off its links */
    async reject(userId: string, appId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            await tx.query('DELETE FROM link_grant_member m USING link_grant g WHERE g.id = m.grant_id AND m.user_id = $1 AND g.app_id::text = $2', [userId, appId]);
            await tx.query(
                `INSERT INTO share_answer (user_id, app_id, answer, answered_at) VALUES ($1, $2, 'rejected', $3)
                 ON CONFLICT (user_id, app_id) DO UPDATE SET answer = 'rejected', answered_at = $3`,
                [userId, appId, this.now()]
            );
        });
    }

    private async answer(userId: string, appId: string, answer: ShareAnswer): Promise<void> {
        await this.db.query(
            `INSERT INTO share_answer (user_id, app_id, answer, answered_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, app_id) DO UPDATE SET answer = $3, answered_at = $4`,
            [userId, appId, answer, this.now()]
        );
    }
}
