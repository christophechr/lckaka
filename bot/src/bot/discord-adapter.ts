import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type MessageCreateOptions,
  type MessageEditOptions,
  type SendableChannels,
} from "discord.js";

import type { CreateManagedRole, ManagedRole, RoleGateway } from "./role-service.js";
import type { PanelGateway } from "./panel-service.js";
import type { ApplicationEmojiRef, TeamEmojiGateway } from "./team-emoji-sync.js";

function managedRole(role: { id: string; name: string }): ManagedRole {
  return { id: role.id, name: role.name };
}

function errorCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? Number((error as { code: unknown }).code)
    : undefined;
}

export class DiscordAdapter implements RoleGateway, PanelGateway, TeamEmojiGateway {
  constructor(private readonly client: Client) {}

  private async guild(guildId: string): Promise<Guild> {
    return this.client.guilds.fetch(guildId);
  }

  private async sendableChannel(channelId: string): Promise<SendableChannels> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) {
      throw new Error("Le salon Discord ne permet pas l'envoi de messages.");
    }
    return channel;
  }

  async findRole(guildId: string, roleId: string): Promise<ManagedRole | null> {
    const role = await (await this.guild(guildId)).roles.fetch(roleId);
    return role ? managedRole(role) : null;
  }

  async findRoleByName(guildId: string, name: string): Promise<ManagedRole | null> {
    const guild = await this.guild(guildId);
    await guild.roles.fetch();
    const role = guild.roles.cache.find((candidate) => candidate.name === name);
    return role ? managedRole(role) : null;
  }

  async createRole(input: CreateManagedRole): Promise<ManagedRole> {
    const role = await (await this.guild(input.guildId)).roles.create({
      name: input.name,
      permissions: input.permissions,
      color: input.color ?? undefined,
      hoist: input.hoist,
      mentionable: input.mentionable,
      reason: "Abonnement d'équipe créé par le bot",
    });
    return managedRole(role);
  }

  async canManageRole(guildId: string, roleId: string): Promise<boolean> {
    const role = await (await this.guild(guildId)).roles.fetch(roleId);
    return role?.editable ?? false;
  }

  async memberHasRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    const member = await (await this.guild(guildId)).members.fetch(userId);
    return member.roles.cache.has(roleId);
  }

  async addRole(guildId: string, userId: string, roleId: string): Promise<void> {
    const member = await (await this.guild(guildId)).members.fetch(userId);
    await member.roles.add(roleId, "Abonnement à une équipe");
  }

  async removeRole(guildId: string, userId: string, roleId: string): Promise<void> {
    const member = await (await this.guild(guildId)).members.fetch(userId);
    await member.roles.remove(roleId, "Désabonnement à une équipe");
  }

  async ensureUsableTextChannel(
    guildId: string,
    channelId: string,
    requireRoleMentions = false,
  ): Promise<void> {
    const guild = await this.guild(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error("Le salon choisi doit être un salon textuel accessible au bot.");
    }

    const bot = guild.members.me ?? (await guild.members.fetchMe());
    const permissions = channel.permissionsFor(bot);
    const required = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory,
      ...(requireRoleMentions ? [PermissionFlagsBits.MentionEveryone] : []),
    ];
    if (!permissions?.has(required)) {
      throw new Error(
        requireRoleMentions
          ? "Le bot doit pouvoir voir le salon, envoyer des messages, intégrer des liens, lire l'historique et mentionner les rôles."
          : "Le bot doit pouvoir voir le salon, envoyer des messages, intégrer des liens et lire l'historique.",
      );
    }
  }

  async sendMessage(channelId: string, payload: MessageCreateOptions): Promise<string> {
    const message = await (await this.sendableChannel(channelId)).send(payload);
    return message.id;
  }

  async editMessage(
    channelId: string,
    messageId: string,
    payload: MessageCreateOptions,
  ): Promise<boolean> {
    const channel = await this.sendableChannel(channelId);
    if (!("messages" in channel)) return false;

    try {
      const message = await channel.messages.fetch(messageId);
      await message.edit(payload as MessageEditOptions);
      return true;
    } catch (error) {
      if (errorCode(error) === 10_008) return false;
      throw error;
    }
  }

  async listApplicationEmojis(): Promise<ApplicationEmojiRef[]> {
    if (!this.client.application) throw new Error("Application Discord indisponible.");
    const emojis = await this.client.application.emojis.fetch();
    return [...emojis.values()].map((emoji) => ({ id: emoji.id, name: emoji.name }));
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return;
      if (!("messages" in channel)) throw new Error("Le salon ne permet pas de retirer le panneau.");
      await channel.messages.delete(messageId);
    } catch (error) {
      if (errorCode(error) !== 10_008 && errorCode(error) !== 10_003) throw error;
    }
  }

  async createApplicationEmoji(name: string, image: Buffer): Promise<ApplicationEmojiRef> {
    if (!this.client.application) throw new Error("Application Discord indisponible.");
    const emoji = await this.client.application.emojis.create({ attachment: image, name });
    return { id: emoji.id, name: emoji.name };
  }

  async deleteApplicationEmoji(id: string): Promise<void> {
    if (!this.client.application) throw new Error("Application Discord indisponible.");
    await this.client.application.emojis.delete(id);
  }
}
