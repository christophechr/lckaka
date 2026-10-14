import { fetchLeaguepediaMatches } from "./leaguepedia.js";
import { ScheduleService } from "./schedule-service.js";
import { createScheduleMessages } from "./schedule-message.js";

const service = new ScheduleService(fetchLeaguepediaMatches);
const embeds = await createScheduleMessages(service);

console.log(JSON.stringify(embeds, null, 2));
