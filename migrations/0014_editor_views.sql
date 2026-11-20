-- Where each person left a view of the editor, per app (docs/design/magnetic-statenet-diagram.md): Statenet's pan and
-- zoom, so it opens as they left it in any browser. Keyed by person, not workspace, so it has no row-level security.
-- `app_id` is text, as in share_answer; `value` is json, as StateUI JSON is
CREATE TABLE editor_view (
    user_id uuid NOT NULL,
    app_id text NOT NULL,
    view text NOT NULL CHECK (view IN ('statenet')),
    value json NOT NULL,
    kept_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, app_id, view)
);
