import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { LEADERBOARD_CHANNEL_ID } from "../config.js";
import type { PredictionStore } from "../db/prediction-repository.js";
import type { WeeklyLeaderboardStore } from "../db/weekly-leaderboard-repository.js";
import { PARIS_TIME_ZONE } from "../week.js";
import { PREDICTION_COLORS } from "./prediction-message.js";
import type { WeeklyScheduleGateway } from "./weekly-schedule-worker.js";

export class WeeklyLeaderboardWorker {
  constructor(
    private readonly predictions: Pick<PredictionStore, "leaderboard">,
    private readonly deliveries: WeeklyLeaderboardStore,
    private readonly gateway: WeeklyScheduleGateway,
    private readonly prepareGuild: () => Promise<string>,
  ) {}

  async publish(now: Date): Promise<boolean> {
    const parisNow = DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE });
    const monday = parisNow.startOf("week");
    if (parisNow < monday.set({ hour: 8 })) return false;
    const weekStart = monday.toISODate()!;
    const guildId = await this.prepareGuild();
    return this.deliveries.deliverOnce(guildId, weekStart, async () => {
      const board = await this.predictions.leaderboard(guildId, 1);
      return {
        title: `🏆 Bilan hebdomadaire · ${monday.setLocale("fr").toFormat("d MMMM yyyy")}`,
        color: PREDICTION_COLORS.gold,
        description: `Classement cumulé au <t:${Math.floor(now.getTime() / 1000)}:f> · Toutes compétitions\n\n`
          + (board.entries.length ? board.entries.map(entry =>
            `**${entry.rank}.** <@${entry.userId}> — **${entry.points} pts**\n`
            + `${entry.correctWinners} bon(s) vainqueur(s) · ${entry.exactScores} bonus score exact · ${entry.settled} match(s) compté(s)`,
          ).join("\n\n") : "Aucun pronostiqueur pour le moment. Vote avec les boutons des matchs pour participer."),
        fields: [],
        footer: { text: `Top 10 · ${board.total} membre(s) · Classement complet : /classement · Vainqueur : 3 pts, score exact BO3/BO5 : +2` },
        timestamp: now.toISOString(),
      };
    }, embed => this.gateway.sendMessage(LEADERBOARD_CHANNEL_ID, {
      embeds: [embed],
      allowedMentions: { parse: [] },
      nonce: createHash("sha256").update(`weekly-leaderboard:${guildId}:${weekStart}`).digest("hex").slice(0, 25),
      enforceNonce: true,
    }));
  }
}
