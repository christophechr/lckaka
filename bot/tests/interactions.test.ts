import { MessageFlags, type Interaction } from "discord.js";
import { describe, expect, it } from "vitest";

import { handleInteraction, type InteractionDependencies } from "../src/bot/interactions.js";
import type { CounterStore } from "../src/bot/commands/index.js";

class MemoryCounters implements CounterStore {
  increments = 0;

  async increment(): Promise<number> {
    this.increments += 1;
    return this.increments;
  }

  async getTotal(): Promise<number> {
    return this.increments;
  }

  async listSplits(): Promise<string[]> {
    return [];
  }

  async listTeams(): Promise<string[]> {
    return [];
  }
}

function menuInteraction(teamKey: string, customId = "lck-team-toggle"): Interaction & { replies: unknown[] } {
  const replies: unknown[] = [];
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId,
    channelId: "channel-1",
    message: { id: "panel-1" },
    guildId: "guild-1",
    user: { id: "user-1" },
    values: [teamKey],
    deferReply: async (payload: unknown) => {
      replies.push(payload);
    },
    editReply: async (payload: unknown) => {
      replies.push(payload);
    },
    replies,
  } as unknown as Interaction & { replies: unknown[] };
}

function dependencies(): InteractionDependencies & { toggled: string[]; counters: MemoryCounters } {
  const toggled: string[] = [];
  return {
    toggled,
    counters: new MemoryCounters(),
    config: {} as InteractionDependencies["config"],
    matchCatalog: {
      listTeams: async () => [
        { key: "gen-g", name: "Gen.G" },
        { key: "t1", name: "T1", emojiId: "emoji-t1", emojiName: "lck_t1" },
      ],
    },
    roles: {
      toggle: async (_guildId, _userId, team) => {
        toggled.push(team.key);
        return { action: "added", roleId: "role-1" };
      },
    },
  };
}

describe("Discord interaction routing", () => {
  it("executes a registered public counter command", async () => {
    const replies: unknown[] = [];
    const interaction = {
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      commandName: "add_drooler",
      options: {
        getString: (name: string) => (name === "split" ? "spring" : null),
        getInteger: () => 2026,
      },
      reply: async (payload: unknown) => replies.push(payload),
    } as unknown as Interaction;
    const deps = dependencies();

    await handleInteraction(interaction, deps);

    expect(deps.counters.increments).toBe(1);
    expect(replies).toEqual(["Drooler a été attrapé 1 fois."]);
  });

  it("routes autocomplete interactions to the matching command", async () => {
    const responses: unknown[] = [];
    const interaction = {
      isChatInputCommand: () => false,
      isAutocomplete: () => true,
      isStringSelectMenu: () => false,
      commandName: "add_hans",
      options: { getFocused: () => ({ name: "split", value: "spr" }) },
      respond: async (payload: unknown) => responses.push(payload),
    } as unknown as Interaction;
    const deps = dependencies();
    deps.counters.listSplits = async () => ["spring"];

    await handleInteraction(interaction, deps);

    expect(responses).toEqual([
      [
        { name: "spr", value: "spr" },
        { name: "spring", value: "spring" },
      ],
    ]);
  });

  it("toggles the selected team and confirms privately", async () => {
    const interaction = menuInteraction("t1");
    const deps = dependencies();

    await handleInteraction(interaction, deps);

    expect(deps.toggled).toEqual(["t1"]);
    expect(interaction.replies).toEqual([
      { flags: MessageFlags.Ephemeral },
      { content: "Tu suis maintenant <:lck_t1:emoji-t1> **T1**." },
    ]);
  });

  it("rejects a team no longer present in the catalog", async () => {
    const interaction = menuInteraction("old-team");

    await handleInteraction(interaction, dependencies());

    expect(interaction.replies.at(-1)).toEqual({
      content: "Cette équipe n'est plus disponible dans le panneau.",
    });
  });
  it("routes a scoped menu to the active competition subscription and confirms privately", async () => {
    const interaction = menuInteraction("g2-esports", "competition-team-toggle:lec");
    const deps = dependencies();
    const calls: unknown[][] = [];
    deps.subscriptions = {
      toggle: async (...args) => {
        calls.push(args);
        return { action: "added", roleId: "lec-role", team: { key: "g2-esports", name: "G2 Esports" }, competition: "LEC" };
      },
    };
    await handleInteraction(interaction, deps);
    expect(calls[0]?.slice(0, 6)).toEqual(["guild-1", "user-1", "channel-1", "panel-1", "lec", "g2-esports"]);
    expect(deps.toggled).toEqual([]);
    expect(interaction.replies[0]).toEqual({ flags: MessageFlags.Ephemeral });
    expect(interaction.replies.at(-1)).toEqual({ content: "Tu suis maintenant **G2 Esports** — LEC." });
  });

});
