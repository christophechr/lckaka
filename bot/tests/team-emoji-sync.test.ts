import { describe, expect, it } from "vitest";

import {
  TeamEmojiSync,
  prepareDiscordEmoji,
  type ApplicationEmojiRef,
  type TeamEmojiCatalog,
  type TeamEmojiGateway,
} from "../src/bot/team-emoji-sync.js";
import type { Team } from "../src/db/match-repository.js";

class MemoryCatalog implements TeamEmojiCatalog {
  teams: Team[] = [
    { key: "t1", name: "T1", logoUrl: "https://example.test/t1.png" },
  ];

  async listTeams(): Promise<Team[]> {
    return this.teams;
  }

  async saveEmoji(
    teamKey: string,
    emoji: { id: string; name: string; logoHash: string },
  ): Promise<void> {
    this.teams = this.teams.map((team) =>
      team.key === teamKey
        ? {
            ...team,
            emojiId: emoji.id,
            emojiName: emoji.name,
            logoHash: emoji.logoHash,
          }
        : team,
    );
  }
}

class MemoryGateway implements TeamEmojiGateway {
  emojis: ApplicationEmojiRef[] = [];
  creates = 0;
  deleted: string[] = [];

  async listApplicationEmojis(): Promise<ApplicationEmojiRef[]> {
    return this.emojis;
  }

  async createApplicationEmoji(name: string): Promise<ApplicationEmojiRef> {
    this.creates += 1;
    const emoji = { id: `emoji-${this.creates}`, name };
    this.emojis.push(emoji);
    return emoji;
  }

  async deleteApplicationEmoji(id: string): Promise<void> {
    this.deleted.push(id);
    this.emojis = this.emojis.filter((emoji) => emoji.id !== id);
  }
}

describe("TeamEmojiSync", () => {
  it("downscales a large Leaguepedia source into a valid Discord emoji", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"><rect width="5000" height="5000" fill="#e4002b"/></svg>',
    );
    const image = await prepareDiscordEmoji(
      "https://example.test/large.svg",
      async () => new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml" } }),
    );

    expect(image.length).toBeLessThanOrEqual(256 * 1_024);
    expect(image.subarray(0, 4).toString("hex")).toBe("52494646");
  });

  it("creates one application emoji and reuses it while the normalized logo is unchanged", async () => {
    const catalog = new MemoryCatalog();
    const gateway = new MemoryGateway();
    const sync = new TeamEmojiSync(catalog, gateway, async () => Buffer.from("same-logo"));

    expect(await sync.sync()).toBe(1);
    expect(gateway.creates).toBe(1);
    expect(catalog.teams[0]).toMatchObject({
      emojiId: "emoji-1",
      emojiName: expect.stringMatching(/^lck_t1_/),
      logoHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    expect(await sync.sync()).toBe(0);
    expect(gateway.creates).toBe(1);
  });

  it("replaces the old emoji only after a changed logo was created", async () => {
    const catalog = new MemoryCatalog();
    const gateway = new MemoryGateway();
    let image = "first-logo";
    const sync = new TeamEmojiSync(catalog, gateway, async () => Buffer.from(image));

    await sync.sync();
    image = "second-logo";
    await sync.sync();

    expect(gateway.creates).toBe(2);
    expect(gateway.deleted).toEqual(["emoji-1"]);
    expect(catalog.teams[0]?.emojiId).toBe("emoji-2");
  });

  it("continues when one team logo cannot be prepared", async () => {
    const catalog = new MemoryCatalog();
    catalog.teams.push({
      key: "gen-g",
      name: "Gen.G",
      logoUrl: "https://example.test/geng.png",
    });
    const gateway = new MemoryGateway();
    const errors: string[] = [];
    const sync = new TeamEmojiSync(
      catalog,
      gateway,
      async (url) => {
        if (url.includes("t1")) throw new Error("image invalide");
        return Buffer.from("geng-logo");
      },
      { error: (message) => errors.push(message) },
    );

    expect(await sync.sync()).toBe(1);
    expect(errors).toHaveLength(1);
    expect(catalog.teams.find((team) => team.key === "gen-g")?.emojiId).toBe("emoji-1");
  });
});
