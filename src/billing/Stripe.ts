import { createHmac, timingSafeEqual } from 'node:crypto';

/** How Magnetic reaches Stripe: the keys come from the environment, never a page or a document */
export interface StripeOptions {
    /** The secret key (sk_live_… or sk_test_…) */
    readonly secretKey: string;
    /** The signing secret of the webhook endpoint (whsec_…) */
    readonly webhookSecret: string;
    /** Default https://api.stripe.com; a stand-in for tests */
    readonly api?: string;
    /** Replaces fetch, for tests */
    readonly fetch?: typeof fetch;
}

/** A checkout started: where to send the person */
export interface Checkout {
    readonly id: string;
    readonly url: string;
}

/** What a signed webhook said that Magnetic acts on */
export type PaymentEvent =
    | { readonly kind: 'paid'; readonly session: string; readonly userId: string; readonly dollars: number; readonly paymentIntent?: string }
    | { readonly kind: 'refunded'; readonly paymentIntent: string; readonly dollars: number }
    | { readonly kind: 'ignored'; readonly type: string };

export class PaymentError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

/** Five minutes either way, as Stripe's own libraries allow */
const TOLERANCE_SECONDS = 300;

/**
 * Stripe Checkout in payment mode (docs/design/magnetic-payments.md): a hosted page per purchase, and a signed webhook
 * that says it was paid or refunded. Called with fetch, form-encoded, as Stripe's API takes it
 */
export class Stripe {
    private readonly api: string;
    private readonly fetch: typeof fetch;

    constructor(private readonly options: StripeOptions) {
        this.api = (options.api ?? 'https://api.stripe.com').replace(/\/$/, '');
        this.fetch = options.fetch ?? fetch;
    }

    /** Where the hosted checkout pages are, which the Agent use page's form may go on to */
    get checkoutOrigin(): string {
        return this.options.api === undefined ? 'https://checkout.stripe.com' : new URL(this.api).origin;
    }

    /** A checkout session for `dollars` of agent use for a person; the person comes back to `back` either way */
    async checkout(input: { readonly userId: string; readonly email?: string; readonly dollars: number; readonly productName: string; readonly success: string; readonly cancel: string }): Promise<Checkout> {
        const form = new URLSearchParams({
            mode: 'payment',
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': 'usd',
            'line_items[0][price_data][unit_amount]': String(Math.round(input.dollars * 100)),
            'line_items[0][price_data][product_data][name]': input.productName,
            client_reference_id: input.userId,
            'metadata[user_id]': input.userId,
            'payment_intent_data[metadata][user_id]': input.userId,
            success_url: input.success,
            cancel_url: input.cancel
        });
        if (input.email !== undefined) form.set('customer_email', input.email);
        const response = await this.fetch(`${this.api}/v1/checkout/sessions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.options.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString()
        });
        const body = (await response.json().catch(() => ({}))) as { id?: unknown; url?: unknown; error?: { message?: unknown } };
        if (!response.ok || typeof body.id !== 'string' || typeof body.url !== 'string') {
            throw new PaymentError(502, `The payment provider did not start a checkout${typeof body.error?.message === 'string' ? `: ${body.error.message}` : ''}.`);
        }
        return { id: body.id, url: body.url };
    }

    /** The event a webhook carries, once its signature is checked; throws PaymentError 400 when it does not hold */
    event(body: string, signature: string | undefined, now: Date = new Date()): PaymentEvent {
        verifySignature(body, signature, this.options.webhookSecret, now);
        let event: { type?: unknown; data?: { object?: Record<string, unknown> } };
        try {
            event = JSON.parse(body) as typeof event;
        } catch {
            throw new PaymentError(400, 'The event is not JSON.');
        }
        const type = typeof event.type === 'string' ? event.type : '';
        const object = event.data?.object ?? {};
        if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
            const metadata = (object['metadata'] ?? {}) as Record<string, unknown>;
            const userId = typeof metadata['user_id'] === 'string' ? metadata['user_id'] : object['client_reference_id'];
            if (object['payment_status'] !== 'paid' || object['currency'] !== 'usd' || typeof userId !== 'string' || typeof object['id'] !== 'string' || typeof object['amount_total'] !== 'number') return { kind: 'ignored', type };
            return {
                kind: 'paid',
                session: object['id'],
                userId,
                dollars: object['amount_total'] / 100,
                ...(typeof object['payment_intent'] === 'string' && { paymentIntent: object['payment_intent'] })
            };
        }
        if (type === 'charge.refunded') {
            if (typeof object['payment_intent'] !== 'string' || typeof object['amount_refunded'] !== 'number' || object['currency'] !== 'usd') return { kind: 'ignored', type };
            return { kind: 'refunded', paymentIntent: object['payment_intent'], dollars: object['amount_refunded'] / 100 };
        }
        return { kind: 'ignored', type };
    }
}

/** The `Stripe-Signature` header a body gets with a secret at a time: what Stripe sends, and what tests send */
export function signatureOf(body: string, secret: string, at: Date = new Date()): string {
    const t = Math.floor(at.getTime() / 1000);
    return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

function verifySignature(body: string, header: string | undefined, secret: string, now: Date): void {
    if (header === undefined || header === '') throw new PaymentError(400, 'The event is not signed.');
    const parts = header.split(',').map((part) => part.trim().split('='));
    const t = Number(parts.find(([key]) => key === 't')?.[1]);
    const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
    if (!Number.isFinite(t) || signatures.length === 0) throw new PaymentError(400, 'The event is not signed.');
    if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) throw new PaymentError(400, 'The event is too old.');
    const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
    const matches = signatures.some((signature) => {
        const given = Buffer.from(signature);
        return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!matches) throw new PaymentError(400, 'The event signature does not match.');
}
