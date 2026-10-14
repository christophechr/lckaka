import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";

export type CounterKind = "drooler" | "hans";

export interface CounterFilters {
  year: number;
  split?: string;
  team?: string;
}

export interface CounterStore {
  increment(
    kind: CounterKind,
    split: string,
    year: number,
    team: string | null,
  ): Promise<number>;
  getTotal(kind: CounterKind, filters: CounterFilters): Promise<number>;
  listSplits(kind: CounterKind, query: string): Promise<string[]>;
  listTeams(kind: CounterKind, query: string): Promise<string[]>;
}

export interface Command {
  data: SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, counters: CounterStore): Promise<void>;
  autocomplete?(
    interaction: AutocompleteInteraction,
    counters: CounterStore,
  ): Promise<void>;
}

export function normalizedSplit(value: string): string {
  return value.trim().toLocaleLowerCase("fr");
}

export function normalizedTeam(value: string | null): string | null {
  return value?.trim() || null;
}
