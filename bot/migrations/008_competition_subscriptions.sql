CREATE TABLE subscription_competitions (
  scope_key text PRIMARY KEY,
  title text NOT NULL,
  overview_page text NOT NULL,
  starts_on date,
  ends_on date,
  teams jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(teams) = 'array')
);

CREATE TABLE competition_subscription_panels (
  guild_id text NOT NULL REFERENCES guild_configs(guild_id) ON DELETE CASCADE,
  scope_key text NOT NULL REFERENCES subscription_competitions(scope_key),
  channel_id text NOT NULL,
  message_id text NOT NULL,
  payload_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, scope_key)
);
