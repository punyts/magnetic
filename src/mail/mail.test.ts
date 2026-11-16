import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { inviteMessage, memoryMailer } from './Mailer.js';
import type { InviteMail, Mailer } from './Mailer.js';

const silent = { info: () => undefined };
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

describe('Invite emails', () => {
    it('should say who invited whom to what, with the link and when it ends, and escape what people typed in the HTML', () => {
        // Act
        const message = inviteMessage({ to: 'ada@example.com', orgName: 'Acme <Labs>', inviterName: 'Ana "A" Ng', role: 'a builder', link: 'https://magnetic.example/invites/abc', expiresAt: '2026-11-23T10:00:00.000Z' });

        // Assert
        expect(message.subject).toBe('Ana "A" Ng invited you to Acme <Labs> on Magnetic');
        expect(message.text).toContain('as a builder');
        expect(message.text).toContain('Join: https://magnetic.example/invites/abc');
        expect(message.text).toContain('until Mon, 23 Nov 2026');
        expect(message.html).toContain('Acme &#60;Labs&#62;');
        expect(message.html).not.toContain('<Labs>');
        expect(message.html).toContain('href="https://magnetic.example/invites/abc"');
    });
});

describe('Invites emailed by the server', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let alice: string;
    const mailer = memoryMailer();
    let failing = false;
    // Sends through the memory mailer, or fails while failing is on, as a refused SES send would
    const switchable: Mailer = {
        invite: async (mail: InviteMail) => {
            if (failing) throw new Error('MessageRejected: Email address is not verified');
            await mailer.invite(mail);
        }
    };

    const send = (path: string, body: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser, mailer: switchable });
        const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice', redirect: 'manual' });
        alice = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
    });

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should email an invite, and still give its link when the email fails', async () => {
        // Arrange
        const org = (await (await send('/orgs', { name: 'Acme', slug: 'acme' })).json()) as { id: string };

        // Act
        const mailed = (await (await send(`/orgs/${org.id}/invites`, { email: 'Ada@Example.com', role: 'builder' })).json()) as { link: string; mailed: boolean };
        failing = true;
        const unmailed = await send(`/orgs/${org.id}/invites`, { email: 'bob@example.com', role: 'member' });
        const unmailedBody = (await unmailed.json()) as { link: string; mailed: boolean };
        failing = false;

        // Assert
        expect(mailed.mailed).toBe(true);
        expect(mailer.sent).toEqual([{ to: 'ada@example.com', orgName: 'Acme', inviterName: 'alice', role: 'a builder', link: mailed.link, expiresAt: expect.any(String) }]);
        expect(unmailed.status).toBe(201);
        expect(unmailedBody).toMatchObject({ mailed: false, link: expect.stringContaining('/invites/') });
        expect(mailer.sent).toHaveLength(1);
    });
});
