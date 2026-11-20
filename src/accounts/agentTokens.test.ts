import { createHash, randomBytes } from 'node:crypto';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { magneticTestDatabase } from '../testing/testDb.js';
import { Accounts } from './Accounts.js';
import { AgentTokens, isLoopbackRedirect } from './AgentTokens.js';
import { Sessions } from './Sessions.js';

let test: TestDatabase;

beforeEach(async () => {
    test = await magneticTestDatabase();
});

afterEach(async () => {
    await test.drop();
});

const REDIRECT = 'http://127.0.0.1:53111/callback';

/** A PKCE verifier and its S256 challenge */
function pkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** A signed-in person: their id and their session's key */
async function person(now: () => Date = () => new Date()): Promise<{ userId: string; session: string; sessions: Sessions }> {
    const user = await new Accounts(test.db).signIn({ provider: 'dev', subject: 'ana' }, { name: 'Ana' });
    const sessions = new Sessions(test.db, now);
    return { userId: user.id, session: await sessions.start(user.id), sessions };
}

describe('AgentTokens', () => {
    it('should give an agent tokens for the person once they allow its ask, with the verifier of its challenge', async () => {
        // Arrange
        const { userId, session } = await person();
        const tokens = new AgentTokens(test.db);
        const { verifier, challenge } = pkce();
        const id = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge, state: 's1' });

        // Act
        const allowed = await tokens.allow(id, Sessions.keyOf(session));
        const wrongVerifier = await tokens.exchange(allowed?.code, pkce().verifier, REDIRECT);
        const allowedAgain = await tokens.allow(id, Sessions.keyOf(session));

        // Assert
        expect(allowed).toMatchObject({ redirectUri: REDIRECT, state: 's1' });
        expect(wrongVerifier).toBeUndefined();
        expect(allowedAgain).toBeUndefined();
        // the code was spent by the wrong verifier, so a second ask is needed
        const id2 = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge, state: 's2' });
        const code = (await tokens.allow(id2, Sessions.keyOf(session)))?.code;
        expect(await tokens.exchange(code, verifier, 'http://127.0.0.1:1/other')).toBeUndefined();
        const id3 = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge, state: 's3' });
        const pair = await tokens.exchange((await tokens.allow(id3, Sessions.keyOf(session)))?.code, verifier, REDIRECT);
        expect(pair?.expiresIn).toBe(3600);
        expect(await tokens.find(pair?.accessToken)).toEqual({ userId });
    });

    it('should refuse an ask allowed from another session', async () => {
        // Arrange
        const { userId, session, sessions } = await person();
        const other = await sessions.start(userId);
        const tokens = new AgentTokens(test.db);
        const id = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge: pkce().challenge, state: '' });

        // Act
        const allowed = await tokens.allow(id, Sessions.keyOf(other));

        // Assert
        expect(allowed).toBeUndefined();
    });

    it('should rotate the refresh token, and end the access an hour on', async () => {
        // Arrange
        let now = new Date('2026-11-20T10:00:00Z');
        const { userId, session } = await person(() => now);
        const tokens = new AgentTokens(test.db, () => now);
        const { verifier, challenge } = pkce();
        const id = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge, state: '' });
        const first = await tokens.exchange((await tokens.allow(id, Sessions.keyOf(session)))?.code, verifier, REDIRECT);

        // Act
        now = new Date('2026-11-20T11:00:01Z');
        const expired = await tokens.find(first?.accessToken);
        const second = await tokens.refresh(first?.refreshToken);
        const reused = await tokens.refresh(first?.refreshToken);

        // Assert
        expect(expired).toBeUndefined();
        expect(await tokens.find(second?.accessToken)).toEqual({ userId });
        expect(reused).toBeUndefined();
    });

    it('should end the agent with the session that allowed it', async () => {
        // Arrange
        const { userId, session, sessions } = await person();
        const tokens = new AgentTokens(test.db);
        const { verifier, challenge } = pkce();
        const id = await tokens.ask(userId, Sessions.keyOf(session), { redirectUri: REDIRECT, challenge, state: '' });
        const pair = await tokens.exchange((await tokens.allow(id, Sessions.keyOf(session)))?.code, verifier, REDIRECT);

        // Act
        await sessions.end(session);

        // Assert
        expect(await tokens.find(pair?.accessToken)).toBeUndefined();
        expect(await tokens.refresh(pair?.refreshToken)).toBeUndefined();
    });

    it('should take only a loopback http redirect with a port', () => {
        // Assert
        expect(isLoopbackRedirect('http://127.0.0.1:53111/callback')).toBe(true);
        expect(isLoopbackRedirect('http://[::1]:53111/')).toBe(true);
        expect(isLoopbackRedirect('http://127.0.0.1/callback')).toBe(false);
        expect(isLoopbackRedirect('https://127.0.0.1:53111/callback')).toBe(false);
        expect(isLoopbackRedirect('http://localhost:53111/callback')).toBe(false);
        expect(isLoopbackRedirect('http://evil.example:53111/callback')).toBe(false);
        expect(isLoopbackRedirect('http://127.0.0.1:53111/callback?x=1')).toBe(false);
    });
});
