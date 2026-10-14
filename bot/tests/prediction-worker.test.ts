import { describe, expect, it, vi } from "vitest";
import type { MessageCreateOptions } from "discord.js";
import type { StoredMatch } from "../src/db/match-repository.js";
import type { DeliveryStore } from "../src/bot/notification-worker.js";
import { PredictionWorker } from "../src/bot/prediction-worker.js";

const now = new Date("2026-09-10T11:30:00Z");
const match: StoredMatch = {
  matchId: "match-1", predictionId: "42", team1Name: "T1", team1Key: "t1",
  team2Name: "Gen.G", team2Key: "gen-g", bestOf: 5,
  scheduledAt: new Date("2026-09-10T12:00:00Z"), overviewPage: "LCK/2026 Season",
  winner: null, team1Score: null, team2Score: null, isNullified: false,
};

function setup(rows: StoredMatch[] = [match]) {
  const sent = new Set<string>();
  const deliveries: DeliveryStore & { findSentMessage(guild: string, id: string, kind: string): Promise<string | null> } = {
    claim: async (_guild, id, kind) => !sent.has(`${id}:${kind}`),
    markSent: async (_guild, id, kind) => { sent.add(`${id}:${kind}`); },
    markFailed: async () => undefined,
    findSentMessage: async (_guild, id, kind) => sent.has(`${id}:${kind}`) ? "message-1" : null,
  };
  const sendMessage = vi.fn<(channel: string, payload: MessageCreateOptions) => Promise<string>>().mockResolvedValue("message-1");
  const target = vi.fn().mockResolvedValue({ guildId: "guild-1", channelId: "1546489098968105031" });
  const editMessage = vi.fn<(channel: string, message: string, payload: MessageCreateOptions) => Promise<boolean>>().mockResolvedValue(true);
  const worker = new PredictionWorker({ findPredictionDue: async () => rows }, deliveries, { sendMessage, editMessage }, target);
  return { worker, deliveries, sendMessage, editMessage, target };
}

describe("dedicated prediction channel", () => {
  it.each([
    [72 * 60 * 60_000 + 1, 0],
    [72 * 60 * 60_000, 1],
    [60_001, 1],
    [60_000, 0],
    [59_999, 0],
  ])("publishes only inside the voting window (%i ms before start)", async (remaining, expected) => {
    const { worker, sendMessage } = setup([{ ...match, scheduledAt: new Date(now.getTime() + remaining) }]);
    expect(await worker.publish(now)).toBe(expected);
    expect(sendMessage).toHaveBeenCalledTimes(expected);
  });

  it("updates an existing embed after a matchup correction without publishing a duplicate", async () => {
    const rows = [{ ...match }];
    const { worker, editMessage, sendMessage } = setup(rows);
    await worker.publish(now);
    rows[0] = { ...match, team1Name: "Replacement", team1Key: "replacement", bestOf: 3 };
    expect(await worker.publish(now)).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessage).toHaveBeenCalledWith("1546489098968105031", "message-1", expect.objectContaining({
      embeds: [expect.objectContaining({ title: expect.stringContaining("Replacement") })],
      components: [expect.objectContaining({ components: expect.any(Array) }), expect.objectContaining({ components: expect.any(Array) })],
    }));
    expect(editMessage.mock.calls[0]![2].components).toMatchObject([
      { components: [{ label: "REPLA 2–0" }, { label: "REPLA 2–1" }] },
      { components: [{ label: "GEN 2–0" }, { label: "GEN 2–1" }] },
    ]);
  });
  it("publishes one voting embed per match only in the target channel", async () => {
    const { worker, sendMessage } = setup();
    expect(await worker.publish(now)).toBe(1);
    expect(await worker.publish(now)).toBe(0);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith("1546489098968105031", expect.objectContaining({
      embeds: [expect.objectContaining({ title: expect.stringContaining("T1") })],
      components: expect.any(Array), allowedMentions: { parse: [] },
    }));
  });

  it.each([{ isNullified: true }, { winner: 1 as const }, { bestOf: 2 }, { scheduledAt: now }, { team1Name: "TBD" }])(
    "skips matches unavailable for predictions: %j", async changes => {
      const { worker, sendMessage, target } = setup([{ ...match, ...changes }]);
      expect(await worker.publish(now)).toBe(0);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(target).not.toHaveBeenCalled();
    },
  );

  it("retries failed sends and continues with other matches", async () => {
    const { worker, sendMessage } = setup([match, { ...match, matchId: "match-2", predictionId: "43" }]);
    sendMessage.mockRejectedValueOnce(new Error("offline"));
    expect(await worker.publish(now)).toBe(1);
    expect(await worker.publish(now)).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
