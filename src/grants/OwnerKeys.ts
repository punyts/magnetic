import { randomUUID } from 'node:crypto';
import { generateGrantKey, readGrant } from '@punyts/state-sync/authority';
import type { GrantKey } from '@punyts/state-sync/authority';
import type { Database } from '@punyts/stateui-pg';
import type { SecretBox } from '../auth/secrets.js';

/** A key that signs: its id and its private part (PKCS#8 DER, base64url) */
export interface SigningKey {
    readonly kid: string;
    readonly privateKey: string;
}

/**
 * One Ed25519 signing key per owner (docs/design/statenet-relays.md, "Keys"), every one held by Magnetic: the owner as
 * an address names it, a user's id or a workspace's. A private key is kept sealed with the server's key
 * (`MAGNETIC_SECRET_KEY`) and opened only to sign. A key is made the first time its owner signs; `rotate` makes a new
 * one, after which the old one verifies only the grants it signed before
 */
export class OwnerKeys {
    private readonly known = new Map<string, GrantKey>();

    constructor(
        private readonly db: Database,
        private readonly box: SecretBox | undefined
    ) {}

    /** Whether the server can sign: it needs `MAGNETIC_SECRET_KEY` to keep private keys */
    get available(): boolean {
        return this.box !== undefined;
    }

    /** The owner's current signing key, made when it has none */
    async signing(ownerId: string): Promise<SigningKey> {
        const box = this.requireBox();
        const row = (await this.db.query<{ kid: string; private_key: string }>('SELECT kid, private_key FROM owner_key WHERE owner_id = $1 AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1', [ownerId])).rows[0];
        if (row !== undefined) return { kid: row.kid, privateKey: box.open(row.private_key) };
        return this.create(ownerId);
    }

    /** Retires the owner's current key and makes a new one; grants the old one signed verify until they expire */
    async rotate(ownerId: string): Promise<string> {
        this.requireBox();
        await this.db.query('UPDATE owner_key SET retired_at = now() WHERE owner_id = $1 AND retired_at IS NULL', [ownerId]);
        for (const [kid, key] of this.known) if (key.ownerId === ownerId) this.known.delete(kid);
        return (await this.create(ownerId)).kid;
    }

    /** The public key of a key id, from the cache: load the keys of a token first (`load`) */
    keyOf(kid: string): GrantKey | undefined {
        return this.known.get(kid);
    }

    /** The public key of a key id, read when the cache does not have it */
    async find(kid: string): Promise<GrantKey | undefined> {
        if (!this.known.has(kid)) await this.loadKids([kid]);
        return this.known.get(kid);
    }

    /** Loads the public keys a token and the chain it embeds were signed with, so `keyOf` knows them */
    async load(token: string): Promise<void> {
        const kids: string[] = [];
        for (let claims = readGrant(token); claims !== undefined && kids.length < 16; claims = claims.parent === undefined ? undefined : readGrant(claims.parent)) kids.push(claims.kid);
        await this.loadKids(kids);
    }

    private async loadKids(kids: readonly string[]): Promise<void> {
        const missing = kids.filter((kid) => !this.known.has(kid));
        if (missing.length === 0) return;
        const rows = (await this.db.query<{ kid: string; owner_id: string; public_key: string; retired_at: Date | null }>('SELECT kid, owner_id, public_key, retired_at FROM owner_key WHERE kid = ANY($1::text[])', [missing])).rows;
        for (const row of rows) {
            this.known.set(row.kid, { ownerId: row.owner_id, publicKey: row.public_key, ...(row.retired_at !== null && { retiredAt: row.retired_at.getTime() }) });
        }
    }

    private async create(ownerId: string): Promise<SigningKey> {
        const box = this.requireBox();
        const pair = generateGrantKey();
        const kid = randomUUID();
        await this.db.query('INSERT INTO owner_key (kid, owner_id, public_key, private_key) VALUES ($1, $2, $3, $4)', [kid, ownerId, pair.publicKey, box.seal(pair.privateKey)]);
        this.known.set(kid, { ownerId, publicKey: pair.publicKey });
        return { kid, privateKey: pair.privateKey };
    }

    private requireBox(): SecretBox {
        if (this.box === undefined) throw new Error('Grants need MAGNETIC_SECRET_KEY, which keeps the owners\' signing keys');
        return this.box;
    }
}
