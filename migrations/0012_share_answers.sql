-- Each person's answer to an app shared with them (docs/design/magnetic-home.md): an app shared through a link they
-- opened, or an app of their org they may open, waits on Your apps until they accept it (it joins their apps) or reject
-- it (it goes, with their membership of its links). `app_id` is text: an org's starter apps have names for ids
CREATE TABLE share_answer (
    user_id uuid NOT NULL,
    app_id text NOT NULL,
    answer text NOT NULL CHECK (answer IN ('accepted', 'rejected')),
    answered_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, app_id)
);

-- The apps people opened through a link before shares waited were already among theirs
INSERT INTO share_answer (user_id, app_id, answer, answered_at)
SELECT m.user_id, g.app_id::text, 'accepted', min(m.first_opened_at)
  FROM link_grant_member m JOIN link_grant g ON g.id = m.grant_id
 GROUP BY m.user_id, g.app_id;
