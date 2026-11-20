import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

/** How long a sign-in link for another device lasts */
export const DEVICE_LINK_MINUTES = 10;
const DEVICE_LINK_MS = DEVICE_LINK_MINUTES * 60 * 1000;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** A link token is 32 random bytes in base64url: 43 characters */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Sign-in links for another device (`device_link`; docs/design/statenet-network.md, S10): a signed-in person makes
 * one, and opening it on another device and confirming signs that device in as them. Each works once and for
 * `DEVICE_LINK_MINUTES`; the table keeps only the token's hash, and expired ones are deleted as new ones are made
 */
export class DeviceLinks {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** Makes a link for a user and returns its token */
    async make(userId: string): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const now = this.now();
        await this.db.query('DELETE FROM device_link WHERE expires_at <= $1', [now]);
        await this.db.query('INSERT INTO device_link (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [hashOf(token), userId, now, new Date(now.getTime() + DEVICE_LINK_MS)]);
        return token;
    }

    /** The user a live link signs in as, without using it: for the page that asks to confirm */
    async peek(token: string | undefined): Promise<string | undefined> {
        if (token === undefined || !TOKEN.test(token)) return undefined;
        return (await this.db.query<{ user_id: string }>('SELECT user_id FROM device_link WHERE token_hash = $1 AND expires_at > $2', [hashOf(token), this.now()])).rows[0]?.user_id;
    }

    /** Uses a live link: the user it signs in as, once; `undefined` for one malformed, unknown, used or expired */
    async use(token: string | undefined): Promise<string | undefined> {
        if (token === undefined || !TOKEN.test(token)) return undefined;
        return (await this.db.query<{ user_id: string }>('DELETE FROM device_link WHERE token_hash = $1 AND expires_at > $2 RETURNING user_id', [hashOf(token), this.now()])).rows[0]?.user_id;
    }
}
