import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { describe, expect, it } from "vitest";

import {
  commandMap,
  commands,
  type CounterStore,
} from "../src/bot/commands/index.js";

class MemoryCounters implements CounterStore {
  readonly increments: Array<{
    kind: "drooler" | "hans";
    split: string;
    year: number;
    team: string | null;
  }> = [];

  async increment(
    kind: "drooler" | "hans",
    split: string,
    year: number,
    team: string | null,
  ): Promise<number> {
    this.increments.push({ kind, split, year, team });
    return 4;
  }

  async getTotal(): Promise<number> {
    return 7;
  }

  async listSplits(): Promise<string[]> {
    return ["spring", "summer"];
  }

  async listTeams(): Promise<string[]> {
    return ["Gen.G", "T1"];
  }
}

function commandInteraction(values: Record<string, string | number | null>) {
  const replies: unknown[] = [];
  return {
    options: {
      getString: (name: string) => values[name] ?? null,
      getInteger: (name: string) => values[name] ?? null,
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
      return { createdTimestamp: 1 };
    },
    editReply: async (payload: unknown) => replies.push(payload),
    replies,
  } as unknown as ChatInputCommandInteraction & { replies: unknown[] };
}

describe("additional Discord commands", () => {
  it("exposes every command for REST registration", () => {
    expect(commands.map((command) => command.data.name)).toEqual([
      "ping",
      "add_drooler",
      "drooler",
      "add_hans",
      "hans_maga",
    ]);
  });

  it("uses dynamic LCK team autocomplete for Drooler queries", () => {
    const json = commandMap.get("drooler")!.data.toJSON();
    const teamOption = json.options?.find((option) => option.name === "equipe");

    expect(teamOption).toMatchObject({ name: "equipe", autocomplete: true });
    expect(teamOption && "choices" in teamOption ? teamOption.choices : undefined).toBeUndefined();
  });

  it("increments a public Drooler counter with normalized input", async () => {
    const counters = new MemoryCounters();
    const interaction = commandInteraction({ split: " Spring ", annee: 2026, equipe: " T1 " });

    await commandMap.get("add_drooler")!.execute(interaction, counters);

    expect(counters.increments).toEqual([
      { kind: "drooler", split: "spring", year: 2026, team: "T1" },
    ]);
    expect(interaction.replies).toEqual(["Drooler a été attrapé 4 fois."]);
  });

  it("returns an aggregated Hans counter", async () => {
    const counters = new MemoryCounters();
    const interaction = commandInteraction({ split: null, annee: 2026, equipe: null });

    await commandMap.get("hans_maga")!.execute(interaction, counters);

    expect(interaction.replies).toEqual(["Hans Sama a flash-in 7 fois en 2026."]);
  });

  it("responds to autocomplete with matching stored values and the typed value", async () => {
    const responses: unknown[] = [];
    const interaction = {
      options: { getFocused: () => ({ name: "split", value: "spr" }) },
      respond: async (choices: unknown) => responses.push(choices),
    } as unknown as AutocompleteInteraction;

    await commandMap.get("add_hans")!.autocomplete!(interaction, new MemoryCounters());

    expect(responses).toEqual([
      [
        { name: "spr", value: "spr" },
        { name: "spring", value: "spring" },
      ],
    ]);
  });
});
