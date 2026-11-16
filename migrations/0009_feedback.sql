-- What people send from the editor's bug button (docs/design/magnetic-feedback.md): a bug, a comment or a feature
-- request, with where it was sent from. Only the server reaches it; it goes with the person's account
CREATE TABLE feedback (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('bug', 'comment', 'feature')),
    text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
    workspace_id uuid,
    app_id uuid,
    app_name text,
    -- What the editor showed: the frame size and the screen, and the browser
    context jsonb NOT NULL DEFAULT '{}',
    user_agent text,
    at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_at ON feedback (at);
CREATE INDEX feedback_user ON feedback (user_id, at);
