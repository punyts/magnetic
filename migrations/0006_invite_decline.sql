-- Invites a person sees on their own Your apps (docs/design/magnetic-m8.md, N5): an invite to someone whose verified
-- email has an account waits there too, to join or decline, besides the link. A declined invite is not shown again
ALTER TABLE org_invite ADD COLUMN declined_at timestamptz;
CREATE INDEX org_invite_email ON org_invite (email) WHERE accepted_at IS NULL AND declined_at IS NULL;
