import type { MatchState, DateRange } from "../leaguepedia.js";
import type { StoredMatch, Team } from "../db/match-repository.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface MatchStore {
  upsertMany(matches: StoredMatch[]): Promise<void>;
  listTeams(): Promise<Team[]>;
}

export type MatchStateFetcher = (range: DateRange) => Promise<MatchState[]>;

function storedMatch(match: MatchState): StoredMatch {
  return {
    matchId: match.id,
    team1Key: match.team1Key,
    team1Name: match.team1,
    team2Key: match.team2Key,
    team2Name: match.team2,
    scheduledAt: match.startsAt,
    bestOf: match.bestOf,
    overviewPage: match.tournament,
    isNullified: match.isNullified,
    winner: match.winner,
    team1Score: match.team1Score,
    team2Score: match.team2Score,
  };
}

export class MatchSync {
  constructor(
    private readonly fetchMatches: MatchStateFetcher,
    private readonly matches: MatchStore,
    private readonly predictions?: { listPendingResultDays(now: Date): Promise<Date[]> },
  ) {}

  async sync(now: Date): Promise<{ matches: number; teams: number }> {
    const states = await this.fetchMatches({
      start: new Date(now.getTime() - DAY_MS),
      endExclusive: new Date(now.getTime() + 30 * DAY_MS),
    });
    await this.matches.upsertMany(states.map(storedMatch));
    // Recover predicted matches missed while the bot was offline for more than a day.
    const pendingDays = await this.predictions?.listPendingResultDays(now) ?? [];
    for (const start of pendingDays) {
      const results = await this.fetchMatches({ start, endExclusive: new Date(start.getTime() + DAY_MS) });
      await this.matches.upsertMany(results.map(storedMatch));
    }
    const teams = await this.matches.listTeams();
    return { matches: states.length, teams: teams.length };
  }

  async refreshResults(now: Date): Promise<void> {
    const states = await this.fetchMatches({
      start: new Date(now.getTime() - DAY_MS),
      endExclusive: new Date(now.getTime() + 60_000),
    });
    await this.matches.upsertMany(states.map(storedMatch));
  }
}
