-- One table of path patterns per owner (docs/design/statenet-permissions.md, S14b). Every right is an entry: app
-- access in an org, an app open to the org, who made an org app, an org's owners and admins, share links and the
-- people who opened them, state grants, dataset shares and the org's standing read of a member's state. The five
-- tables they were kept in move here and go. An entry is never deleted, only revoked
CREATE TABLE permission (
    id uuid PRIMARY KEY,
    -- The owner number whose tree the pattern is under
    owner numeric(20) NOT NULL,
    pattern text NOT NULL,
    -- owner:<number>, members:<org number>[.<role>], group:<org number>.<group id>, link:<id>, everyone
    subject text NOT NULL,
    rights text[] NOT NULL CHECK (cardinality(rights) > 0 AND rights <@ ARRAY['read', 'request', 'write', 'share']),
    parent uuid REFERENCES permission (id),
    -- What the entry stands for in Magnetic's pages; the check never reads it
    kind text NOT NULL CHECK (kind IN ('access.view', 'access.use', 'access.edit', 'access.manage', 'open', 'creator', 'admins', 'link.view', 'link.use', 'link.remix', 'opened', 'share', 'passed', 'org-read')),
    -- The person who made it (who opened a link, for 'opened')
    made_by uuid,
    created_at timestamptz NOT NULL,
    until timestamptz,
    revoked_at timestamptz,
    revoked_by uuid,
    -- A link's token, and the app's name when the link was made
    token text UNIQUE,
    label text,
    last_used_at timestamptz
);
CREATE INDEX permission_owner_subject ON permission (owner, subject);
CREATE INDEX permission_parent ON permission (parent);
CREATE INDEX permission_pattern ON permission (pattern);

-- An org's owners and admins hold its whole tree
INSERT INTO permission (id, owner, pattern, subject, rights, kind, made_by, created_at)
SELECT md5('admins:' || o.id)::uuid, o.owner_number, '$', 'members:' || o.owner_number || '.admin', '{read,write,share}', 'admins', o.created_by, o.created_at
  FROM org o;

-- Whoever made an app in an org, and an app open to the org
INSERT INTO permission (id, owner, pattern, subject, rights, kind, made_by, created_at)
SELECT md5('creator:' || s.workspace_id || ':' || s.app_id)::uuid, o.owner_number, '$.apps.' || s.app_id, 'owner:' || u.owner_number, '{read,write,share}', 'creator', s.created_by, now()
  FROM app_setting s JOIN workspace w ON w.id = s.workspace_id JOIN org o ON o.id = w.org_id JOIN app_user u ON u.id = s.created_by;
INSERT INTO permission (id, owner, pattern, subject, rights, kind, created_at)
SELECT md5('open:' || s.workspace_id || ':' || s.app_id)::uuid, o.owner_number, '$.apps.' || s.app_id, 'members:' || o.owner_number, '{read}', 'open', now()
  FROM app_setting s JOIN workspace w ON w.id = s.workspace_id JOIN org o ON o.id = w.org_id
 WHERE s.open_to_org;

-- App access lists
INSERT INTO permission (id, owner, pattern, subject, rights, kind, made_by, created_at)
SELECT md5('access:' || a.workspace_id || ':' || a.app_id || ':' || a.principal_kind || ':' || a.principal_id)::uuid,
       o.owner_number,
       '$.apps.' || a.app_id,
       CASE a.principal_kind WHEN 'user' THEN 'owner:' || u.owner_number ELSE 'group:' || o.owner_number || '.' || a.principal_id END,
       CASE a.permission WHEN 'manage' THEN '{read,write,share}'::text[] WHEN 'edit' THEN '{read,write}'::text[] ELSE '{read}'::text[] END,
       'access.' || a.permission,
       a.granted_by,
       a.granted_at
  FROM app_access a JOIN workspace w ON w.id = a.workspace_id JOIN org o ON o.id = w.org_id
  LEFT JOIN app_user u ON a.principal_kind = 'user' AND u.id = a.principal_id
 WHERE a.principal_kind = 'group' OR u.id IS NOT NULL;

-- Share links, and the people who opened them as entries passed on from the link
INSERT INTO permission (id, owner, pattern, subject, rights, kind, made_by, created_at, revoked_at, token, label)
SELECT g.id, n.number, '$.apps.' || g.app_id, 'link:' || g.id, '{read}', 'link.' || g."right", g.created_by, g.created_at, g.revoked_at, g.token, g.app_name
  FROM link_grant g JOIN statenet_owner n ON coalesce(n.workspace_id, n.id) = g.workspace_id;
INSERT INTO permission (id, owner, pattern, subject, rights, parent, kind, made_by, created_at, revoked_at)
SELECT md5('opened:' || m.grant_id || ':' || m.user_id)::uuid, p.owner, p.pattern, 'owner:' || u.owner_number, '{read}', p.id, 'opened', m.user_id, m.first_opened_at, p.revoked_at
  FROM link_grant_member m JOIN permission p ON p.id = m.grant_id JOIN app_user u ON u.id = m.user_id;

-- State grants, dataset shares and the org's standing reads; their owner, issuer and subject are numbers already
-- (0017). An address `<owner>/apps/<app>` or `<owner>/data/<dataset>` with a prefix is a pattern under the owner
INSERT INTO permission (id, owner, pattern, subject, rights, parent, kind, made_by, created_at, until, revoked_at, last_used_at)
SELECT g.id,
       split_part(g.address, '/', 1)::numeric,
       '$.' || split_part(g.address, '/', 2) || '.' || split_part(g.address, '/', 3) || substr(g.prefix, 2),
       CASE WHEN g.subject LIKE 'org:%' THEN 'members:' || substr(g.subject, 5) || '.admin' ELSE 'owner:' || g.subject END,
       g.rights,
       g.parent_grant,
       g.kind,
       u.id,
       g.issued_at,
       g.expires_at,
       g.revoked_at,
       g.last_used_at
  FROM state_grant g LEFT JOIN app_user u ON g.kind <> 'org-read' AND u.owner_number::text = g.issuer
 WHERE split_part(g.address, '/', 1) ~ '^[0-9]+$';

DROP TABLE link_grant_member;
DROP TABLE link_grant;
DROP TABLE app_access;
DROP TABLE app_setting;
DROP TABLE state_grant;
