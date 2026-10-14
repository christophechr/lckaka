import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { Team } from "../db/match-repository.js";
import { commands as additionalCommands } from "./commands/index.js";
import { PREDICTION_COMMANDS_JSON } from "./prediction-commands.js";

export const CONFIG_COMMAND_JSON = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure les fonctionnalités LCK")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("notifications")
      .setDescription("Choisit le salon des rappels et résultats")
      .addChannelOption((option) =>
        option
          .setName("salon")
          .setDescription("Salon des notifications")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("abonnements")
      .setDescription("Publie le panneau d'abonnement")
      .addChannelOption((option) =>
        option
          .setName("salon")
          .setDescription("Salon du panneau")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .toJSON();

export const ALL_COMMANDS_JSON = [
  CONFIG_COMMAND_JSON,
  ...additionalCommands.map((command) => command.data.toJSON()),
  ...PREDICTION_COMMANDS_JSON,
];

export function getCommandRoute(clientId: string, guildId?: string): `/${string}` {
  return guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
}

export interface ConfigCommandDependencies {
  guildConfigs: {
    setNotificationChannel(guildId: string, channelId: string): Promise<void>;
  };
  matchCatalog: {
    listTeams(): Promise<Team[]>;
  };
  panels: {
    ensureChannel(guildId: string, channelId: string): Promise<void>;
    publishOrUpdate(guildId: string, channelId: string, teams: Team[]): Promise<string>;
  };
}

export async function handleConfigCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: ConfigCommandDependencies,
): Promise<void> {
  if (
    !interaction.guildId ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "La permission « Gérer le serveur » est requise.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;
  const channel = interaction.options.getChannel("salon", true);
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === "notifications") {
    await dependencies.panels.ensureChannel(guildId, channel.id);
    await dependencies.guildConfigs.setNotificationChannel(guildId, channel.id);
    await interaction.editReply({
      content: `Salon de notifications configuré : <#${channel.id}>.`,
    });
    return;
  }

  if (subcommand === "abonnements") {
    const teams = await dependencies.matchCatalog.listTeams();
    await dependencies.panels.publishOrUpdate(guildId, channel.id, teams);
    await interaction.editReply({
      content: `Panneau d'abonnement configuré : <#${channel.id}>.`,
    });
    return;
  }

  throw new Error(`Sous-commande inconnue : ${subcommand}`);
}
