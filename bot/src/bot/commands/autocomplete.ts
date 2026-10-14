import type { AutocompleteInteraction } from "discord.js";

import type { CounterKind, CounterStore } from "./types.js";

export async function autocompleteCounter(
  interaction: AutocompleteInteraction,
  counters: CounterStore,
  kind: CounterKind,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value).trim();
  const stored =
    focused.name === "split"
      ? await counters.listSplits(kind, query)
      : focused.name === "equipe" || focused.name === "equipe_international"
        ? await counters.listTeams(kind, query)
        : [];
  const lowerQuery = query.toLocaleLowerCase("fr");
  const values = [query, ...stored]
    .filter((value) => value && value.toLocaleLowerCase("fr").includes(lowerQuery))
    .filter((value, index, all) =>
      all.findIndex(
        (candidate) => candidate.toLocaleLowerCase("fr") === value.toLocaleLowerCase("fr"),
      ) === index,
    )
    .slice(0, 25);

  await interaction.respond(values.map((value) => ({ name: value, value })));
}
