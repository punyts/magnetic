import { randomBytes, randomUUID } from 'node:crypto';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/**
 * What a share link gives the person who opens it:
 * - `view`: the owner's app, live and read only;
 * - `use`: their own instance of the app, so they can type into it and keep their own data;
 * - `remix`: a copy of the app in their own workspace, theirs to change
 */
export type GrantRight = 'view' | 'use' | 'remix';

export const GRANT_RIGHTS: readonly GrantRight[] = ['use', 'view', 'remix'];

/** A right on one app given to anyone with the link. Signing in is still needed, so every visit has a user behind it */
export interface Grant {
    readonly id: string;
    /** The random token in the link, 24 bytes in base64url */
    readonly token: string;
    readonly ownerId: string;
    readonly appId: string;
    /** The app's name when the link was made, for the pages of people who open it */
    readonly appName: string;
    readonly right: GrantRight;
    readonly createdAt: string;
    readonly revokedAt?: string;
    /** The people who opened the link, by user id, with when they first did */
    readonly members: Readonly<Record<string, string>>;
}

/** What a person may do with an app that is not theirs, through the links they opened */
export type SharedAccess = { readonly live: Grant & { readonly right: 'view' | 'use' } } | { readonly revoked: Grant & { readonly right: 'view' | 'use' } };

/** The grants file: each grant by its id */
type GrantsFile = Record<string, Grant>;

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** Whether a grant shows the app (`view` or `use`); a remix link gives only a copy */
function shows(grant: Grant): grant is Grant & { readonly right: 'view' | 'use' } {
    return grant.right === 'view' || grant.right === 'use';
}

/**
 * The share links of every app, in one file. A revoked grant is kept, so the people who opened it can be told, and
 * their browsers can delete what they kept of the app, when they come back
 */
export class Grants {
    private file: GrantsFile | undefined;
    private writes: Promise<void> = Promise.resolve();

    constructor(
        private readonly path: string,
        private readonly now: () => Date = () => new Date()
    ) {}

    private async load(): Promise<GrantsFile> {
        this.file ??= (await readJson<GrantsFile>(this.path)) ?? {};
        return this.file;
    }

    private change<T>(update: (file: GrantsFile) => { file: GrantsFile; result: T }): Promise<T> {
        const result = this.writes.then(async () => {
            const next = update(await this.load());
            if (next.file !== this.file) {
                await writeJsonAtomic(this.path, next.file);
                this.file = next.file;
            }
            return next.result;
        });
        this.writes = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    /** A new link to the app */
    create(ownerId: string, app: { readonly id: string; readonly name: string }, right: GrantRight): Promise<Grant> {
        const grant: Grant = { id: randomUUID(), token: randomBytes(24).toString('base64url'), ownerId, appId: app.id, appName: app.name, right, createdAt: this.now().toISOString(), members: {} };
        return this.change((file) => ({ file: { ...file, [grant.id]: grant }, result: grant }));
    }

    /** The grant of a link's token, revoked or not; `undefined` for a token that is malformed or unknown */
    async byToken(token: string): Promise<Grant | undefined> {
        if (!TOKEN.test(token)) return undefined;
        return Object.values(await this.load()).find((grant) => grant.token === token);
    }

    /** The links of one of the owner's apps, the newest first, revoked ones included */
    async forApp(ownerId: string, appId: string): Promise<Grant[]> {
        return Object.values(await this.load())
            .filter((grant) => grant.ownerId === ownerId && grant.appId === appId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /** Records that a person opened a live link; the owner is never a member of their own app */
    join(grantId: string, userId: string): Promise<Grant | undefined> {
        return this.change((file) => {
            const grant = file[grantId];
            if (grant === undefined || grant.revokedAt !== undefined || grant.ownerId === userId || grant.members[userId] !== undefined) return { file, result: grant };
            const joined: Grant = { ...grant, members: { ...grant.members, [userId]: this.now().toISOString() } };
            return { file: { ...file, [grantId]: joined }, result: joined };
        });
    }

    /** Revokes one of the owner's links; `undefined` when the owner has no such link */
    revoke(ownerId: string, grantId: string): Promise<Grant | undefined> {
        return this.change((file) => {
            const grant = file[grantId];
            if (grant === undefined || grant.ownerId !== ownerId) return { file, result: undefined };
            if (grant.revokedAt !== undefined) return { file, result: grant };
            const revoked: Grant = { ...grant, revokedAt: this.now().toISOString() };
            return { file: { ...file, [grantId]: revoked }, result: revoked };
        });
    }

    /**
     * What a person may do with an app that is not theirs: `use` before `view` among the live links they opened; else
     * a revoked one they had opened, so their browser can be told; else nothing
     */
    async access(appId: string, userId: string): Promise<SharedAccess | undefined> {
        const opened = Object.values(await this.load()).filter((grant): grant is Grant & { readonly right: 'view' | 'use' } => grant.appId === appId && grant.members[userId] !== undefined && shows(grant));
        const live = opened.filter((grant) => grant.revokedAt === undefined);
        const best = live.find((grant) => grant.right === 'use') ?? live[0];
        if (best !== undefined) return { live: best };
        const revoked = opened.sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''))[0];
        return revoked === undefined ? undefined : { revoked };
    }

    /** The apps shared with a person through live links they opened, one entry per app (`use` before `view`) */
    async sharedWith(userId: string): Promise<Grant[]> {
        const byApp = new Map<string, Grant>();
        for (const grant of Object.values(await this.load())) {
            if (grant.revokedAt !== undefined || grant.members[userId] === undefined || !shows(grant)) continue;
            const known = byApp.get(grant.appId);
            if (known === undefined || (known.right === 'view' && grant.right === 'use')) byApp.set(grant.appId, grant);
        }
        return [...byApp.values()].sort((a, b) => a.appName.localeCompare(b.appName));
    }
}
