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
            return this.create(tx, identity, { name, email, verified, picture }, orgId);
        });
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
