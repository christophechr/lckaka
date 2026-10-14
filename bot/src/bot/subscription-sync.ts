import type { SubscriptionCompetition } from "../subscription-competitions.js";

export class SubscriptionSync {
  private lastSyncedAt: number | null = null;

  constructor(
    private readonly fetchCompetitions: (now: Date) => Promise<SubscriptionCompetition[]>,
    private readonly store: { saveCompetition(competition: SubscriptionCompetition): Promise<void> },
  ) {}

  async sync(now: Date): Promise<void> {
    if (this.lastSyncedAt !== null && now.getTime() - this.lastSyncedAt < 60 * 60 * 1000) return;
    for (const competition of await this.fetchCompetitions(now)) {
      await this.store.saveCompetition(competition);
    }
    this.lastSyncedAt = now.getTime();
  }
}
