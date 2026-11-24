import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '@punyts/stateui-pg';

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

/** The identity of an account that signs in with links sent to its address; its subject is the address, lower case */
export const EMAIL_PROVIDER = 'email';

/** What a provider tells about the person when they sign in */
export interface Profile {
    readonly name: string;
    readonly email?: string;
    /** Whether the provider says it checked the email; only a verified email may later join an org by its domain */
    readonly emailVerified?: boolean;
    readonly picture?: string;
}

interface UserRow {
    id: string;
    name: string;
    email: string | null;
    picture: string | null;
    created_at: Date;
}

export function userOf(row: UserRow): User {
    return {
        id: row.id,
        name: row.name,
        ...(row.email !== null && { email: row.email }),
        ...(row.picture !== null && { picture: row.picture }),
        createdAt: row.created_at.toISOString()
    };
}

/**
 * The users and their sign-in identities (`app_user`, `identity`). An identity is not the user: a user id is a UUID
 * that owns everything, and each identity maps to one, so a second provider can be linked to the same person later
 */
export class Accounts {
    constructor(private readonly db: Database) {}

    /** The user with this id, if there is one */
    async user(id: string): Promise<User | undefined> {
        const row = (await this.db.query<UserRow>('SELECT id, name, email, picture, created_at FROM app_user WHERE id = $1', [id])).rows[0];
        return row === undefined ? undefined : userOf(row);
    }

    /** The users with these ids, by id */
    async users(ids: readonly string[]): Promise<Map<string, User>> {
        if (ids.length === 0) return new Map();
        const rows = (await this.db.query<UserRow>('SELECT id, name, email, picture, created_at FROM app_user WHERE id = ANY($1::uuid[])', [ids])).rows;
        return new Map(rows.map((row) => [row.id, userOf(row)]));
    }

    /**
     * The user an identity signs in as. The first sign-in makes the user from the profile; a later one refreshes the
     * name, email and picture the provider gives. Two first sign-ins of one identity at once make one user. `orgId` marks
     * an identity of an org's own provider
     */
    async signIn(identity: Identity, profile: Profile, orgId?: string): Promise<User> {
        const name = profile.name.slice(0, 200);
        const email = profile.email?.slice(0, 320) ?? null;
        const picture = profile.picture?.slice(0, 2000) ?? null;
        const verified = profile.email !== undefined && profile.emailVerified === true;
        return this.db.transaction(async (tx) => {
            // Lock the identity, so two first sign-ins of it at once wait for each other
            await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`identity:${identity.provider}:${identity.subject}`]);
            const existing = (await tx.query<{ user_id: string }>('SELECT user_id FROM identity WHERE provider = $1 AND subject = $2', [identity.provider, identity.subject])).rows[0];
            if (existing !== undefined) {
                const row = (
                    await tx.query<UserRow>(
                        'UPDATE app_user SET name = $2, email = $3, email_verified = $4, picture = $5 WHERE id = $1 RETURNING id, name, email, picture, created_at',
                        [existing.user_id, name, email, verified, picture]
                    )
                ).rows[0];
                if (row !== undefined) return userOf(row);
            }
            // A first sign-in whose provider checked the email joins the account that has it verified already, such as
            // one made by an invite: one person, one account (docs/design/magnetic-orgs-and-invites.md)
            const same = !verified || email === null ? undefined : (await tx.query<UserRow>('SELECT id, name, email, picture, created_at FROM app_user WHERE lower(email) = lower($1) AND email_verified ORDER BY created_at, id LIMIT 1', [email])).rows[0];
            if (same !== undefined) {
                await tx.query('INSERT INTO identity (provider, subject, user_id, org_id) VALUES ($1, $2, $3, $4)', [identity.provider, identity.subject, same.id, orgId ?? null]);
                return userOf(same);
            }
            return this.create(tx, identity, { name, email, verified, picture }, orgId);
        });
    }

    /**
     * The account an email address signs in as, once the person proved they hold the address (an invite or sign-in link
     * that came to it): the account of its `email` identity; else the oldest account that has the address verified,
     * which gets that identity; else a new account with the address verified. Never one that has it unverified
     * (docs/design/magnetic-orgs-and-invites.md). `name` names a new account, and renames one when given
     */
    async signInByEmail(email: string, name?: string): Promise<User> {
        const address = email.trim().toLowerCase().slice(0, 320);
        const given = name?.trim().slice(0, 200) ?? '';
        const identity: Identity = { provider: EMAIL_PROVIDER, subject: address };
        return this.db.transaction(async (tx) => {
            await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`identity:${identity.provider}:${identity.subject}`]);
            const userId =
                (await tx.query<{ user_id: string }>('SELECT user_id FROM identity WHERE provider = $1 AND subject = $2', [identity.provider, identity.subject])).rows[0]?.user_id ??
                (await tx.query<{ id: string }>('SELECT id FROM app_user WHERE lower(email) = $1 AND email_verified ORDER BY created_at, id LIMIT 1', [address])).rows[0]?.id;
            if (userId === undefined) return this.create(tx, identity, { name: given === '' ? (address.split('@')[0] as string) : given, email: address, verified: true, picture: null });
            await tx.query('INSERT INTO identity (provider, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING', [identity.provider, identity.subject, userId]);
            const row = (
                await tx.query<UserRow>(
                    'UPDATE app_user SET email = $2, email_verified = true, name = CASE WHEN $3 = \'\' THEN name ELSE $3 END WHERE id = $1 RETURNING id, name, email, picture, created_at',
                    [userId, address, given]
                )
            ).rows[0] as UserRow;
            return userOf(row);
        });
    }

    /** The account whose verified email this is, for a sign-in link; the same account `signInByEmail` would find */
    async byVerifiedEmail(email: string): Promise<User | undefined> {
        const address = email.trim().toLowerCase();
        const row = (
            await this.db.query<UserRow>(
                `SELECT u.id, u.name, u.email, u.picture, u.created_at FROM app_user u
                  WHERE u.id = coalesce((SELECT user_id FROM identity WHERE provider = $2 AND subject = $1),
                                        (SELECT id FROM app_user WHERE lower(email) = $1 AND email_verified ORDER BY created_at, id LIMIT 1))`,
                [address, EMAIL_PROVIDER]
            )
        ).rows[0];
        return row === undefined ? undefined : userOf(row);
    }

    private async create(tx: Queryable, identity: Identity, profile: { name: string; email: string | null; verified: boolean; picture: string | null }, orgId?: string): Promise<User> {
        const row = (
            await tx.query<UserRow>(
                'INSERT INTO app_user (id, name, email, email_verified, picture) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, picture, created_at',
                [randomUUID(), profile.name, profile.email, profile.verified, profile.picture]
            )
        ).rows[0] as UserRow;
        await tx.query('INSERT INTO identity (provider, subject, user_id, org_id) VALUES ($1, $2, $3, $4) ON CONFLICT (provider, subject) DO UPDATE SET user_id = EXCLUDED.user_id', [identity.provider, identity.subject, row.id, orgId ?? null]);
        return userOf(row);
    }
}
