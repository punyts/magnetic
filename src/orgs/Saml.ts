import type { Database } from '@punyts/stateui-pg';
import type { SamlProvider } from '../auth/SamlSignIn.js';
import { fetchIdpMetadata, isProviderUrl, MAX_METADATA_BYTES, MetadataError, parseIdpMetadata } from '../auth/samlMetadata.js';
import type { IdpMetadata } from '../auth/samlMetadata.js';
import { audit, OrgError } from './Orgs.js';
import type { Orgs } from './Orgs.js';

/** How often a metadata URL is read again */
export const METADATA_REFRESH_HOURS = 24;

/** The provider name of an org's SAML identities, apart from its OpenID Connect ones (`org:<id>`) */
export const samlIdentityProvider = (orgId: string): string => `org:${orgId}:saml`;

/** An org's SAML provider as its settings show it */
export interface OrgSamlSettings {
    readonly metadataUrl?: string;
    readonly entityId: string;
    readonly ssoUrl: string;
    readonly certificates: number;
    readonly emailAttribute?: string;
    readonly enabled: boolean;
    /** When the metadata URL was last read */
    readonly fetchedAt?: string;
    /** Why the last read of the metadata URL failed; the last good copy is kept */
    readonly fetchError?: string;
}

/** What an owner sets: the metadata by URL or as XML, the email attribute, and whether it is on */
export interface OrgSamlInput {
    readonly metadataUrl: string;
    readonly metadataXml: string;
    readonly emailAttribute: string;
    readonly enabled: boolean;
}

interface Row {
    readonly metadata_url: string | null;
    readonly entity_id: string;
    readonly sso_url: string;
    readonly certificates: string[];
    readonly email_attribute: string | null;
    readonly enabled: boolean;
    readonly fetched_at: Date | null;
    readonly fetch_error: string | null;
}

/**
 * Each org's own SAML 2.0 identity provider (`org_saml`, docs/design/statenet-network.md, S12): its metadata, by URL
 * or as XML, and the attribute that holds the email. Owners set it; admins see it. An org signs in with one kind of
 * provider at a time, so switching this on switches its OpenID Connect provider off, keeping its settings. A metadata
 * URL is read when the settings are saved and again every day (`refreshDue`), and a failed read keeps the last good
 * copy and shows why
 */
export class OrgSaml {
    constructor(
        private readonly db: Database,
        private readonly orgs: Orgs,
        private readonly fetchMetadata: (url: string) => Promise<{ readonly xml: string; readonly metadata: IdpMetadata }> = fetchIdpMetadata
    ) {}

    async get(actorId: string, orgId: string): Promise<OrgSamlSettings | undefined> {
        await this.orgs.require(orgId, actorId, 'admin');
        const row = (await this.db.query<Row>('SELECT metadata_url, entity_id, sso_url, certificates, email_attribute, enabled, fetched_at, fetch_error FROM org_saml WHERE org_id = $1', [orgId])).rows[0];
        if (row === undefined) return undefined;
        return {
            ...(row.metadata_url !== null && { metadataUrl: row.metadata_url }),
            entityId: row.entity_id,
            ssoUrl: row.sso_url,
            certificates: row.certificates.length,
            ...(row.email_attribute !== null && { emailAttribute: row.email_attribute }),
            enabled: row.enabled,
            ...(row.fetched_at !== null && { fetchedAt: row.fetched_at.toISOString() }),
            ...(row.fetch_error !== null && { fetchError: row.fetch_error })
        };
    }

    /**
     * Sets the org's provider. A metadata URL is read now and its metadata must be good; XML given in its place is
     * taken as it is. With neither, the metadata kept stays, so an owner can change the email attribute or switch it
     * on and off. Owners
     */
    async set(actorId: string, orgId: string, input: OrgSamlInput): Promise<void> {
        await this.orgs.require(orgId, actorId, 'owner');
        const url = input.metadataUrl.trim();
        const given = input.metadataXml.trim();
        const emailAttribute = input.emailAttribute.trim();
        if (emailAttribute.length > 500) throw new OrgError(400, 'The email attribute is the name of one attribute.');
        if (url !== '' && given !== '') throw new OrgError(400, 'Give the metadata URL or the metadata XML, not both.');
        if (url !== '' && (!isProviderUrl(url) || url.length > 2048)) throw new OrgError(400, 'The metadata URL is an https:// address.');
        if (Buffer.byteLength(given, 'utf8') > MAX_METADATA_BYTES) throw new OrgError(400, 'The metadata is larger than 1 MB.');
        let read: { xml: string; metadata: IdpMetadata } | undefined;
        try {
            if (url !== '') read = await this.fetchMetadata(url);
            else if (given !== '') read = { xml: given, metadata: parseIdpMetadata(given) };
        } catch (error) {
            if (error instanceof MetadataError) throw new OrgError(400, error.message);
            throw error;
        }
        await this.db.transaction(async (tx) => {
            const kept = (await tx.query<{ metadata_url: string | null }>('SELECT metadata_url FROM org_saml WHERE org_id = $1 FOR UPDATE', [orgId])).rows[0];
            if (read === undefined) {
                if (kept === undefined) throw new OrgError(400, 'Give the identity provider\'s metadata URL or its metadata XML.');
                await tx.query('UPDATE org_saml SET email_attribute = $2, enabled = $3, updated_by = $4, updated_at = now() WHERE org_id = $1', [orgId, emailAttribute === '' ? null : emailAttribute, input.enabled, actorId]);
            } else {
                await tx.query(
                    `INSERT INTO org_saml (org_id, metadata_url, metadata_xml, entity_id, sso_url, certificates, email_attribute, enabled, fetched_at, fetch_error, updated_by, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, now())
                     ON CONFLICT (org_id) DO UPDATE SET metadata_url = EXCLUDED.metadata_url, metadata_xml = EXCLUDED.metadata_xml, entity_id = EXCLUDED.entity_id, sso_url = EXCLUDED.sso_url,
                         certificates = EXCLUDED.certificates, email_attribute = EXCLUDED.email_attribute, enabled = EXCLUDED.enabled, fetched_at = EXCLUDED.fetched_at, fetch_error = NULL,
                         updated_by = EXCLUDED.updated_by, updated_at = now()`,
                    [orgId, url === '' ? null : url, read.xml, read.metadata.entityId, read.metadata.ssoUrl, [...read.metadata.certificates], emailAttribute === '' ? null : emailAttribute, input.enabled, url === '' ? null : new Date(), actorId]
                );
            }
            // One kind of org sign-in at a time
            if (input.enabled) await tx.query('UPDATE org_sso SET enabled = false WHERE org_id = $1', [orgId]);
            await audit(tx, {
                orgId,
                actorId,
                action: 'saml.changed',
                targetKind: 'org',
                targetId: orgId,
                detail: { enabled: input.enabled, ...(read !== undefined && { entityId: read.metadata.entityId, metadataUrl: url === '' ? null : url }), emailAttribute: emailAttribute === '' ? null : emailAttribute }
            });
        });
    }

    /** The org's provider to sign in with, when it has one switched on */
    async provider(orgId: string): Promise<SamlProvider | undefined> {
        const row = (await this.db.query<Row>('SELECT entity_id, sso_url, certificates, email_attribute, enabled FROM org_saml WHERE org_id = $1', [orgId])).rows[0];
        if (row === undefined || !row.enabled) return undefined;
        return { entityId: row.entity_id, ssoUrl: row.sso_url, certificates: row.certificates, ...(row.email_attribute !== null && { emailAttribute: row.email_attribute }) };
    }

    /**
     * Reads again each metadata URL last read a day ago or more. Good metadata replaces the copy kept; a failed read
     * keeps it and records why. Answers how many were read and how many failed
     */
    async refreshDue(): Promise<{ readonly read: number; readonly failed: number }> {
        const due = (
            await this.db.query<{ org_id: string; metadata_url: string }>(
                `SELECT org_id, metadata_url FROM org_saml WHERE metadata_url IS NOT NULL AND (fetched_at IS NULL OR fetched_at < now() - interval '${METADATA_REFRESH_HOURS} hours') ORDER BY fetched_at NULLS FIRST LIMIT 100`
            )
        ).rows;
        let failed = 0;
        for (const { org_id: orgId, metadata_url: url } of due) {
            try {
                const read = await this.fetchMetadata(url);
                await this.db.query(
                    'UPDATE org_saml SET metadata_xml = $3, entity_id = $4, sso_url = $5, certificates = $6, fetched_at = now(), fetch_error = NULL WHERE org_id = $1 AND metadata_url = $2',
                    [orgId, url, read.xml, read.metadata.entityId, read.metadata.ssoUrl, [...read.metadata.certificates]]
                );
            } catch (error) {
                failed += 1;
                const reason = error instanceof MetadataError ? error.message : 'The metadata URL could not be read.';
                // fetched_at moves on too, so a provider that is down is tried again tomorrow, not every hour
                await this.db.query('UPDATE org_saml SET fetched_at = now(), fetch_error = $3 WHERE org_id = $1 AND metadata_url = $2', [orgId, url, reason]);
            }
        }
        return { read: due.length, failed };
    }
}
