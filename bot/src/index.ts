import "dotenv/config";

import { loadBotConfig } from "./config.js";
import { startBotRuntime } from "./bot/runtime.js";

const config = loadBotConfig();
const botRuntime = await startBotRuntime(config);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await botRuntime.stop();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop()
      .catch((error: unknown) => {
        console.error("Échec de l'arrêt :", error);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  });
}

console.log("Bot prêt · publication le lundi à 08:00 (Europe/Paris).");
