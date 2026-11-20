import { createHash, randomBytes } from 'node:crypto';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider, Profile as SamlProfile } from '@node-saml/node-saml';
import type { Database } from '@punyts/stateui-pg';
import type { Profile } from '../accounts/Accounts.js';
import { safeNext, SignInError } from './OidcSignIn.js';
import type { IdpMetadata } from './samlMetadata.js';

/** How long a person has at their org's provider */
export const SAML_PENDING_MINUTES = 10;
/** The clock difference allowed between Magnetic and a provider */
const CLOCK_SKEW_MS = 60_000;

const TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

/** An org's SAML provider, as its settings keep it */
export interface SamlProvider extends IdpMetadata {
    /** The attribute that holds the email; absent: the usual ones, or the NameID when it is an email */
    readonly emailAttribute?: string;
}

/** A SAML sign-in that came back checked: who, and where they were going */
export interface SamlSignedIn {
    /** The NameID, which the org's identities are keyed by */
    readonly subject: string;
    readonly profile: Profile;
    readonly next: string;
}

const hashOf = (key: string): string => createHash('sha256').update(key).digest('base64url');

/** The first text value of an attribute, which a provider may send as a list */
function valueOf(profile: SamlProfile, name: string): string | undefined {
    const raw = profile[name];
    const value = Array.isArray(raw) ? raw.find((item) => typeof item === 'string') : raw;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

const first = (profile: SamlProfile, names: readonly string[]): string | undefined => {
    for (const name of names) {
        const value = valueOf(profile, name);
        if (value !== undefined) return value;
    }
    return undefined;
};

const EMAIL_ATTRIBUTES = ['email', 'mail', 'emailAddress', 'urn:oid:0.9.2342.19200300.100.1.3', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
const NAME_ATTRIBUTES = ['displayName', 'name', 'urn:oid:2.16.840.1.113730.3.1.241', 'http://schemas.microsoft.com/identity/claims/displayname'];
const GIVEN_ATTRIBUTES = ['givenName', 'firstName', 'urn:oid:2.5.4.42', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
const FAMILY_ATTRIBUTES = ['sn', 'surname', 'lastName', 'urn:oid:2.5.4.4', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];

/** The name and email an assertion gives; whether the email counts as verified is the org's to say */
export function samlProfileOf(profile: SamlProfile, emailAttribute: string | undefined): Profile {
    const fromNameId = profile.nameIDFormat === EMAIL_FORMAT && profile.nameID.includes('@') ? profile.nameID : undefined;
    const email = emailAttribute !== undefined ? valueOf(profile, emailAttribute) : (first(profile, EMAIL_ATTRIBUTES) ?? fromNameId);
    const given = [first(profile, GIVEN_ATTRIBUTES), first(profile, FAMILY_ATTRIBUTES)].filter((part) => part !== undefined).join(' ');
    return {
        name: (first(profile, NAME_ATTRIBUTES) ?? (given !== '' ? given : undefined) ?? email ?? 'Someone').slice(0, 200),
        ...(email !== undefined && email.includes('@') && { email: email.slice(0, 320) })
    };
}

/**
 * Signs people in through their org's SAML 2.0 identity provider (docs/design/statenet-network.md, S12), with
 * `@node-saml/node-saml` checking the answers. Service-provider-initiated only: the request goes by the HTTP-Redirect
 * binding and the answer comes back by HTTP-POST to `<origin>/auth/saml/<orgId>`, which is also Magnetic's entity id
 * and audience for that org. The assertion must be signed by one of the provider's certificates and name the provider
 * as its issuer, this org's audience and recipient, a request this server sent and has not seen answered, and times
 * that hold; each assertion is taken once.
 *
 * The provider's answer is a post from another site, which carries none of Magnetic's cookies, so it is checked and
 * kept on the request, and the browser is sent on to `/auth/saml/<orgId>/finish`, where the key of the browser that
 * started the sign-in (its cookie) must match the request's. A request lives in the database, so any server takes its
 * answer
 */
export class SamlSignIn {
    constructor(
        private readonly db: Database,
        private readonly publicOrigin: () => string
    ) {}

    /** Magnetic's entity id, audience and assertion consumer URL for an org */
    entityIdOf(orgId: string): string {
        return `${this.publicOrigin()}/auth/saml/${orgId}`;
    }

    /** One checker per request or answer, so its cache provider knows which org and request it works for */
    private samlFor(orgId: string, provider: SamlProvider, cache: CacheProvider, requestId?: string): SAML {
        const entityId = this.entityIdOf(orgId);
        return new SAML({
            callbackUrl: entityId,
            entryPoint: provider.ssoUrl,
            issuer: entityId,
            audience: entityId,
            idpCert: [...provider.certificates],
            idpIssuer: provider.entityId,
            wantAssertionsSigned: true,
            wantAuthnResponseSigned: false,
            validateInResponseTo: ValidateInResponseTo.always,
            rejectReplayedAssertions: true,
            requestIdExpirationPeriodMs: SAML_PENDING_MINUTES * 60_000,
            acceptedClockSkewMs: CLOCK_SKEW_MS,
            identifierFormat: null,
            disableRequestedAuthnContext: true,
            cacheProvider: cache,
            ...(requestId !== undefined && { generateUniqueId: () => requestId })
        });
    }

    /** Starts a sign-in: the provider's URL to send the browser to, and the key for its cookie */
    async start(orgId: string, provider: SamlProvider, next: string): Promise<{ readonly url: string; readonly key: string }> {
        await this.db.query('DELETE FROM saml_request WHERE expires_at < now()');
        const key = randomBytes(32).toString('base64url');
        const id = `_${randomBytes(20).toString('hex')}`;
        await this.db.query(`INSERT INTO saml_request (id, org_id, browser_hash, next, expires_at) VALUES ($1, $2, $3, $4, now() + interval '${SAML_PENDING_MINUTES} minutes')`, [id, orgId, hashOf(key), safeNext(next)]);
        const url = await this.samlFor(orgId, provider, this.cache(orgId, () => undefined), id).getAuthorizeUrlAsync('', {});
        return { url, key };
    }

    /**
     * Checks the provider's answer, posted to the org's assertion consumer URL, and keeps who it signed in on the request
     * it answers; that request's id, for the browser to finish with
     */
    async answer(orgId: string, provider: SamlProvider, samlResponse: string | undefined): Promise<string> {
        if (samlResponse === undefined || samlResponse === '') throw new SignInError('Your organisation\'s sign-in sent no answer.');
        let answered: string | undefined;
        let checked;
        try {
            checked = await this.samlFor(orgId, provider, this.cache(orgId, (id) => (answered = id))).validatePostResponseAsync({ SAMLResponse: samlResponse });
        } catch (error) {
            throw new SignInError('Your organisation\'s sign-in could not be checked. Please try again.', { detail: (error instanceof Error ? error.message : String(error)).slice(0, 300), cause: error });
        }
        const profile = checked.profile;
        if (profile === null || answered === undefined) throw new SignInError('Your organisation\'s sign-in could not be checked. Please try again.', { detail: 'no profile or no request answered' });
        if (profile.nameIDFormat === TRANSIENT || profile.nameID.trim() === '' || profile.nameID.length > 1024) {
            throw new SignInError('Your organisation\'s sign-in sends a temporary name for you, so Magnetic cannot know you again. Ask its administrator to send a persistent NameID or the email.', { detail: `NameID format ${profile.nameIDFormat}` });
        }
        await this.db.query('UPDATE saml_request SET subject = $2, profile = $3 WHERE id = $1', [answered, profile.nameID, JSON.stringify(samlProfileOf(profile, provider.emailAttribute))]);
        return answered;
    }

    /** Finishes a sign-in in the browser that started it: `key` from its cookie. Once */
    async finish(orgId: string, requestId: string | null, key: string | undefined): Promise<SamlSignedIn> {
        const row =
            requestId === null || key === undefined
                ? undefined
                : (
                      await this.db.query<{ subject: string; profile: Profile; next: string }>(
                          'DELETE FROM saml_request WHERE id = $1 AND org_id = $2 AND browser_hash = $3 AND subject IS NOT NULL AND expires_at > now() RETURNING subject, profile, next',
                          [requestId, orgId, hashOf(key)]
                      )
                  ).rows[0];
        if (row === undefined) throw new SignInError('This sign-in has expired or was started in another browser. Please try again.');
        return { subject: row.subject, profile: row.profile, next: row.next };
    }

    /**
     * Requests and assertions as node-saml keeps them: a request is one this server sent for this org, answered once
     * (`answered` hears its id); an assertion is kept until it would expire, and taken once
     */
    private cache(orgId: string, answered: (requestId: string) => void): CacheProvider {
        const db = this.db;
        return {
            // The request is written before node-saml makes it (`start`)
            saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
            // node-saml reads the answer as the instant the request was made
            getAsync: async (key) =>
                (
                    await db.query<{ created: Date }>(
                        `SELECT expires_at - interval '${SAML_PENDING_MINUTES} minutes' AS created FROM saml_request WHERE id = $1 AND org_id = $2 AND answered_at IS NULL AND expires_at > now()`,
                        [key, orgId]
                    )
                ).rows[0]?.created.toISOString() ?? null,
            removeAsync: async () => null,
            consumeAsync: async (key) => {
                const taken = (await db.query("UPDATE saml_request SET answered_at = now() WHERE id = $1 AND org_id = $2 AND answered_at IS NULL AND expires_at > now()", [key, orgId])).rowCount === 1;
                if (!taken) return null;
                answered(key);
                return key;
            },
            saveIfAbsentAsync: async (key, _value, expiresAtMs) => {
                await db.query('DELETE FROM saml_assertion WHERE expires_at < now()');
                return ((await db.query('INSERT INTO saml_assertion (key, expires_at) VALUES ($1, to_timestamp($2 / 1000.0)) ON CONFLICT DO NOTHING', [hashOf(key), expiresAtMs])).rowCount ?? 0) === 1;
            }
        };
    }
}
