import type { MessageCreateOptions } from "discord.js";
import type { CalendarChannel, GuildConfigRepository } from "../db/guild-config-repository.js";
import { sendWebhookMessage } from "../webhook.js";
import type { WeeklyScheduleGateway, WeeklyScheduleGuildStore } from "./weekly-schedule-worker.js";

export class CalendarWebhook implements WeeklyScheduleGuildStore, WeeklyScheduleGateway {
  constructor(
    private readonly webhookUrl: string,
    private readonly guilds: Pick<GuildConfigRepository, "ensureGuild">,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listCalendarChannels(): Promise<CalendarChannel[]> {
    const url = new URL(this.webhookUrl);
    url.search = "";
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Discord webhook HTTP ${response.status}`);
    const webhook = await response.json() as { guild_id?: unknown; channel_id?: unknown };
    if (typeof webhook.guild_id !== "string" || !webhook.guild_id
      || typeof webhook.channel_id !== "string" || !webhook.channel_id) {
      throw new Error("Le webhook du calendrier doit appartenir à un salon de serveur Discord.");
    }
    await this.guilds.ensureGuild(webhook.guild_id);
    return [{ guildId: webhook.guild_id, channelId: webhook.channel_id }];
  }

  async sendMessage(_channelId: string, payload: MessageCreateOptions): Promise<string> {
    const embed = payload.embeds?.[0];
    if (!embed || payload.embeds?.length !== 1) throw new Error("Une page du calendrier doit contenir un embed.");
    return sendWebhookMessage(this.webhookUrl, "toJSON" in embed ? embed.toJSON() : embed, this.fetcher);
  }
}
