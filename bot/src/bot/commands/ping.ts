import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

import type { Command } from "./types.js";

const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong and latency.");

const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
    const roundTripMs = sent.createdTimestamp - interaction.createdTimestamp;
    const apiMs = Math.round(interaction.client.ws.ping);
    await interaction.editReply(`Pong! 🏓 Round-trip: ${roundTripMs}ms | API: ${apiMs}ms`);
  },
};

export const pingCommand = command;
