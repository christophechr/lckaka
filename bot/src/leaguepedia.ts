import { DateTime } from "luxon";
import { internationalTournamentPages } from "./competitions.js";
import { officialTeamLogo } from "./team-logos.js";

const LEAGUEPEDIA_API_URL = "https://lol.fandom.com/api.php";

export interface Match {
  id: string;
  team1: string;
  team2: string;
  startsAt: Date;
  bestOf: number;
  tournament: string;
}

export interface MatchState extends Match {
  team1Key: string;
  team2Key: string;
  winner: 1 | 2 | null;
  team1Score: number | null;
  team2Score: number | null;
  isNullified: boolean;
}

export interface Team {
  key: string;
  name: string;
  logoUrl?: string | null;
}

export interface LeaguepediaResponse {
  parse?: { text?: { "*"?: string } };
  error?: { code?: string; info?: string };
}

export interface DateRange {
  start: Date;
  endExclusive: Date;
}

function cargoDate(date: Date): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).toFormat("yyyy-MM-dd HH:mm:ss");
}

function calendarFilter(range: DateRange): string {
  const filters = ['T.League="LoL Champions Korea"', 'MS.OverviewPage LIKE "LEC/%"'];
  const lastYear = new Date(range.endExclusive.getTime() - 1).getUTCFullYear();
  for (let year = range.start.getUTCFullYear(); year <= lastYear; year += 1) {
    for (const page of internationalTournamentPages(year)) {
      filters.push(`MS.OverviewPage="${page}"`, `MS.OverviewPage LIKE "${page}/%"`);
    }
  }
  return `(${filters.join(" OR ")})`;
}

function buildCargoUrl(range: DateRange, fields: string, includeNullified: boolean, offset = 0): string {
  const where = [
    calendarFilter(range),
    `MS.DateTime_UTC >= "${cargoDate(range.start)}"`,
    `MS.DateTime_UTC < "${cargoDate(range.endExclusive)}"`,
    ...(includeNullified ? [] : ['(MS.IsNullified IS NULL OR MS.IsNullified="0")']),
  ].join(" AND ");
  const cargoQuery = [
    "{{#cargo_query:",
    "tables=MatchSchedule=MS,Tournaments=T",
    "join on=MS.OverviewPage=T.OverviewPage",
    `fields=${fields}`,
    `where=${where}`,
    "order by=MS.DateTime_UTC ASC,MS.MatchId ASC",
    "format=table",
    `limit=${includeNullified ? 500 : 100}`,
    ...(offset ? [`offset=${offset}`] : []),
    "}}",
  ].join("|");

  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    prop: "text",
    contentmodel: "wikitext",
    text: cargoQuery,
  });

  return `${LEAGUEPEDIA_API_URL}?${params.toString()}`;
}

export function buildLeaguepediaUrl(range: DateRange, offset = 0): string {
  return buildCargoUrl(
    range,
    "MS.Team1=Team1,MS.Team2=Team2,MS.DateTime_UTC=DateTimeUTC,MS.BestOf=BestOf,MS.OverviewPage=OverviewPage,MS.MatchId=MatchId",
    false,
    offset,
  );
}

export function buildLeaguepediaStateUrl(range: DateRange, offset = 0): string {
  return buildCargoUrl(
    range,
    [
      "MS.Team1=Team1",
      "MS.Team2=Team2",
      "MS.DateTime_UTC=DateTimeUTC",
      "MS.BestOf=BestOf",
      "MS.OverviewPage=OverviewPage",
      "MS.MatchId=MatchId",
      "MS.Winner=Winner",
      "MS.Team1Score=Team1Score",
      "MS.Team2Score=Team2Score",
      "MS.IsNullified=IsNullified",
    ].join(","),
    true,
    offset,
  );
}

export function buildLeaguepediaTeamsUrl(seasonYear: number): string {
  const cargoQuery = [
    "{{#cargo_query:",
    "tables=TournamentRosters=TR,Teams=T",
    "join on=TR.Team=T.Name",
    "fields=TR.Team=Team,T.Image=Image",
    `where=TR.OverviewPage="LCK/${seasonYear} Season/Rounds 1-2"`,
    "group by=TR.Team",
    "order by=TR.Team ASC",
    "format=table",
    "limit=50",
    "}}",
  ].join("|");
  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    prop: "text",
    contentmodel: "wikitext",
    text: cargoQuery,
  });
  return `${LEAGUEPEDIA_API_URL}?${params.toString()}`;
}

function leaguepediaFileUrl(fileName: string): string {
  const normalized = fileName.replace(/^File:/i, "").trim();
  return `https://lol.fandom.com/wiki/Special:Redirect/file/${encodeURIComponent(normalized)}`;
}

interface CargoCell {
  attributes: string;
  text: string;
}

function decodeHtml(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== "#") return namedEntities[code.toLowerCase()] ?? entity;

      const hexadecimal = code[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isNaN(parsed) ? entity : String.fromCodePoint(parsed);
      } catch {
        return entity;
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

function getCargoCell(row: string, field: string): CargoCell | undefined {
  const cells = row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi);
  for (const cell of cells) {
    const attributes = cell[1] ?? "";
    const className = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (className?.split(/\s+/).includes(`field_${field}`)) {
      return { attributes, text: decodeHtml(cell[2] ?? "") };
    }
  }
  return undefined;
}

function getAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeHtml(match[2]) : undefined;
}

function getCargoRows(response: LeaguepediaResponse): string[] {
  if (response.error) {
    const code = response.error.code ?? "unknown";
    const detail = response.error.info ? `: ${response.error.info}` : "";
    throw new Error(`Leaguepedia (${code})${detail}`);
  }

  const html = response.parse?.text?.["*"];
  if (typeof html !== "string") {
    throw new Error("Réponse Leaguepedia invalide");
  }

  const table = html.match(
    /<table\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bcargoTable\b[^"']*["'])[^>]*>[\s\S]*?<\/table>/i,
  )?.[0];
  if (!table) {
    if (/No results/i.test(decodeHtml(html))) return [];
    throw new Error("Réponse Leaguepedia invalide : table Cargo absente");
  }

  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (rowMatch) => rowMatch[1] ?? "",
  );
}

function parseBaseMatch(row: string): Match | null {
  const team1 = getCargoCell(row, "Team1")?.text;
  const team2 = getCargoCell(row, "Team2")?.text;
  const dateCell = getCargoCell(row, "DateTimeUTC");
  const dateTimeUTC = dateCell
    ? getAttribute(dateCell.attributes, "data-sort-value")
    : undefined;
  const bestOfText = getCargoCell(row, "BestOf")?.text;
  const overviewPage = getCargoCell(row, "OverviewPage")?.text;
  const matchId = getCargoCell(row, "MatchId")?.text;

  if (!team1 || !team2 || !dateTimeUTC || !bestOfText || !overviewPage || !matchId) {
    return null;
  }

  const startsAt = DateTime.fromSQL(dateTimeUTC, { zone: "utc" });
  const bestOf = Number(bestOfText);
  if (!startsAt.isValid || !Number.isInteger(bestOf) || bestOf < 1) {
    return null;
  }

  return {
    id: matchId,
    team1,
    team2,
    startsAt: startsAt.toJSDate(),
    bestOf,
    tournament: overviewPage,
  };
}

function optionalNonNegativeInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function teamKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseLeaguepediaMatches(response: LeaguepediaResponse): Match[] {
  return getCargoRows(response).flatMap((row) => {
    const match = parseBaseMatch(row);
    return match ? [match] : [];
  });
}

export function parseLeaguepediaMatchStates(response: LeaguepediaResponse): MatchState[] {
  return getCargoRows(response).flatMap((row) => {
    const match = parseBaseMatch(row);
    if (!match) return [];

    const winnerText = getCargoCell(row, "Winner")?.text;
    const winnerNumber = Number(winnerText);
    const team1Score = optionalNonNegativeInteger(getCargoCell(row, "Team1Score")?.text);
    const team2Score = optionalNonNegativeInteger(getCargoCell(row, "Team2Score")?.text);
    const winner =
      winnerNumber === 1 && team1Score !== null && team2Score !== null && team1Score > team2Score
        ? 1
        : winnerNumber === 2 &&
            team1Score !== null &&
            team2Score !== null &&
            team2Score > team1Score
          ? 2
          : null;

    return [
      {
        ...match,
        team1Key: teamKey(match.team1),
        team2Key: teamKey(match.team2),
        winner,
        team1Score,
        team2Score,
        isNullified: getCargoCell(row, "IsNullified")?.text === "1",
      } satisfies MatchState,
    ];
  });
}

export function extractLckTeams(matches: MatchState[]): Team[] {
  const teams = new Map<string, Team>();
  for (const match of matches) {
    for (const team of [
      { key: match.team1Key, name: match.team1 },
      { key: match.team2Key, name: match.team2 },
    ]) {
      if (team.key && team.name.toLocaleLowerCase("en") !== "tbd") {
        teams.set(team.key, team);
      }
    }
  }
  return [...teams.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function parseLeaguepediaTeams(response: LeaguepediaResponse): Team[] {
  const teams = new Map<string, Team>();
  for (const row of getCargoRows(response)) {
    const name = getCargoCell(row, "Team")?.text;
    if (!name || name.toLocaleLowerCase("en") === "tbd") continue;
    const key = teamKey(name);
    const image = getCargoCell(row, "Image")?.text;
    const logoUrl = officialTeamLogo(name) ?? (image ? leaguepediaFileUrl(image) : undefined);
    if (key) teams.set(key, { key, name, ...(logoUrl ? { logoUrl } : {}) });
  }
  return [...teams.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export async function fetchLeaguepediaMatches(
  range: DateRange,
  fetcher: typeof fetch = fetch,
): Promise<Match[]> {
  const matches = new Map<string, Match>();
  for (let offset = 0; ; offset += 100) {
    const response = await fetcher(buildLeaguepediaUrl(range, offset), {
      headers: {
        Accept: "application/json",
        "User-Agent": "LckWeeklyDiscordBot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Leaguepedia HTTP ${response.status}`);
    }

    const payload = (await response.json()) as LeaguepediaResponse;
    for (const match of parseLeaguepediaMatches(payload)) matches.set(match.id, match);
    // Count source rows, including incomplete matches, before deciding to stop.
    const rowCount = getCargoRows(payload).filter(row => getCargoCell(row, "MatchId")).length;
    if (rowCount < 100) return [...matches.values()];
  }
}

export async function fetchLeaguepediaMatchStates(
  range: DateRange,
  fetcher: typeof fetch = fetch,
): Promise<MatchState[]> {
  const matches = new Map<string, MatchState>();
  for (let offset = 0; ; offset += 500) {
    const response = await fetcher(buildLeaguepediaStateUrl(range, offset), {
      headers: {
        Accept: "application/json",
        "User-Agent": "LckWeeklyDiscordBot/1.0",
      },
    });
    if (!response.ok) throw new Error(`Leaguepedia HTTP ${response.status}`);
    const payload = (await response.json()) as LeaguepediaResponse;
    for (const match of parseLeaguepediaMatchStates(payload)) matches.set(match.id, match);
    if (getCargoRows(payload).filter(row => getCargoCell(row, "MatchId")).length < 500) return [...matches.values()];
  }
}

export async function fetchLeaguepediaTeams(
  seasonYear: number,
  fetcher: typeof fetch = fetch,
): Promise<Team[]> {
  const response = await fetcher(buildLeaguepediaTeamsUrl(seasonYear), {
    headers: {
      Accept: "application/json",
      "User-Agent": "LckWeeklyDiscordBot/1.0",
    },
  });
  if (!response.ok) throw new Error(`Leaguepedia HTTP ${response.status}`);
  return parseLeaguepediaTeams((await response.json()) as LeaguepediaResponse);
}

export interface TournamentDates {
  overviewPage: string;
  startsOn: string | null;
  endsOn: string | null;
}

export function parseLeaguepediaTournamentDates(response: LeaguepediaResponse): TournamentDates[] {
  const date = (value: string | undefined): string | null =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid ? value : null;
  return getCargoRows(response).flatMap(row => {
    const overviewPage = getCargoCell(row, "OverviewPage")?.text;
    if (!overviewPage) return [];
    return [{ overviewPage, startsOn: date(getCargoCell(row, "DateStart")?.text), endsOn: date(getCargoCell(row, "DateEnd")?.text) }];
  });
}
