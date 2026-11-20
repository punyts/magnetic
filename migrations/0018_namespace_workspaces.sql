-- Which workspace each statenet address is in, for every address with state (docs/design/statenet-network.md, S11).
-- The aggregate reads `statenet_namespace` at each load, save and removal, and refuses an address it has no row for;
-- until now a server learned the workspace from the workspace that opened the instance and recorded only what it took
-- over. This records the workspace of every namespace head that has none, and a row that names another workspace than
-- the head is in is set to the head's. Running it again changes nothing.
--
-- Row-level security holds the table's owner too (FORCE), and a migration sets no workspace, so the owner is let past
-- it for this transaction and held again at the end (as in 0013).

ALTER TABLE namespace_head NO FORCE ROW LEVEL SECURITY;

INSERT INTO statenet_namespace (address, workspace_id)
SELECT address, workspace_id FROM namespace_head
ON CONFLICT (address) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, updated_at = now()
WHERE statenet_namespace.workspace_id <> EXCLUDED.workspace_id;

ALTER TABLE namespace_head FORCE ROW LEVEL SECURITY;
