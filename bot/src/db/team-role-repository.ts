import type { Pool } from "pg";

export interface TeamRole {
  guildId: string;
  teamKey: string;
  teamName: string;
  roleId: string;
}

interface TeamRoleRow {
  guild_id: string;
  team_key: string;
  team_name: string;
  role_id: string;
}

function toTeamRole(row: TeamRoleRow): TeamRole {
  return {
    guildId: row.guild_id,
    teamKey: row.team_key,
    teamName: row.team_name,
    roleId: row.role_id,
  };
}

export class TeamRoleRepository {
  constructor(private readonly pool: Pool) {}

  async find(guildId: string, teamKey: string): Promise<TeamRole | null> {
    const result = await this.pool.query<TeamRoleRow>(
      "SELECT * FROM team_roles WHERE guild_id = $1 AND team_key = $2",
      [guildId, teamKey],
    );
    return result.rows[0] ? toTeamRole(result.rows[0]) : null;
  }

  async findForTeams(guildId: string, teamKeys: string[]): Promise<TeamRole[]> {
    if (teamKeys.length === 0) return [];
    const result = await this.pool.query<TeamRoleRow>(
      `SELECT * FROM team_roles
       WHERE guild_id = $1 AND team_key = ANY($2::text[])
       ORDER BY team_key`,
      [guildId, teamKeys],
    );
    return result.rows.map(toTeamRole);
  }

  async upsert(role: TeamRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_roles(guild_id, team_key, team_name, role_id)
       VALUES($1, $2, $3, $4)
       ON CONFLICT (guild_id, team_key) DO UPDATE SET
         team_name = EXCLUDED.team_name,
         role_id = EXCLUDED.role_id,
         updated_at = now()`,
      [role.guildId, role.teamKey, role.teamName, role.roleId],
    );
  }
}
