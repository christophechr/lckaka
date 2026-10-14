import { describe, expect, it } from "vitest";

import { ScheduleService } from "../src/schedule-service.js";
import type { Match } from "../src/leaguepedia.js";

const match: Match = {
  id: "match-1",
  team1: "T1",
  team2: "Gen.G",
  startsAt: new Date("2026-09-05T08:00:00.000Z"),
  bestOf: 5,
  tournament: "LCK/2026 Season/Playoffs",
};

describe("ScheduleService", () => {
  it("reuses a fresh result instead of querying Leaguepedia again", async () => {
    let requestCount = 0;
    const service = new ScheduleService(async () => {
      requestCount += 1;
      return [match];
    });

    const first = await service.getWeek(new Date("2026-09-03T08:00:00.000Z"));
    const second = await service.getWeek(new Date("2026-09-03T08:10:00.000Z"));

    expect(first.matches).toEqual([match]);
    expect(second.matches).toEqual([match]);
    expect(second.stale).toBe(false);
    expect(requestCount).toBe(1);
  });

  it("returns the last valid result when a refresh fails", async () => {
    let requestCount = 0;
    const service = new ScheduleService(async () => {
      requestCount += 1;
      if (requestCount === 2) throw new Error("rate limited");
      return [match];
    });

    await service.getWeek(new Date("2026-09-03T08:00:00.000Z"));
    const fallback = await service.getWeek(new Date("2026-09-03T08:16:00.000Z"));

    expect(fallback.matches).toEqual([match]);
    expect(fallback.stale).toBe(true);
  });
});
