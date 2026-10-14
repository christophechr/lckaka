import { MessageFlags, InteractionContextType, type Interaction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { ALL_COMMANDS_JSON } from "../src/bot/commands.js";
import { handleInteraction, type InteractionDependencies } from "../src/bot/interactions.js";
import { PredictionError, predictionRevision, type PredictionStore } from "../src/db/prediction-repository.js";

const match = {
  id: "42", team1Name: "T1", team2Name: "Gen.G", bestOf: 5,
  scheduledAt: new Date("2026-09-10T12:00:00Z"), overviewPage: "LCK/2026 Season/Playoffs",
};

function setup(options: { command?: string; guildId?: string | null; autocomplete?: boolean; button?: string; page?: number } = {}) {
  const replies: unknown[] = [];
  const interaction = {
    guildId: options.guildId === undefined ? "guild-1" : options.guildId,
    channelId: "1546489098968105031",
    user: { id: "user-1" }, commandName: options.command ?? "classement",
    isChatInputCommand: () => !options.autocomplete && !options.button,
    isAutocomplete: () => !!options.autocomplete,
    isButton: () => !!options.button,
    customId: options.button,
    isStringSelectMenu: () => false,
    options: {
      getString: () => "42",
      getInteger: () => options.page ?? null,
      getFocused: () => ({ name: "match", value: "T1" }),
    },
    reply: async (payload: unknown) => { replies.push(payload); },
    deferReply: async (payload: unknown) => { replies.push(payload); },
    editReply: async (payload: unknown) => { replies.push(payload); },
    respond: async (payload: unknown) => { replies.push(payload); },
  } as unknown as Interaction;
  const store = {
    save: vi.fn<PredictionStore["save"]>().mockResolvedValue(match),
    leaderboard: vi.fn<PredictionStore["leaderboard"]>().mockResolvedValue({
      total: 1, entries: [{ rank: 1, userId: "user-1", points: 5, correctWinners: 1, exactScores: 1, settled: 1 }],
    }),
  };
  const deps = { predictions: store } as unknown as InteractionDependencies;
  return { interaction, replies, store, deps };
}

describe("prediction commands", () => {
  it("registers classement without a prono command", () => {
    expect(ALL_COMMANDS_JSON.some(command => command.name === "prono")).toBe(false);
    expect(ALL_COMMANDS_JSON.find(command => command.name === "classement")).toMatchObject({ contexts: [InteractionContextType.Guild] });
  });

  it("saves a button vote for the clicking member and confirms privately", async () => {
    const revision = predictionRevision(match);
    const { interaction, replies, store, deps } = setup({ button: `prono:42:${revision}:3:1` });
    await handleInteraction(interaction, deps);
    expect(store.save).toHaveBeenCalledWith("guild-1", "user-1", "42", 3, 1, revision);
    expect(replies[0]).toEqual({ flags: MessageFlags.Ephemeral });
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringMatching(/T1.*3.*1.*Gen\.G/) })], allowedMentions: { parse: [] } });
  });

  it("reports a closed match instead of confirming a rejected prediction", async () => {
    const { interaction, replies, store, deps } = setup({ button: `prono:42:${predictionRevision(match)}:3:1` });
    store.save.mockRejectedValue(new PredictionError("Les pronostics sont fermés."));
    await handleInteraction(interaction, deps);
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: "Les pronostics sont fermés." })] });
  });

  it("rejects voting from an old embed outside the dedicated channel", async () => {
    const { interaction, replies, store, deps } = setup({ button: `prono:42:${predictionRevision(match)}:3:1` });
    Object.assign(interaction, { channelId: "old-notifications" });
    await handleInteraction(interaction, deps);
    expect(store.save).not.toHaveBeenCalled();
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringContaining("1546489098968105031") })] });
  });

  it("rejects malformed button payloads before writing", async () => {
    const { interaction, replies, store, deps } = setup({ button: "prono:42:bad:3:1junk" });
    await handleInteraction(interaction, deps);
    expect(store.save).not.toHaveBeenCalled();
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringContaining("invalide") })] });
  });

  it("refuses button voting outside a server", async () => {
    const { interaction, replies, store, deps } = setup({ guildId: null, button: `prono:42:${predictionRevision(match)}:3:1` });
    await handleInteraction(interaction, deps);
    expect(store.save).not.toHaveBeenCalled();
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringContaining("serveur") })] });
  });

  it.each(["classement"])("refuses %s in direct messages", async command => {
    const { interaction, replies, store, deps } = setup({ command, guildId: null });
    await handleInteraction(interaction, deps);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.leaderboard).not.toHaveBeenCalled();
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringContaining("serveur") })], flags: MessageFlags.Ephemeral });
  });

  it("shows the server leaderboard without notifying its members", async () => {
    const { interaction, replies, store, deps } = setup({ command: "classement" });
    await handleInteraction(interaction, deps);
    expect(store.leaderboard).toHaveBeenCalledWith("guild-1", 1);
    expect(replies.at(-1)).toMatchObject({
      embeds: [expect.objectContaining({ description: expect.stringMatching(/<@user-1>.*5/) })],
      allowedMentions: { parse: [] },
    });
  });

  it("explains an empty leaderboard", async () => {
    const { interaction, replies, store, deps } = setup({ command: "classement" });
    store.leaderboard.mockResolvedValue({ total: 0, entries: [] });
    await handleInteraction(interaction, deps);
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringContaining("boutons") })] });
  });

  it("reports an out-of-range page with the last valid page", async () => {
    const { interaction, replies, store, deps } = setup({ command: "classement", page: 3 });
    store.leaderboard.mockResolvedValue({ total: 12, entries: [] });
    await handleInteraction(interaction, deps);
    expect(store.leaderboard).toHaveBeenCalledWith("guild-1", 3);
    expect(replies.at(-1)).toMatchObject({ embeds: [expect.objectContaining({ description: expect.stringMatching(/2/) })] });
  });
});
