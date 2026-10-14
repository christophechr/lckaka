import type { Pool } from "pg";
import { createHash } from "node:crypto";

export interface PredictionMatch {
  id: string;
  team1Name: string;
  team2Name: string;
  bestOf: number;
  scheduledAt: Date;
  overviewPage: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  points: number;
  correctWinners: number;
  exactScores: number;
  settled: number;
}

export interface Leaderboard {
  total: number;
  entries: LeaderboardEntry[];
}

export interface PredictionStore {
  save(guildId: string, userId: string, matchId: string, team1Score: number, team2Score: number, revision?: string): Promise<PredictionMatch>;
  leaderboard(guildId: string, page: number): Promise<Leaderboard>;
}

export class PredictionError extends Error {}

export function predictionRevision(match: Pick<PredictionMatch, "team1Name" | "team2Name" | "bestOf">): string {
  return createHash("sha256").update(JSON.stringify([match.team1Name, match.team2Name, match.bestOf])).digest("hex").slice(0, 16);
}

const matchColumns = `prediction_number::text AS id, team1_name AS "team1Name",
  team2_name AS "team2Name", best_of AS "bestOf", scheduled_at AS "scheduledAt",
  overview_page AS "overviewPage"`;

// Evaluated after taking the match lock to validate the current match state.
const availableMatch = `is_nullified = false AND winner IS NULL
  AND COALESCE(team1_score, 0) = 0 AND COALESCE(team2_score, 0) = 0
  AND scheduled_at > clock_timestamp() + interval '1 minute'
  AND scheduled_at <= clock_timestamp() + interval '72 hours' AND best_of IN (1, 3, 5)
  AND lower(trim(team1_name)) NOT IN ('', 'tbd', 'tba', 'unknown')
  AND lower(trim(team2_name)) NOT IN ('', 'tbd', 'tba', 'unknown')
  AND team1_key <> '' AND team2_key <> '' AND team1_key <> team2_key`;

export class PredictionRepository implements PredictionStore {
  constructor(private readonly pool: Pool) {}

  async listPendingResultDays(now: Date): Promise<Date[]> {
    const result = await this.pool.query<{ day: Date }>(
      `SELECT DISTINCT date_trunc('day', m.scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day
       FROM matches m WHERE NOT m.is_nullified
         AND (m.winner IS NULL OR m.team1_score IS NULL OR m.team2_score IS NULL)
         AND m.scheduled_at < $1::timestamptz - interval '24 hours'
         AND EXISTS (SELECT 1 FROM predictions p WHERE p.match_id = m.match_id)
       ORDER BY day`,
      [now],
    );
    return result.rows.map(row => row.day);
  }

  async save(
    guildId: string, userId: string, matchId: string, team1Score: number, team2Score: number,
    revision?: string,
  ): Promise<PredictionMatch> {
    if (!/^\d{1,19}$/.test(matchId)) throw new PredictionError("Ce match est invalide.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT match_id FROM matches WHERE prediction_number = $1::numeric FOR UPDATE", [matchId],
      );
      if (!locked.rowCount) throw new PredictionError("Ce match n'existe plus.");
      // A separate statement evaluates the current deadline after any lock wait.
      const result = await client.query<PredictionMatch>(
        `SELECT ${matchColumns} FROM matches WHERE prediction_number = $1::numeric AND ${availableMatch}`,
        [matchId],
      );
      const match = result.rows[0];
      if (!match) throw new PredictionError("Les pronostics sont fermés ou indisponibles pour ce match.");
      if (revision !== undefined && revision !== predictionRevision(match)) {
        throw new PredictionError("Les équipes ou le format ont changé. Les votes depuis cet ancien embed sont fermés.");
      }
      const wins = (match.bestOf + 1) / 2;
      if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score)
        || team1Score < 0 || team2Score < 0
        || !((team1Score === wins && team2Score < wins) || (team2Score === wins && team1Score < wins))) {
        throw new PredictionError(`Score impossible en BO${match.bestOf} : le vainqueur doit avoir ${wins} victoire(s).`);
      }
      await client.query(
        `INSERT INTO predictions (guild_id, user_id, match_id, team1_key, team2_key, best_of, team1_score, team2_score)
         SELECT $1, $2, match_id, team1_key, team2_key, best_of, $4, $5
         FROM matches WHERE prediction_number = $3::numeric
         ON CONFLICT (guild_id, user_id, match_id) DO UPDATE SET
           team1_key = EXCLUDED.team1_key, team2_key = EXCLUDED.team2_key,
           best_of = EXCLUDED.best_of, team1_score = EXCLUDED.team1_score,
           team2_score = EXCLUDED.team2_score, updated_at = clock_timestamp()`,
        [guildId, userId, matchId, team1Score, team2Score],
      );
      await client.query("COMMIT");
      return match;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async leaderboard(guildId: string, page: number): Promise<Leaderboard> {
    if (!Number.isSafeInteger(page) || page < 1) throw new PredictionError("Le numéro de page doit être positif.");
    const result = await this.pool.query<Leaderboard>(
      `WITH outcomes AS (
         SELECT p.user_id,
           COALESCE(NOT m.is_nullified AND m.scheduled_at <= clock_timestamp()
             AND p.team1_key = m.team1_key AND p.team2_key = m.team2_key AND p.best_of = m.best_of
             AND ((m.winner = 1 AND m.team1_score = (m.best_of + 1) / 2 AND m.team2_score < m.team1_score)
               OR (m.winner = 2 AND m.team2_score = (m.best_of + 1) / 2 AND m.team1_score < m.team2_score)), false) AS settled,
           (p.team1_score > p.team2_score AND m.winner = 1)
             OR (p.team2_score > p.team1_score AND m.winner = 2) AS correct,
           p.best_of > 1 AND p.team1_score = m.team1_score AND p.team2_score = m.team2_score AS exact
         FROM predictions p JOIN matches m ON m.match_id = p.match_id WHERE p.guild_id = $1
       ), totals AS (
         SELECT user_id,
           sum(CASE WHEN settled AND correct THEN 3 + CASE WHEN exact THEN 2 ELSE 0 END ELSE 0 END) AS points,
           count(*) FILTER (WHERE settled AND correct) AS correct_winners,
           count(*) FILTER (WHERE settled AND correct AND exact) AS exact_scores,
           count(*) FILTER (WHERE settled) AS settled
         FROM outcomes GROUP BY user_id
       ), ranked AS (
         SELECT *, rank() OVER (ORDER BY points DESC) AS rank FROM totals
       ), page AS (
         SELECT * FROM ranked ORDER BY points DESC, user_id LIMIT 10 OFFSET $2
       )
       SELECT (SELECT count(*)::integer FROM ranked) AS total,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'rank', rank, 'userId', user_id, 'points', points, 'correctWinners', correct_winners,
           'exactScores', exact_scores, 'settled', settled) ORDER BY points DESC, user_id) FROM page), '[]'::jsonb) AS entries`,
      [guildId, (page - 1) * 10],
    );
    return result.rows[0]!;
  }
}
