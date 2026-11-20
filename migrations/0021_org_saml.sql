-- An org's own SAML 2.0 identity provider (docs/design/statenet-network.md, S12), the other kind of org sign-in beside
-- OpenID Connect (org_sso). One kind is switched on at a time. The provider's metadata is kept as last read, with what
-- was taken from it; a metadata URL is read again each day, and a failed read keeps the last good copy
CREATE TABLE org_saml (
    org_id uuid PRIMARY KEY REFERENCES org (id) ON DELETE CASCADE,
    metadata_url text,
    metadata_xml text NOT NULL,
    entity_id text NOT NULL,
    sso_url text NOT NULL,
    certificates text[] NOT NULL,
    email_attribute text,
    enabled boolean NOT NULL DEFAULT false,
    fetched_at timestamptz,
    fetch_error text,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A sign-in sent to an org's provider: the request id its answer must name, the hash of the key in the browser that
-- started it, and, once the provider's answer was checked, who it signed in. Taken once, within ten minutes
CREATE TABLE saml_request (
    id text PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    browser_hash text NOT NULL,
    next text NOT NULL,
    expires_at timestamptz NOT NULL,
    answered_at timestamptz,
    subject text,
    profile json
);
CREATE INDEX saml_request_by_expiry ON saml_request (expires_at);

-- Each assertion accepted, by the hash of its issuer and id, until it would have expired: none is accepted twice
CREATE TABLE saml_assertion (
    key text PRIMARY KEY,
    expires_at timestamptz NOT NULL
);
CREATE INDEX saml_assertion_by_expiry ON saml_assertion (expires_at);
