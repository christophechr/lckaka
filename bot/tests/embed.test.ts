import { describe, expect, it } from "vitest";

import { buildScheduleEmbeds } from "../src/embed.js";
import type { Match } from "../src/leaguepedia.js";

describe("buildScheduleEmbeds", () => {
  it("groups matches by Paris calendar day in chronological order", () => {
    const matches: Match[] = [
      {
        id: "2",
        team1: "Dplus KIA",
        team2: "KT Rolster",
        startsAt: new Date("2026-09-03T10:00:00.000Z"),
        bestOf: 3,
        tournament: "LCK/2026 Season",
      },
      {
        id: "1",
        team1: "T1",
        team2: "Gen.G",
        startsAt: new Date("2026-09-02T08:00:00.000Z"),
        bestOf: 3,
        tournament: "LCK/2026 Season",
      },
    ];

    const [embed] = buildScheduleEmbeds(matches, "du 31 août au 6 septembre 2026", false, [
      { key: "t1", name: "T1", emojiId: "111", emojiName: "lck_t1" },
      { key: "gen-g", name: "Gen.G", emojiId: "222", emojiName: "lck_gen_g" },
      { key: "dplus-kia", name: "Dplus KIA", emojiId: "333", emojiName: "lck_dplus" },
      { key: "kt-rolster", name: "KT Rolster", emojiId: "444", emojiName: "lck_kt" },
    ]);

    expect(embed!.title).toBe("LCK · LEC · International — Matchs de la semaine");
    expect(embed!.description).toContain("du 31 août au 6 septembre 2026");
    expect(embed!.fields).toEqual([
      {
        name: "Mercredi 2 septembre",
        value:
          "🕒 <t:1788336000:F> · <t:1788336000:R> · **LCK**\n<:lck_t1:111> **T1** ⚔️ <:lck_gen_g:222> **Gen.G** · Bo3",
        inline: false,
      },
      {
        name: "Jeudi 3 septembre",
        value:
          "🕒 <t:1788429600:F> · <t:1788429600:R> · **LCK**\n<:lck_dplus:333> **Dplus KIA** ⚔️ <:lck_kt:444> **KT Rolster** · Bo3",
        inline: false,
      },
    ]);
    expect(embed!.description).toContain("votre fuseau horaire");
    expect(embed!.footer?.text).toContain("Leaguepedia");
  });

  it("shows a useful empty state when no match is scheduled", () => {
    const [embed] = buildScheduleEmbeds([], "du 7 au 13 septembre 2026");

    expect(embed!.fields).toEqual([]);
    expect(embed!.description).toContain("Aucun match programmé");
  });

  it("warns when the displayed schedule comes from the fallback cache", () => {
    const [embed] = buildScheduleEmbeds([], "du 7 au 13 septembre 2026", true);

    expect(embed!.footer?.text).toContain("dernière mise à jour disponible");
  });
});
