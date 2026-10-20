import { describe, expect, it } from "vitest";
import { teamAcronym } from "../src/bot/team-acronyms.js";

describe("team acronyms", () => {
  it.each([
    ["Bilibili Gaming", "BLG"],
    ["TOP Esports", "TES"],
    ["Anyone's Legend", "AL"],
    ["Anyone’s Legend", "AL"],
    ["Anyones Legend", "AL"],
    ["Invictus Gaming", "IG"],
    ["Shanghai Invictus Gaming Meituan", "IG"],
  ])("uses the Worlds acronym for %s", (name, acronym) => {
    expect(teamAcronym(name)).toBe(acronym);
  });
});
