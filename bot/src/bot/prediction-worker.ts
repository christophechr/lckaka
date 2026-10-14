import type { StoredMatch } from "../db/match-repository.js";
import type { DeliveryStore, NotificationGateway } from "./notification-worker.js";
import { buildPredictionMessage } from "./prediction-message.js";
import type { MessageCreateOptions } from "discord.js";
import type { DeliveryRepository } from "../db/delivery-repository.js";
import { findPredictionAppearances, type PredictionTeamAssetStore } from "./prediction-team-assets.js";

function canVote(match: StoredMatch, now: Date): boolean {
  return !!match.predictionId && [1, 3, 5].includes(match.bestOf)
    && match.scheduledAt.getTime() > now.getTime() + 60_000
    && match.scheduledAt.getTime() <= now.getTime() + 72 * 60 * 60_000
    && !match.isNullified && match.winner === null
    && (match.team1Score ?? 0) === 0 && (match.team2Score ?? 0) === 0
    && !!match.team1Key && !!match.team2Key && match.team1Key !== match.team2Key
    && ![match.team1Name, match.team2Name].some(name => ["", "tbd", "tba", "unknown"].includes(name.trim().toLowerCase()));
}

export class PredictionWorker {
  constructor(
    private readonly matches: { findPredictionDue(now: Date): Promise<StoredMatch[]> },
    private readonly deliveries: DeliveryStore & Pick<DeliveryRepository, "findSentMessage">,
    private readonly discord: NotificationGateway & { editMessage(channelId: string, messageId: string, payload: MessageCreateOptions): Promise<boolean> },
    private readonly prepareTarget: () => Promise<{ guildId: string; channelId: string }>,
    private readonly teamAssets?: PredictionTeamAssetStore,
  ) {}

  async publish(now: Date): Promise<number> {
    const matches = (await this.matches.findPredictionDue(now)).filter(match => canVote(match, now));
    if (!matches.length) return 0;
    const { guildId, channelId } = await this.prepareTarget();
    let sent = 0;
    for (const match of matches) {
      const teams = await findPredictionAppearances(this.teamAssets, [match.team1Key, match.team2Key]);
      const payload = buildPredictionMessage({ ...match, id: match.predictionId! }, teams);
      if (!(await this.deliveries.claim(guildId, match.matchId, "prediction", now))) {
        const messageId = await this.deliveries.findSentMessage(guildId, match.matchId, "prediction");
        if (messageId) {
          try {
            await this.discord.editMessage(channelId, messageId, payload);
          } catch (error) {
            // Keep the confirmed delivery intact; retry editing on the next tick.
            console.error(`Échec de l'actualisation du pronostic ${match.matchId} :`, error);
          }
        }
        continue;
      }
      try {
        const messageId = await this.discord.sendMessage(channelId, payload);
        await this.deliveries.markSent(guildId, match.matchId, "prediction", messageId, now);
        sent++;
      } catch (error) {
        await this.deliveries.markFailed(guildId, match.matchId, "prediction", error instanceof Error ? error.message : String(error), now);
      }
    }
    return sent;
  }
}
