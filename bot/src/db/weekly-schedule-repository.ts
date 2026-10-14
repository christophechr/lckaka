import type { Pool } from "pg";
import type { DiscordEmbed } from "../embed.js";
import type { CalendarCompetition } from "../competitions.js";

export interface WeeklyScheduleDeliveryStore {
  deliverScheduleOnce(
    guildId: string,
    weekStart: string,
    load: () => Promise<DiscordEmbed[]>,
    send: (embed: DiscordEmbed, pageIndex: number) => Promise<string>,
  ): Promise<boolean>;
}

export class WeeklyScheduleRepository implements WeeklyScheduleDeliveryStore {
  constructor(private readonly pool: Pool, private readonly competition: CalendarCompetition = "LCK") {}

  async deliverScheduleOnce(
    guildId: string,
    weekStart: string,
    load: () => Promise<DiscordEmbed[]>,
    send: (embed: DiscordEmbed, pageIndex: number) => Promise<string>,
  ): Promise<boolean> {
    return this.deliverOnce(guildId, weekStart, async () => {
      const readPages = () => this.pool.query<{
        page_index: number; embed: DiscordEmbed; discord_message_id: string | null;
      }>(
        `SELECT page_index, embed, discord_message_id FROM weekly_schedule_pages
         WHERE guild_id = $1 AND week_start = $2 AND competition = $3 ORDER BY page_index`,
        [guildId, weekStart, this.competition],
      );
      let pages = await readPages();
      if (!pages.rows.length) {
        const embeds = await load();
        if (!embeds.length) throw new Error("Le calendrier ne contient aucune page.");
        // Snapshot and page receipts commit independently of the outer delivery.
        // Its advisory lock serializes workers, while a failure preserves progress.
        await this.pool.query(
          `INSERT INTO weekly_schedule_pages(guild_id, week_start, page_index, embed, competition)
           SELECT $1, $2, ordinality - 1, value, $4
           FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY`,
          [guildId, weekStart, JSON.stringify(embeds), this.competition],
        );
        pages = await readPages();
      }
      let lastMessageId = "";
      for (const page of pages.rows) {
        if (page.discord_message_id) {
          lastMessageId = page.discord_message_id;
          continue;
        }
        lastMessageId = await send(page.embed, page.page_index);
        await this.pool.query(
          `UPDATE weekly_schedule_pages SET discord_message_id = $4
           WHERE guild_id = $1 AND week_start = $2 AND page_index = $3 AND competition = $5`,
          [guildId, weekStart, page.page_index, lastMessageId, this.competition],
        );
      }
      return lastMessageId;
    });
  }

  async deliverOnce(
    guildId: string,
    weekStart: string,
    send: () => Promise<string>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // A transaction lock prevents simultaneous workers from publishing the same week.
      // PostgreSQL releases it automatically if the process disconnects.
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
        [`weekly:${this.competition}:${guildId}:${weekStart}`],
      );
      if (!lock.rows[0]?.acquired) {
        await client.query("ROLLBACK");
        return false;
      }
      const sent = await client.query(
        "SELECT 1 FROM weekly_schedule_deliveries WHERE guild_id = $1 AND week_start = $2 AND competition = $3",
        [guildId, weekStart, this.competition],
      );
      if (sent.rowCount) {
        await client.query("COMMIT");
        return false;
      }
      const messageId = await send();
      await client.query(
        `INSERT INTO weekly_schedule_deliveries(guild_id, week_start, discord_message_id, competition)
         VALUES($1, $2, $3, $4)`,
        [guildId, weekStart, messageId, this.competition],
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
