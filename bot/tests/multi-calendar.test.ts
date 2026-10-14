import { describe, expect, it } from "vitest";
import { buildLeaguepediaUrl, buildLeaguepediaStateUrl, type Match } from "../src/leaguepedia.js";
import { buildScheduleEmbeds } from "../src/embed.js";

const range = { start: new Date("2026-12-28T00:00:00Z"), endExclusive: new Date("2027-01-04T00:00:00Z") };

describe("multi-competition calendar", () => {
  it("queries the LEC and international events in every year covered by the week", () => {
    const query = new URL(buildLeaguepediaUrl(range)).searchParams.get("text")!;
    expect(query).toContain('T.League="LoL Champions Korea"');
    expect(query).toContain('MS.OverviewPage LIKE "LEC/%"');
    for (const year of [2026, 2027]) {
      expect(query).toContain(`MS.OverviewPage="${year} First Stand"`);
      expect(query).toContain(`MS.OverviewPage="${year} Mid-Season Invitational"`);
      expect(query).toContain(`MS.OverviewPage="${year} Season World Championship"`);
      expect(query).toContain(`MS.OverviewPage="Esports World Cup ${year}"`);
    }
    expect(query).toContain(') AND MS.DateTime_UTC >=');
    expect(query).toContain('MS.IsNullified IS NULL');
    const stateQuery = new URL(buildLeaguepediaStateUrl(range)).searchParams.get("text")!;
    expect(stateQuery).toContain('LEC/%');
  });

  it("labels each competition and keeps all matches within Discord limits", () => {
    const tournaments = ["LCK/2026 Season/Playoffs", "LEC/2026 Season/Summer Playoffs", "2026 First Stand", "2026 Mid-Season Invitational", "2026 Season World Championship", "Esports World Cup 2026"];
    const matches: Match[] = Array.from({ length: 120 }, (_, index) => ({
      id: String(index), team1: `Team-${index}-A`, team2: `Team-${index}-B`,
      startsAt: new Date("2026-09-07T12:00:00Z"), bestOf: 3,
      tournament: tournaments[index % tournaments.length]!,
    }));
    const embeds = buildScheduleEmbeds(matches, "du 7 au 13 septembre 2026");
    expect(embeds.length).toBeGreaterThan(1);
    const allText = embeds.flatMap(embed => embed.fields.map(field => field.value)).join("\n");
    for (const label of ["LCK", "LEC", "First Stand", "MSI", "Worlds", "Esports World Cup"]) expect(allText).toContain(label);
    for (const match of matches) expect(allText.split(`**${match.team1}**`)).toHaveLength(2);
    for (const embed of embeds) {
      expect(embed.fields.length).toBeLessThanOrEqual(25);
      for (const field of embed.fields) expect(field.value.length).toBeLessThanOrEqual(1024);
      const size = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0)
        + embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
      expect(size).toBeLessThanOrEqual(6000);
    }
  });

  it("identifies the supported competitions when the week is empty", () => {
    const [embed] = buildScheduleEmbeds([], "cette semaine");
    expect(embed?.description).toContain("Aucun match");
    expect(embed?.title).toContain("LEC");
  });
});

describe("calendar source pagination", () => {
  it("continues past 100 source rows even when one match is incomplete", async () => {
    const { fetchLeaguepediaMatches } = await import("../src/leaguepedia.js");
    const row = (index: number, complete = true) => `<tr>
      <td class="field_Team1">${complete ? `Team-${index}` : ""}</td>
      <td class="field_Team2">Opponent</td>
      <td class="field_DateTimeUTC" data-sort-value="2026-12-29 12:00:00">date</td>
      <td class="field_BestOf">3</td>
      <td class="field_OverviewPage">LEC/2026 Season</td>
      <td class="field_MatchId">match-${index}</td></tr>`;
    const offsets: number[] = [];
    const fetcher: typeof fetch = async input => {
      const query = new URL(input.toString()).searchParams.get("text")!;
      const offset = Number(query.match(/\|offset=(\d+)/)?.[1] ?? 0);
      offsets.push(offset);
      const rows = offset === 0
        ? Array.from({ length: 100 }, (_, index) => row(index, index !== 0)).join("")
        : row(100);
      return new Response(JSON.stringify({ parse: { text: { "*": `<table class="cargoTable">${rows}</table>` } } }));
    };
    const matches = await fetchLeaguepediaMatches(range, fetcher);
    expect(offsets).toEqual([0, 100]);
    expect(matches).toHaveLength(100);
    expect(matches.at(-1)?.id).toBe("match-100");
  });
});
