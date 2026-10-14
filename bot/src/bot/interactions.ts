import { MessageFlags, type Interaction } from "discord.js";

import type { Team } from "../db/match-repository.js";
import { handleConfigCommand, type ConfigCommandDependencies } from "./commands.js";
import { commandMap, type CounterStore } from "./commands/index.js";
import { formatTeam, isTeamToggleCustomId } from "./messages.js";
import type { ToggleResult } from "./role-service.js";
import { SubscriptionUnavailableError, type CompetitionPanelService } from "./competition-panel-service.js";
import type { PredictionStore } from "../db/prediction-repository.js";
import { handlePredictionCommand, handlePredictionButton } from "./prediction-commands.js";
import type { PredictionTeamAssetStore } from "./prediction-team-assets.js";

export interface InteractionDependencies {
  config: ConfigCommandDependencies;
  matchCatalog: {
    listTeams(): Promise<Team[]>;
  };
  roles: {
    toggle(guildId: string, userId: string, team: Team): Promise<ToggleResult>;
  };
  counters: CounterStore;
  subscriptions?: Pick<CompetitionPanelService, "toggle">;
  predictions?: PredictionStore;
  predictionTeamAssets?: PredictionTeamAssetStore;
}

export async function handleInteraction(
  interaction: Interaction,
  dependencies: InteractionDependencies,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "classement") {
      await handlePredictionCommand(interaction, dependencies.predictions);
      return;
    }
    if (interaction.commandName === "config") {
      await handleConfigCommand(interaction, dependencies.config);
      return;
    }

    const command = commandMap.get(interaction.commandName);
    if (command) await command.execute(interaction, dependencies.counters);
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandMap.get(interaction.commandName);
    if (command?.autocomplete) {
      await command.autocomplete(interaction, dependencies.counters);
    } else {
      await interaction.respond([]);
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("prono:")) await handlePredictionButton(interaction, dependencies.predictions, dependencies.predictionTeamAssets);
    return;
  }

  if (!interaction.isStringSelectMenu()) return;
  const scope = interaction.customId.match(/^competition-team-toggle:(lec|(?:fst|msi|worlds|ewc)-\d{4})(?::\d+)?$/)?.[1];
  if (!scope && !isTeamToggleCustomId(interaction.customId)) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guildId) {
    await interaction.editReply({ content: "Cette action est réservée à un serveur Discord." });
    return;
  }

  const selectedKey = interaction.values[0];
  if (scope) {
    try {
      if (!dependencies.subscriptions) throw new SubscriptionUnavailableError("Les abonnements sont temporairement indisponibles.");
      const result = await dependencies.subscriptions.toggle(
        interaction.guildId, interaction.user.id, interaction.channelId,
        interaction.message.id, scope, selectedKey ?? "", new Date(),
      );
      await interaction.editReply({ content: `${result.action === "added" ? "Tu suis maintenant" : "Tu ne suis plus"} ${formatTeam(result.team, result.team.name)} — ${result.competition}.` });
    } catch (error) {
      if (!(error instanceof SubscriptionUnavailableError)) throw error;
      await interaction.editReply({ content: error.message });
    }
    return;
  }
  const teams = await dependencies.matchCatalog.listTeams();
  const team = teams.find((candidate) => candidate.key === selectedKey);
  if (!team) {
    await interaction.editReply({
      content: "Cette équipe n'est plus disponible dans le panneau.",
    });
    return;
  }

  const result = await dependencies.roles.toggle(interaction.guildId, interaction.user.id, team);
  await interaction.editReply({
    content:
      result.action === "added"
        ? `Tu suis maintenant ${formatTeam(team, team.name)}.`
        : `Tu ne suis plus ${formatTeam(team, team.name)}.`,
  });
}
