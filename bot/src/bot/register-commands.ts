import "dotenv/config";

import { REST } from "discord.js";

import { loadBotConfig } from "../config.js";
import { ALL_COMMANDS_JSON, getCommandRoute } from "./commands.js";

const config = loadBotConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const route = getCommandRoute(config.discordClientId, config.discordGuildId);

await rest.put(route, { body: ALL_COMMANDS_JSON });
console.log(
  `${ALL_COMMANDS_JSON.length} commandes Discord enregistrées (${config.discordGuildId ? "serveur de test" : "globales"}).`,
);
