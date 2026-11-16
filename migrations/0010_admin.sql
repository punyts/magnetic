-- The operator's admin pages (docs/design/magnetic-admin.md): feedback is open until an admin marks it done, and an
-- admin may give a person agent use (a gift in the ledger, with a note of why)
ALTER TABLE feedback ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done'));
ALTER TABLE feedback ADD COLUMN handled_by uuid;
ALTER TABLE feedback ADD COLUMN handled_at timestamptz;
CREATE INDEX feedback_open ON feedback (status, at);

ALTER TABLE agent_credit DROP CONSTRAINT agent_credit_kind_check;
ALTER TABLE agent_credit ADD CONSTRAINT agent_credit_kind_check CHECK (kind IN ('payment', 'refund', 'gift'));
ALTER TABLE agent_credit ADD COLUMN note text;
ALTER TABLE agent_credit ADD COLUMN given_by uuid;
