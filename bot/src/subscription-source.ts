import { DateTime } from "luxon";
import { competitionLabel, internationalTournamentPages } from "./competitions.js";
import { parseLeaguepediaTeams, parseLeaguepediaTournamentDates, type LeaguepediaResponse } from "./leaguepedia.js";
import { isSubscriptionOpen, subscriptionScope, type SubscriptionCompetition } from "./subscription-competitions.js";
import { PARIS_TIME_ZONE } from "./week.js";

async function query(parts: string[], fetcher: typeof fetch): Promise<LeaguepediaResponse> {
  const url = new URL("https://lol.fandom.com/api.php");
  url.search = new URLSearchParams({ action: "parse", format: "json", prop: "text", contentmodel: "wikitext",
    text: ["{{#cargo_query:", ...parts, "format=table", "limit=500", "}}"].join("|") }).toString();
  const response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "LckWeeklyDiscordBot/1.0" } });
  if (!response.ok) throw new Error(`Leaguepedia HTTP ${response.status}`);
  return await response.json() as LeaguepediaResponse;
}

export async function fetchSubscriptionCompetitions(
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<SubscriptionCompetition[]> {
  const today = DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE });
  const year = today.year;
  const pages = [year - 1, year, year + 1].flatMap(internationalTournamentPages);
  const dates = parseLeaguepediaTournamentDates(await query([
    "tables=Tournaments=T",
    "fields=T.OverviewPage=OverviewPage,T.DateStart=DateStart,T.Date=DateEnd",
    `where=${[
      ...[year - 1, year].map(season => `T.OverviewPage LIKE "LEC/${season} Season/% Season"`),
      ...pages.map(page => `T.OverviewPage="${page}"`),
    ].join(" OR ")}`,
    "order by=T.DateStart DESC",
  ], fetcher));

  // Riot's confirmed dates keep the panel available when the overview has no Cargo dates.
  // https://lolesports.com/en-US/news/worlds-2026-primer
  const worldsPage = "2026 Season World Championship";
  if (pages.includes(worldsPage)) {
    const worlds = dates.find(date => date.overviewPage === worldsPage);
    if (worlds) {
      worlds.startsOn ??= "2026-10-15";
      worlds.endsOn ??= "2026-11-14";
    } else {
      dates.push({ overviewPage: worldsPage, startsOn: "2026-10-15", endsOn: "2026-11-14" });
    }
  }

  const lecDates = dates.filter(date => date.overviewPage.startsWith("LEC/") && date.startsOn)
    .sort((a, b) => b.startsOn!.localeCompare(a.startsOn!));
  const currentLec = lecDates.filter(date => date.overviewPage.startsWith(`LEC/${year} Season/`));
  const lec = currentLec.find(date => date.startsOn! <= today.toISODate()!)
    ?? currentLec.at(-1) ?? lecDates[0];
  const selected = [
    ...(lec ? [{ ...lec, key: "lec", title: "LEC" }] : []),
    ...dates.filter(date => pages.includes(date.overviewPage)).map(date => ({
      ...date, key: subscriptionScope(date.overviewPage)!,
      title: `${competitionLabel(date.overviewPage)} ${date.overviewPage.match(/\d{4}/)![0]}`,
    })),
  ];

  const competitions: SubscriptionCompetition[] = [];
  for (const event of selected) {
    const competition: SubscriptionCompetition = { ...event, teams: [] };
    // Prepare rosters before J-10 so the panel can open at midnight without a source request.
    if (isSubscriptionOpen(competition, now) || isSubscriptionOpen(competition, today.plus({ days: 1 }).toJSDate())) {
      // Worlds stores participants on stage pages. Other events store the
      // main roster at the root; their child pages include qualifiers/showmatches.
      const rosterPages = event.key.startsWith("worlds-")
        ? [event.overviewPage, ...["Play-In", "Main Event", "Swiss Stage", "Knockout Stage"]
          .map(stage => `${event.overviewPage}/${stage}`)]
        : [event.overviewPage];
      competition.teams = parseLeaguepediaTeams(await query([
        "tables=TournamentRosters=TR,Teams=T",
        "join on=TR.Team=T.Name",
        "fields=TR.Team=Team,T.Image=Image",
        `where=(${rosterPages.map(page => `TR.OverviewPage="${page}"`).join(" OR ")})`,
        "group by=TR.Team,T.Image",
        "order by=TR.Team ASC",
      ], fetcher));
    }
    competitions.push(competition);
  }
  if (!competitions.some(competition => competition.key === "lec")) {
    throw new Error("Dates du catalogue LEC indisponibles.");
  }
  return competitions;
}
