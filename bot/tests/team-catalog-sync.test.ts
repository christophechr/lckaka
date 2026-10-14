import { describe, expect, it } from "vitest";

import { TeamCatalogSync } from "../src/bot/team-catalog-sync.js";
import type { Team } from "../src/db/match-repository.js";

class MemoryCatalog {
  seasonYear: number | null = null;
  teams: Team[] = [];

  async replaceSeason(seasonYear: number, teams: Team[]): Promise<void> {
    this.seasonYear = seasonYear;
    this.teams = teams;
  }
}

describe("TeamCatalogSync", () => {
  it("loads the current LCK roster once per day", async () => {
    const catalog = new MemoryCatalog();
    const requestedYears: number[] = [];
    const sync = new TeamCatalogSync(async (seasonYear) => {
      requestedYears.push(seasonYear);
      return [
        { key: "gen-g", name: "Gen.G" },
        { key: "t1", name: "T1" },
      ];
    }, catalog);

    await sync.sync(new Date("2026-09-04T08:00:00.000Z"));
    await sync.sync(new Date("2026-09-04T09:00:00.000Z"));

    expect(requestedYears).toEqual([2026]);
    expect(catalog.seasonYear).toBe(2026);
    expect(catalog.teams).toEqual([
      { key: "gen-g", name: "Gen.G" },
      { key: "t1", name: "T1" },
    ]);
  });

  it("keeps the persisted catalog when a later refresh fails", async () => {
    const catalog = new MemoryCatalog();
    let requestCount = 0;
    const sync = new TeamCatalogSync(async () => {
      requestCount += 1;
      if (requestCount === 2) throw new Error("Leaguepedia indisponible");
      return [{ key: "t1", name: "T1" }];
    }, catalog);

    await sync.sync(new Date("2026-09-04T08:00:00.000Z"));
    await expect(sync.sync(new Date("2026-09-05T08:01:00.000Z"))).rejects.toThrow(
      "Leaguepedia indisponible",
    );

    expect(catalog.teams).toEqual([{ key: "t1", name: "T1" }]);
  });
});
