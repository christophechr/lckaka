import { describe, expect, it } from "vitest";

import { sendWebhookMessage } from "../src/webhook.js";
import type { DiscordEmbed } from "../src/embed.js";

const embed: DiscordEmbed = {
  title: "LCK — Matchs de la semaine",
  description: "Programme de test",
  fields: [],
};

describe("sendWebhookMessage", () => {
  it("asks Discord to confirm that the embed was saved", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return new Response(JSON.stringify({ id: "message-1" }), { status: 200 });
    };

    const messageId = await sendWebhookMessage(
      "https://discord.com/api/webhooks/1/token?thread_id=42",
      embed,
      fetcher,
    );
    expect(messageId).toBe("message-1");

    const url = new URL(requestedUrl);
    expect(url.searchParams.get("wait")).toBe("true");
    expect(url.searchParams.get("thread_id")).toBe("42");
    expect(requestedInit?.method).toBe("POST");
    expect(new Headers(requestedInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      username: "LoL Esports Weekly",
      embeds: [embed],
      allowed_mentions: { parse: [] },
    });
  });

  it("reports Discord errors instead of silently losing the message", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid Webhook Token" }), { status: 401 });

    await expect(
      sendWebhookMessage("https://discord.com/api/webhooks/1/bad-token", embed, fetcher),
    ).rejects.toThrow("Discord webhook HTTP 401");
  });

  it("rejects a missing message receipt so the delivery is not recorded", async () => {
    const fetcher: typeof fetch = async () => new Response("{}", { status: 200 });
    await expect(sendWebhookMessage("https://discord.com/api/webhooks/1/token", embed, fetcher))
      .rejects.toThrow("confirmation");
  });
});
