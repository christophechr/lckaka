import {
  InteractionContextType, MessageFlags, SlashCommandBuilder,
  type ChatInputCommandInteraction, type ButtonInteraction,
} from "discord.js";

import { PredictionError, type PredictionStore } from "../db/prediction-repository.js";
import { PREDICTION_CHANNEL_ID } from "../config.js";
import { teamKey } from "../leaguepedia.js";
import { findPredictionAppearances, type PredictionTeamAssetStore } from "./prediction-team-assets.js";
import { buildPredictionConfirmation, buildPredictionNotice, PREDICTION_COLORS } from "./prediction-message.js";

export const PREDICTION_COMMANDS_JSON = [
  new SlashCommandBuilder()
    .setName("classement")
    .setDescription("Affiche le classement des pronostics de ce serveur")
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption(option => option.setName("page").setDescription("Page du classement, 10 membres par page")
      .setMinValue(1).setMaxValue(1_000_000))
    .toJSON(),
];

export async function handlePredictionCommand(
  interaction: ChatInputCommandInteraction, store?: PredictionStore,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ ...buildPredictionNotice("Commande indisponible", "Cette commande est réservée à un serveur Discord."), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const allowedMentions = { parse: [] as never[] };
  try {
    if (!store) throw new PredictionError("Les pronostics sont temporairement indisponibles.");
    const page = interaction.options.getInteger("page") ?? 1;
    const board = await store.leaderboard(interaction.guildId, page);
    if (board.total === 0) {
      await interaction.editReply(buildPredictionNotice("Le classement attend ses premiers joueurs", "Vote avec les boutons des embeds de match pour participer au classement.", PREDICTION_COLORS.lec));
      return;
    }
    const pages = Math.ceil(board.total / 10);
    if (!board.entries.length) {
      throw new PredictionError(`Cette page n'existe pas. Choisis une page entre 1 et ${pages}.`);
    }
    await interaction.editReply({
      embeds: [{
        title: "🏆 Classement des pronostics",
        color: PREDICTION_COLORS.gold,
        description: board.entries.map(entry =>
          `**${entry.rank}.** <@${entry.userId}> — **${entry.points} pts**\n`
          + `${entry.correctWinners} bon(s) vainqueur(s) · ${entry.exactScores} bonus score exact · ${entry.settled} match(s) compté(s)`,
        ).join("\n\n"),
        footer: { text: `Page ${page}/${pages} · ${board.total} membre(s) · Vainqueur : 3 pts, score exact BO3/BO5 : +2 · Toutes compétitions` },
      }],
      allowedMentions,
    });
  } catch (error) {
    if (!(error instanceof PredictionError)) throw error;
    await interaction.editReply(buildPredictionNotice("Classement indisponible", error.message));
  }
}

export async function handlePredictionButton(interaction: ButtonInteraction, store?: PredictionStore, teamAssets?: PredictionTeamAssetStore): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guildId) throw new PredictionError("Cette action est réservée à un serveur Discord.");
    if (interaction.channelId !== PREDICTION_CHANNEL_ID) {
      throw new PredictionError(`Les votes se font uniquement dans <#${PREDICTION_CHANNEL_ID}>.`);
    }
    if (!store) throw new PredictionError("Les pronostics sont temporairement indisponibles.");
    const parsed = interaction.customId.match(/^prono:(\d{1,19}):([a-f0-9]{16}):([0-3]):([0-3])$/);
    if (!parsed) throw new PredictionError("Ce bouton de pronostic est invalide. Utilise les boutons de l’embed du match.");
    const [, id, revision, first, second] = parsed;
    const team1Score = Number(first);
    const team2Score = Number(second);
    const match = await store.save(interaction.guildId, interaction.user.id, id!, team1Score, team2Score, revision!);
    const teams = await findPredictionAppearances(teamAssets, [teamKey(match.team1Name), teamKey(match.team2Name)]);
    await interaction.editReply(buildPredictionConfirmation(match, team1Score, team2Score, teams));
  } catch (error) {
    if (!(error instanceof PredictionError)) throw error;
    await interaction.editReply(buildPredictionNotice("Vote non enregistré", error.message));
  }
}
