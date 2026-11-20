-- An owner is its number wherever the statenet names it (docs/design/statenet-network.md, "`$` is the owner"): the
-- first part of an address, a grant's issuer and subject, and the owner beside a signing key. This rewrites what was
-- stored by id: a person's or a workspace's id becomes its owner's number (a person's own workspace and an org's
-- workspace go by the person's and the org's), and an org's subject `org:<id>` becomes `org:<number>`. Ids that are
-- no owner's stay as they are, and so does everything that is not an id ('statenet', a named test persona). Running
-- this again changes nothing.
--
-- Row-level security holds the tables' owner too (FORCE), and a migration sets no workspace, so the owner is let
-- through for this transaction only and held again before it ends.

CREATE TEMP TABLE owner_name AS
    SELECT id::text AS id, number::text AS number, kind FROM statenet_owner
    UNION
    SELECT workspace_id::text, number::text, kind FROM statenet_owner WHERE workspace_id IS NOT NULL;

ALTER TABLE state_node NO FORCE ROW LEVEL SECURITY;
ALTER TABLE state_change NO FORCE ROW LEVEL SECURITY;
ALTER TABLE namespace_head NO FORCE ROW LEVEL SECURITY;
ALTER TABLE embedding NO FORCE ROW LEVEL SECURITY;

-- The state, its log, its head, who orders it, and the embeddings of its records (`<address>/<binding>/<key>`)
UPDATE state_node t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;
UPDATE state_change t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;
UPDATE namespace_head t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;
UPDATE namespace_owner t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;
UPDATE embedding t SET source_id = o.number || substr(t.source_id, length(o.id) + 1) FROM owner_name o WHERE t.source_kind = 'persona-record' AND split_part(t.source_id, '/', 1) = o.id;
UPDATE embedding_job t SET source_id = o.number || substr(t.source_id, length(o.id) + 1) FROM owner_name o WHERE t.source_kind = 'persona-record' AND split_part(t.source_id, '/', 1) = o.id;

ALTER TABLE state_node FORCE ROW LEVEL SECURITY;
ALTER TABLE state_change FORCE ROW LEVEL SECURITY;
ALTER TABLE namespace_head FORCE ROW LEVEL SECURITY;
ALTER TABLE embedding FORCE ROW LEVEL SECURITY;

-- Which workspace a namespace is in
UPDATE statenet_namespace t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;

-- Grants: what they reach, who gave them and who holds them
UPDATE state_grant t SET address = o.number || substr(t.address, length(o.id) + 1) FROM owner_name o WHERE split_part(t.address, '/', 1) = o.id;
UPDATE state_grant t SET issuer = o.number FROM owner_name o WHERE t.issuer = o.id;
UPDATE state_grant t SET subject = o.number FROM owner_name o WHERE t.subject = o.id;
UPDATE state_grant t SET subject = 'org:' || o.number FROM owner_name o WHERE o.kind = 'org' AND t.subject = 'org:' || o.id;

-- The owner beside each signing key
UPDATE owner_key t SET owner_id = o.number FROM owner_name o WHERE t.owner_id = o.id;

DROP TABLE owner_name;
