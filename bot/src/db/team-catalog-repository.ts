import type { Pool } from "pg";

import type { Team } from "./match-repository.js";

export class TeamCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async findPredictionTeams(teamKeys: string[]): Promise<Team[]> {
    const lck = await this.findTeams(teamKeys);
    const missing = teamKeys.filter(key => !lck.some(team => team.key === key));
    if (!missing.length) return lck;
    const result = await this.pool.query<{ team: Team }>(
      `SELECT DISTINCT ON (team->>'key') team
       FROM subscription_competitions, jsonb_array_elements(teams) AS team
       WHERE team->>'key' = ANY($1::text[]) ORDER BY team->>'key', updated_at DESC`, [missing],
    );
    return [...lck, ...result.rows.map(row => row.team)];
  }

  async replaceSeason(seasonYear: number, teams: Team[]): Promise<void> {
    if (teams.length === 0) throw new Error("Le catalogue LCK reçu est vide.");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const team of teams) {
        await client.query(
          `INSERT INTO lck_teams(season_year, team_key, team_name, logo_url)
           VALUES($1, $2, $3, $4)
           ON CONFLICT (season_year, team_key) DO UPDATE SET
             team_name = EXCLUDED.team_name,
             logo_url = EXCLUDED.logo_url,
             updated_at = now()`,
          [seasonYear, team.key, team.name, team.logoUrl ?? null],
        );
      }
      await client.query(
        `DELETE FROM lck_teams
         WHERE season_year = $1 AND NOT (team_key = ANY($2::text[]))`,
        [seasonYear, teams.map((team) => team.key)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTeams(): Promise<Team[]> {
    const result = await this.pool.query<Team>(
      `SELECT
         team_key AS key,
         team_name AS name,
         logo_url AS "logoUrl",
         logo_hash AS "logoHash",
         emoji_id AS "emojiId",
         emoji_name AS "emojiName"
       FROM lck_teams
       WHERE season_year = (SELECT max(season_year) FROM lck_teams)
       ORDER BY team_name`,
    );
    return result.rows;
  }

  async findTeams(teamKeys: string[]): Promise<Team[]> {
    if (teamKeys.length === 0) return [];
    const result = await this.pool.query<Team>(
      `SELECT
         team_key AS key,
         team_name AS name,
         logo_url AS "logoUrl",
         logo_hash AS "logoHash",
         emoji_id AS "emojiId",
         emoji_name AS "emojiName"
       FROM lck_teams
       WHERE season_year = (SELECT max(season_year) FROM lck_teams)
         AND team_key = ANY($1::text[])`,
      [teamKeys],
    );
    return result.rows;
  }

  async saveEmoji(
    teamKey: string,
    emoji: { id: string; name: string; logoHash: string },
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE lck_teams SET
         emoji_id = $2,
         emoji_name = $3,
         logo_hash = $4,
         updated_at = now()
       WHERE season_year = (SELECT max(season_year) FROM lck_teams)
         AND team_key = $1`,
      [teamKey, emoji.id, emoji.name, emoji.logoHash],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Équipe LCK inconnue : ${teamKey}`);
    }
  }
}
