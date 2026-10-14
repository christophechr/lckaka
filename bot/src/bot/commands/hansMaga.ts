import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

import { autocompleteCounter } from "./autocomplete.js";
import { normalizedSplit, normalizedTeam, type Command } from "./types.js";

const data = new SlashCommandBuilder()
  .setName("hans_maga")
  .setDescription("Affiche le nombre de flash-in de Hans Maga")
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
      .setDescription("L'année de la game (e.g., 2026)")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("equipe")
      .setDescription("Équipe LEC (Winter/Spring/Summer)")
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName("equipe_international")
      .setDescription("Équipe internationale (autres splits)")
      .setRequired(false)
      .setAutocomplete(true),
  );

const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction, counters) {
    const split = interaction.options.getString("split");
    const year = interaction.options.getInteger("annee") ?? new Date().getFullYear();
    const normalized = split ? normalizedSplit(split) : null;
    const isLecSplit =
      normalized === "winter" || normalized === "spring" || normalized === "summer";
    const lecTeam = normalizedTeam(interaction.options.getString("equipe"));
    const intlTeam = normalizedTeam(interaction.options.getString("equipe_international"));
    const team = isLecSplit ? lecTeam : intlTeam;

    if (isLecSplit && intlTeam) {
      await interaction.reply({
        content: "Choisis `equipe` pour Winter/Spring/Summer.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isLecSplit && lecTeam) {
      await interaction.reply({
        content: "Choisis `equipe_international` pour les autres splits.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const count = await counters.getTotal("hans", {
      year,
      ...(normalized ? { split: normalized } : {}),
      ...(team ? { team } : {}),
    });
    await interaction.reply(`Hans Sama a flash-in ${count} fois en ${year}.`);
  },
  autocomplete: (interaction, counters) => autocompleteCounter(interaction, counters, "hans"),
};

export const hansMagaCommand = command;
