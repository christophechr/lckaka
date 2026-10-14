ALTER TABLE lck_teams
  ADD COLUMN logo_url text,
  ADD COLUMN logo_hash text,
  ADD COLUMN emoji_id text,
  ADD COLUMN emoji_name text;

ALTER TABLE lck_teams
  ADD CONSTRAINT lck_teams_emoji_pair_check CHECK (
    (emoji_id IS NULL AND emoji_name IS NULL)
    OR (emoji_id IS NOT NULL AND emoji_name IS NOT NULL)
  );
