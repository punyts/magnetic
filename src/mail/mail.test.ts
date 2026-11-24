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
    let aliceId: string;
    const mailer = memoryMailer();
    let failing = false;
    // Sends through the memory mailer, or fails while failing is on, as a refused SES send would
    const switchable: Mailer = {
        invite: async (mail: InviteMail) => {
            if (failing) throw new Error('MessageRejected: Email address is not verified');
            await mailer.invite(mail);
        },
        signInLink: (mail) => mailer.signInLink(mail)
    };

    const send = (path: string, body: unknown): Promise<Response> =>
        fetch(`${magnetic.origin}${path}`, { method: 'POST', redirect: 'manual', headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser, mailer: switchable });
        const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice', redirect: 'manual' });
        alice = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
        aliceId = (await magnetic.sessions.find(alice.split('=')[1] as string))?.userId as string;
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

    it('should mail a sign-in link only to an account with the address verified, say the same either way, and mail at most three in ten minutes', async () => {
        // Arrange
        await magnetic.database.query("UPDATE app_user SET email = 'alice@example.com', email_verified = true WHERE id = $1", [aliceId]);
        const ask = (email: string): Promise<Response> => fetch(`${magnetic.origin}/signin/sso?email=${encodeURIComponent(email)}`, { redirect: 'manual' });

        // Act
        const known = await ask('Alice@Example.com');
        const knownPage = await known.text();
        const unknown = await ask('nobody@example.com');
        const unknownPage = await unknown.text();
        const invalid = await ask('not-an-address');
        const link = mailer.signInSent[0]?.link as string;
        const token = link.split('/').at(-1) as string;
        const confirm = await fetch(link, { redirect: 'manual' });
        const used = await fetch(`${magnetic.origin}/signin/link`, { method: 'POST', redirect: 'manual', headers: { Origin: magnetic.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
        const session = (used.headers.get('set-cookie') ?? '').split(';')[0] as string;
        for (let i = 0; i < 4; i++) await (await ask('alice@example.com')).text();

        // Assert
        expect(known.status).toBe(200);
        expect(knownPage).toContain('If an account uses Alice@Example.com, we sent it a link to sign in.');
        expect(unknown.status).toBe(200);
        expect(unknownPage).toContain('If an account uses nobody@example.com, we sent it a link to sign in.');
        expect(invalid.status).toBe(400);
        expect(link).toMatch(/\/signin\/link\/[A-Za-z0-9_-]{43}$/);
        expect(mailer.signInSent[0]).toMatchObject({ to: 'alice@example.com', minutes: expect.any(Number) });
        expect(confirm.status).toBe(200);
        expect(used.status).toBe(303);
        expect((await magnetic.sessions.find(session.split('=')[1] as string))?.userId).toBe(aliceId);
        expect(mailer.signInSent).toHaveLength(3);
    });
});

describe("The server's own orgs", () => {
    let test: TestDatabase;

    beforeAll(async () => {
        test = await magneticTestDatabase();
    });

    afterAll(async () => {
        await test.drop();
    });

    it('should make the company and beta orgs with their budgets, and invite and email each admin once as an owner', async () => {
        // Arrange
        const mailer = memoryMailer();
        const serverOrgs = [
            { slug: 'acme', name: 'acme', pages: true as const, monthlyBudget: 50 },
            { slug: 'beta', name: 'Magnetic beta', monthlyBudget: 500 }
        ];
        const start = (): Promise<RunningMagnetic> => startMagnetic({ database: test.db, host: '127.0.0.1', port: 0, report: silent, starter: 'none', browser: noBrowser, mailer, admins: ['owner@example.com'], serverOrgs });

        // Act: two starts, as after a deploy
        const first = await start();
        await first.stop();
        const second = await start();
        const acme = await second.orgs.bySlug('acme');
        const beta = await second.orgs.bySlug('beta');
        const acmePolicy = await second.policies.get(acme?.id as string);
        const betaPolicy = await second.policies.get(beta?.id as string);
        await second.stop();

        // Assert
        expect(acme?.name).toBe('acme');
        expect(beta?.name).toBe('Magnetic beta');
        expect(acmePolicy).toMatchObject({ personalWorkspaces: false, monthlyBudget: 50 });
        expect(betaPolicy).toMatchObject({ personalWorkspaces: false, monthlyBudget: 500 });
        expect(mailer.sent.map((mail) => [mail.to, mail.orgName, mail.inviterName, mail.role])).toEqual([
            ['owner@example.com', 'acme', 'Magnetic', 'an owner'],
            ['owner@example.com', 'Magnetic beta', 'Magnetic', 'an owner']
        ]);
        expect(mailer.sent[0]?.link).toMatch(/\/invites\/[A-Za-z0-9_-]{43}$/);
        expect((await test.db.query('SELECT created_by FROM org_invite')).rows).toEqual([{ created_by: null }, { created_by: null }]);
    });
});
