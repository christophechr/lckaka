CREATE TABLE guild_configs (
  guild_id text PRIMARY KEY,
  notification_channel_id text,
  subscription_channel_id text,
  subscription_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_roles (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_name text NOT NULL,
  role_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, team_key),
  UNIQUE (guild_id, role_id)
);

CREATE TABLE matches (
  match_id text PRIMARY KEY,
  team1_key text NOT NULL,
  team1_name text NOT NULL,
  team2_key text NOT NULL,
  team2_name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  best_of integer NOT NULL CHECK (best_of > 0),
  overview_page text NOT NULL,
  is_nullified boolean NOT NULL DEFAULT false,
  winner smallint CHECK (winner IN (1, 2)),
  team1_score integer CHECK (team1_score >= 0),
  team2_score integer CHECK (team2_score >= 0),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  match_id text NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder', 'result')),
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  discord_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, match_id, kind)
);

CREATE INDEX matches_reminder_due_idx ON matches (scheduled_at)
  WHERE is_nullified = false;

CREATE INDEX delivery_retry_idx
  ON notification_deliveries (status, next_attempt_at);
