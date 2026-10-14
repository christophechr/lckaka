import "dotenv/config";

import { REST, Routes } from "discord.js";

import { buildReminderMessage, buildResultMessage } from "../src/bot/messages.js";
import type { StoredMatch } from "../src/db/match-repository.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

if (process.env.ALLOW_DISCORD_TEST_SEND !== "yes") {
  throw new Error("Envoi de test Discord non autorisé");
}

const token = required("DISCORD_TOKEN");
const channelId = required("DISCORD_TEST_CHANNEL_ID");
const fixture: StoredMatch = {
  matchId: "manual-visual-check",
  team1Key: "t1",
  team1Name: "T1",
  team2Key: "gen-g",
  team2Name: "Gen.G",
  scheduledAt: new Date(Date.now() + 30 * 60 * 1_000),
  bestOf: 5,
  overviewPage: "LCK/2026 Season",
  isNullified: false,
  winner: 1,
  team1Score: 3,
  team2Score: 2,
};

const rest = new REST({ version: "10" }).setToken(token);
await rest.post(Routes.channelMessages(channelId), {
  body: buildReminderMessage(fixture, []),
});
await rest.post(Routes.channelMessages(channelId), {
  body: buildResultMessage(fixture, []),
});

console.log("Deux messages de test envoyés dans le salon Discord privé.");
