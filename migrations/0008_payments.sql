-- Paying for agent use after the allowance (docs/design/magnetic-payments.md). A ledger of what each person bought:
-- one row per payment (+dollars), keyed by the provider's checkout session, and one per payment's refunds (-dollars,
-- the refunded total, updated in place), keyed by its payment intent, so a webhook delivered twice adds nothing.
-- Only the server reaches it, always by person
CREATE TABLE agent_credit (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('payment', 'refund')),
    dollars numeric(14, 2) NOT NULL,
    provider text NOT NULL,
    -- The checkout session of a payment, or 'refund:<payment intent>' of a refund
    provider_ref text NOT NULL UNIQUE,
    payment_intent text,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_credit_user ON agent_credit (user_id, at);
