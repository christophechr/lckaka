import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

import { autocompleteCounter } from "./autocomplete.js";
import { normalizedSplit, normalizedTeam, type Command } from "./types.js";

const data = new SlashCommandBuilder()
  .setName("drooler")
  .setDescription("Display how many times Ruler has been caught.")
  .addStringOption((option) =>
    option
      .setName("split")
      .setDescription("Split de la game")
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("annee")
      .setDescription("L'année de la game (e.g., 2024)")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("equipe")
      .setDescription("L'équipe qui a attrapé Drooler")
      .setRequired(false)
      .setAutocomplete(true),
  );

const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction, counters) {
    const split = interaction.options.getString("split");
    const year = interaction.options.getInteger("annee") ?? new Date().getFullYear();
    const team = normalizedTeam(interaction.options.getString("equipe"));
    const count = await counters.getTotal("drooler", {
      year,
      ...(split ? { split: normalizedSplit(split) } : {}),
      ...(team ? { team } : {}),
    });
    await interaction.reply(`Ruler has been caught ${count} times in ${year}.`);
  },
  autocomplete: (interaction, counters) =>
    autocompleteCounter(interaction, counters, "drooler"),
};

export const droolerCommand = command;
