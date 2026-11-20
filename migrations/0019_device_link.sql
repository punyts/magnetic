-- Sign in another device (docs/design/statenet-network.md, S10): a link a signed-in person makes, used once within
-- ten minutes. Only the token's hash is kept
CREATE TABLE device_link (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX device_link_by_expiry ON device_link (expires_at);
