import type { Client } from "discord.js";
import { DiscordAdapter } from "../src/bot/discord-adapter.js";
import { describe, expect, it, vi } from "vitest";
import { CompetitionPanelService } from "../src/bot/competition-panel-service.js";
import type { CompetitionPanel } from "../src/db/subscription-repository.js";
import type { SubscriptionCompetition } from "../src/subscription-competitions.js";

function fixture() {
  const competitions: SubscriptionCompetition[] = [
    { key: "lec", title: "LEC", overviewPage: "LEC/2026 Season/Summer Season", startsOn: null, endsOn: null, teams: [{ key: "g2-esports", name: "G2 Esports" }] },
    { key: "worlds-2026", title: "Worlds 2026", overviewPage: "2026 Season World Championship", startsOn: "2026-10-15", endsOn: "2026-11-14", teams: [{ key: "t1", name: "T1" }] },
  ];
  const records = new Map<string, CompetitionPanel>();
  const store = {
    listCompetitions: async () => competitions,
    listPanels: async () => [...records.values()],
    savePanel: async (panel: CompetitionPanel) => { records.set(panel.scopeKey, panel); },
    removePanel: async (_guild: string, scope: string) => { records.delete(scope); },
    withGuildLock: async (_guild: string, operation: () => Promise<void>) => operation(),
  };
  const guilds = { listWithSubscriptionPanel: async () => [{ guildId: "guild-1", notificationChannelId: "notifications", subscriptionChannelId: "subscriptions", subscriptionMessageId: "lck-panel" }] };
  let count = 0;
  const gateway = {
    ensureUsableTextChannel: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => `message-${++count}`),
    editMessage: vi.fn(async () => true),
    deleteMessage: vi.fn(async (_channel: string, _message: string): Promise<void> => undefined),
  };
  const roles = { toggle: vi.fn(async () => ({ action: "added" as const, roleId: "role" })) };
  const service = new CompetitionPanelService(store, guilds, gateway, roles);
  return { service, store, guilds, gateway, records, competitions, roles };
}

describe("competition panel lifecycle", () => {
  it("keeps LEC permanent, opens Worlds at J-10 once, and removes its panel after the final day", async () => {
    const { service, gateway, records } = fixture();
    await service.refresh(new Date("2026-10-04T21:59:59Z"));
    expect([...records.keys()]).toEqual(["lec"]);
    await service.refresh(new Date("2026-10-04T22:00:00Z"));
    expect([...records.keys()]).toEqual(["lec", "worlds-2026"]);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    await service.refresh(new Date("2026-10-05T12:00:00Z"));
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    await service.refresh(new Date("2026-11-14T23:00:00Z"));
    expect([...records.keys()]).toEqual(["lec"]);
    expect(gateway.deleteMessage).toHaveBeenCalledWith("subscriptions", "message-2");
  });
  it("hides an already-published panel if the tournament is postponed beyond J-10", async () => {
    const { service, competitions, records } = fixture();
    await service.refresh(new Date("2026-10-10T12:00:00Z"));
    competitions[1]!.startsOn = "2026-10-30";
    await service.refresh(new Date("2026-10-10T12:01:00Z"));
    expect(records.has("worlds-2026")).toBe(false);
  });
  it("opens an informative panel even when participants are not yet known", async () => {
    const { service, competitions, records } = fixture();
    competitions[1]!.teams = [];
    await service.refresh(new Date("2026-10-10T12:00:00Z"));
    expect(records.has("worlds-2026")).toBe(true);
  });
  it("validates the active panel and participant before toggling a scoped subscription", async () => {
    const { service, roles } = fixture();
    const now = new Date("2026-10-10T12:00:00Z");
    await service.refresh(now);
    await service.toggle("guild-1", "user-1", "subscriptions", "message-2", "worlds-2026", "t1", now);
    expect(roles.toggle).toHaveBeenCalledWith("guild-1", "user-1", { key: "worlds-2026:t1", name: "T1" }, "Worlds 2026");
    await expect(service.toggle("guild-1", "user-1", "subscriptions", "forged", "worlds-2026", "t1", now)).rejects.toThrow("panneau");
    await expect(service.toggle("guild-1", "user-1", "subscriptions", "message-2", "worlds-2026", "unknown", now)).rejects.toThrow("équipe");
    await expect(service.toggle("guild-1", "user-1", "subscriptions", "message-2", "worlds-2026", "t1", new Date("2026-12-01"))).rejects.toThrow("ouverts");
    expect(roles.toggle).toHaveBeenCalledTimes(1);
  });
  it("reuses stored panels after restart and recreates a deleted message", async () => {
    const { service, store, guilds, gateway, roles } = fixture();
    const now = new Date("2026-10-10T12:00:00Z");
    await service.refresh(now);
    const restarted = new CompetitionPanelService(store, guilds, gateway, roles);
    await restarted.refresh(now);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    gateway.editMessage.mockResolvedValueOnce(false);
    await restarted.refresh(new Date("2026-10-10T13:01:00Z"));
    expect(gateway.sendMessage).toHaveBeenCalledTimes(3);
  });
  it("relocates the panels when their old channel was deleted", async () => {
    const { service, guilds, gateway, records } = fixture();
    const now = new Date("2026-10-10T12:00:00Z");
    await service.refresh(now);
    guilds.listWithSubscriptionPanel = async () => [{ guildId: "guild-1", notificationChannelId: "notifications", subscriptionChannelId: "replacement", subscriptionMessageId: "lck-replacement" }];
    const adapter = new DiscordAdapter({ channels: { fetch: async () => { throw { code: 10003 }; } } } as unknown as Client);
    gateway.deleteMessage.mockImplementation((channel, message) => adapter.deleteMessage(channel, message));
    await service.refresh(now);
    expect([...records.values()].map(panel => panel.channelId)).toEqual(["replacement", "replacement"]);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(4);
  });

});
