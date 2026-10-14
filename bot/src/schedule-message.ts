import { buildScheduleEmbeds } from "./embed.js";
import type { DiscordEmbed } from "./embed.js";
import type { ScheduleService } from "./schedule-service.js";
import type { CalendarCompetition } from "./competitions.js";

export async function createScheduleMessages(
  service: ScheduleService,
  now: Date = new Date(),
  competition: CalendarCompetition = "LCK",
): Promise<DiscordEmbed[]> {
  const schedule = await service.getWeek(now);
  return buildScheduleEmbeds(schedule.matches, schedule.weekLabel, schedule.stale, [], competition);
}
