import { describe, expect, it } from "vitest";

import {
  buildReminderMessage,
  buildResultMessage,
  buildSubscriptionPanel,
} from "../src/bot/messages.js";
import type { StoredMatch } from "../src/db/match-repository.js";

const match: StoredMatch = {
  matchId: "match-1",
  team1Key: "t1",
  team1Name: "T1",
  team2Key: "gen-g",
  team2Name: "Gen.G",
  scheduledAt: new Date("2026-09-05T08:00:00.000Z"),
  bestOf: 5,
  overviewPage: "LCK/2026 Season/Playoffs",
  isNullified: false,
  winner: null,
  team1Score: null,
  team2Score: null,
};

describe("Discord bot messages", () => {
  it("builds a sorted team toggle panel", () => {
    const message = buildSubscriptionPanel([
      { key: "t1", name: "T1", emojiId: "111", emojiName: "lck_t1" },
      { key: "gen-g", name: "Gen.G", emojiId: "222", emojiName: "lck_gen_g" },
    ]);

    expect(message.embeds?.[0]).toMatchObject({ title: "Abonnements LCK" });
    expect(message.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "lck-team-toggle",
            placeholder: "Choisis une équipe",
            min_values: 1,
            max_values: 1,
            options: [
              {
                label: "Gen.G",
                value: "gen-g",
                emoji: { id: "222", name: "lck_gen_g" },
              },
              {
                label: "T1",
                value: "t1",
                emoji: { id: "111", name: "lck_t1" },
              },
            ],
          },
        ],
      },
    ]);
  });

  it("builds a localized reminder with restricted role mentions", () => {
    const message = buildReminderMessage(match, ["222", "111", "222"], [
      { key: "t1", name: "T1", emojiId: "1111", emojiName: "lck_t1" },
      { key: "gen-g", name: "Gen.G", emojiId: "2222", emojiName: "lck_gen_g" },
    ]);

    expect(message.content).toBe("<@&222> <@&111>");
    expect(message.allowedMentions).toEqual({ parse: [], roles: ["222", "111"] });
    expect(message.embeds?.[0]).toMatchObject({
      title: "Match dans 30 minutes",
      description:
        "<:lck_t1:1111> **T1** ⚔️ <:lck_gen_g:2222> **Gen.G**\n🕒 <t:1788595200:F> · <t:1788595200:R>\nFormat : Bo5",
      url: "https://lol.fandom.com/wiki/LCK/2026_Season/Playoffs",
    });
  });

  it("hides the final score and winner behind one spoiler", () => {
    const message = buildResultMessage(
      { ...match, winner: 1, team1Score: 3, team2Score: 2 },
      ["111"],
      [
        { key: "t1", name: "T1", emojiId: "1111", emojiName: "lck_t1" },
        { key: "gen-g", name: "Gen.G", emojiId: "2222", emojiName: "lck_gen_g" },
      ],
    );

    expect(message.content).toBe("<@&111>");
    expect(message.allowedMentions).toEqual({ parse: [], roles: ["111"] });
    expect(message.embeds?.[0]).toMatchObject({
      title: "Résultat disponible — T1 contre Gen.G",
      description:
        "||<:lck_t1:1111> **T1 3 – 2 Gen.G** <:lck_gen_g:2222>\nVainqueur : <:lck_t1:1111> **T1**||",
    });
  });

  it("falls back to team names when an emoji is unavailable", () => {
    const message = buildReminderMessage(match, [], []);
    expect((message.embeds?.[0] as { description?: string })?.description).toContain(
      "**T1** ⚔️ **Gen.G**",
    );
  });

  it("rejects an incomplete result", () => {
    expect(() => buildResultMessage(match, [])).toThrow("Résultat incomplet");
  });
});
