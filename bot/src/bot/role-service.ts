import type { Team } from "../db/match-repository.js";
import type { TeamRole } from "../db/team-role-repository.js";

export interface ManagedRole {
  id: string;
  name: string;
}

export interface CreateManagedRole {
  guildId: string;
  name: string;
  permissions: [];
  color: null;
  hoist: false;
  mentionable: false;
}

export interface RoleGateway {
  findRole(guildId: string, roleId: string): Promise<ManagedRole | null>;
  findRoleByName(guildId: string, name: string): Promise<ManagedRole | null>;
  createRole(input: CreateManagedRole): Promise<ManagedRole>;
  canManageRole(guildId: string, roleId: string): Promise<boolean>;
  memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  addRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
}

export interface TeamRoleStore {
  find(guildId: string, teamKey: string): Promise<TeamRole | null>;
  upsert(role: TeamRole): Promise<void>;
}

export interface ToggleResult {
  action: "added" | "removed";
  roleId: string;
}

export class RoleService {
  constructor(
    private readonly roles: TeamRoleStore,
    private readonly gateway: RoleGateway,
  ) {}

  async toggle(guildId: string, userId: string, team: Team, competition = "LCK"): Promise<ToggleResult> {
    const roleName = `${competition} · ${team.name}`.slice(0, 100);
    const mapped = await this.roles.find(guildId, team.key);
    let role = mapped ? await this.gateway.findRole(guildId, mapped.roleId) : null;
    role ??= await this.gateway.findRoleByName(guildId, roleName);
    role ??= await this.gateway.createRole({
      guildId,
      name: roleName,
      permissions: [],
      color: null,
      hoist: false,
      mentionable: false,
    });

    if (!(await this.gateway.canManageRole(guildId, role.id))) {
      throw new Error(
        "Le rôle de l'équipe est au-dessus du bot dans la hiérarchie Discord.",
      );
    }

    await this.roles.upsert({
      guildId,
      teamKey: team.key,
      teamName: team.name,
      roleId: role.id,
    });

    if (await this.gateway.memberHasRole(guildId, userId, role.id)) {
      await this.gateway.removeRole(guildId, userId, role.id);
      return { action: "removed", roleId: role.id };
    }

    await this.gateway.addRole(guildId, userId, role.id);
    return { action: "added", roleId: role.id };
  }
}
