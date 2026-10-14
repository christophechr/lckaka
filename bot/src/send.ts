import "dotenv/config";

import { loadConfig } from "./config.js";
import { fetchLeaguepediaMatches } from "./leaguepedia.js";
import { publishSchedule } from "./publisher.js";
import { ScheduleService } from "./schedule-service.js";

const competition = process.argv[2] ?? "LCK";
if (competition !== "LCK" && competition !== "LEC") throw new Error("Choisis LCK ou LEC pour le calendrier.");
const config = loadConfig(process.env, competition);
const service = new ScheduleService(fetchLeaguepediaMatches);

await publishSchedule(config.webhookUrl, service, new Date(), fetch, competition);
console.log(`Calendrier ${competition} envoyé sur Discord.`);
