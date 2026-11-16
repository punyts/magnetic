-- Connections to outside APIs (docs/design/magnetic-m8.md, N6). A connection belongs to a workspace (a person's or an
-- org's) and is used by the apps in it, through the logic effect `http`. Its secrets (a key, a client secret, tokens)
-- are kept sealed with the server's key (SecretBox) in `secrets`, never sent to a browser or written into a document.
-- Like the org tables it has no row-level security: only the server reaches it, always by workspace
CREATE TABLE connection (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{0,39}$'),
    base_url text NOT NULL,
    -- How it signs in: { "kind": "none" | "key" | "oauth-client" | "oauth-code", and the parts that are not secret }
    auth jsonb NOT NULL DEFAULT '{"kind": "none"}',
    -- Sealed JSON of the secrets: key, clientSecret, accessToken, refreshToken, expiresAt
    secrets text,
    -- [{ name, method, path, query, body, records }]
    endpoints jsonb NOT NULL DEFAULT '[]',
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

-- The OAuth sign-ins started and not finished: the state sent to the provider, its PKCE verifier, for ten minutes
CREATE TABLE connection_oauth (
    state_hash text PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES connection (id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    verifier text NOT NULL,
    expires_at timestamptz NOT NULL
);
