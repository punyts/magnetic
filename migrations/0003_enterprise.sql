-- Enterprise controls: an org's verified email domains, its own OpenID Connect provider, its policies, and an audit
-- log nobody can change. See docs/design/magnetic-postgres.md (Enterprise controls)

-- An email domain an org claims. Its owner proves it with a DNS TXT record holding the token; only a verified domain
-- routes sign-in to the org's provider or lets people join by it
CREATE TABLE org_domain (
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    domain text NOT NULL UNIQUE CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    txt_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    PRIMARY KEY (org_id, domain)
);

-- The org's own OpenID Connect provider (Okta, Entra ID, Google Workspace). The client secret is encrypted with the
-- server's key (AES-256-GCM), never kept as typed
CREATE TABLE org_sso (
    org_id uuid PRIMARY KEY REFERENCES org (id) ON DELETE CASCADE,
    issuer text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- The org's policies; a policy not set has its default (docs: personalWorkspaces on, externalLinks off, autoJoin off,
-- requireSso off, every model, data kept, no org budget)
CREATE TABLE org_policy (
    org_id uuid PRIMARY KEY REFERENCES org (id) ON DELETE CASCADE,
    policy jsonb NOT NULL DEFAULT '{}',
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Which org's provider an identity came from, for an org's SSO identities
ALTER TABLE identity ADD COLUMN org_id uuid REFERENCES org (id) ON DELETE CASCADE;

-- Spend by org: an org's monthly budget sums its workspace's requests
CREATE INDEX agent_request_workspace ON agent_request (workspace_id, at);

-- The audit log is append only: an event is never changed or deleted, by the server or anyone else
CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'The audit log is append only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();
