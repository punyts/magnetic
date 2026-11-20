-- SCIM provisioning per org (docs/design/magnetic-scim.md): the org's identity provider pushes its people and groups.
-- A row in org_scim is SCIM on; only the SHA-256 of its token is kept. A pushed person is held, keyed by email, until
-- they sign in (user_id then names their account); a pushed group is an org_group the provider owns
CREATE TABLE org_scim (
    org_id uuid PRIMARY KEY REFERENCES org (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);

CREATE TABLE scim_user (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org (id) ON DELETE CASCADE,
    external_id text,
    user_name text NOT NULL,
    email text NOT NULL,
    display_name text,
    given_name text,
    family_name text,
    active boolean NOT NULL DEFAULT true,
    user_id uuid REFERENCES app_user (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scim_user_name ON scim_user (org_id, lower(user_name));
CREATE UNIQUE INDEX scim_user_email ON scim_user (org_id, lower(email));
CREATE UNIQUE INDEX scim_user_account ON scim_user (org_id, user_id);
CREATE INDEX scim_user_by_email ON scim_user (lower(email)) WHERE user_id IS NULL;

-- A group the provider pushed: its members as the provider names them, linked or not yet
ALTER TABLE org_group ADD COLUMN scim boolean NOT NULL DEFAULT false;
ALTER TABLE org_group ADD COLUMN external_id text;
ALTER TABLE org_group ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE scim_group_member (
    group_id uuid NOT NULL REFERENCES org_group (id) ON DELETE CASCADE,
    scim_user_id uuid NOT NULL REFERENCES scim_user (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, scim_user_id)
);
CREATE INDEX scim_group_member_user ON scim_group_member (scim_user_id);
