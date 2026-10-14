import type { MessageCreateOptions } from "discord.js";

import type { DeliveryKind } from "../db/delivery-repository.js";
import type { GuildConfig } from "../db/guild-config-repository.js";
import type { StoredMatch, Team } from "../db/match-repository.js";
import type { TeamRole } from "../db/team-role-repository.js";
import { buildReminderMessage, buildResultMessage } from "./messages.js";
import { subscriptionScope, subscriptionTeamKey } from "../subscription-competitions.js";

export interface MatchNotificationStore {
  findReminderDue(now: Date): Promise<StoredMatch[]>;
  findCompleted(now: Date): Promise<StoredMatch[]>;
}

export interface GuildTargetStore {
  listWithNotificationChannel(): Promise<GuildConfig[]>;
}

export interface NotificationRoleStore {
  findForTeams(guildId: string, teamKeys: string[]): Promise<TeamRole[]>;
}

export interface DeliveryStore {
  claim(guildId: string, matchId: string, kind: DeliveryKind, now: Date): Promise<boolean>;
  markSent(
    guildId: string,
    matchId: string,
    kind: DeliveryKind,
    discordMessageId: string,
    now: Date,
  ): Promise<void>;
  markFailed(
    guildId: string,
    matchId: string,
    kind: DeliveryKind,
    error: string,
    now: Date,
  ): Promise<void>;
}

export interface NotificationGateway {
  sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string>;
}

export interface NotificationTeamStore {
  findTeams(teamKeys: string[]): Promise<Team[]>;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

export class NotificationWorker {
  constructor(
    private readonly matches: MatchNotificationStore,
    private readonly guilds: GuildTargetStore,
    private readonly roles: NotificationRoleStore,
    private readonly deliveries: DeliveryStore,
    private readonly notifier: NotificationGateway,
    private readonly refreshResults: (now: Date) => Promise<void>,
    private readonly teamCatalog?: NotificationTeamStore,
  ) {}

  async sendDueReminders(now: Date): Promise<number> {
    const matches = await this.matches.findReminderDue(now);
    return this.send(matches, "reminder", now);
  }

  async refreshAndSendResults(now: Date): Promise<number> {
    await this.refreshResults(now);
    const matches = await this.matches.findCompleted(now);
    return this.send(matches, "result", now);
  }

  private async send(
    matches: StoredMatch[],
    kind: DeliveryKind,
    now: Date,
  ): Promise<number> {
    const guilds = await this.guilds.listWithNotificationChannel();
    let sent = 0;

    for (const match of matches) {
      const scope = subscriptionScope(match.overviewPage);
      if (!scope) continue;
      for (const guild of guilds) {
        const channelId = guild.notificationChannelId;
        if (!channelId) continue;
        if (!(await this.deliveries.claim(guild.guildId, match.matchId, kind, now))) continue;

        try {
          const roles = await this.roles.findForTeams(guild.guildId, [
            subscriptionTeamKey(scope, match.team1Key),
            subscriptionTeamKey(scope, match.team2Key),
          ]);
          const roleIds = roles.map((role) => role.roleId);
          const teams = this.teamCatalog
            ? await this.teamCatalog.findTeams([match.team1Key, match.team2Key])
            : [];
          const payload =
            kind === "reminder"
              ? buildReminderMessage(match, roleIds, teams)
              : buildResultMessage(match, roleIds, teams);
          const messageId = await this.notifier.sendMessage(channelId, payload);
          await this.deliveries.markSent(
            guild.guildId,
            match.matchId,
            kind,
            messageId,
            now,
          );
          sent += 1;
        } catch (error) {
          await this.deliveries.markFailed(
            guild.guildId,
            match.matchId,
            kind,
            safeError(error),
            now,
          );
        }
      }
    }

    return sent;
  }
}
