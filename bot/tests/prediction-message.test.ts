import { describe, expect, it } from "vitest";
import { ButtonStyle } from "discord.js";
import { buildPredictionMessage, buildPredictionConfirmation } from "../src/bot/prediction-message.js";

const match = {
  id: "42", team1Name: "T1", team2Name: "Gen.G", bestOf: 5,
  scheduledAt: new Date("2026-09-10T12:00:00Z"), overviewPage: "LCK/2026 Season/Playoffs",
};

describe("match prediction embed", () => {
  it("shows the voting deadline one minute before kickoff in the embed and confirmation", () => {
    const start = Math.floor(match.scheduledAt.getTime() / 1_000);
    expect(buildPredictionMessage(match).embeds[0]?.description).toContain(`Clôture <t:${start - 60}:R>`);
    expect(buildPredictionMessage(match).embeds[0]?.fields).toContainEqual(expect.objectContaining({
      name: "Début du match", value: `<t:${start}:F>`,
    }));
    expect(buildPredictionConfirmation(match, 3, 1).embeds[0]?.fields).toContainEqual(expect.objectContaining({
      value: expect.stringContaining(`<t:${start - 60}:F>`),
    }));
  });

  const teams = [{ key: "t1", name: "T1", color: 0xff0020, emojiId: "123", emojiName: "t1_logo" }];

  it("keeps all buttons grey and preserves team logos when match sides swap, without changing vote IDs", () => {
    const plain = buildPredictionMessage(match);
    const styled = buildPredictionMessage(match, teams);
    const swapped = buildPredictionMessage({ ...match, team1Name: "Gen.G", team2Name: "T1" }, teams);
    expect(styled.components[0]!.components.every(button => button.style === ButtonStyle.Secondary && button.emoji?.id === "123")).toBe(true);
    expect(swapped.components[1]!.components.every(button => button.style === ButtonStyle.Secondary && button.emoji?.id === "123")).toBe(true);
    expect(styled.components[1]!.components[0]!.style).toBe(ButtonStyle.Secondary);
    expect(styled.embeds[0]!.color).toBe(0xff0020);
    expect(styled.components.flatMap(row => row.components.map(button => button.custom_id)))
      .toEqual(plain.components.flatMap(row => row.components.map(button => button.custom_id)));
  });

  it("colors the private confirmation using the selected winner", () => {
    expect(buildPredictionConfirmation(match, 3, 1, teams).embeds[0]).toMatchObject({ color: 0xff0020, thumbnail: { url: "https://cdn.discordapp.com/emojis/123.webp?size=128" } });
    expect(buildPredictionConfirmation({ ...match, team1Name: "Gen.G", team2Name: "T1" }, 1, 3, teams).embeds[0]!.color).toBe(0xff0020);
  });
  it.each([
    [1, ["1:0", "0:1"]],
    [3, ["2:0", "2:1", "0:2", "1:2"]],
    [5, ["3:0", "3:1", "3:2", "0:3", "1:3", "2:3"]],
  ])("offers exactly the valid final scores for BO%i", (bestOf, scores) => {
    const message = buildPredictionMessage({ ...match, bestOf: Number(bestOf) });
    const rows = message.components!;
    const buttons = rows.flatMap(row => row.components);
    expect(buttons.map(button => button.custom_id.split(":").slice(-2).join(":"))).toEqual(scores);
    expect(rows.every(row => row.components.length <= 5)).toBe(true);
    expect(buttons.every(button => button.custom_id.length <= 100 && button.label!.length <= 80)).toBe(true);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.embeds[0]?.description).toContain("/classement");
  });

  it("names the winning team on each score button", () => {
    const message = buildPredictionMessage(match);
    expect(message.components[0]?.components.map(button => button.label)).toEqual(["T1 3–0", "T1 3–1", "T1 3–2"]);
    expect(message.components[1]?.components.map(button => button.label)).toEqual(["GEN 3–0", "GEN 3–1", "GEN 3–2"]);
  });

  it("changes button identifiers if teams or BO format change", () => {
    const id = buildPredictionMessage(match).components[0]?.components[0]?.custom_id;
    expect(buildPredictionMessage({ ...match, team1Name: "Replacement" }).components[0]?.components[0]?.custom_id).not.toBe(id);
    expect(buildPredictionMessage({ ...match, bestOf: 3 }).components[0]?.components[0]?.custom_id).not.toBe(id);
  });
});
