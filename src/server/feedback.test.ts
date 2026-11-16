import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Feedback, FEEDBACK_PER_HOUR } from '../feedback/Feedback.js';
import { feedbackMessage, memoryMailer } from '../mail/Mailer.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

/** No headless browser: these tests never preview */
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

describe("The editor's bug button over HTTP", () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let alice: string;
    let bob: string;
    let aliceId: string;
    let appId: string;
    const mailer = memoryMailer();
    const send = (path: string, cookie: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, {
            method,
            redirect: 'manual',
            headers: { Cookie: cookie, Origin: magnetic.origin, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
            ...(body !== undefined && { body: JSON.stringify(body) })
        });
    const signIn = async (user: string): Promise<string> => {
        const response = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
        return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: { info: () => undefined },
            devUsers: ['alice', 'bob'],
            starter: 'none',
            browser: noBrowser,
            mailer,
            privacy: { operator: 'Example Operator', email: 'feedback@magnetic.example' }
        });
        alice = await signIn('alice');
        bob = await signIn('bob');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1] as string))?.userId as string;
        await magnetic.database.query("UPDATE app_user SET email = 'alice@example.com' WHERE id = $1", [aliceId]);
        const orgId = ((await (await send('/orgs', alice, 'POST', { name: 'Acme', slug: 'acme' })).json()) as { id: string }).id;
        appId = ((await (await send(`/orgs/${orgId}/apps`, alice, 'POST', { name: 'Tickets' })).json()) as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should keep a feature request with where it came from, and email it to whoever runs the server', async () => {
        // Act
        const response = await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'feature', text: '  Let me undo a change\nfrom the chat  ', context: { size: 'phone', language: 'en', secret: 'dropped' } }, { 'User-Agent': 'TestBrowser/1.0' });

        // Assert
        expect(response.status).toBe(200);
        const [entry] = await new Feedback(magnetic.database).latest();
        expect(entry).toMatchObject({ kind: 'feature', text: 'Let me undo a change\nfrom the chat', userId: aliceId, userName: 'alice', email: 'alice@example.com', appId, appName: 'tickets', context: { size: 'phone', language: 'en' }, userAgent: 'TestBrowser/1.0' });
        await expect.poll(() => mailer.feedbackSent.length).toBe(1);
        expect(mailer.feedbackSent[0]).toMatchObject({ to: 'feedback@magnetic.example', kind: 'feature', fromName: 'alice', fromEmail: 'alice@example.com', appName: 'tickets', context: { size: 'phone', language: 'en', app: appId, browser: 'TestBrowser/1.0' } });
    });

    it('should refuse an empty message, an unknown kind, someone who may not edit the app, and too many in an hour', async () => {
        // Act + Assert
        expect((await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'bug', text: '   ' })).status).toBe(400);
        expect((await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'praise', text: 'Lovely' })).status).toBe(400);
        expect((await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'bug', text: 'x'.repeat(4001) })).status).toBe(400);
        expect((await send(`/edit/${appId}/feedback`, bob, 'POST', { kind: 'bug', text: 'Not my app' })).status).toBe(404);
        const sent = (await magnetic.database.query<{ sent: number }>('SELECT count(*)::int AS sent FROM feedback')).rows[0]?.sent ?? 0;
        for (let index = sent; index < FEEDBACK_PER_HOUR; index++) expect((await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'bug', text: `Bug ${index}` })).status).toBe(200);
        const tooMany = await send(`/edit/${appId}/feedback`, alice, 'POST', { kind: 'bug', text: 'One more' });
        expect(tooMany.status).toBe(429);
    });

    it('should word the email with the kind, the first line as its subject, the sender and the app', () => {
        // Act
        const message = feedbackMessage({ to: 'ops@example.com', kind: 'bug', text: 'The chart is blank on a phone\nIt shows after a reload', fromName: 'Ada', fromEmail: 'ada@example.com', appName: 'Sales', context: { size: 'phone' } });

        // Assert
        expect(message.subject).toBe('Magnetic bug: The chart is blank on a phone');
        expect(message.text).toBe('Bug from Ada <ada@example.com>, in the app Sales:\n\nThe chart is blank on a phone\nIt shows after a reload\n\nsize: phone');
    });
});
