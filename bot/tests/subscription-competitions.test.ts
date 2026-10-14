import { describe, expect, it } from "vitest";
import { isSubscriptionOpen, subscriptionScope, subscriptionTeamKey } from "../src/subscription-competitions.js";

describe("competition subscriptions", () => {
  const worlds = { key: "worlds-2026", title: "Worlds 2026", overviewPage: "2026 Season World Championship", startsOn: "2026-10-15", endsOn: "2026-11-14", teams: [] };
  it("opens at midnight Paris on J-10, stays open through the tournament, then closes", () => {
    expect(isSubscriptionOpen(worlds, new Date("2026-10-04T21:59:59Z"))).toBe(false);
    expect(isSubscriptionOpen(worlds, new Date("2026-10-04T22:00:00Z"))).toBe(true);
    expect(isSubscriptionOpen(worlds, new Date("2026-10-15T10:00:00Z"))).toBe(true);
    expect(isSubscriptionOpen(worlds, new Date("2026-11-14T22:59:59Z"))).toBe(true);
    expect(isSubscriptionOpen(worlds, new Date("2026-11-14T23:00:00Z"))).toBe(false);
  });
  it("uses calendar days across DST and does not guess missing dates", () => {
    const tournament = { ...worlds, startsOn: "2026-04-02", endsOn: "2026-04-10" };
    expect(isSubscriptionOpen(tournament, new Date("2026-03-22T22:59:59Z"))).toBe(false);
    expect(isSubscriptionOpen(tournament, new Date("2026-03-22T23:00:00Z"))).toBe(true);
    expect(isSubscriptionOpen({ ...worlds, startsOn: null }, new Date("2026-10-10"))).toBe(false);
    expect(isSubscriptionOpen({ ...worlds, key: "lec", startsOn: null, endsOn: null }, new Date("2026-01-01"))).toBe(true);
  });
  it.each([
    ["LCK/2026 Season/Playoffs", "lck"],
    ["LEC/2026 Season/Summer Playoffs", "lec"],
    ["2026 First Stand", "fst-2026"],
    ["2026 Mid-Season Invitational", "msi-2026"],
    ["2026 Season World Championship/Play-In", "worlds-2026"],
    ["Esports World Cup 2026", "ewc-2026"],
  ])("maps all stages of %s to %s", (page, scope) => {
    expect(subscriptionScope(page)).toBe(scope);
  });
  it("isolates subscriptions by competition and edition while preserving LCK roles", () => {
    expect(subscriptionTeamKey("lck", "t1")).toBe("t1");
    expect(subscriptionTeamKey("lec", "g2-esports")).toBe("lec:g2-esports");
    expect(subscriptionTeamKey("worlds-2026", "t1")).toBe("worlds-2026:t1");
    expect(subscriptionScope("LPL/2026 Season")).toBeNull();
  });
});
