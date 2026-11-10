import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { profileOf, safeNext } from '../auth/OidcSignIn.js';
import { startMockOidcProvider } from '../testing/mockOidcProvider.js';
import type { MockOidcProvider } from '../testing/mockOidcProvider.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

/** The `name=value` parts of a response's `Set-Cookie` headers, by name */
function cookiesOf(response: Response): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const equals = (pair as string).indexOf('=');
        cookies.set((pair as string).slice(0, equals), (pair as string).slice(equals + 1));
    }
    return cookies;
}

const get = (url: string, cookie?: string): Promise<Response> => fetch(url, { redirect: 'manual', ...(cookie !== undefined && { headers: { Cookie: cookie } }) });

describe('Signing in with an OpenID Connect provider', () => {
    let dataDir: string;
    let provider: MockOidcProvider;
    let magnetic: RunningMagnetic;

    /** Starts a sign-in: the provider's authorization URL and the browser's sign-in cookie */
    async function startSignIn(next?: string): Promise<{ authorize: string; cookie: string }> {
        const response = await get(`${magnetic.origin}/auth/mock${next === undefined ? '' : `?next=${encodeURIComponent(next)}`}`);
        expect(response.status).toBe(303);
        return { authorize: response.headers.get('location') as string, cookie: `magnetic_signin=${cookiesOf(response).get('magnetic_signin')}` };
    }

    /** Lets the provider answer the authorization: the callback URL it sends the browser to */
    async function authorize(url: string): Promise<string> {
        const response = await get(url);
        expect(response.status).toBe(302);
        return response.headers.get('location') as string;
    }

    /** The whole flow in one browser: the callback's response */
    async function signInThrough(next?: string): Promise<Response> {
        const started = await startSignIn(next);
        return get(await authorize(started.authorize), started.cookie);
    }

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-oidc-'));
        provider = await startMockOidcProvider();
        magnetic = await startMagnetic({
            dataDir,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            starter: 'none',
            browser: noBrowser,
            allowHttpProviders: true,
            providers: [{ name: 'mock', label: 'Sign in with Mock', issuer: provider.issuer, clientId: provider.clientId, clientSecret: provider.clientSecret }]
        });
    });

    afterEach(() => {
        provider.deny = false;
        provider.tamper = undefined;
    });

    afterAll(async () => {
        await magnetic.stop();
        await provider.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    it('should offer a button for each provider', async () => {
        // Act
        const html = await (await get(`${magnetic.origin}/signin?next=${encodeURIComponent('/apps/abc')}`)).text();

        // Assert
        expect(html).toContain(`href="/auth/mock?next=%2Fapps%2Fabc"`);
        expect(html).toContain('Sign in with Mock');
    });

    it('should send the browser to the provider with state, nonce, PKCE and the scopes', async () => {
        // Act
        const started = await startSignIn();
        await authorize(started.authorize);

        // Assert
        const query = provider.lastAuthorize as URLSearchParams;
        expect(started.authorize.startsWith(`${provider.issuer}/authorize?`)).toBe(true);
        expect(query.get('response_type')).toBe('code');
        expect(query.get('client_id')).toBe(provider.clientId);
        expect(query.get('redirect_uri')).toBe(`${magnetic.origin}/auth/mock/callback`);
        expect(query.get('scope')).toBe('openid profile email');
        expect(query.get('state')).toMatch(/^[\w-]{20,}$/);
        expect(query.get('nonce')).toMatch(/^[\w-]{20,}$/);
        expect(query.get('code_challenge_method')).toBe('S256');
        expect(started.cookie).toMatch(/^magnetic_signin=[\w-]{43}$/);
    });

    it('should sign the person in, make their user from the profile and go where they set out for', async () => {
        // Arrange
        provider.person = { sub: 'member-ada', name: 'Ada Lovelace', email: 'ada@example.com', email_verified: true, picture: 'https://pictures.example/ada.jpg' };

        // Act
        const response = await signInThrough('/apps/some-app');

        // Assert
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/apps/some-app');
        const cookies = cookiesOf(response);
        expect(cookies.get('magnetic_signin')).toBe('');
        const session = await magnetic.sessions.find(cookies.get('magnetic_session'));
        const user = await magnetic.accounts.user(session?.userId as string);
        expect(user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', picture: 'https://pictures.example/ada.jpg' });
        const home = await get(`${magnetic.origin}/`, `magnetic_session=${cookies.get('magnetic_session')}`);
        expect(home.status).toBe(200);
        expect(await home.text()).toContain('<title>Your apps');
    });

    it('should sign the same subject in as the same user and refresh their profile', async () => {
        // Arrange
        provider.person = { sub: 'member-grace', name: 'Grace', email: 'grace@example.com', email_verified: true };
        const first = await magnetic.sessions.find(cookiesOf(await signInThrough()).get('magnetic_session'));
        provider.person = { sub: 'member-grace', name: 'Grace Hopper', email: 'grace@example.com', email_verified: true };

        // Act
        const second = await magnetic.sessions.find(cookiesOf(await signInThrough()).get('magnetic_session'));

        // Assert
        expect(second?.userId).toBe(first?.userId);
        expect((await magnetic.accounts.user(second?.userId as string))?.name).toBe('Grace Hopper');
    });

    it('should refuse a callback in a browser that did not start the sign-in', async () => {
        // Arrange
        const started = await startSignIn();
        const callback = await authorize(started.authorize);

        // Act
        const response = await get(callback);

        // Assert
        expect(response.status).toBe(400);
        expect(await response.text()).toContain('another browser');
        expect(response.headers.getSetCookie().join()).not.toContain('magnetic_session=');
    });

    it('should accept a callback only once', async () => {
        // Arrange
        const started = await startSignIn();
        const callback = await authorize(started.authorize);
        expect((await get(callback, started.cookie)).status).toBe(303);

        // Act
        const again = await get(callback, started.cookie);

        // Assert
        expect(again.status).toBe(400);
    });

    it('should refuse a callback whose state is not the one sent', async () => {
        // Arrange
        const started = await startSignIn();
        const callback = new URL(await authorize(started.authorize));
        callback.searchParams.set('state', 'forged-state');

        // Act
        const response = await get(callback.href, started.cookie);

        // Assert
        expect(response.status).toBe(400);
    });

    it.each(['nonce', 'audience', 'signature', 'issuer'] as const)('should refuse an ID token with a wrong %s', async (tamper) => {
        // Arrange
        provider.tamper = tamper;

        // Act
        const response = await signInThrough();

        // Assert
        expect(response.status).toBe(400);
        expect(await response.text()).toContain('could not be checked');
        expect(response.headers.getSetCookie().join()).not.toContain('magnetic_session=');
    });

    it('should say so when the person declines at the provider', async () => {
        // Arrange
        provider.deny = true;

        // Act
        const response = await signInThrough();

        // Assert
        expect(response.status).toBe(400);
        expect(await response.text()).toContain('access was declined');
    });

    it('should send a page request without a session to sign in and back', async () => {
        // Act
        const response = await get(`${magnetic.origin}/apps/0f8fad5b-d9cb-469f-a165-70867728950e?x=1`);

        // Assert
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe(`/signin?next=${encodeURIComponent('/apps/0f8fad5b-d9cb-469f-a165-70867728950e?x=1')}`);
    });

    it('should not offer a provider it does not have', async () => {
        // Act
        const response = await get(`${magnetic.origin}/auth/linkedin`);

        // Assert
        expect(response.status).toBe(404);
    });
});

describe('safeNext', () => {
    it.each([
        ['/apps/abc?x=1', '/apps/abc?x=1'],
        ['//evil.example/', '/'],
        ['/\\evil.example', '/'],
        ['https://evil.example/', '/'],
        ['/signin', '/'],
        ['/auth/linkedin/callback', '/'],
        ['/apps/a b', '/'],
        [null, '/']
    ])('should make %s into %s', (next, expected) => {
        expect(safeNext(next)).toBe(expected);
    });
});

describe('profileOf', () => {
    it('should join the given and family names when there is no name, and drop an unverified email and a plain HTTP picture', () => {
        expect(profileOf({ given_name: 'Ada', family_name: 'Lovelace', email: 'ada@example.com', email_verified: false, picture: 'http://pictures.example/a.jpg' })).toEqual({ name: 'Ada Lovelace' });
    });
});
