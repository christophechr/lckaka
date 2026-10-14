import type { MessageCreateOptions } from "discord.js";

import type { GuildConfig } from "../db/guild-config-repository.js";
import type { Team } from "../db/match-repository.js";
import { buildSubscriptionPanel } from "./messages.js";

export interface GuildPanelStore {
  get(guildId: string): Promise<GuildConfig | null>;
  setSubscriptionPanel(guildId: string, channelId: string, messageId: string): Promise<void>;
  listWithSubscriptionPanel(): Promise<GuildConfig[]>;
}

export interface PanelGateway {
  ensureUsableTextChannel(
    guildId: string,
    channelId: string,
    requireRoleMentions?: boolean,
  ): Promise<void>;
  sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string>;
  editMessage(
    channelId: string,
    messageId: string,
    payload: MessageCreateOptions,
  ): Promise<boolean>;
}

export class PanelService {
  constructor(
    private readonly configs: GuildPanelStore,
    private readonly gateway: PanelGateway,
  ) {}

  async ensureChannel(guildId: string, channelId: string): Promise<void> {
    await this.gateway.ensureUsableTextChannel(guildId, channelId, true);
  }

  async publishOrUpdate(guildId: string, channelId: string, teams: Team[]): Promise<string> {
    await this.ensureChannel(guildId, channelId);
    const payload = buildSubscriptionPanel(teams);
    const config = await this.configs.get(guildId);
    if (
      config?.subscriptionChannelId === channelId &&
      config.subscriptionMessageId &&
      (await this.gateway.editMessage(channelId, config.subscriptionMessageId, payload))
    ) {
      return config.subscriptionMessageId;
    }

    const messageId = await this.gateway.sendMessage(channelId, payload);
    await this.configs.setSubscriptionPanel(guildId, channelId, messageId);
    return messageId;
  }

  async refreshConfiguredPanels(teams: Team[]): Promise<number> {
    const configs = await this.configs.listWithSubscriptionPanel();
    let refreshed = 0;
    for (const config of configs) {
      if (!config.subscriptionChannelId) continue;
      await this.publishOrUpdate(config.guildId, config.subscriptionChannelId, teams);
      refreshed += 1;
    }
    return refreshed;
  }
}
