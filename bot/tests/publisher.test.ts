import { describe, expect, it } from "vitest";

import { publishSchedule } from "../src/publisher.js";
import { ScheduleService } from "../src/schedule-service.js";

describe("publishSchedule", () => {
  it("publishes only LEC matches when sending the LEC calendar", async () => {
    const payloads: unknown[] = [];
    const service = new ScheduleService(async () => ["LCK/2026 Season", "LEC/2026 Season", "2026 Season World Championship"].map((tournament, index) => ({
      id: String(index), team1: `Team-${index}`, team2: "Opponent", bestOf: 3,
      startsAt: new Date("2026-09-07T12:00:00Z"), tournament,
    })));
    await publishSchedule("https://discord.com/api/webhooks/2/lec-token", service, new Date("2026-09-07T06:00:00Z"), async (input, init) => {
      expect(new URL(input.toString()).pathname).toBe("/api/webhooks/2/lec-token");
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "message-lec" }), { status: 200 });
    }, "LEC");
    expect(payloads[0]).toMatchObject({ embeds: [{ title: "LEC — Matchs de la semaine" }] });
    expect(JSON.stringify(payloads)).toContain("Team-1");
    expect(JSON.stringify(payloads)).not.toContain("Team-0");
    expect(JSON.stringify(payloads)).not.toContain("Team-2");
  });
  it("loads the current week and posts its embed through the webhook", async () => {
    let payload: { embeds?: Array<{ description?: string }> } = {};
    const fetcher: typeof fetch = async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "message-1" }), { status: 200 });
    };
    const service = new ScheduleService(async () => []);

    await publishSchedule(
      "https://discord.com/api/webhooks/1/token",
      service,
      new Date("2026-09-03T08:00:00Z"),
      fetcher,
    );

    expect(payload.embeds?.[0]?.description).toContain(
      "du 31 août au 6 septembre 2026",
    );
  });
  it("sends every calendar page in a separate webhook message", async () => {
    const payloads: Array<{ embeds: Array<{ fields: Array<{ value: string }> }>; allowed_mentions: { parse: string[] } }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: String(payloads.length) }), { status: 200 });
    };
    const service = new ScheduleService(async () => Array.from({ length: 100 }, (_, index) => ({
      id: String(index), team1: `Team-${index}`, team2: "Opponent", bestOf: 3,
      startsAt: new Date("2026-09-07T12:00:00Z"), tournament: "LCK/2026 Season",
    })));
    await publishSchedule("https://discord.com/api/webhooks/1/token", service, new Date("2026-09-07T06:00:00Z"), fetcher);
    expect(payloads.length).toBeGreaterThan(1);
    const content = payloads.flatMap(payload => payload.embeds.flatMap(embed => embed.fields.map(field => field.value))).join("\n");
    for (let index = 0; index < 100; index += 1) expect(content.split(`**Team-${index}**`)).toHaveLength(2);
    for (const payload of payloads) {
      expect(payload.embeds).toHaveLength(1);
      expect(payload.allowed_mentions.parse).toEqual([]);
    }
  });

  it("publishes only LCK matches to the LCK webhook", async () => {
    const payloads: unknown[] = [];
    const service = new ScheduleService(async () => ["LCK/2026 Season", "LEC/2026 Season", "2026 Season World Championship"].map((tournament, index) => ({
      id: String(index), team1: `Team-${index}`, team2: "Opponent", bestOf: 3,
      startsAt: new Date("2026-09-07T12:00:00Z"), tournament,
    })));
    await publishSchedule("https://discord.com/api/webhooks/1/token", service, new Date("2026-09-07T06:00:00Z"), async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "message-1" }), { status: 200 });
    });
    expect(payloads[0]).toMatchObject({ embeds: [{ title: "LCK — Matchs de la semaine" }] });
    expect(JSON.stringify(payloads)).toContain("Team-0");
    expect(JSON.stringify(payloads)).not.toContain("Team-1");
    expect(JSON.stringify(payloads)).not.toContain("Team-2");
  });

});
