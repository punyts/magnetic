-- A place in the statenet is an owner and a path under its `$` (docs/design/statenet-network.md, "`$` is the owner"):
-- `<owner>/apps/<appId>` for a person's state of an app, `<owner>/data/<dataset>` for a dataset. stateui-pg's 0007
-- moved the state itself; this moves what Magnetic keeps by address: which workspace a namespace is in, and every
-- grant (`<owner>/*/user`, an org's read of all a member's apps, becomes `<owner>/apps/*`). The owner in an address
-- stays the id it was. Running this again changes nothing.

UPDATE statenet_namespace SET address = split_part(address, '/', 1) || '/apps/' || split_part(address, '/', 2) WHERE address ~ '^[^/]+/[^/]+/user$';
UPDATE state_grant SET address = split_part(address, '/', 1) || '/apps/' || split_part(address, '/', 2) WHERE address ~ '^[^/]+/[^/]+/user$';
UPDATE state_grant SET address = split_part(address, '/', 1) || '/data/' || split_part(address, '/', 2) WHERE address ~ '^[^/]+/[^/]+/data$' AND split_part(address, '/', 2) <> 'data';
