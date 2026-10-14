import { DateTime } from "luxon";
import type { Team } from "./db/match-repository.js";
import { PARIS_TIME_ZONE } from "./week.js";

export interface SubscriptionCompetition {
  key: string;
  title: string;
  overviewPage: string;
  startsOn: string | null;
  endsOn: string | null;
  teams: Team[];
}

export function subscriptionScope(page: string): string | null {
  if (page.startsWith("LCK/")) return "lck";
  if (page.startsWith("LEC/")) return "lec";
  const international = page.match(/^(\d{4}) (First Stand|Mid-Season Invitational|Season World Championship)(?:\/|$)/);
  if (international) {
    const prefix = { "First Stand": "fst", "Mid-Season Invitational": "msi", "Season World Championship": "worlds" }[international[2]!];
    return `${prefix}-${international[1]}`;
  }
  const ewc = page.match(/^Esports World Cup (\d{4})(?:\/|$)/);
  return ewc ? `ewc-${ewc[1]}` : null;
}

export function subscriptionTeamKey(scope: string, teamKey: string): string {
  return scope === "lck" ? teamKey : `${scope}:${teamKey}`;
}

export function isSubscriptionOpen(competition: SubscriptionCompetition, now: Date): boolean {
  if (competition.key === "lec") return true;
  if (!competition.startsOn || !competition.endsOn) return false;
  const start = DateTime.fromISO(competition.startsOn, { zone: PARIS_TIME_ZONE }).startOf("day");
  const end = DateTime.fromISO(competition.endsOn, { zone: PARIS_TIME_ZONE }).startOf("day").plus({ days: 1 });
  const time = now.getTime();
  return start.isValid && end.isValid && end > start
    && time >= start.minus({ days: 10 }).toMillis() && time < end.toMillis();
}
