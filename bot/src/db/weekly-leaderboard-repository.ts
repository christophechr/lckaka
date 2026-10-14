import type { Pool } from "pg";
import type { DiscordEmbed } from "../embed.js";

export interface WeeklyLeaderboardStore {
  deliverOnce(
    guildId: string,
    weekStart: string,
    load: () => Promise<DiscordEmbed>,
    send: (embed: DiscordEmbed) => Promise<string>,
  ): Promise<boolean>;
}

export class WeeklyLeaderboardRepository implements WeeklyLeaderboardStore {
  constructor(private readonly pool: Pool) {}

  async deliverOnce(
    guildId: string, weekStart: string,
    load: () => Promise<DiscordEmbed>, send: (embed: DiscordEmbed) => Promise<string>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
        [`weekly-leaderboard:${guildId}:${weekStart}`],
      );
      if (!lock.rows[0]?.acquired) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query<{ embed: DiscordEmbed; discord_message_id: string | null }>(
        "SELECT embed, discord_message_id FROM weekly_prediction_leaderboards WHERE guild_id = $1 AND week_start = $2",
        [guildId, weekStart],
      );
      if (result.rows[0]?.discord_message_id) {
        await client.query("COMMIT");
        return false;
      }
      let embed = result.rows[0]?.embed;
      if (!embed) {
        embed = await load();
        // Commit the snapshot separately so failed sends retry the same cumulative totals.
        // The advisory lock above still serializes all workers for this week.
        await this.pool.query(
          "INSERT INTO weekly_prediction_leaderboards(guild_id, week_start, embed) VALUES($1, $2, $3::jsonb)",
          [guildId, weekStart, JSON.stringify(embed)],
        );
      }
      const messageId = await send(embed);
      await client.query(
        `UPDATE weekly_prediction_leaderboards SET discord_message_id = $3, sent_at = clock_timestamp()
         WHERE guild_id = $1 AND week_start = $2`,
        [guildId, weekStart, messageId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
