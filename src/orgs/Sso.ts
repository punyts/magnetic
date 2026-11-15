import type { Database } from '@punyts/stateui-pg';
import type { SecretBox } from '../auth/secrets.js';
import type { OidcProvider } from '../auth/OidcSignIn.js';
import { audit, OrgError } from './Orgs.js';
import type { Orgs } from './Orgs.js';

/** An org's provider as its settings show it: never its secret */
export interface OrgSsoSettings {
    readonly issuer: string;
    readonly clientId: string;
    readonly enabled: boolean;
}

/** The name of every org provider in URLs: one redirect URI, `<origin>/auth/sso/callback`, serves them all */
export const SSO_PROVIDER = 'sso';

/** The provider name of an org's identities, so they never meet another provider's subjects */
export const ssoIdentityProvider = (orgId: string): string => `org:${orgId}`;

/**
 * Each org's own OpenID Connect provider (`org_sso`): its issuer, client id and secret, sealed with the server's key.
 * Owners set it; admins see it without the secret. Without a server key there is nowhere safe for a secret, so it
 * cannot be set
 */
export class OrgSso {
    constructor(
        private readonly db: Database,
        private readonly orgs: Orgs,
        private readonly box: SecretBox | undefined
    ) {}

    /** Whether this server can keep an org's provider (it has a secret key) */
    get available(): boolean {
        return this.box !== undefined;
    }

    async get(actorId: string, orgId: string): Promise<OrgSsoSettings | undefined> {
        await this.orgs.require(orgId, actorId, 'admin');
        const row = (await this.db.query<{ issuer: string; client_id: string; enabled: boolean }>('SELECT issuer, client_id, enabled FROM org_sso WHERE org_id = $1', [orgId])).rows[0];
        return row === undefined ? undefined : { issuer: row.issuer, clientId: row.client_id, enabled: row.enabled };
    }

    /** Sets the org's provider; an empty secret keeps the one stored. Owners */
    async set(actorId: string, orgId: string, input: { readonly issuer: string; readonly clientId: string; readonly clientSecret: string; readonly enabled: boolean }): Promise<void> {
        if (this.box === undefined) throw new OrgError(409, 'This server has no secret key (MAGNETIC_SECRET_KEY), so it cannot keep an org\'s sign-in secret.');
        await this.orgs.require(orgId, actorId, 'owner');
        const issuer = input.issuer.trim();
        const clientId = input.clientId.trim();
        let url: URL;
        try {
            url = new URL(issuer);
        } catch {
            throw new OrgError(400, 'The issuer is the provider\'s https:// address.');
        }
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new OrgError(400, 'The issuer is the provider\'s https:// address.');
        if (clientId === '' || clientId.length > 500) throw new OrgError(400, 'Give the client id the provider made for Magnetic.');
        const box = this.box;
        await this.db.transaction(async (tx) => {
            const stored = (await tx.query<{ client_secret: string }>('SELECT client_secret FROM org_sso WHERE org_id = $1 FOR UPDATE', [orgId])).rows[0]?.client_secret;
            const secret = input.clientSecret.trim() !== '' ? box.seal(input.clientSecret.trim()) : stored;
            if (secret === undefined) throw new OrgError(400, 'Give the client secret the provider made for Magnetic.');
            await tx.query(
                `INSERT INTO org_sso (org_id, issuer, client_id, client_secret, enabled, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
                 ON CONFLICT (org_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
                [orgId, issuer, clientId, secret, input.enabled, actorId]
            );
            await audit(tx, { orgId, actorId, action: 'sso.changed', targetKind: 'org', targetId: orgId, detail: { issuer, clientId, enabled: input.enabled, secretChanged: input.clientSecret.trim() !== '' } });
        });
    }

    /** The org's provider to sign in with, when it has one switched on */
    async provider(orgId: string): Promise<OidcProvider | undefined> {
        if (this.box === undefined) return undefined;
        const row = (await this.db.query<{ issuer: string; client_id: string; client_secret: string; enabled: boolean }>('SELECT issuer, client_id, client_secret, enabled FROM org_sso WHERE org_id = $1', [orgId])).rows[0];
        if (row === undefined || !row.enabled) return undefined;
        return { name: SSO_PROVIDER, label: 'Sign in with your work account', issuer: row.issuer, clientId: row.client_id, clientSecret: this.box.open(row.client_secret) };
    }
}
