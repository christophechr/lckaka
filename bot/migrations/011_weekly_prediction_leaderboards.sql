CREATE TABLE weekly_prediction_leaderboards (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  embed jsonb NOT NULL,
  discord_message_id text,
  sent_at timestamptz,
  PRIMARY KEY (guild_id, week_start)
);
