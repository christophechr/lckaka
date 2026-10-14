import { describe, expect, it } from "vitest";
import { fetchSubscriptionCompetitions } from "../src/subscription-source.js";
import { parseLeaguepediaTournamentDates } from "../src/leaguepedia.js";

function table(rows: string): Response {
  return new Response(JSON.stringify({ parse: { text: { "*": `<table class="cargoTable">${rows}</table>` } } }));
}
function dates(page: string, start: string, end: string): string {
  return `<tr><td class="field_OverviewPage">${page}</td><td class="field_DateStart">${start}</td><td class="field_DateEnd">${end}</td></tr>`;
}
function fixture() {
  const queries: string[] = [];
  const fetcher: typeof fetch = async input => {
    const query = new URL(input.toString()).searchParams.get("text")!;
    queries.push(query);
    if (query.includes("tables=Tournaments=T")) return table([
      dates("LEC/2026 Season/Summer Season", "2026-07-24", "2026-08-30"),
      dates("LEC/2026 Season/Spring Season", "2026-03-28", "2026-05-10"),
      dates("2026 Season World Championship", "2026-10-15", "2026-11-14"),
      dates("2027 First Stand", "2027", ""),
    ].join(""));
    const name = query.includes("LEC/") ? "G2 Esports" : "T1";
    return table(`<tr><td class="field_Team">${name}</td><td class="field_Image">${name} logo.png</td></tr>`);
  };
  return { queries, fetcher };
}

describe("subscription source", () => {
  it("selects the latest regular LEC split and discovers tournament dates without needing matches", async () => {
    const { queries, fetcher } = fixture();
    const events = await fetchSubscriptionCompetitions(new Date("2026-09-07T12:00:00Z"), fetcher);
    expect(events.find(event => event.key === "lec")).toMatchObject({
      overviewPage: "LEC/2026 Season/Summer Season", teams: [{ key: "g2-esports", name: "G2 Esports" }],
    });
    expect(events.find(event => event.key === "worlds-2026")).toMatchObject({ startsOn: "2026-10-15", endsOn: "2026-11-14", teams: [] });
    expect(events.find(event => event.key === "fst-2027")?.startsOn).toBeNull();
    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain("MatchSchedule");
    expect(queries[1]).not.toContain("Playoffs");
  });
  it("prefetches participants before J-10 including all international stages", async () => {
    const { queries, fetcher } = fixture();
    const events = await fetchSubscriptionCompetitions(new Date("2026-10-04T12:00:00Z"), fetcher);
    expect(events.find(event => event.key === "worlds-2026")?.teams[0]?.key).toBe("t1");
    expect(queries.at(-1)).toContain('TR.OverviewPage="2026 Season World Championship/Play-In"');
    expect(queries.at(-1)).toContain('TR.OverviewPage="2026 Season World Championship/Main Event"');
    expect(queries.at(-1)).not.toContain('LIKE');
  });
  it("excludes qualifying tournaments and showmatches from participant lists", async () => {
    const rosterQueries: string[] = [];
    const fetcher: typeof fetch = async input => {
      const query = new URL(input.toString()).searchParams.get("text")!;
      if (query.includes("tables=Tournaments=T")) return table([
        dates("LEC/2026 Season/Spring Season", "2026-03-28", "2026-05-10"),
        dates("Esports World Cup 2026", "2026-07-15", "2026-07-19"),
        dates("2026 Mid-Season Invitational", "2026-06-28", "2026-07-12"),
      ].join(""));
      rosterQueries.push(query);
      return table('<tr><td class="field_Team">T1</td></tr>');
    };
    await fetchSubscriptionCompetitions(new Date("2026-07-06T12:00:00Z"), fetcher);
    expect(rosterQueries).toHaveLength(3);
    for (const query of rosterQueries) expect(query).not.toContain("LIKE");
  });
  it("does not interpret fuzzy or impossible dates as a publication date", () => {
    const result = parseLeaguepediaTournamentDates({ parse: { text: { "*": `<table class="cargoTable">${dates("2027 First Stand", "2027", "2027-02-30")}</table>` } } });
    expect(result[0]).toEqual({ overviewPage: "2027 First Stand", startsOn: null, endsOn: null });
  });
});
