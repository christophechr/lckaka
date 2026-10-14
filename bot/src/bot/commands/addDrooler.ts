import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

import { autocompleteCounter } from "./autocomplete.js";
import { normalizedSplit, normalizedTeam, type Command } from "./types.js";

const data = new SlashCommandBuilder()
  .setName("add_drooler")
  .setDescription("Augmente le nombre de fois que Drooler a été attrapé.")
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
      .setDescription("L'année de la game (e.g., 2024)")
      .setRequired(true),
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
    const split = normalizedSplit(interaction.options.getString("split", true));
    const year = interaction.options.getInteger("annee", true);
    const team = normalizedTeam(interaction.options.getString("equipe"));
    const count = await counters.increment("drooler", split, year, team);
    await interaction.reply(`Drooler a été attrapé ${count} fois.`);
  },
  autocomplete: (interaction, counters) =>
    autocompleteCounter(interaction, counters, "drooler"),
};

export const addDroolerCommand = command;
