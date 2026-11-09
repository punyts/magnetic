import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** The person the mock provider signs in next, by their OIDC claims */
export interface MockPerson {
    readonly sub: string;
    readonly name?: string;
    readonly email?: string;
    readonly email_verified?: boolean;
    readonly picture?: string;
}

/** Ways the mock provider can misbehave, to check that the client refuses it */
export type MockTamper = 'nonce' | 'audience' | 'signature' | 'issuer';

export interface MockOidcProvider {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    /** Who the next authorization signs in */
    person: MockPerson;
    /** Declines the next authorizations (`error=access_denied`) */
    deny: boolean;
    tamper: MockTamper | undefined;
    /** The query of the last authorization request */
    readonly lastAuthorize: URLSearchParams | undefined;
    stop(): Promise<void>;
}

interface Grant {
    readonly person: MockPerson;
    readonly nonce: string | null;
    readonly challenge: string | null;
    readonly redirectUri: string;
}

/**
 * A small OpenID Connect provider on loopback HTTP for tests and `--mock-provider`: discovery, an authorization endpoint that signs the
 * current `person` in at once, a token endpoint (client_secret_post, PKCE S256, one use per code) that returns an RS256
 * ID token, userinfo and the key set
 */
export async function startMockOidcProvider(): Promise<MockOidcProvider> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-key', alg: 'RS256', use: 'sig' };
    const clientId = 'magnetic-test';
    const clientSecret = randomBytes(16).toString('hex');
    const grants = new Map<string, Grant>();
    const accessTokens = new Map<string, MockPerson>();
    let issuer = '';

    const state = {
        person: { sub: 'member-1', name: 'Ada Lovelace', email: 'ada@example.com', email_verified: true } as MockPerson,
        deny: false,
        tamper: undefined as MockTamper | undefined,
        lastAuthorize: undefined as URLSearchParams | undefined
    };

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', issuer);
        const json = (status: number, body: unknown): void => {
            response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(body));
        };
        void (async () => {
            if (url.pathname === '/.well-known/openid-configuration') {
                return json(200, {
                    issuer,
                    authorization_endpoint: `${issuer}/authorize`,
                    token_endpoint: `${issuer}/token`,
                    userinfo_endpoint: `${issuer}/userinfo`,
                    jwks_uri: `${issuer}/jwks`,
                    response_types_supported: ['code'],
                    subject_types_supported: ['public'],
                    id_token_signing_alg_values_supported: ['RS256'],
                    token_endpoint_auth_methods_supported: ['client_secret_post'],
                    code_challenge_methods_supported: ['S256'],
                    scopes_supported: ['openid', 'profile', 'email']
                });
            }
            if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
            if (url.pathname === '/authorize') {
                state.lastAuthorize = url.searchParams;
                const redirectUri = url.searchParams.get('redirect_uri') ?? '';
                if (url.searchParams.get('client_id') !== clientId || redirectUri === '') return json(400, { error: 'invalid_request' });
                const back = new URL(redirectUri);
                const sentState = url.searchParams.get('state');
                if (sentState !== null) back.searchParams.set('state', sentState);
                if (state.deny) {
                    back.searchParams.set('error', 'access_denied');
                } else {
                    const code = randomBytes(16).toString('hex');
                    grants.set(code, { person: state.person, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), redirectUri });
                    back.searchParams.set('code', code);
                }
                response.writeHead(302, { Location: back.href });
                return response.end();
            }
            if (url.pathname === '/token' && request.method === 'POST') {
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(chunk as Buffer);
                const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
                if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return json(401, { error: 'invalid_client' });
                const code = form.get('code') ?? '';
                const grant = grants.get(code);
                grants.delete(code);
                if (grant === undefined || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== grant.redirectUri) return json(400, { error: 'invalid_grant' });
                if (grant.challenge !== null) {
                    const verifier = form.get('code_verifier') ?? '';
                    if (createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
                }
                const accessToken = randomBytes(16).toString('hex');
                accessTokens.set(accessToken, grant.person);
                const idToken = await new SignJWT({ ...grant.person, ...(grant.nonce !== null && { nonce: state.tamper === 'nonce' ? 'not-the-nonce' : grant.nonce }) })
                    .setProtectedHeader({ alg: 'RS256', kid: 'mock-key' })
                    .setIssuer(state.tamper === 'issuer' ? 'https://elsewhere.example' : issuer)
                    .setAudience(state.tamper === 'audience' ? 'someone-else' : clientId)
                    .setSubject(grant.person.sub)
                    .setIssuedAt()
                    .setExpirationTime('5m')
                    .sign(state.tamper === 'signature' ? other.privateKey : privateKey);
                return json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300, scope: 'openid profile email', id_token: idToken });
            }
            if (url.pathname === '/userinfo') {
                const person = accessTokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''));
                if (person === undefined) return json(401, { error: 'invalid_token' });
                return json(200, person);
            }
            json(404, { error: 'not_found' });
        })().catch((error: unknown) => json(500, { error: String(error) }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    return Object.assign(state, {
        issuer,
        clientId,
        clientSecret,
        stop: () => new Promise<void>((resolve) => server.close(() => resolve()))
    });
}
