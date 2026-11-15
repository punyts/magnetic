-- Grants (docs/design/statenet-relays.md, "Grants" and "Keys"): one Ed25519 signing key per owner, its private part
-- sealed with the server's key, and every grant Magnetic issued, for Shared by me, audit and revocation.
--
-- A grant row is the standing right; the tokens Magnetic signs for it are short-lived and signed again while it is in
-- use. A grant passed on from another names it as its parent, and revoking a grant revokes everything passed on from it.

CREATE TABLE owner_key (
    kid text PRIMARY KEY,
    -- The owner as addresses name it: a user's id, or a workspace's
    owner_id text NOT NULL,
    public_key text NOT NULL,
    -- PKCS#8 DER, sealed with MAGNETIC_SECRET_KEY (SecretBox)
    private_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Grants issued after this no longer verify with it; those before it verify until they expire
    retired_at timestamptz
);
CREATE INDEX owner_key_owner ON owner_key (owner_id, created_at);

CREATE TABLE state_grant (
    id uuid PRIMARY KEY,
    -- 'share': an owner gave it; 'passed': a subject passed on part of one; 'org-read': the org's standing read of a member's state in its apps
    kind text NOT NULL CHECK (kind IN ('share', 'passed', 'org-read')),
    issuer text NOT NULL,
    subject text NOT NULL,
    address text NOT NULL,
    prefix text NOT NULL,
    rights text[] NOT NULL,
    parent_grant uuid REFERENCES state_grant (id) ON DELETE CASCADE,
    -- The org whose standing read it is, for 'org-read'
    org_id uuid,
    issued_at timestamptz NOT NULL DEFAULT now(),
    -- When the right ends; NULL for a standing grant that lasts until it is revoked (its tokens are still short-lived)
    expires_at timestamptz,
    revoked_at timestamptz,
    last_used_at timestamptz
);
CREATE INDEX state_grant_owner ON state_grant ((split_part(address, '/', 1)));
CREATE INDEX state_grant_issuer ON state_grant (issuer);
CREATE INDEX state_grant_subject ON state_grant (subject);
CREATE INDEX state_grant_parent ON state_grant (parent_grant);
