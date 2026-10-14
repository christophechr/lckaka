import type { CalendarCompetition } from "./competitions.js";

export const PREDICTION_CHANNEL_ID = "1546489098968105031";
export const LEADERBOARD_CHANNEL_ID = "1546534221835931759";

export interface WebhookConfig {
  webhookUrl: string;
}

export interface BotConfig extends WebhookConfig {
  lecWebhookUrl?: string;
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  databaseUrl: string;
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  competition: CalendarCompetition = "LCK",
): WebhookConfig {
  const webhookUrl = requireEnv(env, `${competition}_MATCH_CALENDAR_WEBHOOK_URL`);

  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    throw new Error("URL de webhook Discord invalide");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    !url.pathname.startsWith("/api/webhooks/")
  ) {
    throw new Error("URL de webhook Discord invalide");
  }

  return { webhookUrl };
}

export function loadBotConfig(
  env: Record<string, string | undefined> = process.env,
): BotConfig {
  return {
    ...loadConfig(env),
    ...(env.LEC_MATCH_CALENDAR_WEBHOOK_URL?.trim()
      ? { lecWebhookUrl: loadConfig(env, "LEC").webhookUrl } : {}),
    discordToken: requireEnv(env, "DISCORD_TOKEN"),
    discordClientId: requireEnv(env, "DISCORD_CLIENT_ID"),
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || undefined,
    databaseUrl: requireEnv(env, "DATABASE_URL"),
  };
}
