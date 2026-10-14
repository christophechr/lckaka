import { teamKey } from "../leaguepedia.js";

const TEAM_ACRONYMS: Record<string, string> = {
  "giantx": "GX",
  "natus-vincere": "NAVI",
  "hanwha-life-esports": "HLE",
  "t1": "T1",
  "team-vitality": "VIT",
  "movistar-koi": "MKOI",
  "gen-g": "GEN",
  "gen-g-esports": "GEN",
  "dplus-kia": "DK",
  "kt-rolster": "KT",
  "bnk-fearx": "BFX",
  "dn-soopers": "DNS",
  "hanjin-brion": "BRO",
  "kiwoom-drx": "DRX",
  "nongshim-redforce": "NS",
  "fnatic": "FNC",
  "g2-esports": "G2",
  "karmine-corp": "KC",
  "shifters": "SHFT",
  "sk-gaming": "SK",
  "team-heretics": "TH",
};

export function teamAcronym(name: string): string {
  const known = TEAM_ACRONYMS[teamKey(name)];
  if (known) return known;
  const words = name.trim().match(/[\p{L}\p{N}]+/gu) ?? [];
  return (words.length > 1 ? words.map(word => word[0]).join("") : words[0] ?? "?")
    .slice(0, 5).toUpperCase();
}
