import { randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import type { Identity, Profile } from '../accounts/Accounts.js';

/** One OpenID Connect provider people sign in with */
export interface OidcProvider {
    /** Its name in URLs (`/auth/<name>`) and identities (`<name>:<subject>`): small letters, digits and `-` */
    readonly name: string;
    /** The text of its button */
    readonly label: string;
    /** The issuer, whose `/.well-known/openid-configuration` describes it */
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    /** Default `openid profile email` */
    readonly scopes?: readonly string[];
    /** Sends a PKCE code challenge (S256) with the request and its verifier with the code; default true */
    readonly pkce?: boolean;
}

/** LinkedIn's "Sign In with LinkedIn using OpenID Connect" */
export function linkedInProvider(clientId: string, clientSecret: string, options: { readonly pkce?: boolean } = {}): OidcProvider {
    return {
        name: 'linkedin',
        label: 'Sign in with LinkedIn',
        issuer: 'https://www.linkedin.com/oauth',
        clientId,
        clientSecret,
        scopes: ['openid', 'profile', 'email'],
        pkce: options.pkce ?? true
    };
}

export interface OidcSignInOptions {
    /** The origin people reach this server at; the redirect URI of a provider is `<origin>/auth/<name>/callback` */
    readonly publicOrigin: () => string;
    /** Allows providers over plain HTTP, for a mock provider in tests. Never for a real one */
    readonly allowHttp?: boolean;
    /** How long a sign-in may take at the provider; default 10 minutes */
    readonly pendingMs?: number;
    /** The most sign-ins in flight at once; the oldest are dropped past it. Default 10,000 */
    readonly maxPending?: number;
}

/** A sign-in that went to a provider and has not come back */
interface Pending {
    readonly provider: string;
    readonly state: string;
    readonly nonce: string;
    readonly verifier: string | undefined;
    readonly next: string;
    readonly expires: number;
}

/** Why a sign-in did not finish; its message can be shown to the person */
export class SignInError extends Error {}

export interface SignedIn {
    readonly identity: Identity;
    readonly profile: Profile;
    /** Where to send the person now: the path they set out for */
    readonly next: string;
}

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

/**
 * Signs people in with OpenID Connect providers by the authorization code flow. Each sign-in in flight has a random
 * key, kept in a cookie of the browser that started it, and its state, nonce and PKCE verifier stay on the server
 * under that key. The callback is accepted only from that browser, once, within the time allowed. The ID token is
 * checked by openid-client: its signature against the provider's published keys (`enableNonRepudiationChecks`,
 * which openid-client leaves off by default for tokens from the token endpoint), issuer, audience, expiry and nonce
 */
export class OidcSignIn {
    private readonly configurations = new Map<string, Promise<client.Configuration>>();
    private readonly pending = new Map<string, Pending>();
    private readonly byName: ReadonlyMap<string, OidcProvider>;

    constructor(
        readonly providers: readonly OidcProvider[],
        private readonly options: OidcSignInOptions
    ) {
        const byName = new Map<string, OidcProvider>();
        for (const provider of providers) {
            if (!NAME.test(provider.name) || provider.name === 'dev') throw new Error(`Invalid provider name: ${provider.name}`);
            if (byName.has(provider.name)) throw new Error(`Two providers are named ${provider.name}`);
            byName.set(provider.name, provider);
        }
        this.byName = byName;
    }

    has(name: string): boolean {
        return this.byName.has(name);
    }

    /** The redirect URI to register with a provider */
    redirectUri(name: string): string {
        return `${this.options.publicOrigin()}/auth/${name}/callback`;
    }

    /** The provider's configuration, discovered once; a failed discovery is tried again next time */
    private configuration(provider: OidcProvider): Promise<client.Configuration> {
        let found = this.configurations.get(provider.name);
        if (found === undefined) {
            found = client.discovery(new URL(provider.issuer), provider.clientId, undefined, client.ClientSecretPost(provider.clientSecret), {
                execute: [client.enableNonRepudiationChecks, ...(this.options.allowHttp === true ? [client.allowInsecureRequests] : [])]
            });
            found.catch(() => this.configurations.delete(provider.name));
            this.configurations.set(provider.name, found);
        }
        return found;
    }

    /**
     * Starts a sign-in: the provider's authorization URL to send the browser to, and the key for its cookie.
     * `next` is where to go afterwards, a path of this server
     */
    async start(name: string, next: string): Promise<{ url: string; key: string }> {
        const provider = this.byName.get(name);
        if (provider === undefined) throw new SignInError('No such provider');
        const configuration = await this.configuration(provider);
        this.sweep();
        const state = client.randomState();
        const nonce = client.randomNonce();
        const verifier = provider.pkce === false ? undefined : client.randomPKCECodeVerifier();
        const parameters: Record<string, string> = {
            redirect_uri: this.redirectUri(name),
            scope: (provider.scopes ?? DEFAULT_SCOPES).join(' '),
            state,
            nonce,
            ...(verifier !== undefined && { code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' })
        };
        const key = randomBytes(32).toString('base64url');
        const maxPending = this.options.maxPending ?? 10_000;
        while (this.pending.size >= maxPending) this.pending.delete(this.pending.keys().next().value as string);
        this.pending.set(key, { provider: name, state, nonce, verifier, next: safeNext(next), expires: Date.now() + (this.options.pendingMs ?? 10 * 60_000) });
        return { url: client.buildAuthorizationUrl(configuration, parameters).href, key };
    }

    /**
     * Finishes a sign-in at the callback: `key` from the browser's cookie, `search` the query of the callback. The
     * code is exchanged for tokens, the ID token checked, and the profile read from its claims and the userinfo
     * endpoint
     */
    async finish(name: string, key: string | undefined, search: string): Promise<SignedIn> {
        const pending = key === undefined ? undefined : this.pending.get(key);
        if (key !== undefined) this.pending.delete(key);
        if (pending === undefined || pending.provider !== name || pending.expires < Date.now()) throw new SignInError('This sign-in has expired or was started in another browser. Please try again.');
        const provider = this.byName.get(name) as OidcProvider;
        const configuration = await this.configuration(provider);
        const callback = new URL(this.redirectUri(name));
        callback.search = search;
        if (callback.searchParams.has('error')) throw new SignInError(`${provider.label.replace(/^Sign in with /, '')} did not sign you in${callback.searchParams.get('error') === 'access_denied' ? ': access was declined' : ''}.`);
        let tokens;
        try {
            tokens = await client.authorizationCodeGrant(configuration, callback, {
                expectedState: pending.state,
                expectedNonce: pending.nonce,
                idTokenExpected: true,
                ...(pending.verifier !== undefined && { pkceCodeVerifier: pending.verifier })
            });
        } catch (error) {
            throw new SignInError(`The sign-in could not be checked (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
        }
        const claims = tokens.claims();
        if (claims === undefined) throw new SignInError('The provider sent no ID token.');
        let info: Record<string, unknown> = {};
        if (configuration.serverMetadata().userinfo_endpoint !== undefined) {
            try {
                info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
            } catch {
                // The ID token's claims are enough to sign in
            }
        }
        return { identity: { provider: name, subject: claims.sub }, profile: profileOf({ ...claims, ...info }), next: pending.next };
    }

    /** Drops the sign-ins that took too long */
    private sweep(): void {
        const now = Date.now();
        for (const [key, pending] of this.pending) if (pending.expires < now) this.pending.delete(key);
    }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The name, email and picture a provider gives, by the standard OIDC claims */
export function profileOf(claims: Record<string, unknown>): Profile {
    const given = [text(claims['given_name']), text(claims['family_name'])].filter((part) => part !== undefined).join(' ');
    const email = claims['email_verified'] === false ? undefined : text(claims['email']);
    const picture = text(claims['picture']);
    return {
        name: (text(claims['name']) ?? (given !== '' ? given : undefined) ?? email ?? 'Someone').slice(0, 200),
        ...(email !== undefined && { email: email.slice(0, 320) }),
        ...(picture !== undefined && picture.startsWith('https://') && picture.length <= 2048 && { picture })
    };
}

/**
 * A path of this server to go to after signing in, or `/`. Only a plain path: not another site (`//host`, `/\host`),
 * and not the sign-in routes themselves
 */
export function safeNext(next: string | null | undefined): string {
    if (next === null || next === undefined || next.length > 2048) return '/';
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\s\u0000-\u001f\\]/.test(next)) return '/';
    if (/^\/(signin|signout|auth)(\/|\?|$)/.test(next)) return '/';
    return next;
}
