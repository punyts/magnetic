import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

/** How long the person has to allow an agent, and the agent to trade its code, after the ask */
export const AGENT_ASK_MINUTES = 10;
/** How long an agent's access token lasts */
export const AGENT_ACCESS_SECONDS = 60 * 60;
/** How long an agent's refresh token lasts, never past the session that allowed it */
export const AGENT_REFRESH_DAYS = 30;
const ASK_MS = AGENT_ASK_MINUTES * 60 * 1000;
const ACCESS_MS = AGENT_ACCESS_SECONDS * 1000;
const REFRESH_MS = AGENT_REFRESH_DAYS * 24 * 60 * 60 * 1000;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');
const newToken = (): string => randomBytes(32).toString('base64url');

/** Every token here is 32 random bytes in base64url: 43 characters. A PKCE verifier is 43 to 128 of its characters */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** The longest `state` an agent may send, returned as it is */
const MAX_STATE = 200;

/** What an agent asks for: where to send the code, the PKCE challenge (S256) and its `state` */
export interface AgentAsk {
    readonly redirectUri: string;
    readonly challenge: string;
    readonly state: string;
}

/** The tokens an agent gets, as the token endpoint answers them */
export interface AgentTokenPair {
    readonly accessToken: string;
    readonly refreshToken: string;
    /** Seconds the access token lasts */
    readonly expiresIn: number;
}

/**
 * Whether a redirect URI is one an agent on the person's own computer listens on (RFC 8252): `http` to 127.0.0.1 or
 * [::1] with a port, no user, query or fragment
 */
export function isLoopbackRedirect(text: string): boolean {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return false;
    }
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]') && url.port !== '' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && text.length <= 200;
}

/** Checks an ask's parts: a loopback redirect, an S256 challenge and a short `state` */
export function isAgentAsk(ask: { readonly redirectUri: string; readonly challenge: string; readonly state: string }): boolean {
    return isLoopbackRedirect(ask.redirectUri) && TOKEN.test(ask.challenge) && ask.state.length <= MAX_STATE;
}

/**
 * Agents signed in as a person (`agent_code`, `agent_token`; docs/design/statenet-network.md, S10b). The person, signed
 * in in a browser, sees an ask and allows it; the agent trades the code with its PKCE verifier for an access token
 * (an hour) and a refresh token (used once, 30 days). Everything hangs on the browser session that allowed it, so
 * ending that session ends the agent's access. Only hashes are kept
 */
export class AgentTokens {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** Records an ask the person is shown, from their session (its key, `Sessions.keyOf`); returns its id for the page */
    async ask(userId: string, sessionKey: string, ask: AgentAsk): Promise<string> {
        if (!isAgentAsk(ask)) throw new Error('Not an ask an agent may make');
        const id = newToken();
        const now = this.now();
        await this.db.query('DELETE FROM agent_code WHERE expires_at <= $1', [now]);
        await this.db.query('INSERT INTO agent_code (request_hash, user_id, session_hash, challenge, redirect_uri, state, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [hashOf(id), userId, sessionKey, ask.challenge, ask.redirectUri, ask.state, new Date(now.getTime() + ASK_MS)]);
        return id;
    }

    /**
     * The person allows an ask, from the session it was shown in: where to send the agent, with its code. Once only;
     * `undefined` for an ask that is unknown, expired, already allowed or another session's
     */
    async allow(id: string | undefined, sessionKey: string): Promise<{ readonly redirectUri: string; readonly code: string; readonly state: string } | undefined> {
        if (id === undefined || !TOKEN.test(id)) return undefined;
        const code = newToken();
        const row = (
            await this.db.query<{ redirect_uri: string; state: string }>(
                'UPDATE agent_code SET code_hash = $1 WHERE request_hash = $2 AND session_hash = $3 AND code_hash IS NULL AND expires_at > $4 RETURNING redirect_uri, state',
                [hashOf(code), hashOf(id), sessionKey, this.now()]
            )
        ).rows[0];
        return row === undefined ? undefined : { redirectUri: row.redirect_uri, code, state: row.state };
    }

    /**
     * Trades a code for tokens: once, with the verifier of its challenge and the redirect URI it was sent to, while its
     * session lasts. `undefined` for anything else
     */
    async exchange(code: string | undefined, verifier: string | undefined, redirectUri: string | undefined): Promise<AgentTokenPair | undefined> {
        if (code === undefined || verifier === undefined || redirectUri === undefined || !TOKEN.test(code) || !VERIFIER.test(verifier)) return undefined;
        const now = this.now();
        const row = (
            await this.db.query<{ user_id: string; session_hash: string; challenge: string; redirect_uri: string; session_expires: Date | null }>(
                `DELETE FROM agent_code c WHERE code_hash = $1 AND c.expires_at > $2
                 RETURNING user_id, session_hash, challenge, redirect_uri, (SELECT s.expires_at FROM session s WHERE s.token_hash = c.session_hash AND s.expires_at > $2) AS session_expires`,
                [hashOf(code), now]
            )
        ).rows[0];
        if (row === undefined || row.session_expires === null) return undefined;
        if (row.redirect_uri !== redirectUri || hashOf(verifier) !== row.challenge) return undefined;
        return this.issue(row.user_id, row.session_hash, row.session_expires);
    }

    /** Trades a refresh token for a new pair; the old pair stops working. `undefined` once it is used, expired or its session ended */
    async refresh(refreshToken: string | undefined): Promise<AgentTokenPair | undefined> {
        if (refreshToken === undefined || !TOKEN.test(refreshToken)) return undefined;
        const now = this.now();
        const row = (
            await this.db.query<{ user_id: string; session_hash: string; session_expires: Date | null }>(
                `DELETE FROM agent_token t WHERE refresh_hash = $1 AND t.refresh_expires_at > $2
                 RETURNING user_id, session_hash, (SELECT s.expires_at FROM session s WHERE s.token_hash = t.session_hash AND s.expires_at > $2) AS session_expires`,
                [hashOf(refreshToken), now]
            )
        ).rows[0];
        if (row === undefined || row.session_expires === null) return undefined;
        return this.issue(row.user_id, row.session_hash, row.session_expires);
    }

    /** The person an access token acts as, while it and its session last */
    async find(accessToken: string | undefined): Promise<{ readonly userId: string } | undefined> {
        if (accessToken === undefined || !TOKEN.test(accessToken)) return undefined;
        const now = this.now();
        const row = (
            await this.db.query<{ user_id: string }>(
                'SELECT t.user_id FROM agent_token t JOIN session s ON s.token_hash = t.session_hash WHERE t.access_hash = $1 AND t.access_expires_at > $2 AND s.expires_at > $2',
                [hashOf(accessToken), now]
            )
        ).rows[0];
        return row === undefined ? undefined : { userId: row.user_id };
    }

    private async issue(userId: string, sessionKey: string, sessionExpires: Date): Promise<AgentTokenPair> {
        const accessToken = newToken();
        const refreshToken = newToken();
        const now = this.now();
        const refreshEnds = new Date(Math.min(now.getTime() + REFRESH_MS, sessionExpires.getTime()));
        await this.db.query('DELETE FROM agent_token WHERE refresh_expires_at <= $1', [now]);
        await this.db.query(
            'INSERT INTO agent_token (access_hash, refresh_hash, user_id, session_hash, created_at, access_expires_at, refresh_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [hashOf(accessToken), hashOf(refreshToken), userId, sessionKey, now, new Date(Math.min(now.getTime() + ACCESS_MS, refreshEnds.getTime())), refreshEnds]
        );
        return { accessToken, refreshToken, expiresIn: Math.max(1, Math.floor((Math.min(now.getTime() + ACCESS_MS, refreshEnds.getTime()) - now.getTime()) / 1000)) };
    }
}
