-- Magnetic's schema, on top of @punyts/stateui-pg's: people, orgs and their sign-in, permissions, owner keys, the
-- agent's spend and chats, payments, feedback, Magnetic's pages and the audit log. Magnetic had no users when its
-- migrations were folded into this file (owner, 2026-11-22); a schema change edits it and the databases are reset.

-- The audit log is append only: an event is never changed or deleted, by the server or anyone else
CREATE FUNCTION audit_event_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'The audit log is append only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Every owner has a number from one sequence: people and orgs as they come, after Magnetic's own two
-- (statenet_system_owner)
CREATE SEQUENCE statenet_owner_number AS bigint START 3;

-- A person with a Magnetic account. Their own workspace has their id
CREATE TABLE app_user (
    id uuid NOT NULL,
    name text NOT NULL,
    email text,
    email_verified boolean DEFAULT false NOT NULL,
    picture text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_number bigint DEFAULT nextval('statenet_owner_number'::regclass) NOT NULL,
    CONSTRAINT app_user_owner_number_key UNIQUE (owner_number),
    CONSTRAINT app_user_pkey PRIMARY KEY (id)
);

-- An organisation: its members, groups, invites, domains, sign-in and policy are the org_* tables
CREATE TABLE org (
    id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    -- null for an org the server made (docs/design/magnetic-orgs-and-invites.md)
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_number bigint DEFAULT nextval('statenet_owner_number'::regclass) NOT NULL,
    CONSTRAINT org_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'::text)),
    CONSTRAINT org_owner_number_key UNIQUE (owner_number),
    CONSTRAINT org_pkey PRIMARY KEY (id),
    CONSTRAINT org_slug_key UNIQUE (slug),
    CONSTRAINT org_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id)
);

-- A provider's stable id of a person (OIDC `sub`) points at one user; a second provider can point at the same user
CREATE TABLE identity (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid,
    CONSTRAINT identity_pkey PRIMARY KEY (provider, subject),
    CONSTRAINT identity_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE,
    CONSTRAINT identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX identity_user ON identity USING btree (user_id);

-- Only the SHA-256 of a session token is kept, so a copy of the table opens no session
CREATE TABLE session (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT session_pkey PRIMARY KEY (token_hash),
    CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX session_by_expiry ON session USING btree (expires_at);
CREATE INDEX session_by_user ON session USING btree (user_id);

-- What each model request cost: budgets sum it per UTC day and user, and per UTC month
CREATE TABLE agent_request (
    id bigserial,
    user_id uuid NOT NULL,
    workspace_id uuid,
    app_id uuid,
    model text,
    input_tokens integer,
    output_tokens integer,
    cache_creation_input_tokens integer,
    cache_read_input_tokens integer,
    dollars numeric(14,6) NOT NULL,
    at timestamp with time zone NOT NULL,
    CONSTRAINT agent_request_pkey PRIMARY KEY (id)
);
CREATE INDEX agent_request_at ON agent_request USING btree (at);
CREATE INDEX agent_request_user_at ON agent_request USING btree (user_id, at);
CREATE INDEX agent_request_workspace ON agent_request USING btree (workspace_id, at);

-- The chat of each person with the agent about one app of a workspace
CREATE TABLE chat_entry (
    id bigserial,
    workspace_id uuid NOT NULL,
    app_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    tools jsonb,
    outcome text,
    message text,
    at timestamp with time zone NOT NULL,
    CONSTRAINT chat_entry_role_check CHECK ((role = ANY (ARRAY['person'::text, 'agent'::text]))),
    CONSTRAINT chat_entry_pkey PRIMARY KEY (id)
);
CREATE INDEX chat_entry_thread ON chat_entry USING btree (workspace_id, app_id, user_id, id);

-- What Magnetic last made of its own apps in a workspace (Your apps, the editor, the pages), so each is made again when its definition changes
CREATE TABLE workspace_stamp (
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    value jsonb NOT NULL,
    CONSTRAINT workspace_stamp_pkey PRIMARY KEY (workspace_id, name)
);

-- How a person wants Magnetic to look and speak
CREATE TABLE user_preference (
    user_id uuid NOT NULL,
    prefs jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preference_pkey PRIMARY KEY (user_id)
);

-- A member's role: owner (everything, at least one per org), admin (members, groups, invites, access, every app),
-- builder (makes apps, edits those its access allows), member (uses the apps its access allows)
CREATE TABLE org_member (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_member_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'builder'::text, 'member'::text]))),
    CONSTRAINT org_member_pkey PRIMARY KEY (org_id, user_id),
    CONSTRAINT org_member_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE,
    CONSTRAINT org_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX org_member_user ON org_member USING btree (user_id);

-- A department or team: app access given to a group follows people as they join and leave it
CREATE TABLE org_group (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scim boolean DEFAULT false NOT NULL,
    external_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_group_name UNIQUE (org_id, name),
    CONSTRAINT org_group_pkey PRIMARY KEY (id),
    CONSTRAINT org_group_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

CREATE TABLE org_group_member (
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT org_group_member_pkey PRIMARY KEY (group_id, user_id),
    CONSTRAINT org_group_member_group_id_fkey FOREIGN KEY (group_id) REFERENCES org_group(id) ON DELETE CASCADE,
    CONSTRAINT org_group_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX org_group_member_user ON org_group_member USING btree (user_id);

-- An invite to an org by email, with the role and groups to join with. Only the SHA-256 of its token is kept
CREATE TABLE org_invite (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    groups uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    token_hash text NOT NULL,
    -- null for an invite from Magnetic itself
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    declined_at timestamp with time zone,
    CONSTRAINT org_invite_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'builder'::text, 'member'::text]))),
    CONSTRAINT org_invite_pkey PRIMARY KEY (id),
    CONSTRAINT org_invite_token_hash_key UNIQUE (token_hash),
    CONSTRAINT org_invite_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES app_user(id),
    CONSTRAINT org_invite_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id),
    CONSTRAINT org_invite_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);
CREATE INDEX org_invite_email ON org_invite USING btree (email) WHERE ((accepted_at IS NULL) AND (declined_at IS NULL));
CREATE INDEX org_invite_org ON org_invite USING btree (org_id);

-- A workspace: a user's own (its id is the user's id) or an org's
CREATE TABLE workspace (
    id uuid NOT NULL,
    kind text NOT NULL,
    user_id uuid,
    org_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_check CHECK ((((kind = 'personal'::text) AND (user_id IS NOT NULL) AND (org_id IS NULL) AND (id = user_id)) OR ((kind = 'org'::text) AND (org_id IS NOT NULL) AND (user_id IS NULL)))),
    CONSTRAINT workspace_kind_check CHECK ((kind = ANY (ARRAY['personal'::text, 'org'::text]))),
    CONSTRAINT workspace_org_id_key UNIQUE (org_id),
    CONSTRAINT workspace_pkey PRIMARY KEY (id),
    CONSTRAINT workspace_user_id_key UNIQUE (user_id),
    CONSTRAINT workspace_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE,
    CONSTRAINT workspace_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

-- Every change of people, access, links, policies and apps, and every support view of a member's state. Append only
CREATE TABLE audit_event (
    id bigserial,
    org_id uuid,
    workspace_id uuid,
    actor_id uuid,
    action text NOT NULL,
    target_kind text,
    target_id text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_event_pkey PRIMARY KEY (id)
);
CREATE INDEX audit_event_org ON audit_event USING btree (org_id, at);
CREATE TRIGGER audit_event_append_only BEFORE DELETE OR UPDATE ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();

-- An email domain an org claims. Its owner proves it with a DNS TXT record holding the token; only a verified domain
-- routes sign-in to the org's provider or lets people join by it
CREATE TABLE org_domain (
    org_id uuid NOT NULL,
    domain text NOT NULL,
    txt_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    CONSTRAINT org_domain_domain_check CHECK ((domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'::text)),
    CONSTRAINT org_domain_domain_key UNIQUE (domain),
    CONSTRAINT org_domain_pkey PRIMARY KEY (org_id, domain),
    CONSTRAINT org_domain_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

-- The org's own OpenID Connect provider (Okta, Entra ID, Google Workspace). The client secret is encrypted with the
-- server's key (AES-256-GCM), never kept as typed
CREATE TABLE org_sso (
    org_id uuid NOT NULL,
    issuer text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_sso_pkey PRIMARY KEY (org_id),
    CONSTRAINT org_sso_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

-- The org's policies; a policy not set has its default (docs: personalWorkspaces on, externalLinks off, autoJoin off,
-- requireSso off, every model, data kept, no org budget)
CREATE TABLE org_policy (
    org_id uuid NOT NULL,
    policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_policy_pkey PRIMARY KEY (org_id),
    CONSTRAINT org_policy_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

-- One Ed25519 signing key per owner (docs/design/statenet-relays.md, "Keys"), its private part sealed with the
-- server's key. The certificate authority that signs the servers' and relays' node certificates is the key of the
-- owner 'statenet'
CREATE TABLE owner_key (
    kid text NOT NULL,
    owner_id text NOT NULL,
    public_key text NOT NULL,
    private_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT owner_key_pkey PRIMARY KEY (kid)
);
CREATE INDEX owner_key_owner ON owner_key USING btree (owner_id, created_at);

-- The workspace each statenet namespace's app is in (docs/design/statenet-relays.md, "Topology, in steps", 3): the
-- server that takes a namespace over starts its instance there. No row-level security: only Magnetic's servers reach
-- it, and it holds no state
CREATE TABLE statenet_namespace (
    address text NOT NULL,
    workspace_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT statenet_namespace_pkey PRIMARY KEY (address)
);

-- Connections to outside APIs (docs/design/magnetic-m8.md, N6). A connection belongs to a workspace (a person's or an
-- org's) and is used by the apps in it, through the logic effect `http`. Its secrets (a key, a client secret, tokens)
-- are kept sealed with the server's key (SecretBox) in `secrets`, never sent to a browser or written into a document.
-- Like the org tables it has no row-level security: only the server reaches it, always by workspace
CREATE TABLE connection (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    auth jsonb DEFAULT '{"kind": "none"}'::jsonb NOT NULL,
    secrets text,
    endpoints jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connection_name_check CHECK ((name ~ '^[a-z][a-z0-9-]{0,39}$'::text)),
    CONSTRAINT connection_pkey PRIMARY KEY (id),
    CONSTRAINT connection_workspace_id_name_key UNIQUE (workspace_id, name)
);

-- The OAuth sign-ins started and not finished: the state sent to the provider, its PKCE verifier, for ten minutes
CREATE TABLE connection_oauth (
    state_hash text NOT NULL,
    connection_id uuid NOT NULL,
    user_id uuid NOT NULL,
    verifier text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT connection_oauth_pkey PRIMARY KEY (state_hash),
    CONSTRAINT connection_oauth_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES connection(id) ON DELETE CASCADE
);

-- Paying for agent use after the allowance (docs/design/magnetic-payments.md). A ledger of what each person bought:
-- one row per payment (+dollars), keyed by the provider's checkout session, and one per payment's refunds (-dollars,
-- the refunded total, updated in place), keyed by its payment intent, so a webhook delivered twice adds nothing.
-- Only the server reaches it, always by person
CREATE TABLE agent_credit (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    dollars numeric(14,2) NOT NULL,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    payment_intent text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    given_by uuid,
    CONSTRAINT agent_credit_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'refund'::text, 'gift'::text]))),
    CONSTRAINT agent_credit_pkey PRIMARY KEY (id),
    CONSTRAINT agent_credit_provider_ref_key UNIQUE (provider_ref)
);
CREATE INDEX agent_credit_user ON agent_credit USING btree (user_id, at);

-- What people send from the editor's bug button (docs/design/magnetic-feedback.md): a bug, a comment or a feature
-- request, with where it was sent from. Only the server reaches it; it goes with the person's account
CREATE TABLE feedback (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    text text NOT NULL,
    workspace_id uuid,
    app_id uuid,
    app_name text,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_agent text,
    at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    handled_by uuid,
    handled_at timestamp with time zone,
    CONSTRAINT feedback_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'comment'::text, 'feature'::text]))),
    CONSTRAINT feedback_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text]))),
    CONSTRAINT feedback_text_check CHECK (((length(text) >= 1) AND (length(text) <= 4000))),
    CONSTRAINT feedback_pkey PRIMARY KEY (id),
    CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX feedback_at ON feedback USING btree (at);
CREATE INDEX feedback_open ON feedback USING btree (status, at);
CREATE INDEX feedback_user ON feedback USING btree (user_id, at);

-- Magnetic's own pages as an admin published them (docs/design/magnetic-editable.md): the assembled document and icons
-- a page serves, the app and the parts it reaches that a person's copy is made from, the English of each text at the
-- publish (to drop the translations of texts that changed since), and who published it when. Without a row a page is
-- served from Magnetic's code. `json`, not `jsonb`: key order matters
CREATE TABLE magnetic_page (
    name text NOT NULL,
    stamp text NOT NULL,
    base text NOT NULL,
    document json NOT NULL,
    icons json NOT NULL,
    parts json NOT NULL,
    english json NOT NULL,
    published_by uuid NOT NULL,
    published_at timestamp with time zone NOT NULL,
    CONSTRAINT magnetic_page_pkey PRIMARY KEY (name)
);

-- Each person's answer to an app shared with them (docs/design/magnetic-home.md): an app shared through a link they
-- opened, or an app of their org they may open, waits on Your apps until they accept it (it joins their apps) or reject
-- it (it goes, with their membership of its links). `app_id` is text: an org's starter apps have names for ids
CREATE TABLE share_answer (
    user_id uuid NOT NULL,
    app_id text NOT NULL,
    answer text NOT NULL,
    answered_at timestamp with time zone NOT NULL,
    CONSTRAINT share_answer_answer_check CHECK ((answer = ANY (ARRAY['accepted'::text, 'rejected'::text]))),
    CONSTRAINT share_answer_pkey PRIMARY KEY (user_id, app_id)
);

-- Where each person left a view of the editor, per app (docs/design/magnetic-statenet-diagram.md): Statenet's pan and
-- zoom, so it opens as they left it in any browser. Keyed by person, not workspace, so it has no row-level security.
-- `app_id` is text, as in share_answer; `value` is json, as StateUI JSON is
CREATE TABLE editor_view (
    user_id uuid NOT NULL,
    app_id text NOT NULL,
    view text NOT NULL,
    value json NOT NULL,
    kept_at timestamp with time zone NOT NULL,
    CONSTRAINT editor_view_view_check CHECK ((view = ANY (ARRAY['statenet'::text, 'screens'::text]))),
    CONSTRAINT editor_view_pkey PRIMARY KEY (user_id, app_id, view)
);

-- Magnetic's two workspaces that are nobody's account: its own pages, and the admins' drafts of them
-- (`src/inspector/constants.ts`). They are owners 1 and 2 on every database
CREATE TABLE statenet_system_owner (
    id uuid NOT NULL,
    name text NOT NULL,
    owner_number bigint NOT NULL,
    CONSTRAINT statenet_system_owner_owner_number_key UNIQUE (owner_number),
    CONSTRAINT statenet_system_owner_pkey PRIMARY KEY (id)
);

-- Sign in another device (docs/design/statenet-network.md, S10): a link a signed-in person makes, used once within
-- ten minutes. Only the token's hash is kept
CREATE TABLE device_link (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT device_link_pkey PRIMARY KEY (token_hash),
    CONSTRAINT device_link_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX device_link_by_expiry ON device_link USING btree (expires_at);

-- An ask the person has seen, and once they allow it the code it was answered with
CREATE TABLE agent_code (
    request_hash text NOT NULL,
    code_hash text,
    user_id uuid NOT NULL,
    session_hash text NOT NULL,
    challenge text NOT NULL,
    redirect_uri text NOT NULL,
    state text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_code_code_hash_key UNIQUE (code_hash),
    CONSTRAINT agent_code_pkey PRIMARY KEY (request_hash),
    CONSTRAINT agent_code_session_hash_fkey FOREIGN KEY (session_hash) REFERENCES session(token_hash) ON DELETE CASCADE,
    CONSTRAINT agent_code_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX agent_code_by_expiry ON agent_code USING btree (expires_at);

-- A token pair: the access token for an hour, the refresh token, used once, for 30 days and never past its session
CREATE TABLE agent_token (
    access_hash text NOT NULL,
    refresh_hash text NOT NULL,
    user_id uuid NOT NULL,
    session_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    access_expires_at timestamp with time zone NOT NULL,
    refresh_expires_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_token_pkey PRIMARY KEY (access_hash),
    CONSTRAINT agent_token_refresh_hash_key UNIQUE (refresh_hash),
    CONSTRAINT agent_token_session_hash_fkey FOREIGN KEY (session_hash) REFERENCES session(token_hash) ON DELETE CASCADE,
    CONSTRAINT agent_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);
CREATE INDEX agent_token_by_expiry ON agent_token USING btree (refresh_expires_at);
CREATE INDEX agent_token_by_session ON agent_token USING btree (session_hash);

-- An org's own SAML 2.0 identity provider (docs/design/statenet-network.md, S12), the other kind of org sign-in beside
-- OpenID Connect (org_sso). One kind is switched on at a time. The provider's metadata is kept as last read, with what
-- was taken from it; a metadata URL is read again each day, and a failed read keeps the last good copy
CREATE TABLE org_saml (
    org_id uuid NOT NULL,
    metadata_url text,
    metadata_xml text NOT NULL,
    entity_id text NOT NULL,
    sso_url text NOT NULL,
    certificates text[] NOT NULL,
    email_attribute text,
    enabled boolean DEFAULT false NOT NULL,
    fetched_at timestamp with time zone,
    fetch_error text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_saml_pkey PRIMARY KEY (org_id),
    CONSTRAINT org_saml_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

-- A sign-in sent to an org's provider: the request id its answer must name, the hash of the key in the browser that
-- started it, and, once the provider's answer was checked, who it signed in. Taken once, within ten minutes
CREATE TABLE saml_request (
    id text NOT NULL,
    org_id uuid NOT NULL,
    browser_hash text NOT NULL,
    next text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    answered_at timestamp with time zone,
    subject text,
    profile json,
    CONSTRAINT saml_request_pkey PRIMARY KEY (id),
    CONSTRAINT saml_request_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);
CREATE INDEX saml_request_by_expiry ON saml_request USING btree (expires_at);

-- Each assertion accepted, by the hash of its issuer and id, until it would have expired: none is accepted twice
CREATE TABLE saml_assertion (
    key text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT saml_assertion_pkey PRIMARY KEY (key)
);
CREATE INDEX saml_assertion_by_expiry ON saml_assertion USING btree (expires_at);

-- SCIM provisioning per org (docs/design/magnetic-scim.md): the org's identity provider pushes its people and groups.
-- A row in org_scim is SCIM on; only the SHA-256 of its token is kept. A pushed person is held, keyed by email, until
-- they sign in (user_id then names their account); a pushed group is an org_group the provider owns
CREATE TABLE org_scim (
    org_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT org_scim_pkey PRIMARY KEY (org_id),
    CONSTRAINT org_scim_token_hash_key UNIQUE (token_hash),
    CONSTRAINT org_scim_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE
);

-- A person an org's identity provider pushed by SCIM, before and after they sign in
CREATE TABLE scim_user (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    external_id text,
    user_name text NOT NULL,
    email text NOT NULL,
    display_name text,
    given_name text,
    family_name text,
    active boolean DEFAULT true NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scim_user_pkey PRIMARY KEY (id),
    CONSTRAINT scim_user_org_id_fkey FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE,
    CONSTRAINT scim_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX scim_user_account ON scim_user USING btree (org_id, user_id);
CREATE INDEX scim_user_by_email ON scim_user USING btree (lower(email)) WHERE (user_id IS NULL);
CREATE UNIQUE INDEX scim_user_email ON scim_user USING btree (org_id, lower(email));
CREATE UNIQUE INDEX scim_user_name ON scim_user USING btree (org_id, lower(user_name));

CREATE TABLE scim_group_member (
    group_id uuid NOT NULL,
    scim_user_id uuid NOT NULL,
    CONSTRAINT scim_group_member_pkey PRIMARY KEY (group_id, scim_user_id),
    CONSTRAINT scim_group_member_group_id_fkey FOREIGN KEY (group_id) REFERENCES org_group(id) ON DELETE CASCADE,
    CONSTRAINT scim_group_member_scim_user_id_fkey FOREIGN KEY (scim_user_id) REFERENCES scim_user(id) ON DELETE CASCADE
);
CREATE INDEX scim_group_member_user ON scim_group_member USING btree (scim_user_id);

-- One table of path patterns per owner (docs/design/statenet-permissions.md, S14b). Every right is an entry: app
-- access in an org, an app open to the org, who made an org app, an org's owners and admins, share links and the
-- people who opened them, state grants, dataset shares and the org's standing read of a member's state. An entry is
-- never deleted, only revoked
CREATE TABLE permission (
    id uuid NOT NULL,
    owner numeric(20,0) NOT NULL,
    pattern text NOT NULL,
    subject text NOT NULL,
    rights text[] NOT NULL,
    parent uuid,
    kind text NOT NULL,
    made_by uuid,
    created_at timestamp with time zone NOT NULL,
    until timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    token text,
    label text,
    last_used_at timestamp with time zone,
    request_days integer,
    CONSTRAINT permission_request_days_check CHECK (((request_days >= 1) AND (request_days <= 30))),
    CONSTRAINT permission_kind_check CHECK ((kind = ANY (ARRAY['access.view'::text, 'access.use'::text, 'access.edit'::text, 'access.manage'::text, 'open'::text, 'creator'::text, 'admins'::text, 'link.view'::text, 'link.use'::text, 'link.remix'::text, 'opened'::text, 'share'::text, 'passed'::text, 'org-read'::text, 'bound'::text]))),
    CONSTRAINT permission_rights_check CHECK (((cardinality(rights) > 0) AND (rights <@ ARRAY['read'::text, 'request'::text, 'write'::text, 'share'::text]))),
    CONSTRAINT permission_pkey PRIMARY KEY (id),
    CONSTRAINT permission_token_key UNIQUE (token),
    CONSTRAINT permission_parent_fkey FOREIGN KEY (parent) REFERENCES permission(id)
);
CREATE INDEX permission_owner_subject ON permission USING btree (owner, subject);

-- What people using a workspace's apps may do to one of its datasets (docs/design/statenet-requests.md, R3c): write it,
-- or request changes that wait request_days for the owner. Keyed by the data part's id, so a rename keeps it; a
-- dataset without a row is written.
CREATE TABLE dataset_setting (
    workspace_id uuid NOT NULL,
    part_id uuid NOT NULL,
    bound_rights text NOT NULL,
    request_days integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by uuid,
    CONSTRAINT dataset_setting_pkey PRIMARY KEY (workspace_id, part_id),
    CONSTRAINT dataset_setting_rights_check CHECK ((bound_rights = ANY (ARRAY['write'::text, 'request'::text]))),
    CONSTRAINT dataset_setting_days_check CHECK (((request_days >= 1) AND (request_days <= 30)))
);
ALTER TABLE dataset_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_rows ON dataset_setting USING (workspace_id = ANY (app_workspace_ids())) WITH CHECK (workspace_id = ANY (app_workspace_ids()));
CREATE INDEX permission_parent ON permission USING btree (parent);
CREATE INDEX permission_pattern ON permission USING btree (pattern);

-- Every owner by its number: who it is, and the workspace that is its tree
CREATE VIEW statenet_owner AS
 SELECT app_user.owner_number AS number,
    'user'::text AS kind,
    app_user.id,
    app_user.id AS workspace_id
   FROM app_user
UNION ALL
 SELECT org.owner_number AS number,
    'org'::text AS kind,
    org.id,
    workspace.id AS workspace_id
   FROM (org
     LEFT JOIN workspace ON ((workspace.org_id = org.id)))
UNION ALL
 SELECT statenet_system_owner.owner_number AS number,
    'system'::text AS kind,
    statenet_system_owner.id,
    statenet_system_owner.id AS workspace_id
   FROM statenet_system_owner;

INSERT INTO statenet_system_owner (id, name, owner_number) VALUES
    ('00000000-0000-4000-8000-000000000000', 'Magnetic', 1),
    ('00000000-0000-4000-8000-000000000001', 'Magnetic pages', 2);
