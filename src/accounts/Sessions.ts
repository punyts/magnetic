import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** How long a session lasts after sign-in */
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export interface Session {
    readonly userId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
}

/** The sessions file: the SHA-256 of each token → its session. A copy of the file opens no session */
type SessionsFile = Record<string, Session>;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** A session token is 32 random bytes in base64url: 43 characters */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Signed-in sessions. The token is 32 random bytes, sent only in the session cookie; the file keeps its hash, so the
 * file alone opens nothing. Expired sessions are dropped on the next write
 */
export class Sessions {
    private file: SessionsFile | undefined;
    private writes: Promise<void> = Promise.resolve();

    constructor(
        private readonly path: string,
        private readonly now: () => Date = () => new Date()
    ) {}

    private async load(): Promise<SessionsFile> {
        this.file ??= (await readJson<SessionsFile>(this.path)) ?? {};
        return this.file;
    }

    private change(update: (file: SessionsFile) => SessionsFile): Promise<void> {
        const result = this.writes.then(async () => {
            const now = this.now().getTime();
            const kept = Object.fromEntries(Object.entries(update(await this.load())).filter(([, session]) => Date.parse(session.expiresAt) > now));
            await writeJsonAtomic(this.path, kept);
            this.file = kept;
        });
        this.writes = result.catch(() => undefined);
        return result;
    }

    /** Starts a session for a user and returns its token, for the cookie */
    async start(userId: string): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const now = this.now();
        const session: Session = { userId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_MS).toISOString() };
        await this.change((file) => ({ ...file, [hashOf(token)]: session }));
        return token;
    }

    /** The live session of a token, or `undefined` for a token that is malformed, unknown or expired */
    async find(token: string | undefined): Promise<Session | undefined> {
        if (token === undefined || !TOKEN.test(token)) return undefined;
        const session = (await this.load())[hashOf(token)];
        if (session === undefined || Date.parse(session.expiresAt) <= this.now().getTime()) return undefined;
        return session;
    }

    /** Ends the session of a token; nothing happens for an unknown one */
    async end(token: string | undefined): Promise<void> {
        if (token === undefined || !TOKEN.test(token)) return;
        const hash = hashOf(token);
        await this.change(({ [hash]: _ended, ...rest }) => rest);
    }

    /** A key for the session of a token that is safe to keep in memory and logs: the token's hash */
    static keyOf(token: string): string {
        return hashOf(token);
    }
}
