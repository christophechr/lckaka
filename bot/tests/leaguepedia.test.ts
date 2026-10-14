import { describe, expect, it } from "vitest";

import {
  buildLeaguepediaUrl,
  buildLeaguepediaStateUrl,
  buildLeaguepediaTeamsUrl,
  extractLckTeams,
  fetchLeaguepediaMatches,
  parseLeaguepediaMatches,
  parseLeaguepediaMatchStates,
  parseLeaguepediaTeams,
  type LeaguepediaResponse,
} from "../src/leaguepedia.js";

describe("buildLeaguepediaUrl", () => {
  it("renders a Cargo table for non-nullified calendar matches inside the requested UTC range", () => {
    const url = new URL(
      buildLeaguepediaUrl({
        start: new Date("2026-08-31T22:00:00.000Z"),
        endExclusive: new Date("2026-09-07T22:00:00.000Z"),
      }),
    );

    expect(url.origin + url.pathname).toBe("https://lol.fandom.com/api.php");
    expect(url.searchParams.get("action")).toBe("parse");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("prop")).toBe("text");
    expect(url.searchParams.get("contentmodel")).toBe("wikitext");

    const text = url.searchParams.get("text");
    expect(text).toContain("{{#cargo_query:");
    expect(text).toContain("tables=MatchSchedule=MS,Tournaments=T");
    expect(text).toContain("join on=MS.OverviewPage=T.OverviewPage");
    expect(text).toContain(
      "fields=MS.Team1=Team1,MS.Team2=Team2,MS.DateTime_UTC=DateTimeUTC,MS.BestOf=BestOf,MS.OverviewPage=OverviewPage,MS.MatchId=MatchId",
    );
    expect(text).toContain(
      ') AND MS.DateTime_UTC >= "2026-08-31 22:00:00" AND MS.DateTime_UTC < "2026-09-07 22:00:00" AND (MS.IsNullified IS NULL OR MS.IsNullified="0")',
    );
    expect(text).toContain("order by=MS.DateTime_UTC ASC");
    expect(text).toContain("format=table");
    expect(text).toContain("limit=100");
  });
});

describe("fetchLeaguepediaMatches", () => {
  it("requests parsed Cargo HTML with an identifiable user agent", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return new Response(
        JSON.stringify({
          parse: {
            text: {
              "*": `<table class="cargoTable"><tbody><tr>
                <td class="field_Team1">T1</td>
                <td class="field_Team2">Gen.G</td>
                <td class="field_DateTimeUTC" data-sort-value="2026-09-05 08:00:00">September 5, 2026</td>
                <td class="field_BestOf">5</td>
                <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
                <td class="field_MatchId">match-1</td>
              </tr></tbody></table>`,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const matches = await fetchLeaguepediaMatches(
      {
        start: new Date("2026-08-31T22:00:00.000Z"),
        endExclusive: new Date("2026-09-07T22:00:00.000Z"),
      },
      fetcher,
    );

    expect(requestedUrl).toContain("action=parse");
    expect(new Headers(requestedInit?.headers).get("user-agent")).toBe(
      "LckWeeklyDiscordBot/1.0",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("match-1");
  });

  it("rejects a non-successful HTTP response", async () => {
    const fetcher: typeof fetch = async () => new Response("Unavailable", { status: 503 });

    await expect(
      fetchLeaguepediaMatches(
        {
          start: new Date("2026-08-31T22:00:00.000Z"),
          endExclusive: new Date("2026-09-07T22:00:00.000Z"),
        },
        fetcher,
      ),
    ).rejects.toThrow("HTTP 503");
  });
});

describe("parseLeaguepediaMatches", () => {
  it("normalizes rendered Cargo rows and ignores incomplete matches", () => {
    const response: LeaguepediaResponse = {
      parse: {
        text: {
          "*": `<table class="cargoTable"><tbody>
            <tr>
              <td class="field_Team1"><a>T1</a></td>
              <td class="field_Team2">Gen.G</td>
              <td class="field_DateTimeUTC" data-sort-value="2026-09-05 08:00:00">September 5, 2026</td>
              <td class="field_BestOf">5</td>
              <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
              <td class="field_MatchId">LCK/2026 Season/Playoffs_1</td>
            </tr>
            <tr>
              <td class="field_Team1">TBD</td>
              <td class="field_Team2"></td>
              <td class="field_DateTimeUTC" data-sort-value="2026-09-06 08:00:00">September 6, 2026</td>
              <td class="field_BestOf">5</td>
              <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
              <td class="field_MatchId">LCK/2026 Season/Playoffs_2</td>
            </tr>
          </tbody></table>`,
        },
      },
    };

    expect(parseLeaguepediaMatches(response)).toEqual([
      {
        id: "LCK/2026 Season/Playoffs_1",
        team1: "T1",
        team2: "Gen.G",
        startsAt: new Date("2026-09-05T08:00:00.000Z"),
        bestOf: 5,
        tournament: "LCK/2026 Season/Playoffs",
      },
    ]);
  });

  it("rejects a Cargo API error returned with an HTTP success", () => {
    expect(() =>
      parseLeaguepediaMatches({
        error: { code: "ratelimited", info: "You've exceeded your rate limit." },
      }),
    ).toThrow("Leaguepedia (ratelimited)");
  });

  it("returns no matches when Cargo reports no results", () => {
    expect(
      parseLeaguepediaMatches({
        parse: { text: { "*": '<p><em class="error">No results</em></p>' } },
      }),
    ).toEqual([]);
  });

  it("rejects a malformed parse response", () => {
    expect(() => parseLeaguepediaMatches({})).toThrow("Réponse Leaguepedia invalide");
  });
});

describe("Leaguepedia bot match states", () => {
  const stateResponse: LeaguepediaResponse = {
    parse: {
      text: {
        "*": `<table class="cargoTable"><tbody>
          <tr>
            <td class="field_Team1">T1</td>
            <td class="field_Team2">Gen.G</td>
            <td class="field_DateTimeUTC" data-sort-value="2026-09-05 08:00:00">September 5</td>
            <td class="field_BestOf">5</td>
            <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
            <td class="field_MatchId">match-1</td>
            <td class="field_Winner">1</td>
            <td class="field_Team1Score">3</td>
            <td class="field_Team2Score">2</td>
            <td class="field_IsNullified">0</td>
          </tr>
          <tr>
            <td class="field_Team1">TBD</td>
            <td class="field_Team2">Dplus KIA</td>
            <td class="field_DateTimeUTC" data-sort-value="2026-09-06 08:00:00">September 6</td>
            <td class="field_BestOf">5</td>
            <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
            <td class="field_MatchId">match-2</td>
            <td class="field_Winner"></td>
            <td class="field_Team1Score"></td>
            <td class="field_Team2Score"></td>
            <td class="field_IsNullified">1</td>
          </tr>
        </tbody></table>`,
      },
    },
  };

  it("queries result and cancellation fields without excluding nullified rows", () => {
    const url = new URL(
      buildLeaguepediaStateUrl({
        start: new Date("2026-09-01T00:00:00.000Z"),
        endExclusive: new Date("2026-10-01T00:00:00.000Z"),
      }),
    );
    const text = url.searchParams.get("text") ?? "";

    expect(text).toContain("MS.Winner=Winner");
    expect(text).toContain("MS.Team1Score=Team1Score");
    expect(text).toContain("MS.Team2Score=Team2Score");
    expect(text).toContain("MS.IsNullified=IsNullified");
    expect(text).not.toContain("MS.IsNullified IS NULL");
  });

  it("normalizes final and nullified match states", () => {
    expect(parseLeaguepediaMatchStates(stateResponse)).toEqual([
      {
        id: "match-1",
        team1: "T1",
        team2: "Gen.G",
        team1Key: "t1",
        team2Key: "gen-g",
        startsAt: new Date("2026-09-05T08:00:00.000Z"),
        bestOf: 5,
        tournament: "LCK/2026 Season/Playoffs",
        winner: 1,
        team1Score: 3,
        team2Score: 2,
        isNullified: false,
      },
      {
        id: "match-2",
        team1: "TBD",
        team2: "Dplus KIA",
        team1Key: "tbd",
        team2Key: "dplus-kia",
        startsAt: new Date("2026-09-06T08:00:00.000Z"),
        bestOf: 5,
        tournament: "LCK/2026 Season/Playoffs",
        winner: null,
        team1Score: null,
        team2Score: null,
        isNullified: true,
      },
    ]);
  });

  it("ignores a winner when the published score is missing or incoherent", () => {
    const response: LeaguepediaResponse = {
      parse: {
        text: {
          "*": `<table class="cargoTable"><tbody>
            <tr>
              <td class="field_Team1">T1</td>
              <td class="field_Team2">Gen.G</td>
              <td class="field_DateTimeUTC" data-sort-value="2026-09-05 08:00:00">September 5</td>
              <td class="field_BestOf">5</td>
              <td class="field_OverviewPage">LCK/2026 Season/Playoffs</td>
              <td class="field_MatchId">match-incoherent</td>
              <td class="field_Winner">1</td>
              <td class="field_Team1Score">1</td>
              <td class="field_Team2Score">3</td>
              <td class="field_IsNullified">0</td>
            </tr>
          </tbody></table>`,
        },
      },
    };

    expect(parseLeaguepediaMatchStates(response)[0]?.winner).toBeNull();
  });

  it("extracts a sorted, unique team catalog without placeholders", () => {
    const states = parseLeaguepediaMatchStates(stateResponse);

    expect(extractLckTeams([...states, states[0]!])).toEqual([
      { key: "dplus-kia", name: "Dplus KIA" },
      { key: "gen-g", name: "Gen.G" },
      { key: "t1", name: "T1" },
    ]);
  });
});

describe("Leaguepedia LCK team catalog", () => {
  it("queries TournamentRosters for the requested LCK season", () => {
    const url = new URL(buildLeaguepediaTeamsUrl(2026));
    const text = url.searchParams.get("text") ?? "";

    expect(text).toContain("tables=TournamentRosters=TR,Teams=T");
    expect(text).toContain("join on=TR.Team=T.Name");
    expect(text).toContain("fields=TR.Team=Team,T.Image=Image");
    expect(text).toContain('TR.OverviewPage="LCK/2026 Season/Rounds 1-2"');
  });

  it("normalizes, deduplicates and sorts roster teams", () => {
    const response: LeaguepediaResponse = {
      parse: {
        text: {
          "*": `<table class="cargoTable"><tbody>
            <tr><td class="field_Team">T1</td><td class="field_Image">T1 logo.png</td></tr>
            <tr><td class="field_Team">Gen.G</td><td class="field_Image">Gen.G Esports logo.svg</td></tr>
            <tr><td class="field_Team">T1</td><td class="field_Image">T1 logo.png</td></tr>
            <tr><td class="field_Team">TBD</td></tr>
          </tbody></table>`,
        },
      },
    };

    expect(parseLeaguepediaTeams(response)).toEqual([
      {
        key: "gen-g",
        name: "Gen.G",
        logoUrl:
          "https://static.lolesports.com/teams/1773829250929_GENGLOGO_GOLD.png",
      },
      {
        key: "t1",
        name: "T1",
        logoUrl: "https://static.lolesports.com/teams/1726801573959_539px-T1_2019_full_allmode.png",
      },
    ]);
  });
});
