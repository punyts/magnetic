import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../accounts/Accounts.js';
import type { Budgets } from '../agent/Budgets.js';
import type { Credits } from '../billing/Credits.js';
import { PaymentError } from '../billing/Stripe.js';
import type { Stripe } from '../billing/Stripe.js';
import { billingPage, usd } from '../http/billingPage.js';
import type { BillingView } from '../http/billingPage.js';
import type { BillingSaid } from '../http/billingText.js';
import type { PageLook } from '../http/pages.js';

/** The largest webhook body read: Stripe's events are a few kilobytes */
const MAX_EVENT_BYTES = 256 * 1024;

export interface BillingRouteContext {
    readonly budgets: Budgets;
    readonly credits: Credits;
    /** Absent: this server takes no payments, and the page only shows the balance */
    readonly stripe?: Stripe;
    /** The amounts offered, in dollars */
    readonly topUps: readonly number[];
    readonly signedIn: (request: IncomingMessage) => Promise<{ readonly user: User } | undefined>;
    readonly readForm: (request: IncomingMessage) => Promise<URLSearchParams>;
    readonly lookOf: (request: IncomingMessage, userId: string) => Promise<PageLook>;
    /** Sends a page; `formTargets` are the origins its forms may go on to besides this one */
    readonly sendPage: (response: ServerResponse, html: string, status?: number, formTargets?: readonly string[]) => void;
    readonly sendJson: (response: ServerResponse, status: number, body: unknown) => void;
    readonly redirect: (response: ServerResponse, location: string) => void;
    /** The origin people reach the server at, for the provider's way back */
    readonly origin: () => string;
    readonly report: (message: string, fields?: Record<string, unknown>) => void;
}

async function readText(request: IncomingMessage, limit: number): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > limit) throw new PaymentError(413, 'The event is too large.');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * `GET|POST /settings/billing`: what a person has of agent use and buttons to add more through Stripe Checkout; and
 * `POST /billing/stripe`, the webhook that adds what was paid and takes off what was refunded
 * (docs/design/magnetic-payments.md). Answers true when it handled the request
 */
export function billingRoutes(context: BillingRouteContext) {
    const { budgets, credits, stripe } = context;
    const topUps = stripe === undefined ? [] : context.topUps;

    async function show(request: IncomingMessage, response: ServerResponse, user: User, extra: Pick<BillingView, 'notice' | 'error' | 'pending'> = {}, status = 200): Promise<void> {
        const spent = await budgets.spent(user.id);
        const allowance = await budgets.allowanceOf(user.id);
        const full = budgets.limits.perUserTotal;
        const first = budgets.limits.allowanceUsers;
        context.sendPage(
            response,
            billingPage({ look: await context.lookOf(request, user.id), ...(allowance !== undefined && { allowance }), ...(allowance === 0 && full !== undefined && { firstOnly: { allowance: full, people: first, full: await budgets.allowanceFull() } }), bought: spent.bought, spent: spent.total, credits: await credits.of(user.id), topUps, ...extra }),
            status,
            stripe === undefined ? [] : [stripe.checkoutOrigin]
        );
    }

    async function webhook(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (stripe === undefined) {
            context.sendJson(response, 404, { message: 'This server takes no payments.' });
            return;
        }
        try {
            const signature = request.headers['stripe-signature'];
            const event = stripe.event(await readText(request, MAX_EVENT_BYTES), Array.isArray(signature) ? signature[0] : signature);
            if (event.kind === 'paid') {
                const added = await credits.paid({ userId: event.userId, dollars: event.dollars, provider: 'stripe', session: event.session, ...(event.paymentIntent !== undefined && { paymentIntent: event.paymentIntent }) });
                context.report(added ? 'Agent use paid' : 'Agent use payment seen before or for no one', { user: event.userId, dollars: event.dollars });
            } else if (event.kind === 'refunded') {
                const found = await credits.refunded({ provider: 'stripe', paymentIntent: event.paymentIntent, dollars: event.dollars });
                context.report(found ? 'Agent use refunded' : 'A refund of no payment here', { dollars: event.dollars });
            }
            context.sendJson(response, 200, { received: true });
        } catch (error) {
            if (!(error instanceof PaymentError)) throw error;
            context.report('Payment event refused', { reason: error.message });
            context.sendJson(response, error.status, { message: error.message });
        }
    }

    return async (request: IncomingMessage, response: ServerResponse, method: string, path: string, query: URLSearchParams): Promise<boolean> => {
        if (path === '/billing/stripe' && method === 'POST') {
            await webhook(request, response);
            return true;
        }
        if (path !== '/settings/billing') return false;
        const who = await context.signedIn(request);
        if (who === undefined) {
            context.redirect(response, `/signin?next=${encodeURIComponent('/settings/billing')}`);
            return true;
        }
        if (method === 'GET') {
            const session = query.get('paid');
            if (session !== null && session !== '') {
                const dollars = await credits.hasSession(who.user.id, session);
                const notice: BillingSaid = dollars === undefined ? { key: 'billing.pending' } : { key: 'billing.paid', values: { amount: usd(dollars) } };
                await show(request, response, who.user, { notice, ...(dollars === undefined && { pending: session }) });
            } else if (query.get('cancelled') !== null) await show(request, response, who.user, { notice: { key: 'billing.cancelled' } });
            else await show(request, response, who.user);
            return true;
        }
        if (method === 'POST') {
            const amount = Number((await context.readForm(request)).get('amount') ?? '');
            if (stripe === undefined || !topUps.includes(amount)) {
                await show(request, response, who.user, { error: { key: 'billing.badAmount' } }, 400);
                return true;
            }
            const back = `${context.origin()}/settings/billing`;
            try {
                const checkout = await stripe.checkout({
                    userId: who.user.id,
                    ...(who.user.email !== undefined && { email: who.user.email }),
                    dollars: amount,
                    productName: `Magnetic agent use (${usd(amount)})`,
                    success: `${back}?paid={CHECKOUT_SESSION_ID}`,
                    cancel: `${back}?cancelled=1`
                });
                context.report('Agent use checkout started', { user: who.user.id, dollars: amount });
                context.redirect(response, checkout.url);
            } catch (error) {
                if (!(error instanceof PaymentError)) throw error;
                context.report('Agent use checkout failed', { reason: error.message });
                await show(request, response, who.user, { error: { key: 'billing.failed' } }, 502);
            }
            return true;
        }
        return false;
    };
}
