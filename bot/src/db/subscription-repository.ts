import type { Pool } from "pg";
import type { SubscriptionCompetition } from "../subscription-competitions.js";

export interface CompetitionPanel {
  guildId: string;
  scopeKey: string;
  channelId: string;
  messageId: string;
  payloadHash: string;
  updatedAt: Date;
}

export class SubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async saveCompetition(competition: SubscriptionCompetition): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscription_competitions(scope_key, title, overview_page, starts_on, ends_on, teams)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (scope_key) DO UPDATE SET
         title = EXCLUDED.title, overview_page = EXCLUDED.overview_page,
         starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
         teams = CASE WHEN jsonb_array_length(EXCLUDED.teams) > 0
                        OR subscription_competitions.overview_page <> EXCLUDED.overview_page
                      THEN EXCLUDED.teams ELSE subscription_competitions.teams END,
         updated_at = now()`,
      [competition.key, competition.title, competition.overviewPage, competition.startsOn, competition.endsOn, JSON.stringify(competition.teams)],
    );
  }

  async listCompetitions(): Promise<SubscriptionCompetition[]> {
    const result = await this.pool.query<SubscriptionCompetition>(
      `SELECT scope_key AS key, title, overview_page AS "overviewPage",
              to_char(starts_on, 'YYYY-MM-DD') AS "startsOn",
              to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", teams
       FROM subscription_competitions ORDER BY scope_key`,
    );
    return result.rows;
  }

  async listPanels(guildId: string): Promise<CompetitionPanel[]> {
    const result = await this.pool.query<CompetitionPanel>(
      `SELECT guild_id AS "guildId", scope_key AS "scopeKey", channel_id AS "channelId",
              message_id AS "messageId", payload_hash AS "payloadHash", updated_at AS "updatedAt"
       FROM competition_subscription_panels WHERE guild_id = $1`, [guildId],
    );
    return result.rows;
  }

  async savePanel(panel: CompetitionPanel): Promise<void> {
    await this.pool.query(
      `INSERT INTO competition_subscription_panels(guild_id, scope_key, channel_id, message_id, payload_hash, updated_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (guild_id, scope_key) DO UPDATE SET channel_id = EXCLUDED.channel_id,
         message_id = EXCLUDED.message_id, payload_hash = EXCLUDED.payload_hash, updated_at = EXCLUDED.updated_at`,
      [panel.guildId, panel.scopeKey, panel.channelId, panel.messageId, panel.payloadHash, panel.updatedAt],
    );
  }

  async removePanel(guildId: string, scopeKey: string): Promise<void> {
    await this.pool.query("DELETE FROM competition_subscription_panels WHERE guild_id = $1 AND scope_key = $2", [guildId, scopeKey]);
  }

  async withGuildLock(guildId: string, operation: () => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired", [`subscription-panels:${guildId}`],
      );
      if (result.rows[0]?.acquired) await operation();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
