CREATE TABLE weekly_schedule_pages (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  week_start date NOT NULL,
  page_index integer NOT NULL CHECK (page_index >= 0),
  embed jsonb NOT NULL,
  discord_message_id text,
  PRIMARY KEY (guild_id, week_start, page_index)
);
