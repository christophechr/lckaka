import type { ScheduleService } from "./schedule-service.js";
import { createScheduleMessages } from "./schedule-message.js";
import { sendWebhookMessage } from "./webhook.js";
import type { CalendarCompetition } from "./competitions.js";

export async function publishSchedule(
  webhookUrl: string,
  service: ScheduleService,
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
  competition: CalendarCompetition = "LCK",
): Promise<void> {
  const embeds = await createScheduleMessages(service, now, competition);
  for (const embed of embeds) {
    await sendWebhookMessage(webhookUrl, embed, fetcher);
  }
}
