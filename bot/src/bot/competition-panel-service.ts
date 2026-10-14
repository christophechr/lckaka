import { createHash } from "node:crypto";
import type { MessageCreateOptions } from "discord.js";
import type { CompetitionPanel } from "../db/subscription-repository.js";
import type { GuildConfig } from "../db/guild-config-repository.js";
import type { Team } from "../db/match-repository.js";
import { isSubscriptionOpen, subscriptionTeamKey, type SubscriptionCompetition } from "../subscription-competitions.js";
import { buildSubscriptionPanel } from "./messages.js";
import type { PanelGateway } from "./panel-service.js";
import type { ToggleResult } from "./role-service.js";

interface CompetitionPanelStore {
  listCompetitions(): Promise<SubscriptionCompetition[]>;
  listPanels(guildId: string): Promise<CompetitionPanel[]>;
  savePanel(panel: CompetitionPanel): Promise<void>;
  removePanel(guildId: string, scope: string): Promise<void>;
  withGuildLock(guildId: string, operation: () => Promise<void>): Promise<void>;
}

export class SubscriptionUnavailableError extends Error {}

function panelPayload(competition: SubscriptionCompetition): MessageCreateOptions {
  const payload: MessageCreateOptions = competition.teams.length
    ? buildSubscriptionPanel(competition.teams, { title: competition.title, customId: `competition-team-toggle:${competition.key}` })
    : { embeds: [{ title: `Abonnements ${competition.title}`, description: "Les équipes participantes seront proposées dès leur annonce.", color: 0x0c2340 }], components: [] };
  return { ...payload, allowedMentions: { parse: [] } };
}

export class CompetitionPanelService {
  constructor(
    private readonly store: CompetitionPanelStore,
    private readonly guilds: { listWithSubscriptionPanel(): Promise<GuildConfig[]> },
    private readonly gateway: PanelGateway & { deleteMessage(channelId: string, messageId: string): Promise<void> },
    private readonly roles: { toggle(guildId: string, userId: string, team: Team, title: string): Promise<ToggleResult> },
  ) {}

  async refresh(now: Date): Promise<void> {
    const competitions = await this.store.listCompetitions();
    const errors: unknown[] = [];
    for (const guild of await this.guilds.listWithSubscriptionPanel()) {
      const channelId = guild.subscriptionChannelId;
      if (!channelId) continue;
      try {
        await this.store.withGuildLock(guild.guildId, async () => {
          const panels = await this.store.listPanels(guild.guildId);
          // Expiry and postponed dates are evaluated even when no new roster is available.
          for (const panel of panels) {
            const competition = competitions.find(candidate => candidate.key === panel.scopeKey);
            if (!competition || !isSubscriptionOpen(competition, now) || panel.channelId !== channelId) {
              await this.gateway.deleteMessage(panel.channelId, panel.messageId);
              await this.store.removePanel(guild.guildId, panel.scopeKey);
            }
          }
          for (const competition of competitions.filter(candidate => isSubscriptionOpen(candidate, now))) {
            const previous = panels.find(panel => panel.scopeKey === competition.key && panel.channelId === channelId);
            const payload = panelPayload(competition);
            const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
            if (previous?.payloadHash === payloadHash && now.getTime() - previous.updatedAt.getTime() < 60 * 60 * 1000) continue;
            await this.gateway.ensureUsableTextChannel(guild.guildId, channelId);
            let messageId = previous?.messageId;
            if (!messageId || !await this.gateway.editMessage(channelId, messageId, payload)) {
              messageId = await this.gateway.sendMessage(channelId, {
                ...payload,
                nonce: createHash("sha256").update(`panel:${guild.guildId}:${channelId}:${competition.key}`).digest("hex").slice(0, 25),
                enforceNonce: true,
              });
            }
            await this.store.savePanel({ guildId: guild.guildId, scopeKey: competition.key, channelId, messageId, payloadHash, updatedAt: now });
          }
        });
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Échec de mise à jour des panneaux d'abonnement.");
  }

  async toggle(
    guildId: string, userId: string, channelId: string, messageId: string,
    scope: string, teamKey: string, now: Date,
  ): Promise<ToggleResult & { team: Team; competition: string }> {
    const competition = (await this.store.listCompetitions()).find(candidate => candidate.key === scope);
    if (!competition || !isSubscriptionOpen(competition, now)) throw new SubscriptionUnavailableError("Les abonnements à cette compétition ne sont pas ouverts.");
    const guild = (await this.guilds.listWithSubscriptionPanel()).find(candidate => candidate.guildId === guildId);
    const panel = (await this.store.listPanels(guildId)).find(candidate => candidate.scopeKey === scope);
    if (guild?.subscriptionChannelId !== channelId || panel?.channelId !== channelId || panel?.messageId !== messageId) {
      throw new SubscriptionUnavailableError("Ce panneau d'abonnement n'est plus actif.");
    }
    const team = competition.teams.find(candidate => candidate.key === teamKey);
    if (!team) throw new SubscriptionUnavailableError("Cette équipe n'est plus disponible dans le panneau.");
    const result = await this.roles.toggle(guildId, userId, { ...team, key: subscriptionTeamKey(scope, team.key) }, competition.title);
    return { ...result, team, competition: competition.title };
  }
}
