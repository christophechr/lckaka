import type { Pool } from "pg";

export interface Team {
  key: string;
  name: string;
  logoUrl?: string | null;
  emojiId?: string | null;
  emojiName?: string | null;
  logoHash?: string | null;
}

export interface StoredMatch {
  matchId: string;
  predictionId?: string;
  team1Key: string;
  team1Name: string;
  team2Key: string;
  team2Name: string;
  scheduledAt: Date;
  bestOf: number;
  overviewPage: string;
  isNullified: boolean;
  winner: 1 | 2 | null;
  team1Score: number | null;
  team2Score: number | null;
}

interface StoredMatchRow {
  match_id: string;
  prediction_number: string;
  team1_key: string;
  team1_name: string;
  team2_key: string;
  team2_name: string;
  scheduled_at: Date;
  best_of: number;
  overview_page: string;
  is_nullified: boolean;
  winner: 1 | 2 | null;
  team1_score: number | null;
  team2_score: number | null;
}

function toStoredMatch(row: StoredMatchRow): StoredMatch {
  return {
    matchId: row.match_id,
    predictionId: row.prediction_number,
    team1Key: row.team1_key,
    team1Name: row.team1_name,
    team2Key: row.team2_key,
    team2Name: row.team2_name,
    scheduledAt: row.scheduled_at,
    bestOf: row.best_of,
    overviewPage: row.overview_page,
    isNullified: row.is_nullified,
    winner: row.winner,
    team1Score: row.team1_score,
    team2Score: row.team2_score,
  };
}

export class MatchRepository {
  constructor(private readonly pool: Pool) {}

  async upsertMany(matches: StoredMatch[]): Promise<void> {
    for (const match of matches) {
      await this.pool.query(
        `INSERT INTO matches(
          match_id, team1_key, team1_name, team2_key, team2_name,
          scheduled_at, best_of, overview_page, is_nullified,
          winner, team1_score, team2_score, synced_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (match_id) DO UPDATE SET
          team1_key = EXCLUDED.team1_key,
          team1_name = EXCLUDED.team1_name,
          team2_key = EXCLUDED.team2_key,
          team2_name = EXCLUDED.team2_name,
          scheduled_at = EXCLUDED.scheduled_at,
          best_of = EXCLUDED.best_of,
          overview_page = EXCLUDED.overview_page,
          is_nullified = EXCLUDED.is_nullified,
          winner = EXCLUDED.winner,
          team1_score = EXCLUDED.team1_score,
          team2_score = EXCLUDED.team2_score,
          synced_at = now()`,
        [
          match.matchId,
          match.team1Key,
          match.team1Name,
          match.team2Key,
          match.team2Name,
          match.scheduledAt,
          match.bestOf,
          match.overviewPage,
          match.isNullified,
          match.winner,
          match.team1Score,
          match.team2Score,
        ],
      );
    }
  }

  async findReminderDue(now: Date): Promise<StoredMatch[]> {
    const result = await this.pool.query<StoredMatchRow>(
      `SELECT * FROM matches
       WHERE is_nullified = false
         AND scheduled_at > $1
         AND scheduled_at <= $1::timestamptz + interval '30 minutes'
       ORDER BY scheduled_at ASC`,
      [now],
    );
    return result.rows.map(toStoredMatch);
  }

  async findPredictionDue(now: Date): Promise<StoredMatch[]> {
    const result = await this.pool.query<StoredMatchRow>(
      `SELECT * FROM matches
       WHERE is_nullified = false
         AND scheduled_at > $1::timestamptz + interval '1 minute'
         AND scheduled_at <= $1::timestamptz + interval '72 hours'
       ORDER BY scheduled_at ASC`,
      [now],
    );
    return result.rows.map(toStoredMatch);
  }

  async findStartedWithoutResult(now: Date): Promise<StoredMatch[]> {
    const result = await this.pool.query<StoredMatchRow>(
      `SELECT * FROM matches
       WHERE is_nullified = false
         AND scheduled_at <= $1
         AND winner IS NULL
       ORDER BY scheduled_at ASC`,
      [now],
    );
    return result.rows.map(toStoredMatch);
  }

  async findCompleted(now: Date = new Date()): Promise<StoredMatch[]> {
    const result = await this.pool.query<StoredMatchRow>(
      `SELECT * FROM matches
       WHERE is_nullified = false
         AND winner IS NOT NULL
         AND team1_score IS NOT NULL
         AND team2_score IS NOT NULL
         AND scheduled_at > $1::timestamptz - interval '24 hours'
         AND scheduled_at <= $1
       ORDER BY scheduled_at ASC`,
      [now],
    );
    return result.rows.map(toStoredMatch);
  }

  async listTeams(): Promise<Team[]> {
    const result = await this.pool.query<{ key: string; name: string }>(
      `SELECT key, name FROM (
         SELECT DISTINCT ON (key) key, name
         FROM (
           SELECT team1_key AS key, team1_name AS name FROM matches
           UNION ALL
           SELECT team2_key AS key, team2_name AS name FROM matches
         ) all_teams
         WHERE key <> '' AND lower(name) <> 'tbd'
         ORDER BY key, name
       ) unique_teams
       ORDER BY name`,
    );
    return result.rows;
  }
}
