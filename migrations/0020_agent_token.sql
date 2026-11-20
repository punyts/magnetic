-- An agent signed in as a person (docs/design/statenet-network.md, S10b): a standalone stateui-mcp asks in the
-- person's browser (the authorization code flow with PKCE and a loopback redirect), and gets tokens that act as them.
-- Both hang on the browser session that allowed them, so signing that session out ends the agent's access. Only
-- hashes are kept

-- An ask the person has seen, and once they allow it the code it was answered with
CREATE TABLE agent_code (
    request_hash text PRIMARY KEY,
    code_hash text UNIQUE,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    session_hash text NOT NULL REFERENCES session (token_hash) ON DELETE CASCADE,
    challenge text NOT NULL,
    redirect_uri text NOT NULL,
    state text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX agent_code_by_expiry ON agent_code (expires_at);

-- A token pair: the access token for an hour, the refresh token, used once, for 30 days and never past its session
CREATE TABLE agent_token (
    access_hash text PRIMARY KEY,
    refresh_hash text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    session_hash text NOT NULL REFERENCES session (token_hash) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL
);
CREATE INDEX agent_token_by_expiry ON agent_token (refresh_expires_at);
CREATE INDEX agent_token_by_session ON agent_token (session_hash);
