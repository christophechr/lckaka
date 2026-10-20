import { createHash } from "node:crypto";
import sharp from "sharp";
import { officialTeamLogo } from "../team-logos.js";

import type { Team } from "../db/match-repository.js";
import { prepareDiscordEmoji, type TeamEmojiGateway, type LogoPreparer } from "./team-emoji-sync.js";

export interface PredictionTeamAppearance extends Team {
  color?: number;
}

export interface PredictionTeamAssetStore {
  findTeams(keys: string[]): Promise<PredictionTeamAppearance[]>;
}

// Cosmetic lookups must never prevent confirmation of a successfully saved vote.
export async function findPredictionAppearances(store: PredictionTeamAssetStore | undefined, keys: string[]): Promise<PredictionTeamAppearance[]> {
  if (!store) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      store.findTeams(keys),
      new Promise<PredictionTeamAppearance[]>(resolve => { timer = setTimeout(() => resolve([]), 8_000); }),
    ]);
  } catch (error) {
    console.error("Habillage des pronostics indisponible :", error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function logoAccent(image: Buffer): Promise<number> {
  const { data } = await sharp(image).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, { weight: number; r: number; g: number; b: number; count: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, alpha] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    if (alpha < 128) continue;
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, count: 0 };
    // Prefer the colored mark over its white/black outline or background.
    bin.weight += saturation > 0.15 ? 1 + saturation : 0.03;
    bin.r += r; bin.g += g; bin.b += b; bin.count++;
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
  return dominant
    ? Math.round(dominant.r / dominant.count) << 16 | Math.round(dominant.g / dominant.count) << 8 | Math.round(dominant.b / dominant.count)
    : 0x808080;
}

async function preparePredictionLogo(url: string): Promise<Buffer> {
  const fetcher: typeof fetch = (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(8_000) });
  try {
    return await prepareDiscordEmoji(url, fetcher);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("exceeds pixel limit")) throw error;
    // Leaguepedia serves some original logos at more than 70 megapixels.
    const thumbnail = new URL(url);
    thumbnail.searchParams.set("width", "256");
    return prepareDiscordEmoji(thumbnail.href, fetcher);
  }
}

export class PredictionTeamAssets implements PredictionTeamAssetStore {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<PredictionTeamAppearance> }>();

  constructor(
    private readonly catalog: { findTeams(keys: string[]): Promise<Team[]> },
    private readonly gateway: TeamEmojiGateway,
    private readonly prepareLogo: LogoPreparer = preparePredictionLogo,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async findTeams(keys: string[]): Promise<PredictionTeamAppearance[]> {
    const now = Date.now();
    const missing = [...new Set(keys)].filter(key => (this.cache.get(key)?.expiresAt ?? 0) <= now);
    if (missing.length) {
      const teams = (await this.catalog.findTeams(missing)).map(team => ({
        ...team, logoUrl: officialTeamLogo(team.name) ?? team.logoUrl,
      }));
      const emojis = await this.gateway.listApplicationEmojis();
      for (const team of teams) {
        if ((this.cache.get(team.key)?.expiresAt ?? 0) > now) continue;
        const existingEmoji = emojis.find(emoji => emoji.id === team.emojiId);
        const fallback: PredictionTeamAppearance = { ...team, emojiId: existingEmoji?.id ?? null, emojiName: existingEmoji?.name ?? null };
        const value = (async (): Promise<PredictionTeamAppearance> => {
          if (!team.logoUrl) return fallback;
          const image = await this.prepareLogo(team.logoUrl);
          const color = await logoAccent(image);
          fallback.color = color;
          const hash = createHash("sha256").update(image).digest("hex").slice(0, 8);
          const name = `pr_${team.key.replace(/[^a-z0-9]/g, "_").slice(0, 20)}_${hash}`;
          const emoji = emojis.find(emoji => emoji.id === team.emojiId || emoji.name === name)
            ?? await this.gateway.createApplicationEmoji(name, image);
          return { ...team, color, emojiId: emoji.id, emojiName: emoji.name };
        })().catch(error => {
          console.error(`Logo de pronostic indisponible pour ${team.name} :`, error);
          const cached = this.cache.get(team.key);
          if (cached?.value === value) cached.expiresAt = Date.now() + 60_000;
          return fallback;
        });
        this.cache.set(team.key, { expiresAt: now + 24 * 60 * 60 * 1_000, value });
      }
    }
    return Promise.all(keys.flatMap(key => this.cache.get(key)?.value ?? []));
  }
}
