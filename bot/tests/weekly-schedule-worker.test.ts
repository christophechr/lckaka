import type { MessageCreateOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { WeeklyScheduleWorker } from "../src/bot/weekly-schedule-worker.js";
import type { CalendarChannel } from "../src/db/guild-config-repository.js";
import type { Team } from "../src/db/match-repository.js";
import type { DiscordEmbed } from "../src/embed.js";
import type { WeeklyScheduleDeliveryStore } from "../src/db/weekly-schedule-repository.js";

class MemoryDeliveries implements WeeklyScheduleDeliveryStore {
  sent = new Set<string>();
  async deliverScheduleOnce(guildId: string, week: string, load: () => Promise<DiscordEmbed[]>, send: (embed: DiscordEmbed, pageIndex: number) => Promise<string>): Promise<boolean> {
    const key = `${guildId}:${week}`;
    if (this.sent.has(key)) return false;
    for (const [index, embed] of (await load()).entries()) await send(embed, index);
    this.sent.add(key);
    return true;
  }
}

function fixture(deliveries = new MemoryDeliveries()) {
  const schedule = { getWeek: vi.fn(async () => ({ weekLabel: "cette semaine", matches: [], stale: false })) };
  const guilds = { listCalendarChannels: async () => [
    { guildId: "one", channelId: "channel-one" },
    { guildId: "two", channelId: "channel-two" },
  ] };
  const gateway = { sendMessage: vi.fn(async (_channel: string, _payload: MessageCreateOptions) => "message-id") };
  const worker = new WeeklyScheduleWorker(schedule, guilds, { listTeams: async () => [] }, gateway, deliveries);
  return { worker, schedule, gateway, deliveries };
}

describe("WeeklyScheduleWorker", () => {
  it("publishes the weekly schedule with team emojis in every notification channel", async () => {
    const messages: Array<{ channelId: string; payload: MessageCreateOptions }> = [];
    const guilds = {
      async listCalendarChannels(): Promise<CalendarChannel[]> {
        return [
          {
            guildId: "guild-1",
            channelId: "channel-1",
          },
        ];
      },
    };
    const teams = {
      async listTeams(): Promise<Team[]> {
        return [
          { key: "t1", name: "T1", emojiId: "emoji-t1", emojiName: "lck_t1" },
          { key: "gen-g", name: "Gen.G", emojiId: "emoji-geng", emojiName: "lck_gen_g" },
        ];
      },
    };
    const schedule = {
      async getWeek() {
        return {
          weekLabel: "du 31 août au 6 septembre 2026",
          stale: false,
          matches: [
            {
              id: "match-1",
              team1: "T1",
              team2: "Gen.G",
              startsAt: new Date("2026-09-05T08:00:00.000Z"),
              bestOf: 5,
              tournament: "LCK/2026 Season/Playoffs",
            },
          ],
        };
      },
    };
    const notifier = {
      async sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string> {
        messages.push({ channelId, payload });
        return "message-1";
      },
    };
    const worker = new WeeklyScheduleWorker(schedule, guilds, teams, notifier, new MemoryDeliveries());

    expect(await worker.publish(new Date("2026-09-01T08:00:00.000Z"))).toBe(1);
    expect(messages[0]?.channelId).toBe("channel-1");
    expect((messages[0]?.payload.embeds?.[0] as { fields?: Array<{ value: string }> }).fields?.[0]?.value)
      .toContain("<:lck_t1:emoji-t1> **T1** ⚔️ <:lck_gen_g:emoji-geng> **Gen.G**");
  });

  it.each([
    ["2026-09-07T05:59:59Z", "2026-09-07T06:00:00Z"],
    ["2026-03-30T05:59:59Z", "2026-03-30T06:00:00Z"],
    ["2026-10-26T06:59:59Z", "2026-10-26T07:00:00Z"],
  ])("waits for Monday 08:00 Paris including DST (%s)", async (before, due) => {
    const { worker, schedule } = fixture();
    expect(await worker.publish(new Date(before))).toBe(0);
    expect(schedule.getWeek).not.toHaveBeenCalled();
    expect(await worker.publish(new Date(due))).toBe(2);
  });

  it("catches up after sleep and skips already sent weeks after restart without fetching Leaguepedia", async () => {
    const first = fixture();
    expect(await first.worker.publish(new Date("2026-09-07T08:00:00Z"))).toBe(2);
    expect(first.schedule.getWeek).toHaveBeenCalledTimes(1);
    const restarted = fixture(first.deliveries);
    expect(await restarted.worker.publish(new Date("2026-09-08T08:00:00Z"))).toBe(0);
    expect(restarted.schedule.getWeek).not.toHaveBeenCalled();
    expect(await restarted.worker.publish(new Date("2026-09-14T06:00:00Z"))).toBe(2);
    expect(restarted.deliveries.sent.size).toBe(4);
  });

  it("retries only failed guilds and keeps a stable Discord nonce", async () => {
    const { worker, gateway } = fixture();
    gateway.sendMessage.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(worker.publish(new Date("2026-09-07T06:00:00Z"))).rejects.toThrow("Échec de publication");
    expect(gateway.sendMessage).toHaveBeenCalledTimes(2);
    expect(await worker.publish(new Date("2026-09-07T06:01:00Z"))).toBe(1);
    expect(gateway.sendMessage.mock.calls.map(([channel]) => channel)).toEqual(["channel-one", "channel-two", "channel-one"]);
    expect(gateway.sendMessage.mock.calls[0]?.[1].nonce).toBe(gateway.sendMessage.mock.calls[2]?.[1].nonce);
    expect(gateway.sendMessage.mock.calls[2]?.[1].enforceNonce).toBe(true);
  });

  it("retries the source after an outage without recording a delivery", async () => {
    const { worker, schedule, deliveries } = fixture();
    schedule.getWeek.mockRejectedValueOnce(new Error("Leaguepedia indisponible"));
    await expect(worker.publish(new Date("2026-09-07T06:00:00Z"))).rejects.toThrow();
    expect(deliveries.sent.size).toBe(0);
    expect(await worker.publish(new Date("2026-09-07T06:01:00Z"))).toBe(2);
  });
  it("uses distinct nonces for each page of a busy calendar", async () => {
    const { gateway, deliveries } = fixture();
    const worker = new WeeklyScheduleWorker({ getWeek: async () => ({
      weekLabel: "cette semaine", stale: false,
      matches: Array.from({ length: 100 }, (_, index) => ({
        id: String(index), team1: `Team-${index}`, team2: "Opponent", bestOf: 3,
        startsAt: new Date("2026-09-07T12:00:00Z"), tournament: "LCK/2026 Season",
      })),
    }) }, { listCalendarChannels: async () => [{
      guildId: "guild-1", channelId: "channel-1",
    }] }, { listTeams: async () => [] }, gateway, deliveries);
    expect(await worker.publish(new Date("2026-09-07T06:00:00Z"))).toBe(1);
    const payloads = gateway.sendMessage.mock.calls.map(([, payload]) => payload);
    expect(payloads.length).toBeGreaterThan(1);
    expect(new Set(payloads.map(payload => payload.nonce)).size).toBe(payloads.length);
    for (const payload of payloads) {
      expect(payload.enforceNonce).toBe(true);
      expect(payload.allowedMentions).toEqual({ parse: [] });
      expect(payload.embeds).toHaveLength(1);
    }
  });

});
