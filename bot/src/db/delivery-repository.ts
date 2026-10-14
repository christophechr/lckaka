import type { Pool } from "pg";

export type DeliveryKind = "reminder" | "result" | "prediction";

export class DeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async findSentMessage(guildId: string, matchId: string, kind: DeliveryKind): Promise<string | null> {
    const result = await this.pool.query<{ discord_message_id: string | null }>(
      `SELECT discord_message_id FROM notification_deliveries
       WHERE guild_id = $1 AND match_id = $2 AND kind = $3 AND status = 'sent'`,
      [guildId, matchId, kind],
    );
    return result.rows[0]?.discord_message_id ?? null;
  }

  async claim(
    guildId: string,
    matchId: string,
    kind: DeliveryKind,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO notification_deliveries(
         guild_id, match_id, kind, status, attempts, claimed_at, next_attempt_at
       ) VALUES($1, $2, $3, 'sending', 1, $4, $4)
       ON CONFLICT (guild_id, match_id, kind) DO UPDATE SET
         status = 'sending',
         attempts = notification_deliveries.attempts + 1,
         claimed_at = EXCLUDED.claimed_at,
         last_error = NULL
       WHERE (
         notification_deliveries.status = 'failed'
         AND notification_deliveries.next_attempt_at <= EXCLUDED.claimed_at
       ) OR (
         notification_deliveries.status = 'sending'
         AND notification_deliveries.claimed_at <= EXCLUDED.claimed_at - interval '10 minutes'
       )
       RETURNING 1`,
      [guildId, matchId, kind, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markSent(
    guildId: string,
    matchId: string,
    kind: DeliveryKind,
    discordMessageId: string,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'sent', discord_message_id = $4, sent_at = $5, last_error = NULL
       WHERE guild_id = $1 AND match_id = $2 AND kind = $3`,
      [guildId, matchId, kind, discordMessageId, now],
    );
  }

  async markFailed(
    guildId: string,
    matchId: string,
    kind: DeliveryKind,
    error: string,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'failed',
           last_error = $4,
           next_attempt_at = $5::timestamptz
             + LEAST(15, power(2, GREATEST(attempts - 1, 0))) * interval '1 minute'
       WHERE guild_id = $1 AND match_id = $2 AND kind = $3`,
      [guildId, matchId, kind, error.slice(0, 1_000), now],
    );
  }
}
