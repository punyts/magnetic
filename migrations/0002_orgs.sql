-- Orgs: a company, its members (employees) with one role each, groups of members, invites, its workspace, and who may
-- do what with each app of a workspace. See docs/design/magnetic-postgres.md (Orgs, members and groups; Roles and app
-- permissions)

CREATE TABLE org (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name text NOT NULL,
    created_by uuid NOT NULL REFERENCES app_user (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- A member's role: owner (everything, at least one per org), admin (members, groups, invites, access, every app),
-- builder (makes apps, edits those its access allows), member (uses the apps its access allows)
CREATE TABLE org_member (
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'builder', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_member_user ON org_member (user_id);

-- A department or team: app access given to a group follows people as they join and leave it
CREATE TABLE org_group (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_group_name UNIQUE (org_id, name)
);

CREATE TABLE org_group_member (
    group_id uuid NOT NULL REFERENCES org_group (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX org_group_member_user ON org_group_member (user_id);

-- An invite to an org by email, with the role and groups to join with. Only the SHA-256 of its token is kept
CREATE TABLE org_invite (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'builder', 'member')),
    groups uuid[] NOT NULL DEFAULT '{}',
    token_hash text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES app_user (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    accepted_by uuid REFERENCES app_user (id)
);
CREATE INDEX org_invite_org ON org_invite (org_id);

-- A workspace: a user's own (its id is the user's id) or an org's
CREATE TABLE workspace (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('personal', 'org')),
    user_id uuid UNIQUE REFERENCES app_user (id) ON DELETE CASCADE,
    org_id uuid UNIQUE REFERENCES org (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'personal' AND user_id IS NOT NULL AND org_id IS NULL AND id = user_id) OR (kind = 'org' AND org_id IS NOT NULL AND user_id IS NULL))
);

-- Who may do what with one app of a workspace: a member or a group, with one permission
CREATE TABLE app_access (
    workspace_id uuid NOT NULL,
    app_id uuid NOT NULL,
    principal_kind text NOT NULL CHECK (principal_kind IN ('user', 'group')),
    principal_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('manage', 'edit', 'use', 'view')),
    granted_by uuid,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, app_id, principal_kind, principal_id)
);

-- What an app of an org workspace is, beyond its part: who made it (they manage it) and whether every member may use it
CREATE TABLE app_setting (
    workspace_id uuid NOT NULL,
    app_id uuid NOT NULL,
    created_by uuid,
    open_to_org boolean NOT NULL DEFAULT false,
    PRIMARY KEY (workspace_id, app_id)
);

-- Every change of people, access, links, policies and apps, and every support view of a member's state. Append only
CREATE TABLE audit_event (
    id bigserial PRIMARY KEY,
    org_id uuid,
    workspace_id uuid,
    actor_id uuid,
    action text NOT NULL,
    target_kind text,
    target_id text,
    detail jsonb NOT NULL DEFAULT '{}',
    ip text,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_org ON audit_event (org_id, at);
