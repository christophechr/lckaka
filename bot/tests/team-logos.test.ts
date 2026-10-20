import { describe, expect, it } from "vitest";
import { parseLeaguepediaTeams } from "../src/leaguepedia.js";
import { officialTeamLogo } from "../src/team-logos.js";

describe("official team logos", () => {
  it.each([
    "BNK FEARX", "DN SOOPers", "Dplus Kia", "Gen.G", "HANJIN BRION",
    "Hanwha Life Esports", "KT Rolster", "Kiwoom DRX", "Nongshim RedForce", "T1",
    "Movistar KOI", "Karmine Corp", "Natus Vincere", "SK Gaming", "Fnatic",
    "G2 Esports", "Team Vitality", "Team Heretics", "Shifters", "GIANTX",
    "Bilibili Gaming", "Top Esports", "Anyone’s Legend", "Invictus Gaming",
    "Shanghai Invictus Gaming Meituan", "Cloud9", "Cloud9 Kia", "LYON",
    "Team Liquid", "Team Liquid Alienware", "Team Secret Whales",
    "CTBC Flying Oyster", "MVK Esports", "LOS", "FURIA",
  ])("uses Riot assets instead of blocked Fandom redirects for %s", name => {
    const [team] = parseLeaguepediaTeams({ parse: { text: { "*":
      `<table class="cargoTable"><tr><td class="field_Team">${name}</td><td class="field_Image">${name}logo.png</td></tr></table>`,
    } } });
    expect(team?.logoUrl).toMatch(/^https:\/\/static\.lolesports\.com\/teams\//);
  });

  it("recognizes the different Gen.G and Nongshim spellings", () => {
    expect(officialTeamLogo("Gen.G Esports")).toBe(officialTeamLogo("Gen.G"));
    expect(officialTeamLogo("NONGSHIM RED FORCE")).toBe(officialTeamLogo("Nongshim RedForce"));
  });

  it("preserves Leaguepedia logos for teams outside the official catalog", () => {
    const [team] = parseLeaguepediaTeams({ parse: { text: { "*":
      '<table class="cargoTable"><tr><td class="field_Team">Other Team</td><td class="field_Image">Other logo.png</td></tr></table>',
    } } });
    expect(team?.logoUrl).toBe("https://lol.fandom.com/wiki/Special:Redirect/file/Other%20logo.png");
    expect(officialTeamLogo("Other Team")).toBeUndefined();
  });
});
