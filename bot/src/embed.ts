import { DateTime } from "luxon";

import { teamKey, type Match } from "./leaguepedia.js";
import { competitionLabel, type CalendarCompetition } from "./competitions.js";
import type { Team } from "./db/match-repository.js";
import { formatTeam } from "./bot/messages.js";
import { PARIS_TIME_ZONE } from "./week.js";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  color?: number;
  title?: string;
  description?: string;
  fields: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export function buildScheduleEmbeds(
  matches: Match[],
  weekLabel: string,
  stale = false,
  teams: Team[] = [],
  competition?: CalendarCompetition,
): DiscordEmbed[] {
  if (competition) matches = matches.filter(match => match.tournament.startsWith(`${competition}/`));
  const base = {
    color: 0x0c2340,
    title: `${competition ?? "LCK · LEC · International"} — Matchs de la semaine`,
    description: matches.length === 0
      ? `📅 ${weekLabel}\n\nAucun match programmé cette semaine en ${competition ?? "LCK, LEC, First Stand, MSI, Worlds ou Esports World Cup"}.`
      : `📅 Programme ${weekLabel} · dates adaptées à votre fuseau horaire`,
    footer: { text: stale
      ? "Source : Leaguepedia · dernière mise à jour disponible"
      : "Source : Leaguepedia" },
    timestamp: new Date().toISOString(),
  };
  const fields: DiscordEmbedField[] = [];
  const sorted = [...matches].sort((left, right) =>
    left.startsAt.getTime() - right.startsAt.getTime() || left.id.localeCompare(right.id));
  let previousDay: string | undefined;
  for (const match of sorted) {
    const day = DateTime.fromJSDate(match.startsAt, { zone: PARIS_TIME_ZONE })
      .setLocale("fr").toFormat("cccc d MMMM");
    const label = day.charAt(0).toUpperCase() + day.slice(1);
    const timestamp = Math.floor(match.startsAt.getTime() / 1_000);
    const team1 = teams.find(team => team.key === teamKey(match.team1));
    const team2 = teams.find(team => team.key === teamKey(match.team2));
    const value = `🕒 <t:${timestamp}:F> · <t:${timestamp}:R> · **${competitionLabel(match.tournament)}**\n${formatTeam(team1, match.team1)} ⚔️ ${formatTeam(team2, match.team2)} · Bo${match.bestOf}`;
    if (value.length > 1024) throw new Error(`Rencontre trop longue pour Discord : ${match.id}`);
    const lastField = fields.at(-1);
    if (previousDay === day && lastField && lastField.value.length + 1 + value.length <= 1024) {
      lastField.value += `\n${value}`;
    } else {
      fields.push({ name: label, value, inline: false });
    }
    previousDay = day;
  }

  const embeds: DiscordEmbed[] = [];
  let current: DiscordEmbed = { ...base, fields: [] };
  // Reserve room for the page suffix, which is appended after pagination.
  const baseSize = base.title.length + base.description.length + base.footer.text.length + 40;
  let size = baseSize;
  for (const field of fields) {
    const fieldSize = field.name.length + field.value.length;
    if (current.fields.length === 25 || size + fieldSize > 6000) {
      embeds.push(current);
      current = { ...base, fields: [] };
      size = baseSize;
    }
    current.fields.push(field);
    size += fieldSize;
  }
  embeds.push(current);
  if (embeds.length > 1) {
    embeds.forEach((embed, index) => { embed.title += ` (${index + 1}/${embeds.length})`; });
  }
  return embeds;
}
