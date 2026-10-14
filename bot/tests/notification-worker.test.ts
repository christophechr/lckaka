import type { MessageCreateOptions } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  NotificationWorker,
  type DeliveryStore,
  type GuildTargetStore,
  type MatchNotificationStore,
  type NotificationGateway,
  type NotificationRoleStore,
} from "../src/bot/notification-worker.js";
import type { DeliveryKind } from "../src/db/delivery-repository.js";
import type { GuildConfig } from "../src/db/guild-config-repository.js";
import type { StoredMatch } from "../src/db/match-repository.js";
import type { TeamRole } from "../src/db/team-role-repository.js";
import type { Team } from "../src/db/match-repository.js";

const match: StoredMatch = {
  matchId: "match-1",
  predictionId: "42",
  team1Key: "t1",
  team1Name: "T1",
  team2Key: "gen-g",
  team2Name: "Gen.G",
  scheduledAt: new Date("2026-09-05T08:00:00.000Z"),
  bestOf: 5,
  overviewPage: "LCK/2026 Season/Playoffs",
  isNullified: false,
  winner: null,
  team1Score: null,
  team2Score: null,
};

class MemoryMatches implements MatchNotificationStore {
  value = match;

  async findReminderDue(now: Date): Promise<StoredMatch[]> {
    const milliseconds = this.value.scheduledAt.getTime() - now.getTime();
    return !this.value.isNullified && milliseconds > 0 && milliseconds <= 30 * 60 * 1_000
      ? [this.value]
      : [];
  }

  async findCompleted(): Promise<StoredMatch[]> {
    return this.value.winner && this.value.team1Score !== null && this.value.team2Score !== null
      ? [this.value]
      : [];
  }
}

class MemoryDeliveries implements DeliveryStore {
  readonly statuses = new Map<string, "sending" | "sent" | "failed">();

  private key(guildId: string, matchId: string, kind: DeliveryKind): string {
    return `${guildId}:${matchId}:${kind}`;
  }

  async claim(guildId: string, matchId: string, kind: DeliveryKind): Promise<boolean> {
    const key = this.key(guildId, matchId, kind);
    if (this.statuses.has(key)) return false;
    this.statuses.set(key, "sending");
    return true;
  }

  async markSent(guildId: string, matchId: string, kind: DeliveryKind): Promise<void> {
    this.statuses.set(this.key(guildId, matchId, kind), "sent");
  }

  async markFailed(guildId: string, matchId: string, kind: DeliveryKind): Promise<void> {
    this.statuses.set(this.key(guildId, matchId, kind), "failed");
  }
}

class MemoryGuilds implements GuildTargetStore {
  async listWithNotificationChannel(): Promise<GuildConfig[]> {
    return [
      {
        guildId: "guild-1",
        notificationChannelId: "channel-1",
        subscriptionChannelId: null,
        subscriptionMessageId: null,
      },
      {
        guildId: "guild-2",
        notificationChannelId: "channel-2",
        subscriptionChannelId: null,
        subscriptionMessageId: null,
      },
    ];
  }
}

class MemoryRoles implements NotificationRoleStore {
  async findForTeams(guildId: string): Promise<TeamRole[]> {
    return guildId === "guild-1"
      ? [{ guildId, teamKey: "t1", teamName: "T1", roleId: "111" }]
      : [];
  }
}

class MemoryNotifier implements NotificationGateway {
  readonly messages: Array<{ channelId: string; payload: MessageCreateOptions }> = [];
  failingChannel: string | null = null;

  async sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string> {
    if (channelId === this.failingChannel) throw new Error("Discord indisponible");
    this.messages.push({ channelId, payload });
    return `message-${this.messages.length}`;
  }
}

class MemoryTeamAssets {
  async findTeams(): Promise<Team[]> {
    return [
      { key: "t1", name: "T1", emojiId: "emoji-t1", emojiName: "lck_t1" },
      { key: "gen-g", name: "Gen.G", emojiId: "emoji-geng", emojiName: "lck_gen_g" },
    ];
  }
}

describe("NotificationWorker", () => {
  it("sends one reminder per configured guild at the 30 minute boundary", async () => {
    const matches = new MemoryMatches();
    const deliveries = new MemoryDeliveries();
    const notifier = new MemoryNotifier();
    const worker = new NotificationWorker(
      matches,
      new MemoryGuilds(),
      new MemoryRoles(),
      deliveries,
      notifier,
      async () => undefined,
      new MemoryTeamAssets(),
    );

    expect(await worker.sendDueReminders(new Date("2026-09-05T07:29:59.000Z"))).toBe(0);
    expect(await worker.sendDueReminders(new Date("2026-09-05T07:30:00.000Z"))).toBe(2);
    expect(await worker.sendDueReminders(new Date("2026-09-05T07:31:00.000Z"))).toBe(0);
    expect(notifier.messages).toHaveLength(2);
    expect(notifier.messages[0]?.payload.components).toBeUndefined();
    expect(notifier.messages[0]).toMatchObject({
      channelId: "channel-1",
      payload: { content: "<@&111>", allowedMentions: { parse: [], roles: ["111"] } },
    });
    expect(
      (notifier.messages[0]?.payload.embeds?.[0] as { description?: string })?.description,
    ).toContain("<:lck_t1:emoji-t1> **T1** ⚔️ <:lck_gen_g:emoji-geng> **Gen.G**");
  });

  it("refreshes and sends one spoiler result per guild", async () => {
    const matches = new MemoryMatches();
    const deliveries = new MemoryDeliveries();
    const notifier = new MemoryNotifier();
    let refreshes = 0;
    const worker = new NotificationWorker(
      matches,
      new MemoryGuilds(),
      new MemoryRoles(),
      deliveries,
      notifier,
      async () => {
        refreshes += 1;
        matches.value = { ...match, winner: 1, team1Score: 3, team2Score: 2 };
      },
    );

    expect(await worker.refreshAndSendResults(new Date("2026-09-05T10:00:00.000Z"))).toBe(2);
    expect(refreshes).toBe(1);
    expect(notifier.messages[0]?.payload.embeds?.[0]).toMatchObject({
      description: "||**T1 3 – 2 Gen.G**\nVainqueur : **T1**||",
    });
    expect(await worker.refreshAndSendResults(new Date("2026-09-05T10:05:00.000Z"))).toBe(0);
  });

  it("continues with other guilds when one Discord send fails", async () => {
    const matches = new MemoryMatches();
    const deliveries = new MemoryDeliveries();
    const notifier = new MemoryNotifier();
    notifier.failingChannel = "channel-1";
    const worker = new NotificationWorker(
      matches,
      new MemoryGuilds(),
      new MemoryRoles(),
      deliveries,
      notifier,
      async () => undefined,
    );

    expect(await worker.sendDueReminders(new Date("2026-09-05T07:30:00.000Z"))).toBe(1);
    expect(notifier.messages[0]?.channelId).toBe("channel-2");
    expect(deliveries.statuses.get("guild-1:match-1:reminder")).toBe("failed");
  });
  it("mentions only subscriptions for the matching international edition", async () => {
    const matches = new MemoryMatches();
    matches.value = { ...match, overviewPage: "2026 Season World Championship/Main Event" };
    const notifier = new MemoryNotifier();
    const available = [
      { guildId: "guild-1", teamKey: "t1", teamName: "T1", roleId: "lck-role" },
      { guildId: "guild-1", teamKey: "worlds-2025:t1", teamName: "T1", roleId: "old-worlds-role" },
      { guildId: "guild-1", teamKey: "worlds-2026:t1", teamName: "T1", roleId: "current-worlds-role" },
    ];
    const worker = new NotificationWorker(matches, new MemoryGuilds(), {
      findForTeams: async (guild, keys) => available.filter(role => role.guildId === guild && keys.includes(role.teamKey)),
    }, new MemoryDeliveries(), notifier, async () => undefined);
    await worker.sendDueReminders(new Date("2026-09-05T07:30:00Z"));
    expect(notifier.messages[0]?.payload.content).toBe("<@&current-worlds-role>");
    expect(notifier.messages[0]?.payload.allowedMentions).toEqual({ parse: [], roles: ["current-worlds-role"] });
  });

});
