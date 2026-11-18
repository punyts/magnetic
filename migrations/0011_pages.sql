-- Magnetic's own pages as an admin published them (docs/design/magnetic-editable.md): the assembled document and icons
-- a page serves, the app and the parts it reaches that a person's copy is made from, the English of each text at the
-- publish (to drop the translations of texts that changed since), and who published it when. Without a row a page is
-- served from Magnetic's code. `json`, not `jsonb`: key order matters
CREATE TABLE magnetic_page (
    name text PRIMARY KEY,
    stamp text NOT NULL,
    base text NOT NULL,
    document json NOT NULL,
    icons json NOT NULL,
    parts json NOT NULL,
    english json NOT NULL,
    published_by uuid NOT NULL,
    published_at timestamptz NOT NULL
);
