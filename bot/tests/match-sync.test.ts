import { describe, expect, it } from "vitest";

import { MatchSync, type MatchStore } from "../src/bot/match-sync.js";
import type { MatchState } from "../src/leaguepedia.js";
import type { StoredMatch, Team } from "../src/db/match-repository.js";

class MemoryMatches implements MatchStore {
  readonly rows = new Map<string, StoredMatch>();

  async upsertMany(matches: StoredMatch[]): Promise<void> {
    for (const match of matches) this.rows.set(match.matchId, match);
  }

  async listTeams(): Promise<Team[]> {
    const teams = new Map<string, Team>();
    for (const match of this.rows.values()) {
      teams.set(match.team1Key, { key: match.team1Key, name: match.team1Name });
      teams.set(match.team2Key, { key: match.team2Key, name: match.team2Name });
    }
    return [...teams.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
  }
}

const state: MatchState = {
  id: "match-1",
  team1: "T1",
  team2: "Gen.G",
  team1Key: "t1",
  team2Key: "gen-g",
  startsAt: new Date("2026-09-05T08:00:00.000Z"),
  bestOf: 5,
  tournament: "LCK/2026 Season/Playoffs",
  winner: null,
  team1Score: null,
  team2Score: null,
  isNullified: false,
};

describe("MatchSync", () => {
  it("recovers old predicted results after downtime, fetching only their UTC days", async () => {
    const store = new MemoryMatches();
    const ranges: Array<{ start: Date; endExclusive: Date }> = [];
    const now = new Date("2026-09-10T12:00:00Z");
    const sync = new MatchSync(async range => {
      ranges.push(range);
      return range.start.getTime() === new Date("2026-09-05T00:00:00Z").getTime()
        ? [{ ...state, winner: 1, team1Score: 3, team2Score: 1 }]
        : [];
    }, store, {
      listPendingResultDays: async received => {
        expect(received).toEqual(now);
        return [new Date("2026-09-05T00:00:00Z")];
      },
    });
    await sync.sync(now);
    expect(ranges).toEqual([
      { start: new Date("2026-09-09T12:00:00Z"), endExclusive: new Date("2026-10-10T12:00:00Z") },
      { start: new Date("2026-09-05T00:00:00Z"), endExclusive: new Date("2026-09-06T00:00:00Z") },
    ]);
    expect(store.rows.get("match-1")).toMatchObject({ winner: 1, team1Score: 3, team2Score: 1 });
  });

  it("persists Leaguepedia match states and returns the team count", async () => {
    const ranges: Array<{ start: Date; endExclusive: Date }> = [];
    const store = new MemoryMatches();
    const sync = new MatchSync(async (range) => {
      ranges.push(range);
      return [state];
    }, store);

    expect(await sync.sync(new Date("2026-09-04T12:00:00.000Z"))).toEqual({
      matches: 1,
      teams: 2,
    });
    expect(ranges).toEqual([
      {
        start: new Date("2026-09-03T12:00:00.000Z"),
        endExclusive: new Date("2026-10-04T12:00:00.000Z"),
      },
    ]);
    expect(store.rows.get("match-1")).toEqual({
      matchId: "match-1",
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
    });
  });

  it("updates a moved or nullified match instead of duplicating it", async () => {
    const store = new MemoryMatches();
    let fetched = state;
    const sync = new MatchSync(async () => [fetched], store);

    await sync.sync(new Date("2026-09-04T12:00:00.000Z"));
    fetched = {
      ...state,
      startsAt: new Date("2026-09-05T09:00:00.000Z"),
      isNullified: true,
    };
    await sync.sync(new Date("2026-09-04T12:15:00.000Z"));

    expect(store.rows).toHaveLength(1);
    expect(store.rows.get("match-1")).toMatchObject({
      scheduledAt: new Date("2026-09-05T09:00:00.000Z"),
      isNullified: true,
    });
  });
});
