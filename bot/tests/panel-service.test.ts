import { describe, expect, it } from "vitest";

import {
  PanelService,
  type GuildPanelStore,
  type PanelGateway,
} from "../src/bot/panel-service.js";
import type { GuildConfig } from "../src/db/guild-config-repository.js";

class MemoryPanelStore implements GuildPanelStore {
  config: GuildConfig | null = null;

  async get(): Promise<GuildConfig | null> {
    return this.config;
  }

  async setSubscriptionPanel(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    this.config = {
      guildId,
      notificationChannelId: this.config?.notificationChannelId ?? null,
      subscriptionChannelId: channelId,
      subscriptionMessageId: messageId,
    };
  }

  async listWithSubscriptionPanel(): Promise<GuildConfig[]> {
    return this.config?.subscriptionChannelId && this.config.subscriptionMessageId
      ? [this.config]
      : [];
  }
}

class MemoryPanelGateway implements PanelGateway {
  readonly sent: Array<{ channelId: string; payload: unknown }> = [];
  readonly edited: Array<{ channelId: string; messageId: string; payload: unknown }> = [];
  editSucceeds = true;

  async ensureUsableTextChannel(): Promise<void> {}

  async sendMessage(channelId: string, payload: unknown): Promise<string> {
    this.sent.push({ channelId, payload });
    return `message-${this.sent.length}`;
  }

  async editMessage(channelId: string, messageId: string, payload: unknown): Promise<boolean> {
    this.edited.push({ channelId, messageId, payload });
    return this.editSucceeds;
  }
}

const teams = [
  { key: "gen-g", name: "Gen.G" },
  { key: "t1", name: "T1" },
];

describe("PanelService", () => {
  it("publishes and stores the first subscription panel", async () => {
    const store = new MemoryPanelStore();
    const gateway = new MemoryPanelGateway();
    const service = new PanelService(store, gateway);

    const messageId = await service.publishOrUpdate("guild-1", "channel-1", teams);

    expect(messageId).toBe("message-1");
    expect(gateway.sent).toHaveLength(1);
    expect(store.config?.subscriptionMessageId).toBe("message-1");
  });

  it("updates an accessible existing panel", async () => {
    const store = new MemoryPanelStore();
    store.config = {
      guildId: "guild-1",
      notificationChannelId: null,
      subscriptionChannelId: "channel-1",
      subscriptionMessageId: "existing-message",
    };
    const gateway = new MemoryPanelGateway();
    const service = new PanelService(store, gateway);

    expect(await service.publishOrUpdate("guild-1", "channel-1", teams)).toBe(
      "existing-message",
    );
    expect(gateway.edited).toHaveLength(1);
    expect(gateway.sent).toEqual([]);
  });

  it("recreates a deleted panel", async () => {
    const store = new MemoryPanelStore();
    store.config = {
      guildId: "guild-1",
      notificationChannelId: null,
      subscriptionChannelId: "channel-1",
      subscriptionMessageId: "deleted-message",
    };
    const gateway = new MemoryPanelGateway();
    gateway.editSucceeds = false;
    const service = new PanelService(store, gateway);

    expect(await service.publishOrUpdate("guild-1", "channel-1", teams)).toBe("message-1");
    expect(gateway.sent).toHaveLength(1);
    expect(store.config?.subscriptionMessageId).toBe("message-1");
  });

  it("refreshes configured panels after team emojis are synchronized", async () => {
    const store = new MemoryPanelStore();
    store.config = {
      guildId: "guild-1",
      notificationChannelId: null,
      subscriptionChannelId: "channel-1",
      subscriptionMessageId: "existing-message",
    };
    const gateway = new MemoryPanelGateway();
    const service = new PanelService(store, gateway);

    expect(
      await service.refreshConfiguredPanels([
        { key: "t1", name: "T1", emojiId: "emoji-1", emojiName: "lck_t1" },
      ]),
    ).toBe(1);
    expect(gateway.edited[0]).toMatchObject({
      channelId: "channel-1",
      messageId: "existing-message",
    });
  });
});
