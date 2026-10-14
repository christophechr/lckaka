import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

import { autocompleteCounter } from "./autocomplete.js";
import { normalizedSplit, normalizedTeam, type Command } from "./types.js";

const data = new SlashCommandBuilder()
  .setName("add_hans")
  .setDescription("Augmente le nombre de flash-in de Hans Sama.")
  .addStringOption((option) =>
    option
      .setName("split")
      .setDescription("Split de la game")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addIntegerOption((option) =>
    option
      .setName("annee")
      .setDescription("L'année de la game (e.g., 2026)")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("equipe")
      .setDescription("Hans Maga a flash-in contre quelle équipe ?")
      .setRequired(false)
      .setAutocomplete(true),
  );

const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction, counters) {
    const split = normalizedSplit(interaction.options.getString("split", true));
    const year = interaction.options.getInteger("annee", true);
    const team = normalizedTeam(interaction.options.getString("equipe"));
    const count = await counters.increment("hans", split, year, team);
    await interaction.reply(`Hans Sama a flash-in ${count} fois.`);
  },
  autocomplete: (interaction, counters) => autocompleteCounter(interaction, counters, "hans"),
};

export const addHansCommand = command;
