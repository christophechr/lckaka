import { describe, expect, it } from "vitest";

import { loadBotConfig, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads the LEC webhook independently for a manual LEC send", () => {
    expect(loadConfig({ LEC_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/2/lec-token" }, "LEC"))
      .toEqual({ webhookUrl: "https://discord.com/api/webhooks/2/lec-token" });
    expect(() => loadConfig({}, "LEC")).toThrow("LEC_MATCH_CALENDAR_WEBHOOK_URL");
  });

  it("loads distinct LCK and LEC webhooks for the bot and validates the optional LEC URL", () => {
    const env = { LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/lck",
      LEC_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/2/lec",
      DISCORD_TOKEN: "token", DISCORD_CLIENT_ID: "client", DATABASE_URL: "postgresql://localhost/test" };
    expect(loadBotConfig(env)).toMatchObject({ webhookUrl: env.LCK_MATCH_CALENDAR_WEBHOOK_URL, lecWebhookUrl: env.LEC_MATCH_CALENDAR_WEBHOOK_URL });
    expect(() => loadBotConfig({ ...env, LEC_MATCH_CALENDAR_WEBHOOK_URL: "https://example.com/not-discord" }))
      .toThrow("URL de webhook Discord invalide");
  });
  it("loads the Discord webhook used for publication", () => {
    expect(loadConfig({ LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token" }))
      .toEqual({ webhookUrl: "https://discord.com/api/webhooks/1/token" });
  });

  it("refuses to start without the webhook URL", () => {
    expect(() => loadConfig({})).toThrow("LCK_MATCH_CALENDAR_WEBHOOK_URL");
  });

  it("rejects a URL that is not a Discord webhook", () => {
    expect(() =>
      loadConfig({ LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://example.com/not-discord" }),
    ).toThrow("URL de webhook Discord invalide");
  });

  it("loads the bot, database and existing webhook configuration", () => {
    expect(
      loadBotConfig({
        LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
        DISCORD_TOKEN: "discord-token",
        DISCORD_CLIENT_ID: "123456789",
        DISCORD_GUILD_ID: "987654321",
        DATABASE_URL: "postgresql://bot:secret@postgres:5432/lck",
      }),
    ).toEqual({
      webhookUrl: "https://discord.com/api/webhooks/1/token",
      discordToken: "discord-token",
      discordClientId: "123456789",
      discordGuildId: "987654321",
      databaseUrl: "postgresql://bot:secret@postgres:5432/lck",
    });
  });

  it.each(["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DATABASE_URL"])(
    "rejects a missing %s for the bot runtime",
    (missing) => {
      const env = {
        LCK_MATCH_CALENDAR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
        DISCORD_TOKEN: "discord-token",
        DISCORD_CLIENT_ID: "123456789",
        DATABASE_URL: "postgresql://bot:secret@postgres:5432/lck",
      } as Record<string, string | undefined>;
      delete env[missing];

      expect(() => loadBotConfig(env)).toThrow(missing);
    },
  );
});
