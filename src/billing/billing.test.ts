import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import type { TestDatabase } from '@punyts/stateui-pg/testing';
import { startMagnetic } from '../server/startMagnetic.js';
import type { RunningMagnetic } from '../server/startMagnetic.js';
import { magneticTestDatabase } from '../testing/testDb.js';
import { signatureOf, Stripe } from './Stripe.js';

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

const WEBHOOK_SECRET = 'whsec_unit_test';

const paidEvent = (session: string, userId: string, cents: number, currency = 'usd'): string =>
    JSON.stringify({ id: `evt_${session}`, type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid', currency, amount_total: cents, payment_intent: `pi_${session}`, client_reference_id: userId, metadata: { user_id: userId } } } });

const refundEvent = (session: string, cents: number): string => JSON.stringify({ id: `evt_r_${session}`, type: 'charge.refunded', data: { object: { id: `ch_${session}`, currency: 'usd', payment_intent: `pi_${session}`, amount_refunded: cents } } });

describe('Stripe events', () => {
    const stripe = new Stripe({ secretKey: 'sk_test_unit', webhookSecret: WEBHOOK_SECRET });
    const NOW = new Date('2026-11-16T10:00:00Z');

    it('should read a paid checkout and a refund once their signature holds', () => {
        const body = paidEvent('cs_1', 'u1', 2500);
        expect(stripe.event(body, signatureOf(body, WEBHOOK_SECRET, NOW), NOW)).toEqual({ kind: 'paid', session: 'cs_1', userId: 'u1', dollars: 25, paymentIntent: 'pi_cs_1' });
        const refund = refundEvent('cs_1', 1000);
        expect(stripe.event(refund, signatureOf(refund, WEBHOOK_SECRET, NOW), NOW)).toEqual({ kind: 'refunded', paymentIntent: 'pi_cs_1', dollars: 10 });
    });

    it('should refuse an unsigned, wrongly signed, changed or old event, and ignore another currency', () => {
        const body = paidEvent('cs_2', 'u1', 1000);
        expect(() => stripe.event(body, undefined, NOW)).toThrow('not signed');
        expect(() => stripe.event(body, signatureOf(body, 'whsec_other', NOW), NOW)).toThrow('does not match');
        expect(() => stripe.event(body.replace('1000', '100000'), signatureOf(body, WEBHOOK_SECRET, NOW), NOW)).toThrow('does not match');
        expect(() => stripe.event(body, signatureOf(body, WEBHOOK_SECRET, new Date(NOW.getTime() - 10 * 60_000)), NOW)).toThrow('too old');
        const euros = paidEvent('cs_3', 'u1', 1000, 'eur');
        expect(stripe.event(euros, signatureOf(euros, WEBHOOK_SECRET, NOW), NOW)).toEqual({ kind: 'ignored', type: 'checkout.session.completed' });
    });
});

describe('Buying agent use after the allowance', () => {
    let test: TestDatabase;
    let magnetic: RunningMagnetic;
    let alice: { id: string; cookie: string };
    const asked: URLSearchParams[] = [];

    const fakeStripe: typeof fetch = async (_url, init) => {
        asked.push(new URLSearchParams(String(init?.body ?? '')));
        return new Response(JSON.stringify({ id: `cs_test_${asked.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${asked.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const page = async (query = ''): Promise<string> => (await fetch(`${magnetic.origin}/settings/billing${query}`, { headers: { cookie: alice.cookie } })).text();
    const buy = (amount: string): Promise<Response> =>
        fetch(`${magnetic.origin}/settings/billing`, { method: 'POST', redirect: 'manual', headers: { cookie: alice.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ amount }).toString() });
    const deliver = (body: string, secret = WEBHOOK_SECRET): Promise<Response> =>
        fetch(`${magnetic.origin}/billing/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signatureOf(body, secret) }, body });

    beforeAll(async () => {
        test = await magneticTestDatabase();
        magnetic = await startMagnetic({
            database: test.db,
            host: '127.0.0.1',
            port: 0,
            report: silent,
            devUsers: ['alice'],
            starter: 'none',
            browser: noBrowser,
            agent: { budgets: { perUserTotal: 5, dailyPerUser: 1, monthly: 100 } },
            payments: { stripe: { secretKey: 'sk_test_unit', webhookSecret: WEBHOOK_SECRET, fetch: fakeStripe }, topUps: [10, 25] }
        });
        const signedIn = await fetch(`${magnetic.origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=alice', redirect: 'manual' });
        const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] as string;
        alice = { cookie, id: (await magnetic.sessions.find(cookie.split('=')[1] as string))?.userId as string };
    }, 60_000);

    afterAll(async () => {
        await magnetic.stop();
        await test.drop();
    });

    it('should show the allowance and the amounts to add, and let the form go on to Stripe', async () => {
        const answer = await fetch(`${magnetic.origin}/settings/billing`, { headers: { cookie: alice.cookie } });
        const html = await answer.text();
        expect(html).toContain('<dt>Included with your account</dt><dd>$5.00</dd>');
        expect(html).toContain('<dt>Left</dt><dd><strong>$5.00</strong></dd>');
        expect(html).toContain('>Add $10.00</button>');
        expect(html).toContain('>Add $25.00</button>');
        expect(html).toContain('No payments yet.');
        expect(answer.headers.get('content-security-policy')).toContain("form-action 'self' https://checkout.stripe.com");
    });

    it('should start a checkout for an amount on offer, with the person on it, and refuse any other amount', async () => {
        // Act
        const started = await buy('10');

        // Assert
        expect(started.status).toBe(303);
        expect(started.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
        const form = asked[0] as URLSearchParams;
        expect(form.get('mode')).toBe('payment');
        expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
        expect(form.get('line_items[0][price_data][unit_amount]')).toBe('1000');
        expect(form.get('metadata[user_id]')).toBe(alice.id);
        expect(form.get('success_url')).toBe(`${magnetic.origin}/settings/billing?paid={CHECKOUT_SESSION_ID}`);
        const odd = await buy('7');
        expect(odd.status).toBe(400);
        expect(await odd.text()).toContain('Choose one of the amounts offered.');
        expect(asked).toHaveLength(1);
    });

    it('should refuse the agent past the allowance, then add a paid checkout once, however often the news comes', async () => {
        // Arrange: alice spent her allowance, more than a day's limit too
        await magnetic.budgets.charge(alice.id, 5.5);
        expect(await magnetic.budgets.check(alice.id)).toBe('You have used your $5 of agent use. Add more under Agent use on Your apps. Everything else still works: your apps, editing by hand and sharing.');
        expect(await page('?paid=cs_test_1')).toContain('Your payment is being confirmed');

        // Act
        const body = paidEvent('cs_test_1', alice.id, 1000);
        expect((await deliver(body)).status).toBe(200);
        expect((await deliver(body)).status).toBe(200);

        // Assert: $10 added once; paid use is not held to the daily limit
        expect((await magnetic.budgets.spent(alice.id)).bought).toBe(10);
        expect(await magnetic.budgets.check(alice.id)).toBeUndefined();
        const html = await page('?paid=cs_test_1');
        expect(html).toContain('$10.00 of agent use is added. Thank you.');
        expect(html).toContain('<dt>Left</dt><dd><strong>$9.50</strong></dd>');
        expect(html).toMatch(/<td>Payment<\/td><td>\$10\.00<\/td>/);
    });

    it('should add nothing for a forged event or one for no one', async () => {
        expect((await deliver(paidEvent('cs_forged', alice.id, 100000), 'whsec_forged')).status).toBe(400);
        expect((await deliver(paidEvent('cs_nobody', '00000000-0000-4000-8000-000000000999', 1000))).status).toBe(200);
        expect((await magnetic.budgets.spent(alice.id)).bought).toBe(10);
    });

    it('should take a refund off, and refuse the agent once what was added is spent', async () => {
        // Act
        expect((await deliver(refundEvent('cs_test_1', 400))).status).toBe(200);
        expect((await deliver(refundEvent('cs_test_1', 1000))).status).toBe(200);

        // Assert: the refunded total, not the sum of the news
        expect((await magnetic.budgets.spent(alice.id)).bought).toBe(0);
        expect(await page()).toMatch(/<td>Refund<\/td><td>−\$10\.00<\/td>/);
        expect(await magnetic.budgets.check(alice.id)).toContain('your $5 of agent use');
    });
});
