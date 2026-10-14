import type { MessageCreateOptions } from "discord.js";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";

import type { CalendarChannel } from "../db/guild-config-repository.js";
import type { Team } from "../db/match-repository.js";
import { buildScheduleEmbeds } from "../embed.js";
import type { Match } from "../leaguepedia.js";
import type { WeeklyScheduleDeliveryStore } from "../db/weekly-schedule-repository.js";
import { PARIS_TIME_ZONE } from "../week.js";
import type { CalendarCompetition } from "../competitions.js";

export interface WeeklyScheduleSource {
  getWeek(now: Date): Promise<{
    matches: Match[];
    weekLabel: string;
    stale: boolean;
  }>;
}

export interface WeeklyScheduleGuildStore {
  listCalendarChannels(): Promise<CalendarChannel[]>;
}

export interface WeeklyScheduleTeamStore {
  listTeams(): Promise<Team[]>;
}

export interface WeeklyScheduleGateway {
  sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string>;
}

export class WeeklyScheduleWorker {
  constructor(
    private readonly schedule: WeeklyScheduleSource,
    private readonly guilds: WeeklyScheduleGuildStore,
    private readonly teams: WeeklyScheduleTeamStore,
    private readonly gateway: WeeklyScheduleGateway,
    private readonly deliveries: WeeklyScheduleDeliveryStore,
    private readonly competition: CalendarCompetition = "LCK",
  ) {}

  async publish(now: Date): Promise<number> {
    const parisNow = DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE });
    const monday = parisNow.startOf("week");
    if (parisNow < monday.set({ hour: 8 })) return 0;
    const weekStart = monday.toISODate()!;
    const guilds = await this.guilds.listCalendarChannels();
    // Load Leaguepedia only if at least one guild still needs this week's message.
    let embedPromise: Promise<ReturnType<typeof buildScheduleEmbeds>> | undefined;
    const loadEmbeds = () => embedPromise ??= Promise.all([
      this.schedule.getWeek(now), this.teams.listTeams(),
    ]).then(([week, teams]) => buildScheduleEmbeds(week.matches, week.weekLabel, week.stale, teams, this.competition));
    let sent = 0;
    const errors: unknown[] = [];
    for (const guild of guilds) {
      const channelId = guild.channelId;
      try {
        const delivered = await this.deliveries.deliverScheduleOnce(guild.guildId, weekStart, loadEmbeds, async (embed, pageIndex) => {
          return this.gateway.sendMessage(channelId, {
            embeds: [embed],
            allowedMentions: { parse: [] },
            // Discord also deduplicates recent retries if a response/DB commit is lost.
            nonce: createHash("sha256").update(`weekly:${this.competition}:${guild.guildId}:${weekStart}:${pageIndex}`).digest("hex").slice(0, 25),
            enforceNonce: true,
          });
        });
        if (delivered) sent += 1;
      } catch (error) {
        errors.push(new Error(`Planning ${this.competition} ${weekStart}, serveur ${guild.guildId}`, { cause: error }));
      }
    }
    if (errors.length) throw new AggregateError(errors, "Échec de publication du planning ; nouvelle tentative à la prochaine minute.");
    return sent;
  }
}
