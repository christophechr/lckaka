import { addDroolerCommand } from "./addDrooler.js";
import { addHansCommand } from "./addHans.js";
import { droolerCommand } from "./drooler.js";
import { hansMagaCommand } from "./hansMaga.js";
import { pingCommand } from "./ping.js";

export type { Command, CounterStore } from "./types.js";
import type { Command } from "./types.js";

export const commands: Command[] = [
  pingCommand,
  addDroolerCommand,
  droolerCommand,
  addHansCommand,
  hansMagaCommand,
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
