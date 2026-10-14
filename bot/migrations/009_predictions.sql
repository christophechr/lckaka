ALTER TABLE matches ADD COLUMN prediction_number bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE matches ADD CONSTRAINT matches_prediction_number_unique UNIQUE (prediction_number);

CREATE TABLE predictions (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  match_id text NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  team1_key text NOT NULL,
  team2_key text NOT NULL,
  best_of integer NOT NULL CHECK (best_of IN (1, 3, 5)),
  team1_score integer NOT NULL CHECK (team1_score >= 0),
  team2_score integer NOT NULL CHECK (team2_score >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id, match_id),
  CHECK (
    (team1_score = (best_of + 1) / 2 AND team2_score < team1_score)
    OR (team2_score = (best_of + 1) / 2 AND team1_score < team2_score)
  )
);

CREATE INDEX predictions_match_idx ON predictions (match_id);
