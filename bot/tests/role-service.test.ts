import { describe, expect, it } from "vitest";

import {
  RoleService,
  type CreateManagedRole,
  type ManagedRole,
  type RoleGateway,
  type TeamRoleStore,
} from "../src/bot/role-service.js";
import type { TeamRole } from "../src/db/team-role-repository.js";

class MemoryTeamRoles implements TeamRoleStore {
  readonly values = new Map<string, TeamRole>();

  async find(guildId: string, teamKey: string): Promise<TeamRole | null> {
    return this.values.get(`${guildId}:${teamKey}`) ?? null;
  }

  async upsert(role: TeamRole): Promise<void> {
    this.values.set(`${role.guildId}:${role.teamKey}`, role);
  }
}

class MemoryRoleGateway implements RoleGateway {
  readonly roles = new Map<string, ManagedRole>();
  readonly memberRoles = new Map<string, Set<string>>();
  readonly createdRoles: CreateManagedRole[] = [];
  manageable = true;

  async findRole(guildId: string, roleId: string): Promise<ManagedRole | null> {
    return this.roles.get(`${guildId}:${roleId}`) ?? null;
  }

  async findRoleByName(guildId: string, name: string): Promise<ManagedRole | null> {
    return [...this.roles.entries()].find(
      ([key, role]) => key.startsWith(`${guildId}:`) && role.name === name,
    )?.[1] ?? null;
  }

  async createRole(input: CreateManagedRole): Promise<ManagedRole> {
    this.createdRoles.push(input);
    const role = { id: `created-role-${this.createdRoles.length}`, name: input.name };
    this.roles.set(`${input.guildId}:${role.id}`, role);
    return role;
  }

  async canManageRole(): Promise<boolean> {
    return this.manageable;
  }

  async memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    return this.memberRoles.get(`${guildId}:${userId}`)?.has(roleId) ?? false;
  }

  async addRole(guildId: string, userId: string, roleId: string): Promise<void> {
    const key = `${guildId}:${userId}`;
    const roles = this.memberRoles.get(key) ?? new Set<string>();
    roles.add(roleId);
    this.memberRoles.set(key, roles);
  }

  async removeRole(guildId: string, userId: string, roleId: string): Promise<void> {
    this.memberRoles.get(`${guildId}:${userId}`)?.delete(roleId);
  }
}

describe("RoleService", () => {
  it("creates a safe role and subscribes a member", async () => {
    const store = new MemoryTeamRoles();
    const gateway = new MemoryRoleGateway();
    const service = new RoleService(store, gateway);

    const result = await service.toggle("guild-1", "user-1", { key: "t1", name: "T1" });

    expect(result).toEqual({ action: "added", roleId: "created-role-1" });
    expect(gateway.createdRoles).toEqual([
      {
        guildId: "guild-1",
        name: "LCK · T1",
        permissions: [],
        color: null,
        hoist: false,
        mentionable: false,
      },
    ]);
    expect(await gateway.memberHasRole("guild-1", "user-1", "created-role-1")).toBe(true);
  });

  it("removes an existing subscription on the next selection", async () => {
    const store = new MemoryTeamRoles();
    const gateway = new MemoryRoleGateway();
    const service = new RoleService(store, gateway);
    const team = { key: "t1", name: "T1" };

    await service.toggle("guild-1", "user-1", team);
    const result = await service.toggle("guild-1", "user-1", team);

    expect(result).toEqual({ action: "removed", roleId: "created-role-1" });
    expect(await gateway.memberHasRole("guild-1", "user-1", "created-role-1")).toBe(false);
    expect(gateway.createdRoles).toHaveLength(1);
  });

  it("reuses an existing role with the managed name", async () => {
    const store = new MemoryTeamRoles();
    const gateway = new MemoryRoleGateway();
    gateway.roles.set("guild-1:existing-role", { id: "existing-role", name: "LCK · T1" });
    const service = new RoleService(store, gateway);

    const result = await service.toggle("guild-1", "user-1", { key: "t1", name: "T1" });

    expect(result.roleId).toBe("existing-role");
    expect(gateway.createdRoles).toEqual([]);
    expect((await store.find("guild-1", "t1"))?.roleId).toBe("existing-role");
  });

  it("refuses to change a role above the bot hierarchy", async () => {
    const store = new MemoryTeamRoles();
    const gateway = new MemoryRoleGateway();
    gateway.manageable = false;
    const service = new RoleService(store, gateway);

    await expect(
      service.toggle("guild-1", "user-1", { key: "t1", name: "T1" }),
    ).rejects.toThrow("hiérarchie");
  });
  it("keeps the same team's regional and international roles independent", async () => {
    const store = new MemoryTeamRoles();
    const gateway = new MemoryRoleGateway();
    const service = new RoleService(store, gateway);
    const lec = { key: "lec:g2-esports", name: "G2 Esports" };
    const worlds = { key: "worlds-2026:g2-esports", name: "G2 Esports" };
    const regional = await service.toggle("guild-1", "user-1", lec, "LEC");
    const international = await service.toggle("guild-1", "user-1", worlds, "Worlds 2026");
    expect(gateway.createdRoles.map(role => role.name)).toEqual(["LEC · G2 Esports", "Worlds 2026 · G2 Esports"]);
    await service.toggle("guild-1", "user-1", lec, "LEC");
    expect(await gateway.memberHasRole("guild-1", "user-1", regional.roleId)).toBe(false);
    expect(await gateway.memberHasRole("guild-1", "user-1", international.roleId)).toBe(true);
  });

});
