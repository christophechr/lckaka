import { ButtonStyle, escapeMarkdown, type APIActionRowComponent, type APIButtonComponentWithCustomId, type APIEmbed } from "discord.js";
import { competitionLabel } from "../competitions.js";
import { predictionRevision, type PredictionMatch } from "../db/prediction-repository.js";
import { teamKey } from "../leaguepedia.js";
import type { PredictionTeamAppearance } from "./prediction-team-assets.js";
import { teamAcronym } from "./team-acronyms.js";

function teamLogo(team?: PredictionTeamAppearance): string | undefined {
  return team?.emojiId ? `https://cdn.discordapp.com/emojis/${team.emojiId}.webp?size=128` : undefined;
}

export const PREDICTION_COLORS = {
  lec: 0xa78bfa,
  lck: 0x64b6ac,
  gold: 0xd9b66f,
  success: 0x77c9a0,
  warning: 0xe4b779,
};

export function buildPredictionNotice(title: string, description: string, color = PREDICTION_COLORS.warning) {
  return {
    embeds: [{ color, title, description, footer: { text: "Pronostics · Réponse privée" } }],
    allowedMentions: { parse: [] as never[] },
  };
}

export function buildPredictionConfirmation(match: PredictionMatch, team1Score: number, team2Score: number, teams: PredictionTeamAppearance[] = []) {
  const winner = team1Score > team2Score ? match.team1Name : match.team2Name;
  const appearance = teams.find(team => team.key === teamKey(winner));
  const logo = teamLogo(appearance);
  return {
    embeds: [{
      color: appearance?.color ?? PREDICTION_COLORS.success,
      ...(logo ? { thumbnail: { url: logo } } : {}),
      title: "✓ Ton pronostic est enregistré",
      description: `**${escapeMarkdown(match.team1Name)} ${team1Score}–${team2Score} ${escapeMarkdown(match.team2Name)}**`,
      fields: [
        { name: "Ton vainqueur", value: escapeMarkdown(winner), inline: true },
        { name: "Points possibles", value: match.bestOf === 1 ? "**3 pts** · bon vainqueur" : "**3 pts** · bon vainqueur\n**+2 pts** · score exact", inline: true },
        { name: "Tu peux encore changer d'avis", value: `Clique sur un autre score avant <t:${Math.floor(match.scheduledAt.getTime() / 1_000) - 60}:F> (1 minute avant le début du match).` },
      ],
      footer: { text: `${competitionLabel(match.overviewPage)} · BO${match.bestOf} · Ton choix reste privé` },
    }],
    allowedMentions: { parse: [] as never[] },
  };
}

export function buildPredictionMessage(match: PredictionMatch, teams: PredictionTeamAppearance[] = []): {
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIButtonComponentWithCustomId>[];
  allowedMentions: { parse: [] };
} {
  const wins = (match.bestOf + 1) / 2;
  const revision = predictionRevision(match);
  const competition = competitionLabel(match.overviewPage);
  const start = Math.floor(match.scheduledAt.getTime() / 1_000);
  const team1 = teams.find(team => team.key === teamKey(match.team1Name));
  const team2 = teams.find(team => team.key === teamKey(match.team2Name));
  const components: APIActionRowComponent<APIButtonComponentWithCustomId>[] = [1, 2].map(winner => ({
    type: 1,
    components: Array.from({ length: wins }, (_, lost) => ({
      type: 2,
      style: ButtonStyle.Secondary,
      ...((winner === 1 ? team1 : team2)?.emojiId ? { emoji: { id: (winner === 1 ? team1 : team2)!.emojiId!, name: (winner === 1 ? team1 : team2)!.emojiName ?? undefined } } : {}),
      label: `${teamAcronym(winner === 1 ? match.team1Name : match.team2Name)} ${wins}–${lost}`,
      custom_id: `prono:${match.id}:${revision}:${winner === 1 ? wins : lost}:${winner === 2 ? wins : lost}`,
    })),
  }));
  return {
    embeds: [{
      color: team1?.color ?? (competition === "LEC" ? PREDICTION_COLORS.lec : competition === "LCK" ? PREDICTION_COLORS.lck : PREDICTION_COLORS.gold),
      author: { name: `${competition} · PRONOSTICS OUVERTS`, ...(teamLogo(team1) ? { icon_url: teamLogo(team1) } : {}) },
      ...(teamLogo(team2) ? { thumbnail: { url: teamLogo(team2)! } } : {}),
      title: `Pronostic · ${match.team1Name} vs ${match.team2Name}`.slice(0, 256),
      description: "Choisis ton vainqueur et le score final avec les boutons ci-dessous.\n"
        + `**Votes ouverts** · Clôture <t:${start - 60}:R> (1 minute avant le début du match)\nClassement : /classement.`,
      fields: [
        { name: "Début du match", value: `<t:${start}:F>`, inline: true },
        { name: "Format", value: `**BO${match.bestOf}**`, inline: true },
        { name: "À gagner", value: match.bestOf === 1 ? "**3 points** · bon vainqueur" : "**3 points** · bon vainqueur\n**+2 points** · score exact", inline: true },
      ],
      footer: { text: "Un vote par membre · Modifiable jusqu’à 1 min avant le match · Confirmation privée" },
    }],
    components,
    allowedMentions: { parse: [] },
  };
}
