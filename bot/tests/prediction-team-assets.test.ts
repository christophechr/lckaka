import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { findPredictionAppearances, logoAccent, PredictionTeamAssets } from "../src/bot/prediction-team-assets.js";

const logo = () => sharp({ create: { width: 32, height: 32, channels: 4, background: "#ee2233" } }).png().toBuffer();

describe("prediction team assets", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("selects a saturated logo color for embeds", async () => {
    const color = await logoAccent(await logo());
    expect(color).toBe(0xee2233);
  });

  it("replaces a stored Fandom logo with the official Worlds asset", async () => {
    const prepare = vi.fn(logo);
    const catalog = { findTeams: async () => [{ key: "bilibili-gaming", name: "Bilibili Gaming", logoUrl: "https://lol.fandom.com/wiki/Special:Redirect/file/BLG.png" }] };
    const gateway = { listApplicationEmojis: vi.fn(async () => []), createApplicationEmoji: vi.fn(async (name: string) => ({ id: "blg", name })), deleteApplicationEmoji: vi.fn() };
    const teams = await new PredictionTeamAssets(catalog, gateway, prepare).findTeams(["bilibili-gaming"]);
    expect(prepare).toHaveBeenCalledWith("https://static.lolesports.com/teams/1682322954525_Bilibili_Gaming_logo_20211.png");
    expect(teams[0]?.emojiId).toBe("blg");
  });

  it("reuses existing emojis and caches repeated lookups", async () => {
    const catalog = { findTeams: vi.fn(async () => [{ key: "t1", name: "T1", logoUrl: "https://example.com/logo", emojiId: "123" }]) };
    const gateway = { listApplicationEmojis: vi.fn(async () => [{ id: "123", name: "existing_t1" }]), createApplicationEmoji: vi.fn(), deleteApplicationEmoji: vi.fn() };
    const assets = new PredictionTeamAssets(catalog, gateway, logo);
    expect(await assets.findTeams(["t1"])).toMatchObject([{ emojiId: "123", color: 0xee2233 }]);
    await assets.findTeams(["t1"]);
    expect(catalog.findTeams).toHaveBeenCalledTimes(1);
    expect(gateway.createApplicationEmoji).not.toHaveBeenCalled();
  });

  it("creates only one reusable emoji for a new team", async () => {
    const catalog = { findTeams: vi.fn(async () => [{ key: "giantx", name: "GIANTX", logoUrl: "https://example.com/logo" }]) };
    const gateway = { listApplicationEmojis: vi.fn(async () => []), createApplicationEmoji: vi.fn(async (name: string) => ({ id: "456", name })), deleteApplicationEmoji: vi.fn() };
    const assets = new PredictionTeamAssets(catalog, gateway, logo);
    await Promise.all([assets.findTeams(["giantx"]), assets.findTeams(["giantx"])]);
    expect(gateway.createApplicationEmoji).toHaveBeenCalledTimes(1);
    expect(gateway.createApplicationEmoji.mock.calls[0]![0]).toMatch(/^pr_giantx_[a-f0-9]{8}$/);
  });

  it("never returns a deleted emoji when logo preparation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const catalog = { findTeams: async () => [{ key: "t1", name: "T1", logoUrl: "https://example.com/logo", emojiId: "deleted", emojiName: "old_logo" }] };
    const gateway = { listApplicationEmojis: async () => [], createApplicationEmoji: vi.fn(), deleteApplicationEmoji: vi.fn() };
    const assets = new PredictionTeamAssets(catalog, gateway, async () => { throw new Error("offline"); });
    expect(await assets.findTeams(["t1"])).toMatchObject([{ key: "t1", emojiId: null, emojiName: null }]);
  });

  it("keeps colors on emoji creation failure and retries after a minute", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const catalog = { findTeams: async () => [{ key: "t1", name: "T1", logoUrl: "https://example.com/logo" }] };
    const gateway = { listApplicationEmojis: async () => [], createApplicationEmoji: vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue({ id: "new", name: "new_logo" }), deleteApplicationEmoji: vi.fn() };
    const assets = new PredictionTeamAssets(catalog, gateway, logo);
    vi.useFakeTimers();
    expect(await assets.findTeams(["t1"])).toMatchObject([{ color: 0xee2233, emojiId: null }]);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await assets.findTeams(["t1"])).toMatchObject([{ emojiId: "new" }]);
    expect(gateway.createApplicationEmoji).toHaveBeenCalledTimes(2);
    assets.invalidate();
    await assets.findTeams(["t1"]);
    expect(gateway.createApplicationEmoji).toHaveBeenCalledTimes(3);
  });

  it("falls back on lookup failure or timeout so saved votes can be confirmed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await findPredictionAppearances({ findTeams: async () => { throw new Error("offline"); } }, ["t1"])).toEqual([]);
    vi.useFakeTimers();
    const pending = findPredictionAppearances({ findTeams: () => new Promise(() => {}) }, ["t1"]);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual([]);
  });
});
