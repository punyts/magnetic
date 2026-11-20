-- The screens board keeps its view as Statenet does (docs/design/magnetic-screens-board.md): a kept view may be
-- `screens` as well as `statenet`
ALTER TABLE editor_view DROP CONSTRAINT editor_view_view_check;
ALTER TABLE editor_view ADD CONSTRAINT editor_view_view_check CHECK (view IN ('statenet', 'screens'));
