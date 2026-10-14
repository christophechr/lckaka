import { createHash } from "node:crypto";

import sharp from "sharp";

import type { Team } from "../db/match-repository.js";

const MAX_EMOJI_BYTES = 256 * 1_024;
const MAX_SOURCE_PIXELS = 40_000_000;

export interface ApplicationEmojiRef {
  id: string;
  name: string;
}

export interface TeamEmojiCatalog {
  listTeams(): Promise<Team[]>;
  saveEmoji(
    teamKey: string,
    emoji: { id: string; name: string; logoHash: string },
  ): Promise<void>;
}

export interface TeamEmojiGateway {
  listApplicationEmojis(): Promise<ApplicationEmojiRef[]>;
  createApplicationEmoji(name: string, image: Buffer): Promise<ApplicationEmojiRef>;
  deleteApplicationEmoji(id: string): Promise<void>;
}

export interface TeamEmojiLogger {
  error(message: string, error?: unknown): void;
}

export type LogoPreparer = (url: string) => Promise<Buffer>;

const defaultLogger: TeamEmojiLogger = {
  error: (message, error) => console.error(message, error),
};

export async function prepareDiscordEmoji(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const response = await fetcher(url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "LckWeeklyDiscordBot/1.0",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Logo Leaguepedia HTTP ${response.status}`);

  const source = Buffer.from(await response.arrayBuffer());
  if (source.length === 0) throw new Error("Logo Leaguepedia vide");

  const image = await sharp(source, { limitInputPixels: MAX_SOURCE_PIXELS })
    .resize(128, 128, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();

  if (image.length > MAX_EMOJI_BYTES) {
    throw new Error("Logo trop volumineux pour Discord après conversion");
  }
  return image;
}

function emojiName(teamKey: string, hash: string): string {
  const base = teamKey
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 19) || "team";
  return `lck_${base}_${hash.slice(0, 8)}`;
}

export class TeamEmojiSync {
  constructor(
    private readonly catalog: TeamEmojiCatalog,
    private readonly gateway: TeamEmojiGateway,
    private readonly prepareLogo: LogoPreparer = prepareDiscordEmoji,
    private readonly logger: TeamEmojiLogger = defaultLogger,
  ) {}

  async sync(): Promise<number> {
    const teams = await this.catalog.listTeams();
    const applicationEmojis = await this.gateway.listApplicationEmojis();
    const emojisById = new Map(applicationEmojis.map((emoji) => [emoji.id, emoji]));
    const emojisByName = new Map(applicationEmojis.map((emoji) => [emoji.name, emoji]));
    let changed = 0;

    for (const team of teams) {
      if (!team.logoUrl) continue;
      try {
        const image = await this.prepareLogo(team.logoUrl);
        const logoHash = createHash("sha256").update(image).digest("hex");
        if (team.logoHash === logoHash && team.emojiId && emojisById.has(team.emojiId)) {
          continue;
        }

        const name = emojiName(team.key, logoHash);
        const emoji =
          emojisByName.get(name) ??
          (await this.gateway.createApplicationEmoji(name, image));

        await this.catalog.saveEmoji(team.key, {
          id: emoji.id,
          name: emoji.name,
          logoHash,
        });
        changed += 1;

        if (team.emojiId && team.emojiId !== emoji.id && emojisById.has(team.emojiId)) {
          await this.gateway.deleteApplicationEmoji(team.emojiId);
          emojisById.delete(team.emojiId);
        }
        emojisById.set(emoji.id, emoji);
        emojisByName.set(emoji.name, emoji);
      } catch (error) {
        this.logger.error(`Impossible de synchroniser le logo de ${team.name}.`, error);
      }
    }

    return changed;
  }
}
