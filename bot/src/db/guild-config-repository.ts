import type { Pool } from "pg";

export interface CalendarChannel {
  guildId: string;
  channelId: string;
}

export interface GuildConfig {
  guildId: string;
  notificationChannelId: string | null;
  subscriptionChannelId: string | null;
  subscriptionMessageId: string | null;
}

interface GuildConfigRow {
  guild_id: string;
  notification_channel_id: string | null;
  subscription_channel_id: string | null;
  subscription_message_id: string | null;
}

function toGuildConfig(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guild_id,
    notificationChannelId: row.notification_channel_id,
    subscriptionChannelId: row.subscription_channel_id,
    subscriptionMessageId: row.subscription_message_id,
  };
}

export class GuildConfigRepository {
  constructor(private readonly pool: Pool) {}

  async ensureGuild(guildId: string): Promise<void> {
    await this.pool.query("INSERT INTO guild_configs(guild_id) VALUES($1) ON CONFLICT (guild_id) DO NOTHING", [guildId]);
  }

  async setCalendarChannel(guildId: string, channelId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO guild_configs(guild_id, calendar_channel_id)
       VALUES($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET
         calendar_channel_id = EXCLUDED.calendar_channel_id,
         updated_at = now()`,
      [guildId, channelId],
    );
  }

  async listCalendarChannels(): Promise<CalendarChannel[]> {
    const result = await this.pool.query<CalendarChannel>(
      `SELECT guild_id AS "guildId",
              COALESCE(calendar_channel_id, notification_channel_id) AS "channelId"
       FROM guild_configs
       WHERE COALESCE(calendar_channel_id, notification_channel_id) IS NOT NULL`,
    );
    return result.rows;
  }

  async get(guildId: string): Promise<GuildConfig | null> {
    const result = await this.pool.query<GuildConfigRow>(
      "SELECT * FROM guild_configs WHERE guild_id = $1",
      [guildId],
    );
    return result.rows[0] ? toGuildConfig(result.rows[0]) : null;
  }

  async setNotificationChannel(guildId: string, channelId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO guild_configs(guild_id, notification_channel_id)
       VALUES($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET
         notification_channel_id = EXCLUDED.notification_channel_id,
         updated_at = now()`,
      [guildId, channelId],
    );
  }

  async setSubscriptionPanel(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO guild_configs(guild_id, subscription_channel_id, subscription_message_id)
       VALUES($1, $2, $3)
       ON CONFLICT (guild_id) DO UPDATE SET
         subscription_channel_id = EXCLUDED.subscription_channel_id,
         subscription_message_id = EXCLUDED.subscription_message_id,
         updated_at = now()`,
      [guildId, channelId, messageId],
    );
  }

  async listWithNotificationChannel(): Promise<GuildConfig[]> {
    const result = await this.pool.query<GuildConfigRow>(
      "SELECT * FROM guild_configs WHERE notification_channel_id IS NOT NULL",
    );
    return result.rows.map(toGuildConfig);
  }

  async listWithSubscriptionPanel(): Promise<GuildConfig[]> {
    const result = await this.pool.query<GuildConfigRow>(
      `SELECT * FROM guild_configs
       WHERE subscription_channel_id IS NOT NULL
         AND subscription_message_id IS NOT NULL`,
    );
    return result.rows.map(toGuildConfig);
  }
}
