CREATE TABLE incident_counters (
  counter_type text NOT NULL CHECK (counter_type IN ('drooler', 'hans')),
  split text NOT NULL CHECK (split <> ''),
  season_year integer NOT NULL CHECK (season_year BETWEEN 2010 AND 2100),
  team_key text NOT NULL DEFAULT '',
  team_name text,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (counter_type, split, season_year, team_key),
  CHECK (
    (team_key = '' AND team_name IS NULL)
    OR (team_key <> '' AND team_name IS NOT NULL)
  )
);

CREATE INDEX incident_counters_suggestions_idx
  ON incident_counters (counter_type, season_year DESC);
