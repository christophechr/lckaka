import type { Team } from "../db/match-repository.js";

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface TeamCatalogStore {
  replaceSeason(seasonYear: number, teams: Team[]): Promise<void>;
}

export type TeamCatalogFetcher = (seasonYear: number) => Promise<Team[]>;

export class TeamCatalogSync {
  private lastSyncedAt: number | null = null;

  constructor(
    private readonly fetchTeams: TeamCatalogFetcher,
    private readonly catalog: TeamCatalogStore,
  ) {}

  async sync(now: Date): Promise<void> {
    if (
      this.lastSyncedAt !== null &&
      now.getTime() - this.lastSyncedAt < REFRESH_INTERVAL_MS
    ) {
      return;
    }

    const seasonYear = now.getUTCFullYear();
    const teams = await this.fetchTeams(seasonYear);
    if (teams.length === 0) throw new Error(`Catalogue LCK ${seasonYear} vide.`);
    await this.catalog.replaceSeason(seasonYear, teams);
    this.lastSyncedAt = now.getTime();
  }
}
