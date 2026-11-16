import { randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';
import type { FeedbackKind } from '../feedback/Feedback.js';

/** Who may open the admin pages: people whose verified email is in the list (`MAGNETIC_ADMIN_EMAILS`) */
export class AdminList {
    private readonly emails: ReadonlySet<string>;

    constructor(
        private readonly db: Database,
        emails: readonly string[]
    ) {
        this.emails = new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email !== ''));
    }

    get any(): boolean {
        return this.emails.size > 0;
    }

    /** Whether the person is an admin: their email is verified and in the list */
    async is(userId: string): Promise<boolean> {
        if (this.emails.size === 0) return false;
        const row = (await this.db.query<{ email: string | null; email_verified: boolean }>('SELECT email, email_verified FROM app_user WHERE id::text = $1', [userId])).rows[0];
        return row !== undefined && row.email_verified && row.email !== null && this.emails.has(row.email.toLowerCase());
    }
}

/** The numbers on the admin overview */
export interface Overview {
    readonly people: number;
    readonly peopleThisWeek: number;
    readonly agentThisMonth: number;
    readonly agentToday: number;
    readonly paid: number;
    readonly given: number;
    readonly openFeedback: number;
}

/** One person on the admin People page, in the order they first signed in */
export interface PersonRow {
    /** 1 for the first person to sign in */
    readonly place: number;
    readonly id: string;
    readonly name: string;
    readonly email: string | null;
    readonly emailVerified: boolean;
    readonly createdAt: Date;
    readonly spent: number;
    readonly paid: number;
    readonly given: number;
    readonly lastAgentUse: Date | null;
}

/** One message on the admin Feedback page */
export interface FeedbackRow {
    readonly id: string;
    readonly kind: FeedbackKind;
    readonly text: string;
    readonly status: 'open' | 'done';
    readonly userId: string;
    readonly userName: string;
    readonly email: string | null;
    readonly appId: string | null;
    readonly appName: string | null;
    readonly context: Readonly<Record<string, string>>;
    readonly userAgent: string | null;
    readonly at: Date;
    readonly handledAt: Date | null;
}

export interface FeedbackFilter {
    readonly status?: 'open' | 'done';
    readonly kind?: FeedbackKind;
}

/** What the admin pages read and change, across every person: reached only through the database owner's view */
export class Admin {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    async overview(): Promise<Overview> {
        const now = this.now();
        const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const week = new Date(now.getTime() - 7 * 86_400_000);
        const row = (
            await this.db.query<{ people: number; week: number; month: string | null; today: string | null; paid: string | null; given: string | null; open: number }>(
                `SELECT (SELECT count(*)::int FROM app_user) AS people,
                        (SELECT count(*)::int FROM app_user WHERE created_at >= $1) AS week,
                        (SELECT sum(dollars) FROM agent_request WHERE at >= $2) AS month,
                        (SELECT sum(dollars) FROM agent_request WHERE at >= $3) AS today,
                        (SELECT sum(dollars) FROM agent_credit WHERE kind IN ('payment', 'refund')) AS paid,
                        (SELECT sum(dollars) FROM agent_credit WHERE kind = 'gift') AS given,
                        (SELECT count(*)::int FROM feedback WHERE status = 'open') AS open`,
                [week, month, day]
            )
        ).rows[0];
        return {
            people: row?.people ?? 0,
            peopleThisWeek: row?.week ?? 0,
            agentThisMonth: Number(row?.month ?? 0),
            agentToday: Number(row?.today ?? 0),
            paid: Number(row?.paid ?? 0),
            given: Number(row?.given ?? 0),
            openFeedback: row?.open ?? 0
        };
    }

    /** Everyone, in the order they first signed in (the order the allowance goes by) */
    async people(): Promise<PersonRow[]> {
        const rows = (
            await this.db.query<{ place: string; id: string; name: string; email: string | null; email_verified: boolean; created_at: Date; spent: string | null; paid: string | null; given: string | null; last: Date | null }>(
                `SELECT row_number() OVER (ORDER BY u.created_at, u.id) AS place, u.id::text AS id, u.name, u.email, u.email_verified, u.created_at,
                        r.spent, r.last, c.paid, c.given
                   FROM app_user u
                   LEFT JOIN (SELECT user_id, sum(dollars) AS spent, max(at) AS last FROM agent_request GROUP BY user_id) r ON r.user_id = u.id
                   LEFT JOIN (SELECT user_id, sum(dollars) FILTER (WHERE kind IN ('payment', 'refund')) AS paid, sum(dollars) FILTER (WHERE kind = 'gift') AS given FROM agent_credit GROUP BY user_id) c ON c.user_id = u.id
                  ORDER BY u.created_at, u.id`
            )
        ).rows;
        return rows.map((row) => ({
            place: Number(row.place),
            id: row.id,
            name: row.name,
            email: row.email,
            emailVerified: row.email_verified,
            createdAt: new Date(row.created_at),
            spent: Number(row.spent ?? 0),
            paid: Math.max(0, Number(row.paid ?? 0)),
            given: Number(row.given ?? 0),
            lastAgentUse: row.last === null ? null : new Date(row.last)
        }));
    }

    /** Whether a person exists */
    async personName(userId: string): Promise<string | undefined> {
        return (await this.db.query<{ name: string }>('SELECT name FROM app_user WHERE id::text = $1', [userId])).rows[0]?.name;
    }

    /** Gives a person agent use, with a note of why */
    async give(input: { readonly userId: string; readonly dollars: number; readonly note: string; readonly by: string }): Promise<void> {
        const id = randomUUID();
        await this.db.query(
            `INSERT INTO agent_credit (id, user_id, kind, dollars, provider, provider_ref, note, given_by, at) VALUES ($1, $2, 'gift', $3, 'admin', $4, $5, $6, $7)`,
            [id, input.userId, input.dollars, `gift:${id}`, input.note, input.by, this.now()]
        );
    }

    /** The feedback, the newest first, up to 200 */
    async feedback(filter: FeedbackFilter = {}): Promise<FeedbackRow[]> {
        const where: string[] = [];
        const values: unknown[] = [];
        if (filter.status !== undefined) where.push(`f.status = $${values.push(filter.status)}`);
        if (filter.kind !== undefined) where.push(`f.kind = $${values.push(filter.kind)}`);
        const rows = (
            await this.db.query<{ id: string; kind: FeedbackKind; text: string; status: 'open' | 'done'; user_id: string; name: string; email: string | null; app_id: string | null; app_name: string | null; context: Record<string, string>; user_agent: string | null; at: Date; handled_at: Date | null }>(
                `SELECT f.id::text AS id, f.kind, f.text, f.status, f.user_id::text AS user_id, u.name, u.email, f.app_id::text AS app_id, f.app_name, f.context, f.user_agent, f.at, f.handled_at
                   FROM feedback f JOIN app_user u ON u.id = f.user_id
                  ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
                  ORDER BY f.at DESC LIMIT 200`,
                values
            )
        ).rows;
        return rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            text: row.text,
            status: row.status,
            userId: row.user_id,
            userName: row.name,
            email: row.email,
            appId: row.app_id,
            appName: row.app_name,
            context: row.context,
            userAgent: row.user_agent,
            at: new Date(row.at),
            handledAt: row.handled_at === null ? null : new Date(row.handled_at)
        }));
    }

    /** Marks a message done or open again; false when there is no such message */
    async setFeedbackStatus(id: string, status: 'open' | 'done', by: string): Promise<boolean> {
        const changed = await this.db.query(
            "UPDATE feedback SET status = $2, handled_by = CASE WHEN $2 = 'done' THEN $3::uuid END, handled_at = CASE WHEN $2 = 'done' THEN $4::timestamptz END WHERE id::text = $1",
            [id, status, by, this.now()]
        );
        return (changed.rowCount ?? 0) > 0;
    }
}
