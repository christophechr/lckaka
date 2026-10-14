ALTER TABLE weekly_schedule_deliveries
  ADD COLUMN competition text NOT NULL DEFAULT 'LCK' CHECK (competition IN ('LCK', 'LEC'));
ALTER TABLE weekly_schedule_deliveries DROP CONSTRAINT weekly_schedule_deliveries_pkey;
ALTER TABLE weekly_schedule_deliveries ADD PRIMARY KEY (guild_id, competition, week_start);

ALTER TABLE weekly_schedule_pages
  ADD COLUMN competition text NOT NULL DEFAULT 'LCK' CHECK (competition IN ('LCK', 'LEC'));
ALTER TABLE weekly_schedule_pages DROP CONSTRAINT weekly_schedule_pages_pkey;
ALTER TABLE weekly_schedule_pages ADD PRIMARY KEY (guild_id, competition, week_start, page_index);
