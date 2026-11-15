import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

/** How long a session lasts after sign-in */
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** How often expired sessions are swept away */
const SWEEP_MS = 60 * 60 * 1000;

export interface Session {
    readonly userId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
}

const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** A session token is 32 random bytes in base64url: 43 characters */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Signed-in sessions (`session`). The token is 32 random bytes, sent only in the session cookie; the table keeps its
 * hash, so the table alone opens nothing. Expired sessions are never found, and are deleted by a sweep at most hourly
 */
export class Sessions {
    private lastSweep = 0;

    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    private async sweep(): Promise<void> {
        const now = this.now();
        if (now.getTime() - this.lastSweep < SWEEP_MS) return;
        this.lastSweep = now.getTime();
        await this.db.query('DELETE FROM session WHERE expires_at <= $1', [now]);
    }

    /** Starts a session for a user and returns its token, for the cookie */
    async start(userId: string): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const now = this.now();
        await this.db.query('INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [hashOf(token), userId, now, new Date(now.getTime() + SESSION_MS)]);
        await this.sweep();
        return token;
    }

    /** The live session of a token, or `undefined` for a token that is malformed, unknown or expired */
    async find(token: string | undefined): Promise<Session | undefined> {
        if (token === undefined || !TOKEN.test(token)) return undefined;
        const row = (await this.db.query<{ user_id: string; created_at: Date; expires_at: Date }>('SELECT user_id, created_at, expires_at FROM session WHERE token_hash = $1 AND expires_at > $2', [hashOf(token), this.now()])).rows[0];
        if (row === undefined) return undefined;
        return { userId: row.user_id, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() };
    }

    /** Ends the session of a token; nothing happens for an unknown one */
    async end(token: string | undefined): Promise<void> {
        if (token === undefined || !TOKEN.test(token)) return;
        await this.db.query('DELETE FROM session WHERE token_hash = $1', [hashOf(token)]);
    }

    /** Ends every session of a user, such as one removed from everything; returns the keys (`keyOf`) of those ended */
    async endAll(userId: string): Promise<string[]> {
        return (await this.db.query<{ token_hash: string }>('DELETE FROM session WHERE user_id = $1 RETURNING token_hash', [userId])).rows.map((row) => row.token_hash);
    }

    /** A key for the session of a token that is safe to keep in memory and logs: the token's hash */
    static keyOf(token: string): string {
        return hashOf(token);
    }
}
