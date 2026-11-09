import { randomUUID } from 'node:crypto';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** A person on the statenet: the owner of their apps and state. Sign-in identities point at one */
export interface User {
    readonly id: string;
    readonly name: string;
    readonly email?: string;
    readonly picture?: string;
    readonly createdAt: string;
}

/** Who a provider says someone is: the provider's name and its stable id of them (OIDC `sub`) */
export interface Identity {
    readonly provider: string;
    readonly subject: string;
}

/** What a provider tells about the person when they sign in */
export interface Profile {
    readonly name: string;
    readonly email?: string;
    readonly picture?: string;
}

interface AccountsFile {
    users: Record<string, User>;
    /** `<provider>:<subject>` → user id */
    identities: Record<string, string>;
}

const identityKey = (identity: Identity): string => `${identity.provider}:${identity.subject}`;

/**
 * The users and their sign-in identities, in one JSON file written atomically, one write at a time. An identity is
 * not the user: a user id is a UUID that owns everything, and each identity maps to one, so a second provider can be
 * linked to the same person later
 */
export class Accounts {
    private file: AccountsFile | undefined;
    private writes: Promise<void> = Promise.resolve();

    constructor(private readonly path: string) {}

    private async load(): Promise<AccountsFile> {
        this.file ??= (await readJson<AccountsFile>(this.path)) ?? { users: {}, identities: {} };
        return this.file;
    }

    /** The user with this id, if there is one */
    async user(id: string): Promise<User | undefined> {
        return (await this.load()).users[id];
    }

    /**
     * The user an identity signs in as. The first sign-in makes the user from the profile; a later one refreshes the
     * name, email and picture the provider gives
     */
    signIn(identity: Identity, profile: Profile): Promise<User> {
        const result = this.writes.then(async () => {
            const file = await this.load();
            const key = identityKey(identity);
            const existing = file.identities[key];
            const base = existing === undefined ? undefined : file.users[existing];
            const user: User = {
                id: base?.id ?? randomUUID(),
                name: profile.name.slice(0, 200),
                ...(profile.email !== undefined && { email: profile.email.slice(0, 320) }),
                ...(profile.picture !== undefined && { picture: profile.picture.slice(0, 2000) }),
                createdAt: base?.createdAt ?? new Date().toISOString()
            };
            const next: AccountsFile = { users: { ...file.users, [user.id]: user }, identities: { ...file.identities, [key]: user.id } };
            await writeJsonAtomic(this.path, next);
            this.file = next;
            return user;
        });
        this.writes = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }
}
