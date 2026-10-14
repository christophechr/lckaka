import type { APIActionRowComponent, APIStringSelectComponent, MessageCreateOptions } from "discord.js";

import type { StoredMatch, Team } from "../db/match-repository.js";
import { competitionLabel } from "../competitions.js";

const LCK_NAVY = 0x0c2340;
const TEAM_TOGGLE_ID = "lck-team-toggle";

function leaguepediaPageUrl(page: string): string {
  const path = page
    .replaceAll(" ", "_")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://lol.fandom.com/wiki/${path}`;
}

function discordTimestamp(date: Date, style: "F" | "R"): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function mentionOptions(roleIds: string[]): Pick<MessageCreateOptions, "content" | "allowedMentions"> {
  const roles = [...new Set(roleIds)];
  return {
    content: roles.length > 0 ? roles.map((id) => `<@&${id}>`).join(" ") : undefined,
    allowedMentions: { parse: [], roles },
  };
}

function emojiForTeam(team: Team | undefined): string {
  return team?.emojiId && team.emojiName ? `<:${team.emojiName}:${team.emojiId}>` : "";
}

export function formatTeam(team: Team | undefined, fallbackName: string): string {
  const emoji = emojiForTeam(team);
  return `${emoji ? `${emoji} ` : ""}**${fallbackName}**`;
}

function teamByKey(teams: Team[], key: string): Team | undefined {
  return teams.find((team) => team.key === key);
}

export function buildSubscriptionPanel(
  teams: Team[],
  options: { title: string; customId: string } = { title: "LCK", customId: TEAM_TOGGLE_ID },
): MessageCreateOptions {
  const sorted = [...teams].sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (sorted.length === 0) {
    throw new Error("Aucune équipe disponible");
  }
  if (sorted.length > 125) {
    throw new Error("Trop d'équipes pour le panneau Discord");
  }

  const components: APIActionRowComponent<APIStringSelectComponent>[] = [];
  for (let index = 0; index < sorted.length; index += 25) {
    const chunk = sorted.slice(index, index + 25);
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: index === 0 ? options.customId : `${options.customId}:${index / 25}`,
          placeholder: "Choisis une équipe",
          min_values: 1,
          max_values: 1,
          options: chunk.map((team) => ({
            label: team.name.slice(0, 100),
            value: team.key,
            ...(team.emojiId && team.emojiName
              ? { emoji: { id: team.emojiId, name: team.emojiName } }
              : {}),
          })),
        },
      ],
    });
  }

  return {
    embeds: [
      {
        color: LCK_NAVY,
        title: `Abonnements ${options.title}`,
        description:
          "Choisis une équipe pour ajouter son rôle. Sélectionne-la de nouveau pour te désabonner.",
      },
    ],
    components,
  };
}

export function buildReminderMessage(
  match: StoredMatch,
  roleIds: string[],
  teams: Team[] = [],
): MessageCreateOptions {
  const team1 = teamByKey(teams, match.team1Key);
  const team2 = teamByKey(teams, match.team2Key);
  return {
    ...mentionOptions(roleIds),
    embeds: [
      {
        color: LCK_NAVY,
        title: "Match dans 30 minutes",
        description: [
          `${formatTeam(team1, match.team1Name)} ⚔️ ${formatTeam(team2, match.team2Name)}`,
          `🕒 ${discordTimestamp(match.scheduledAt, "F")} · ${discordTimestamp(match.scheduledAt, "R")}`,
          `Format : Bo${match.bestOf}`,
        ].join("\n"),
        url: leaguepediaPageUrl(match.overviewPage),
        footer: { text: `Source : Leaguepedia · ${competitionLabel(match.overviewPage)}` },
      },
    ],
  };
}

export function buildResultMessage(
  match: StoredMatch,
  roleIds: string[],
  teams: Team[] = [],
): MessageCreateOptions {
  if (
    (match.winner !== 1 && match.winner !== 2) ||
    match.team1Score === null ||
    match.team2Score === null
  ) {
    throw new Error("Résultat incomplet");
  }

  const team1 = teamByKey(teams, match.team1Key);
  const team2 = teamByKey(teams, match.team2Key);
  const winner = match.winner === 1 ? team1 : team2;
  const winnerName = match.winner === 1 ? match.team1Name : match.team2Name;
  const team1Emoji = emojiForTeam(team1);
  const team2Emoji = emojiForTeam(team2);
  return {
    ...mentionOptions(roleIds),
    embeds: [
      {
        color: LCK_NAVY,
        title: `Résultat disponible — ${match.team1Name} contre ${match.team2Name}`,
        description:
          `||${team1Emoji ? `${team1Emoji} ` : ""}**${match.team1Name} ${match.team1Score} – ${match.team2Score} ${match.team2Name}**${team2Emoji ? ` ${team2Emoji}` : ""}\n` +
          `Vainqueur : ${formatTeam(winner, winnerName)}||`,
        url: leaguepediaPageUrl(match.overviewPage),
        footer: { text: `Source : Leaguepedia · ${competitionLabel(match.overviewPage)}` },
      },
    ],
  };
}

export function isTeamToggleCustomId(customId: string): boolean {
  return customId === TEAM_TOGGLE_ID || customId.startsWith(`${TEAM_TOGGLE_ID}:`);
}
