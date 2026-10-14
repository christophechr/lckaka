CREATE TABLE lck_teams (
  season_year integer NOT NULL CHECK (season_year BETWEEN 2010 AND 2100),
  team_key text NOT NULL CHECK (team_key <> ''),
  team_name text NOT NULL CHECK (team_name <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_year, team_key)
);

CREATE INDEX lck_teams_season_name_idx
  ON lck_teams (season_year DESC, team_name);
