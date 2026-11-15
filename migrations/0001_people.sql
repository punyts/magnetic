-- Magnetic's people: users and their sign-in identities, sessions, share links, the agent's spend and chats

CREATE TABLE app_user (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    email text,
    email_verified boolean NOT NULL DEFAULT false,
    picture text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- A provider's stable id of a person (OIDC `sub`) points at one user; a second provider can point at the same user
CREATE TABLE identity (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX identity_user ON identity (user_id);

-- Only the SHA-256 of a session token is kept, so a copy of the table opens no session
CREATE TABLE session (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX session_by_user ON session (user_id);
CREATE INDEX session_by_expiry ON session (expires_at);

-- A link to one app of a workspace; `grant` is a reserved word
CREATE TABLE link_grant (
    id uuid PRIMARY KEY,
    token text NOT NULL UNIQUE,
    workspace_id uuid NOT NULL,
    app_id uuid NOT NULL,
    app_name text NOT NULL,
    "right" text NOT NULL CHECK ("right" IN ('use', 'view', 'remix')),
    created_by uuid,
    created_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX link_grant_app ON link_grant (workspace_id, app_id);
CREATE INDEX link_grant_app_id ON link_grant (app_id);

-- The people who opened a link
CREATE TABLE link_grant_member (
    grant_id uuid NOT NULL REFERENCES link_grant (id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    first_opened_at timestamptz NOT NULL,
    PRIMARY KEY (grant_id, user_id)
);
CREATE INDEX link_grant_member_user ON link_grant_member (user_id);

-- What each model request cost: budgets sum it per UTC day and user, and per UTC month
CREATE TABLE agent_request (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL,
    workspace_id uuid,
    app_id uuid,
    model text,
    input_tokens integer,
    output_tokens integer,
    cache_creation_input_tokens integer,
    cache_read_input_tokens integer,
    dollars numeric(14, 6) NOT NULL,
    at timestamptz NOT NULL
);
CREATE INDEX agent_request_user_at ON agent_request (user_id, at);
CREATE INDEX agent_request_at ON agent_request (at);

-- The chat of each person with the agent about one app of a workspace
CREATE TABLE chat_entry (
    id bigserial PRIMARY KEY,
    workspace_id uuid NOT NULL,
    app_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('person', 'agent')),
    text text NOT NULL,
    tools jsonb,
    outcome text,
    message text,
    at timestamptz NOT NULL
);
CREATE INDEX chat_entry_thread ON chat_entry (workspace_id, app_id, user_id, id);

-- What Magnetic last made of its own apps in a workspace (Your apps, the editor, the pages), so each is made again when its definition changes
CREATE TABLE workspace_stamp (
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    value jsonb NOT NULL,
    PRIMARY KEY (workspace_id, name)
);

-- How a person wants Magnetic to look and speak
CREATE TABLE user_preference (
    user_id uuid PRIMARY KEY,
    prefs jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
