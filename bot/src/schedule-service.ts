import type { Match } from "./leaguepedia.js";
import { getParisWeekRange, type WeekRange } from "./week.js";

const CACHE_DURATION_MS = 15 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  matches: Match[];
}

export interface WeekSchedule {
  matches: Match[];
  weekLabel: string;
  stale: boolean;
}

type FetchMatches = (range: WeekRange) => Promise<Match[]>;

export class ScheduleService {
  readonly #cache = new Map<string, CacheEntry>();

  constructor(private readonly fetchMatches: FetchMatches) {}

  async getWeek(now: Date): Promise<WeekSchedule> {
    const range = getParisWeekRange(now);
    const key = range.start.toISOString();
    const cached = this.#cache.get(key);

    if (cached && now.getTime() - cached.fetchedAt < CACHE_DURATION_MS) {
      return { matches: cached.matches, weekLabel: range.label, stale: false };
    }

    try {
      const matches = await this.fetchMatches(range);
      this.#cache.set(key, { matches, fetchedAt: now.getTime() });
      return { matches, weekLabel: range.label, stale: false };
    } catch (error) {
      if (cached) {
        return { matches: cached.matches, weekLabel: range.label, stale: true };
      }
      throw error;
    }
  }
}
