import type { APIEmbed } from "discord.js";

export async function sendWebhookMessage(
  webhookUrl: string,
  embed: APIEmbed,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");

  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "LoL Esports Weekly",
      embeds: [embed],
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook HTTP ${response.status}`);
  }
  const message = await response.json() as { id?: unknown };
  if (typeof message.id !== "string" || !message.id) {
    throw new Error("Discord webhook : confirmation du message manquante");
  }
  return message.id;
}
