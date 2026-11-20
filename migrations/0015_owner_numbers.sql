-- Owner numbers (docs/design/statenet-network.md, "`$` is the owner"): the `$` of a state path is an owner, and an
-- owner is a number that is distinct universally. Users and orgs are the owners; each gets the next number of one
-- sequence when it is made, and never another. A person's own workspace is that person's tree and an org's workspace
-- the org's, so a workspace has no number of its own. The ids (uuid) stay what every table refers to.

CREATE SEQUENCE statenet_owner_number AS bigint START 1;

ALTER TABLE app_user ADD COLUMN owner_number bigint UNIQUE;
ALTER TABLE org ADD COLUMN owner_number bigint UNIQUE;

-- Those who are here already are numbered in the order they came, people and orgs in one line
WITH numbered AS (
    SELECT kind, id, row_number() OVER (ORDER BY created_at, id) AS number
      FROM (
            SELECT 'user' AS kind, id, created_at FROM app_user
            UNION ALL
            SELECT 'org', id, created_at FROM org
           ) owners
), users AS (
    UPDATE app_user SET owner_number = numbered.number FROM numbered WHERE numbered.kind = 'user' AND numbered.id = app_user.id
)
UPDATE org SET owner_number = numbered.number FROM numbered WHERE numbered.kind = 'org' AND numbered.id = org.id;

-- The next one made takes the number after the last given
SELECT setval('statenet_owner_number', greatest(1, (SELECT count(*) FROM app_user) + (SELECT count(*) FROM org)), (SELECT count(*) FROM app_user) + (SELECT count(*) FROM org) > 0);

ALTER TABLE app_user ALTER COLUMN owner_number SET DEFAULT nextval('statenet_owner_number'), ALTER COLUMN owner_number SET NOT NULL;
ALTER TABLE org ALTER COLUMN owner_number SET DEFAULT nextval('statenet_owner_number'), ALTER COLUMN owner_number SET NOT NULL;

-- Every owner by its number: who it is, and the workspace that is its tree
CREATE VIEW statenet_owner AS
    SELECT owner_number AS number, 'user'::text AS kind, id, id AS workspace_id FROM app_user
    UNION ALL
    SELECT org.owner_number, 'org', org.id, workspace.id FROM org LEFT JOIN workspace ON workspace.org_id = org.id;
