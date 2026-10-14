CREATE TABLE weekly_schedule_deliveries (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  discord_message_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, week_start)
);
