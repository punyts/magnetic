-- Several Magnetic servers on one database (docs/design/statenet-relays.md, "Topology, in steps", 3). Each instance is
-- the statenet namespace of its address, owned by one server at a time (namespace_owner, from stateui-pg). The server
-- that takes a namespace over starts its instance in the workspace the app is in, which this table names: a server
-- writes it when it first places a namespace, and again when the app moved to another workspace. It has no row-level
-- security, like the directory: only Magnetic's servers reach it, and it holds no state.
--
-- The certificate authority that signs the servers' and relays' node certificates is an owner_key row of the owner
-- 'statenet', sealed with MAGNETIC_SECRET_KEY like every other.

CREATE TABLE statenet_namespace (
    address text PRIMARY KEY,
    workspace_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
