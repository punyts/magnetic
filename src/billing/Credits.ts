import { randomUUID } from 'node:crypto';
import type { Database } from '@punyts/stateui-pg';

/** One row of a person's ledger: a payment (+dollars), a payment's refunds (-dollars), or agent use an admin gave (+dollars) */
export interface Credit {
    readonly id: string;
    readonly kind: 'payment' | 'refund' | 'gift';
    readonly dollars: number;
    readonly at: Date;
}

/**
 * What each person bought of agent use (`agent_credit`, docs/design/magnetic-payments.md): payments keyed by their
 * checkout session and refunds by their payment intent, so the same news from the provider twice adds nothing
 */
export class Credits {
    constructor(private readonly db: Database) {}

    /** Adds a paid checkout session; false when it was added before or the person is unknown */
    async paid(input: { readonly userId: string; readonly dollars: number; readonly provider: string; readonly session: string; readonly paymentIntent?: string }): Promise<boolean> {
        const person = (await this.db.query('SELECT 1 FROM app_user WHERE id::text = $1', [input.userId])).rows[0];
        if (person === undefined) return false;
        const added = await this.db.query(
            `INSERT INTO agent_credit (id, user_id, kind, dollars, provider, provider_ref, payment_intent)
             VALUES ($1, $2, 'payment', $3, $4, $5, $6) ON CONFLICT (provider_ref) DO NOTHING`,
            [randomUUID(), input.userId, input.dollars, input.provider, input.session, input.paymentIntent ?? null]
        );
        return (added.rowCount ?? 0) > 0;
    }

    /**
     * Sets the refunded total of a payment, found by its payment intent: the refund row says minus that total. False
     * when no payment has that intent
     */
    async refunded(input: { readonly provider: string; readonly paymentIntent: string; readonly dollars: number }): Promise<boolean> {
        const payment = (await this.db.query<{ user_id: string; dollars: number }>("SELECT user_id::text AS user_id, dollars FROM agent_credit WHERE kind = 'payment' AND payment_intent = $1", [input.paymentIntent])).rows[0];
        if (payment === undefined) return false;
        const refunded = Math.min(Number(payment.dollars), Math.max(0, input.dollars));
        await this.db.query(
            `INSERT INTO agent_credit (id, user_id, kind, dollars, provider, provider_ref, payment_intent)
             VALUES ($1, $2, 'refund', $3, $4, $5, $6)
             ON CONFLICT (provider_ref) DO UPDATE SET dollars = EXCLUDED.dollars, at = now()`,
            [randomUUID(), payment.user_id, -refunded, input.provider, `refund:${input.paymentIntent}`, input.paymentIntent]
        );
        return true;
    }

    /** Whether a checkout session has been paid and added */
    async hasSession(userId: string, session: string): Promise<number | undefined> {
        const row = (await this.db.query<{ dollars: number }>("SELECT dollars FROM agent_credit WHERE kind = 'payment' AND user_id::text = $1 AND provider_ref = $2", [userId, session])).rows[0];
        return row === undefined ? undefined : Number(row.dollars);
    }

    /** A person's ledger, the latest first */
    async of(userId: string): Promise<Credit[]> {
        const rows = (await this.db.query<{ id: string; kind: 'payment' | 'refund' | 'gift'; dollars: number; at: Date }>('SELECT id::text AS id, kind, dollars, at FROM agent_credit WHERE user_id::text = $1 ORDER BY at DESC, kind', [userId])).rows;
        return rows.map((row) => ({ id: row.id, kind: row.kind, dollars: Number(row.dollars), at: new Date(row.at) }));
    }
}
