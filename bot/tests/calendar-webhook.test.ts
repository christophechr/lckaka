import { describe, expect, it } from "vitest";
import { CalendarWebhook } from "../src/bot/calendar-webhook.js";
import { WeeklyScheduleWorker } from "../src/bot/weekly-schedule-worker.js";
import type { WeeklyScheduleDeliveryStore } from "../src/db/weekly-schedule-repository.js";

describe("calendar webhook", () => {
  it.each(["LCK", "LEC"] as const)("publishes only %s matches to that calendar's webhook", async competition => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const guilds: string[] = [];
    const receipts: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: new URL(input.toString()), init });
      return new Response(JSON.stringify(init?.method === "POST"
        ? { id: "message-1" }
        : { guild_id: "webhook-guild", channel_id: "webhook-channel" }), { status: 200 });
    };
    const webhook = new CalendarWebhook(`https://discord.com/api/webhooks/1/${competition}-token?thread_id=42`, {
      ensureGuild: async id => { guilds.push(id); },
    }, fetcher);
    const deliveries: WeeklyScheduleDeliveryStore = { deliverScheduleOnce: async (guildId, week, load, send) => {
      expect(guildId).toBe("webhook-guild");
      expect(week).toBe("2026-09-07");
      for (const [index, embed] of (await load()).entries()) receipts.push(await send(embed, index));
      return true;
    } };
    const worker = new WeeklyScheduleWorker({ getWeek: async () => ({ matches: [
      { id: "lck", team1: "T1", team2: "Gen.G", bestOf: 3, startsAt: new Date("2026-09-07T12:00:00Z"), tournament: "LCK/2026 Season" },
      { id: "lec", team1: "G2", team2: "Fnatic", bestOf: 3, startsAt: new Date("2026-09-07T12:00:00Z"), tournament: "LEC/2026 Season" },
    ], weekLabel: "cette semaine", stale: false }) },
      webhook, { listTeams: async () => [] }, webhook, deliveries, competition);
    expect(await worker.publish(new Date("2026-09-07T06:00:00Z"))).toBe(1);
    expect(guilds).toEqual(["webhook-guild"]);
    expect(receipts).toEqual(["message-1"]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url.search).toBe("");
    expect(requests[1]?.url.pathname).toBe(`/api/webhooks/1/${competition}-token`);
    expect(requests[1]?.url.searchParams.get("thread_id")).toBe("42");
    expect(requests[1]?.url.searchParams.get("wait")).toBe("true");
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      embeds: [{ title: `${competition} — Matchs de la semaine`, description: expect.stringContaining("cette semaine") }], allowed_mentions: { parse: [] },
    });
    expect(String(requests[1]?.init?.body)).toContain(competition === "LCK" ? "T1" : "G2");
    expect(String(requests[1]?.init?.body)).not.toContain(competition === "LCK" ? "G2" : "T1");
  });

  it.each([
    [404, { message: "Unknown webhook" }, "HTTP 404"],
    [200, { guild_id: null, channel_id: null }, "serveur"],
  ])("refuses an unavailable webhook (%i)", async (status, response, error) => {
    const guilds: string[] = [];
    const webhook = new CalendarWebhook("https://discord.com/api/webhooks/1/token", {
      ensureGuild: async id => { guilds.push(id); },
    }, async () => new Response(JSON.stringify(response), { status }));
    await expect(webhook.listCalendarChannels()).rejects.toThrow(error);
    expect(guilds).toEqual([]);
  });
});
