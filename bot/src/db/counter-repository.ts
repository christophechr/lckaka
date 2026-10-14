import type { Pool } from "pg";

import type {
  CounterFilters,
  CounterKind,
  CounterStore,
} from "../bot/commands/types.js";

function normalizeSplit(split: string): string {
  const value = split.trim().toLocaleLowerCase("fr");
  if (!value) throw new Error("Le split est requis.");
  return value;
}

function normalizeTeam(team: string | null | undefined): {
  key: string;
  name: string | null;
} {
  const name = team?.trim() || null;
  return { key: name?.toLocaleLowerCase("fr") ?? "", name };
}

export class CounterRepository implements CounterStore {
  constructor(private readonly pool: Pool) {}

  async increment(
    kind: CounterKind,
    split: string,
    year: number,
    team: string | null,
  ): Promise<number> {
    const normalizedTeam = normalizeTeam(team);
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO incident_counters(
         counter_type, split, season_year, team_key, team_name, count
       ) VALUES($1, $2, $3, $4, $5, 1)
       ON CONFLICT (counter_type, split, season_year, team_key) DO UPDATE SET
         count = incident_counters.count + 1,
         team_name = COALESCE(EXCLUDED.team_name, incident_counters.team_name),
         updated_at = now()
       RETURNING count`,
      [kind, normalizeSplit(split), year, normalizedTeam.key, normalizedTeam.name],
    );
    return result.rows[0]?.count ?? 0;
  }

  async getTotal(kind: CounterKind, filters: CounterFilters): Promise<number> {
    const values: unknown[] = [kind, filters.year];
    const conditions = ["counter_type = $1", "season_year = $2"];
    if (filters.split) {
      values.push(normalizeSplit(filters.split));
      conditions.push(`split = $${values.length}`);
    }
    if (filters.team) {
      values.push(normalizeTeam(filters.team).key);
      conditions.push(`team_key = $${values.length}`);
    }

    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(sum(count), 0)::text AS total
       FROM incident_counters
       WHERE ${conditions.join(" AND ")}`,
      values,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async listSplits(kind: CounterKind, query: string): Promise<string[]> {
    const result = await this.pool.query<{ split: string }>(
      `SELECT DISTINCT split
       FROM incident_counters
       WHERE counter_type = $1 AND split ILIKE $2
       ORDER BY split
       LIMIT 25`,
      [kind, `%${query.trim()}%`],
    );
    return result.rows.map((row) => row.split);
  }

  async listTeams(kind: CounterKind, query: string): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      `SELECT DISTINCT name FROM (
         SELECT team_name AS name
         FROM lck_teams
         WHERE season_year = (SELECT max(season_year) FROM lck_teams)
         UNION
         SELECT team_name AS name
         FROM incident_counters
         WHERE counter_type = $1 AND team_key <> ''
       ) teams
       WHERE name ILIKE $2
       ORDER BY name
       LIMIT 25`,
      [kind, `%${query.trim()}%`],
    );
    return result.rows.map((row) => row.name);
  }
}
