export type CalendarCompetition = "LCK" | "LEC";

// Leaguepedia overview pages are stable across tournament stages and seasons.
export function internationalTournamentPages(year: number): string[] {
  return [
    `${year} First Stand`,
    `${year} Mid-Season Invitational`,
    `${year} Season World Championship`,
    `Esports World Cup ${year}`,
  ];
}

export function competitionLabel(overviewPage: string): string {
  if (overviewPage.startsWith("LCK/")) return "LCK";
  if (overviewPage.startsWith("LEC/")) return "LEC";
  if (/^\d{4} First Stand(?:\/|$)/.test(overviewPage)) return "First Stand";
  if (/^\d{4} Mid-Season Invitational(?:\/|$)/.test(overviewPage)) return "MSI";
  if (/^\d{4} Season World Championship(?:\/|$)/.test(overviewPage)) return "Worlds";
  if (/^Esports World Cup \d{4}(?:\/|$)/.test(overviewPage)) return "Esports World Cup";
  return overviewPage;
}
