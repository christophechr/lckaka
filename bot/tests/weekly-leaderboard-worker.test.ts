import type { MessageCreateOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { WeeklyLeaderboardWorker } from "../src/bot/weekly-leaderboard-worker.js";
import type { WeeklyLeaderboardStore } from "../src/db/weekly-leaderboard-repository.js";
import type { DiscordEmbed } from "../src/embed.js";

class MemoryDeliveries implements WeeklyLeaderboardStore {
  sent = new Set<string>();
  async deliverOnce(guildId: string, week: string, load: () => Promise<DiscordEmbed>, send: (embed: DiscordEmbed) => Promise<string>) {
    const key = `${guildId}:${week}`;
    if (this.sent.has(key)) return false;
    await send(await load());
    this.sent.add(key);
    return true;
  }
}

function fixture(deliveries = new MemoryDeliveries()) {
  const board = { total: 12, entries: [
    { rank: 1, userId: "winner", points: 35, correctWinners: 9, exactScores: 4, settled: 12 },
    { rank: 1, userId: "tied", points: 35, correctWinners: 9, exactScores: 4, settled: 12 },
  ] };
  const predictions = { leaderboard: vi.fn(async () => board) };
  const messages: Array<{ channelId: string; payload: MessageCreateOptions }> = [];
  const gateway = { sendMessage: async (channelId: string, payload: MessageCreateOptions) => {
    messages.push({ channelId, payload });
    return `message-${messages.length}`;
  } };
  const worker = new WeeklyLeaderboardWorker(predictions, deliveries, gateway, async () => "guild-1");
  return { worker, deliveries, predictions, board, messages, gateway };
}

describe("weekly cumulative prediction summary", () => {
  it.each([
    ["2026-09-07T05:59:59Z", "2026-09-07T06:00:00Z"],
    ["2026-03-30T05:59:59Z", "2026-03-30T06:00:00Z"],
    ["2026-10-26T06:59:59Z", "2026-10-26T07:00:00Z"],
  ])("waits until Monday 08:00 Paris, including DST (%s)", async (before, due) => {
    const { worker, messages } = fixture();
    expect(await worker.publish(new Date(before))).toBe(false);
    expect(messages).toHaveLength(0);
    expect(await worker.publish(new Date(due))).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it("publishes cumulative points and shared ranks in the dedicated channel without mentions", async () => {
    const { worker, messages, predictions } = fixture();
    await worker.publish(new Date("2026-09-07T06:00:00Z"));
    expect(predictions.leaderboard).toHaveBeenCalledWith("guild-1", 1);
    expect(messages[0]).toMatchObject({ channelId: "1546534221835931759", payload: {
      embeds: [{ title: expect.stringContaining("Bilan hebdomadaire"),
        description: expect.stringMatching(/cumulé[\s\S]*\*\*1\.\*\* <@winner> — \*\*35 pts\*\*[\s\S]*\*\*1\.\*\* <@tied>/),
        footer: { text: expect.stringContaining("/classement") },
      }],
      allowedMentions: { parse: [] }, enforceNonce: true,
    } });
  });

  it("catches up once after a restart and retains cumulative points the next week", async () => {
    const first = fixture();
    expect(await first.worker.publish(new Date("2026-09-09T12:00:00Z"))).toBe(true);
    const restarted = fixture(first.deliveries);
    expect(await restarted.worker.publish(new Date("2026-09-10T12:00:00Z"))).toBe(false);
    expect(restarted.predictions.leaderboard).not.toHaveBeenCalled();
    expect(await restarted.worker.publish(new Date("2026-09-14T06:00:00Z"))).toBe(true);
    expect(restarted.messages[0]?.payload.embeds?.[0]).toMatchObject({ description: expect.stringContaining("35 pts") });
    expect(restarted.messages[0]?.payload.nonce).not.toBe(first.messages[0]?.payload.nonce);
  });

  it("publishes an explicit empty summary", async () => {
    const { worker, board, messages } = fixture();
    board.total = 0;
    board.entries = [];
    await worker.publish(new Date("2026-09-07T06:00:00Z"));
    expect(messages[0]?.payload.embeds?.[0]).toMatchObject({ description: expect.stringContaining("Aucun pronostiqueur") });
  });

  it("retries a failed send with the same nonce", async () => {
    const { worker, gateway, messages } = fixture();
    const send = gateway.sendMessage;
    let fail = true;
    gateway.sendMessage = async (channelId, payload) => {
      const id = await send(channelId, payload);
      if (fail) { fail = false; throw new Error("Discord indisponible"); }
      return id;
    };
    await expect(worker.publish(new Date("2026-09-07T06:00:00Z"))).rejects.toThrow("Discord indisponible");
    expect(await worker.publish(new Date("2026-09-07T06:01:00Z"))).toBe(true);
    expect(messages[0]?.payload.nonce).toBe(messages[1]?.payload.nonce);
  });
});
