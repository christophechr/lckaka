import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { DeliveryRepository } from "../src/db/delivery-repository.js";
import { GuildConfigRepository } from "../src/db/guild-config-repository.js";
import { MatchRepository, type StoredMatch } from "../src/db/match-repository.js";
import { TeamRoleRepository } from "../src/db/team-role-repository.js";
import { CounterRepository } from "../src/db/counter-repository.js";
import { TeamCatalogRepository } from "../src/db/team-catalog-repository.js";
import { buildScheduleEmbeds } from "../src/embed.js";
import { SubscriptionRepository } from "../src/db/subscription-repository.js";
import { CompetitionPanelService } from "../src/bot/competition-panel-service.js";
import { WeeklyScheduleRepository } from "../src/db/weekly-schedule-repository.js";
import { PredictionRepository, predictionRevision } from "../src/db/prediction-repository.js";
import { WeeklyLeaderboardRepository } from "../src/db/weekly-leaderboard-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL migrations", () => {
  const pool = createPool(databaseUrl ?? "");
  const guilds = new GuildConfigRepository(pool);
  const roles = new TeamRoleRepository(pool);
  const matches = new MatchRepository(pool);
  const deliveries = new DeliveryRepository(pool);
  const counters = new CounterRepository(pool);
  const teamCatalog = new TeamCatalogRepository(pool);
  const predictions = new PredictionRepository(pool);

  it("keeps LCK and LEC snapshots and receipts independent in the same guild and week", async () => {
    await guilds.ensureGuild("guild-1");
    const lck = new WeeklyScheduleRepository(pool);
    const lec = new WeeklyScheduleRepository(pool, "LEC");
    const sent: string[] = [];
    const loadLck = async () => [{ title: "LCK page 1", fields: [] }, { title: "LCK page 2", fields: [] }];
    const loadLec = async () => [{ title: "LEC page 1", fields: [] }];
    await expect(lck.deliverScheduleOnce("guild-1", "2026-09-07", loadLck, async (embed, page) => {
      if (page === 1) throw new Error("Interrupted LCK send");
      sent.push(embed.title!);
      return "lck-message-1";
    })).rejects.toThrow("Interrupted LCK send");
    expect(await lec.deliverScheduleOnce("guild-1", "2026-09-07", loadLec, async embed => {
      sent.push(embed.title!);
      return "lec-message-1";
    })).toBe(true);
    const noReload = async (): Promise<never> => { throw new Error("Stored snapshot must be reused"); };
    expect(await new WeeklyScheduleRepository(pool).deliverScheduleOnce("guild-1", "2026-09-07", noReload, async embed => {
      sent.push(embed.title!);
      return "lck-message-2";
    })).toBe(true);
    expect(await new WeeklyScheduleRepository(pool, "LEC").deliverScheduleOnce("guild-1", "2026-09-07", noReload, async () => {
      throw new Error("LEC must not be sent twice");
    })).toBe(false);
    expect(sent).toEqual(["LCK page 1", "LEC page 1", "LCK page 2"]);
  });

  it("preserves a weekly leaderboard snapshot on failure and deduplicates concurrent workers and restarts", async () => {
    await guilds.ensureGuild("guild-1");
    const first = new WeeklyLeaderboardRepository(pool);
    const restarted = new WeeklyLeaderboardRepository(pool);
    const load = async () => ({ description: "35 points cumulés", fields: [] });
    await expect(first.deliverOnce("guild-1", "2026-09-07", load, async () => {
      throw new Error("Discord indisponible");
    })).rejects.toThrow("Discord indisponible");
    let sends = 0;
    const noReload = async (): Promise<never> => { throw new Error("Snapshot must survive restart"); };
    const send = async (embed: { description?: string }) => {
      expect(embed.description).toBe("35 points cumulés");
      sends += 1;
      return "leaderboard-message";
    };
    const results = await Promise.all([
      first.deliverOnce("guild-1", "2026-09-07", noReload, send),
      restarted.deliverOnce("guild-1", "2026-09-07", noReload, send),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(sends).toBe(1);
    expect(await restarted.deliverOnce("guild-1", "2026-09-07", noReload, send)).toBe(false);
    expect(await restarted.deliverOnce("guild-1", "2026-09-14", load, send)).toBe(true);
    expect(sends).toBe(2);
    // A leaderboard delivery must not suppress the calendar for the same week.
    expect(await new WeeklyScheduleRepository(pool).deliverOnce("guild-1", "2026-09-07", async () => "calendar-message")).toBe(true);
  });

  it("finds prediction logos across competitions without adding teams to the LCK catalog", async () => {
    await teamCatalog.replaceSeason(2026, [{ key: "t1", name: "T1", logoUrl: "https://example.com/t1" }]);
    await teamCatalog.saveEmoji("t1", { id: "emoji-t1", name: "t1", logoHash: "hash" });
    await new SubscriptionRepository(pool).saveCompetition({ key: "lec", title: "LEC", overviewPage: "LEC/2026 Season/Summer Season", startsOn: null, endsOn: null, teams: [
      { key: "giantx", name: "GIANTX", logoUrl: "https://example.com/giantx" },
      { key: "t1", name: "T1", logoUrl: "https://example.com/other-t1" },
    ] });
    expect(await teamCatalog.findPredictionTeams(["t1", "giantx", "missing"])).toMatchObject([
      { key: "t1", emojiId: "emoji-t1", logoUrl: "https://example.com/t1" },
      { key: "giantx", logoUrl: "https://example.com/giantx" },
    ]);
    expect((await teamCatalog.listTeams()).map(team => team.key)).toEqual(["t1"]);
  });

  it("persists prediction deliveries independently from reminders across restarts", async () => {
    await guilds.ensureGuild("prediction-guild");
    await matches.upsertMany([match]);
    const now = new Date();
    expect(await deliveries.claim("prediction-guild", match.matchId, "prediction", now)).toBe(true);
    await deliveries.markSent("prediction-guild", match.matchId, "prediction", "embed-1", now);
    expect(await new DeliveryRepository(pool).findSentMessage("prediction-guild", match.matchId, "prediction")).toBe("embed-1");
    expect(await deliveries.findSentMessage("other-guild", match.matchId, "prediction")).toBeNull();
    expect(await new DeliveryRepository(pool).claim("prediction-guild", match.matchId, "prediction", now)).toBe(false);
    expect(await deliveries.claim("prediction-guild", match.matchId, "reminder", now)).toBe(true);
    expect((await guilds.get("prediction-guild"))?.notificationChannelId).toBeNull();
  });

  async function predictionMatch(overrides: Partial<StoredMatch> = {}) {
    const upcoming = { ...match, scheduledAt: new Date(Date.now() + 3_600_000), ...overrides };
    await matches.upsertMany([upcoming]);
    const { rows } = await pool.query<{ id: string }>(
      "SELECT prediction_number::text AS id FROM matches WHERE match_id = $1", [upcoming.matchId],
    );
    return { match: upcoming, id: rows[0]!.id };
  }

  async function completePredictionMatch(fixture: { match: StoredMatch }, team1Score = 3, team2Score = 1) {
    await matches.upsertMany([{
      ...fixture.match, scheduledAt: new Date(Date.now() - 3_600_000),
      winner: team1Score > team2Score ? 1 : 2, team1Score, team2Score,
    }]);
  }

  it("rejects stale embed buttons under the write lock", async () => {
    const fixture = await predictionMatch();
    const revision = predictionRevision(fixture.match);
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1, revision);
    await matches.upsertMany([{ ...fixture.match, team1Name: "Replacement", team1Key: "replacement" }]);
    await expect(predictions.save("guild-1", "user-1", fixture.id, 3, 0, revision)).rejects.toThrow("changé");
    await completePredictionMatch(fixture);
  });

  it("exposes the stable prediction ID on reminder matches", async () => {
    const fixture = await predictionMatch({ scheduledAt: new Date(Date.now() + 600_000) });
    expect((await matches.findReminderDue(new Date()))[0]).toMatchObject({ predictionId: fixture.id });
  });

  it("selects predictions from 72 hours before kickoff until one minute before kickoff", async () => {
    const now = new Date("2026-09-10T12:00:00Z");
    await matches.upsertMany([
      { ...match, matchId: "too-early", scheduledAt: new Date(now.getTime() + 72 * 3_600_000 + 1) },
      { ...match, matchId: "opening", scheduledAt: new Date(now.getTime() + 72 * 3_600_000) },
      { ...match, matchId: "last-vote", scheduledAt: new Date(now.getTime() + 60_001) },
      { ...match, matchId: "closed", scheduledAt: new Date(now.getTime() + 60_000) },
      { ...match, matchId: "started", scheduledAt: now },
      { ...match, matchId: "cancelled", scheduledAt: new Date(now.getTime() + 3_600_000), isNullified: true },
    ]);
    expect((await matches.findPredictionDue(now)).map(row => row.matchId)).toEqual(["last-vote", "opening"]);
  });

  it.each([60_000, 30_000, 73 * 3_600_000])("rejects votes outside the window (%i ms before kickoff)", async remaining => {
    const fixture = await predictionMatch({ scheduledAt: new Date(Date.now() + remaining) });
    await expect(predictions.save("guild-1", "user-1", fixture.id, 3, 1)).rejects.toThrow("fermés");
    expect((await predictions.leaderboard("guild-1", 1)).total).toBe(0);
  });

  it("accepts votes three days before kickoff and prevents edits in the final minute", async () => {
    const fixture = await predictionMatch({ scheduledAt: new Date(Date.now() + 72 * 3_600_000) });
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1);
    await matches.upsertMany([{ ...fixture.match, scheduledAt: new Date(Date.now() + 60_000) }]);
    await expect(predictions.save("guild-1", "user-1", fixture.id, 1, 3)).rejects.toThrow("fermés");
    await completePredictionMatch(fixture);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]?.points).toBe(5);
  });

  it("replaces a prediction and persists it across repository instances without duplicates", async () => {
    const fixture = await predictionMatch();
    await predictions.save("guild-1", "user-1", fixture.id, 3, 0);
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1);
    await completePredictionMatch(fixture);
    const restarted = new PredictionRepository(pool);
    expect(await restarted.leaderboard("guild-1", 1)).toEqual({
      total: 1, entries: [{ rank: 1, userId: "user-1", points: 5, correctWinners: 1, exactScores: 1, settled: 1 }],
    });
    expect(await restarted.leaderboard("guild-1", 1)).toEqual(await predictions.leaderboard("guild-1", 1));
  });

  it("awards winner points and exact BO bonuses, shares tied ranks and isolates guilds", async () => {
    const fixture = await predictionMatch();
    await predictions.save("guild-1", "exact-a", fixture.id, 3, 1);
    await predictions.save("guild-1", "exact-b", fixture.id, 3, 1);
    await predictions.save("guild-1", "winner", fixture.id, 3, 2);
    await predictions.save("guild-1", "wrong", fixture.id, 1, 3);
    await predictions.save("guild-2", "outsider", fixture.id, 3, 1);
    expect((await predictions.leaderboard("guild-1", 1)).entries.every(entry => entry.points === 0)).toBe(true);
    await completePredictionMatch(fixture);
    const board = await predictions.leaderboard("guild-1", 1);
    expect(board.total).toBe(4);
    expect(board.entries.map(entry => [entry.rank, entry.userId, entry.points])).toEqual([
      [1, "exact-a", 5], [1, "exact-b", 5], [3, "winner", 3], [4, "wrong", 0],
    ]);
    expect((await predictions.leaderboard("guild-2", 1)).total).toBe(1);
  });

  it.each([1, 3, 5])("handles either winner in BO%i with no exact-score bonus in BO1", async (bestOf) => {
    const fixture = await predictionMatch({ bestOf });
    const wins = (bestOf + 1) / 2;
    await predictions.save("guild-1", "user-1", fixture.id, 0, wins);
    await completePredictionMatch(fixture, 0, wins);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({
      points: bestOf === 1 ? 3 : 5, correctWinners: 1, exactScores: bestOf === 1 ? 0 : 1,
    });
  });

  it("reflects corrected results and removes points for a nullified match", async () => {
    const fixture = await predictionMatch();
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1);
    await completePredictionMatch(fixture);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]?.points).toBe(5);
    await completePredictionMatch(fixture, 3, 2);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]?.points).toBe(3);
    await matches.upsertMany([{ ...fixture.match, isNullified: true, winner: 1, team1Score: 3, team2Score: 1 }]);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({ points: 0, settled: 0 });
  });

  it.each([{ team1Key: "replacement" }, { bestOf: 3 }])("invalidates predictions when the matchup or format changes: %j", async changes => {
    const fixture = await predictionMatch();
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1);
    await completePredictionMatch({ match: { ...fixture.match, ...changes } });
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({ points: 0, settled: 0 });
  });

  it.each([[0, 0], [2, 1], [3, 3], [4, 0], [-1, 3], [3, 0.5]])("rejects an impossible BO5 score %i-%i", async (a, b) => {
    const fixture = await predictionMatch();
    await expect(predictions.save("guild-1", "user-1", fixture.id, a, b)).rejects.toThrow("Score impossible");
    expect((await predictions.leaderboard("guild-1", 1)).total).toBe(0);
  });

  it.each([
    { scheduledAt: new Date(0) }, { isNullified: true }, { winner: 1 as const },
    { team1Score: 1 }, { team2Name: "TBD", team2Key: "tbd" }, { bestOf: 2 },
  ])("refuses closed or unavailable matches: %j", async overrides => {
    const fixture = await predictionMatch(overrides);
    await expect(predictions.save("guild-1", "user-1", fixture.id, 3, 1)).rejects.toThrow();
  });

  it("rejects late edits without changing the saved prediction", async () => {
    const fixture = await predictionMatch();
    await predictions.save("guild-1", "user-1", fixture.id, 3, 1);
    await completePredictionMatch(fixture);
    await expect(predictions.save("guild-1", "user-1", fixture.id, 1, 3)).rejects.toThrow();
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]?.points).toBe(5);
  });

  it("checks the deadline after waiting for a concurrent match update", async () => {
    const fixture = await predictionMatch();
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      await client.query("UPDATE matches SET scheduled_at = clock_timestamp() + interval '1 minute' WHERE match_id = $1", [fixture.match.matchId]);
      const pending = predictions.save("guild-1", "user-1", fixture.id, 3, 1);
      const assertion = expect(pending).rejects.toThrow();
      await client.query("COMMIT");
      await assertion;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect((await predictions.leaderboard("guild-1", 1)).total).toBe(0);
  });

  it("keeps one prediction during concurrent submissions", async () => {
    const fixture = await predictionMatch();
    await Promise.all(Array.from({ length: 5 }, () => predictions.save("guild-1", "user-1", fixture.id, 3, 1)));
    await completePredictionMatch(fixture);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({ points: 5, settled: 1 });
  });

  it("sums points across matches but waits for a complete and consistent BO result", async () => {
    const first = await predictionMatch();
    const second = await predictionMatch({ matchId: "second", bestOf: 3 });
    await predictions.save("guild-1", "user-1", first.id, 3, 1);
    await predictions.save("guild-1", "user-1", second.id, 2, 1);
    await completePredictionMatch(first);
    await completePredictionMatch(second, 1, 0);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({ points: 5, settled: 1 });
    await completePredictionMatch(second, 2, 0);
    expect((await predictions.leaderboard("guild-1", 1)).entries[0]).toMatchObject({ points: 8, settled: 2 });
  });

  it("recovers only old unfinished predicted matches, grouped by UTC day", async () => {
    const first = await predictionMatch();
    const second = await predictionMatch({ matchId: "second" });
    await predictions.save("guild-1", "user-1", first.id, 3, 1);
    await predictions.save("guild-1", "user-1", second.id, 3, 1);
    await matches.upsertMany([
      { ...first.match, scheduledAt: new Date("2026-08-02T23:30:00Z") },
      { ...second.match, scheduledAt: new Date("2026-08-02T01:00:00Z") },
      { ...first.match, matchId: "unpredicted", scheduledAt: new Date("2026-08-01T10:00:00Z") },
    ]);
    expect(await predictions.listPendingResultDays(new Date("2026-08-05T12:00:00Z"))).toEqual([new Date("2026-08-02T00:00:00Z")]);
    await matches.upsertMany([
      { ...first.match, scheduledAt: new Date("2026-08-02T23:30:00Z"), winner: 1, team1Score: 3, team2Score: 1 },
      { ...second.match, scheduledAt: new Date("2026-08-02T01:00:00Z"), isNullified: true },
    ]);
    expect(await predictions.listPendingResultDays(new Date("2026-08-05T12:00:00Z"))).toEqual([]);
  });

  it("paginates the leaderboard", async () => {
    const fixture = await predictionMatch({ matchId: "a".repeat(200) });
    for (let i = 0; i < 12; i++) await predictions.save("guild-1", `user-${String(i).padStart(2, "0")}`, fixture.id, 3, 1);
    await completePredictionMatch(fixture);
    expect((await predictions.leaderboard("guild-1", 1)).entries).toHaveLength(10);
    expect(await predictions.leaderboard("guild-1", 2)).toMatchObject({
      total: 12, entries: [{ rank: 1, userId: "user-10" }, { rank: 1, userId: "user-11" }],
    });
    expect(await predictions.leaderboard("guild-1", 3)).toEqual({ total: 12, entries: [] });
  });



  it("persists weekly deliveries across workers and retries a failed send", async () => {
    await guilds.setNotificationChannel("guild-1", "channel-1");
    const first = new WeeklyScheduleRepository(pool);
    const restarted = new WeeklyScheduleRepository(pool);
    await expect(first.deliverOnce("guild-1", "2026-09-07", async () => {
      throw new Error("Discord indisponible");
    })).rejects.toThrow("Discord indisponible");
    let sends = 0;
    const send = async () => { sends += 1; return "weekly-message"; };
    expect(await first.deliverOnce("guild-1", "2026-09-07", send)).toBe(true);
    expect(await restarted.deliverOnce("guild-1", "2026-09-07", send)).toBe(false);
    expect(sends).toBe(1);
    expect(await restarted.deliverOnce("guild-1", "2026-09-14", send)).toBe(true);
  });

  it("resumes the frozen calendar after a partial send and restart", async () => {
    await guilds.setNotificationChannel("guild-1", "channel-1");
    const first = new WeeklyScheduleRepository(pool);
    const pages = buildScheduleEmbeds(Array.from({ length: 100 }, (_, index) => ({
      id: String(index), team1: `Team-${index}-A`, team2: `Team-${index}-B`,
      startsAt: new Date("2026-09-07T12:00:00Z"), bestOf: 3, tournament: "LEC/2026 Season",
    })), "cette semaine");
    expect(pages.length).toBeGreaterThan(1);
    const published: number[] = [];
    await expect(first.deliverScheduleOnce("guild-1", "2026-09-07", async () => pages, async (_page, index) => {
      if (index === 1) throw new Error("Discord indisponible");
      published.push(index);
      return `page-${index}`;
    })).rejects.toThrow("Discord indisponible");
    const restarted = new WeeklyScheduleRepository(pool);
    const mustNotReload = async () => { throw new Error("The original snapshot must be reused"); };
    expect(await restarted.deliverScheduleOnce("guild-1", "2026-09-07", mustNotReload, async (page, index) => {
      expect(page).toEqual(pages[index]);
      published.push(index);
      return `page-${index}`;
    })).toBe(true);
    expect(published).toEqual(pages.map((_, index) => index));
    expect(await restarted.deliverScheduleOnce("guild-1", "2026-09-07", mustNotReload, async () => {
      throw new Error("No duplicate expected");
    })).toBe(false);
  });

  it("prevents two workers from sending the same week concurrently", async () => {
    await guilds.setNotificationChannel("guild-1", "channel-1");
    const first = new WeeklyScheduleRepository(pool);
    const second = new WeeklyScheduleRepository(pool);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const pending = first.deliverOnce("guild-1", "2026-09-07", async () => {
      enter();
      await released;
      return "weekly-message";
    });
    await entered;
    try {
      expect(await second.deliverOnce("guild-1", "2026-09-07", async () => {
        throw new Error("A duplicate must not be sent");
      })).toBe(false);
    } finally {
      release();
      await pending;
    }
  });

  const match: StoredMatch = {
    matchId: "match-1",
    team1Key: "t1",
    team1Name: "T1",
    team2Key: "gen-g",
    team2Name: "Gen.G",
    scheduledAt: new Date("2026-09-05T08:00:00.000Z"),
    bestOf: 5,
    overviewPage: "LCK/2026 Season/Playoffs",
    isNullified: false,
    winner: null,
    team1Score: null,
    team2Score: null,
  };

  beforeAll(async () => {
    await runMigrations(pool, resolve("migrations"));
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE notification_deliveries, team_roles, matches, guild_configs, incident_counters, lck_teams, subscription_competitions CASCADE",
    );
  });

  afterAll(async () => {
    await closePool(pool);
  });

  it("is repeatable and enforces one delivery per guild, match and kind", async () => {
    await runMigrations(pool, resolve("migrations"));
    await pool.query("INSERT INTO guild_configs(guild_id) VALUES($1)", ["guild-1"]);
    await pool.query(
      `INSERT INTO matches(
        match_id, team1_key, team1_name, team2_key, team2_name,
        scheduled_at, best_of, overview_page
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        "match-1",
        "t1",
        "T1",
        "gen-g",
        "Gen.G",
        new Date("2026-09-05T08:00:00.000Z"),
        5,
        "LCK/2026 Season/Playoffs",
      ],
    );
    await pool.query(
      `INSERT INTO notification_deliveries(guild_id, match_id, kind, status)
       VALUES($1,$2,$3,$4)`,
      ["guild-1", "match-1", "reminder", "pending"],
    );

    await expect(
      pool.query(
        `INSERT INTO notification_deliveries(guild_id, match_id, kind, status)
         VALUES($1,$2,$3,$4)`,
        ["guild-1", "match-1", "reminder", "pending"],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("stores isolated guild channels and team role mappings", async () => {
    await guilds.setNotificationChannel("guild-1", "channel-notifications");
    await guilds.setSubscriptionPanel("guild-1", "channel-subscriptions", "message-1");
    await roles.upsert({
      guildId: "guild-1",
      teamKey: "t1",
      teamName: "T1",
      roleId: "role-1",
    });

    expect(await guilds.get("guild-1")).toEqual({
      guildId: "guild-1",
      notificationChannelId: "channel-notifications",
      subscriptionChannelId: "channel-subscriptions",
      subscriptionMessageId: "message-1",
    });
    expect(await roles.find("guild-1", "t1")).toEqual({
      guildId: "guild-1",
      teamKey: "t1",
      teamName: "T1",
      roleId: "role-1",
    });
    expect(await roles.findForTeams("guild-2", ["t1"])).toEqual([]);
  });

  it("routes calendars to a dedicated channel while retaining notification destinations", async () => {
    await guilds.setNotificationChannel("guild-1", "notifications");
    await guilds.setNotificationChannel("guild-2", "fallback");
    await guilds.setCalendarChannel("guild-1", "1545159453664350369");
    await guilds.setCalendarChannel("guild-3", "calendar-only");

    expect((await guilds.listCalendarChannels()).sort((a, b) => a.guildId.localeCompare(b.guildId))).toEqual([
      { guildId: "guild-1", channelId: "1545159453664350369" },
      { guildId: "guild-2", channelId: "fallback" },
      { guildId: "guild-3", channelId: "calendar-only" },
    ]);
    expect((await guilds.get("guild-1"))?.notificationChannelId).toBe("notifications");
    expect((await guilds.listWithNotificationChannel()).map(guild => guild.guildId).sort()).toEqual(["guild-1", "guild-2"]);
  });

  it("persists scoped panels across restarts and removes only the expired tournament panel", async () => {
    await guilds.setSubscriptionPanel("guild-1", "subscriptions", "lck-panel");
    const store = new SubscriptionRepository(pool);
    const worlds = { key: "worlds-2026", title: "Worlds 2026", overviewPage: "2026 Season World Championship", startsOn: "2026-10-15", endsOn: "2026-11-14", teams: [{ key: "t1", name: "T1" }] };
    await store.saveCompetition(worlds);
    await store.saveCompetition({ ...worlds, key: "lec", title: "LEC", overviewPage: "LEC/2026 Season/Summer Season" });
    let sent = 0;
    const deleted: string[] = [];
    const gateway = {
      ensureUsableTextChannel: async () => undefined,
      sendMessage: async () => `panel-${++sent}`,
      editMessage: async () => true,
      deleteMessage: async (_channel: string, message: string) => { deleted.push(message); },
    };
    const service = new CompetitionPanelService(store, guilds, gateway, { toggle: async () => ({ action: "added", roleId: "role" }) });
    await service.refresh(new Date("2026-10-04T21:59:59Z"));
    expect((await store.listPanels("guild-1")).map(panel => panel.scopeKey)).toEqual(["lec"]);
    await service.refresh(new Date("2026-10-04T22:00:00Z"));
    const restarted = new CompetitionPanelService(new SubscriptionRepository(pool), guilds, gateway, { toggle: async () => ({ action: "added", roleId: "role" }) });
    await restarted.refresh(new Date("2026-10-05T12:00:00Z"));
    expect(sent).toBe(2);
    await restarted.refresh(new Date("2026-11-15T12:00:00Z"));
    expect(deleted).toEqual(["panel-2"]);
    expect((await store.listPanels("guild-1")).map(panel => panel.scopeKey)).toEqual(["lec"]);
    expect((await guilds.get("guild-1"))?.subscriptionMessageId).toBe("lck-panel");
  });

  it("keeps known participants when a roster temporarily disappears and updates the tournament dates", async () => {
    const store = new SubscriptionRepository(pool);
    const worlds = { key: "worlds-2026", title: "Worlds 2026", overviewPage: "2026 Season World Championship", startsOn: "2026-10-15", endsOn: "2026-11-14", teams: [{ key: "t1", name: "T1" }] };
    await store.saveCompetition(worlds);
    await store.saveCompetition({ ...worlds, startsOn: "2026-10-30", teams: [] });
    expect(await store.listCompetitions()).toEqual([{ ...worlds, startsOn: "2026-10-30" }]);
  });

  it("upserts matches and finds only reminders that are due", async () => {
    await matches.upsertMany([
      match,
      {
        ...match,
        matchId: "match-later",
        team1Key: "dplus-kia",
        team1Name: "Dplus KIA",
        scheduledAt: new Date("2026-09-05T09:00:01.000Z"),
      },
    ]);

    expect(await matches.findReminderDue(new Date("2026-09-05T07:30:00.000Z"))).toEqual([
      { ...match, predictionId: expect.any(String) },
    ]);
    expect(await matches.listTeams()).toEqual([
      { key: "dplus-kia", name: "Dplus KIA" },
      { key: "gen-g", name: "Gen.G" },
      { key: "t1", name: "T1" },
    ]);
  });

  it("claims one delivery and retries failures only after their delay", async () => {
    const now = new Date("2026-09-05T07:30:00.000Z");
    await guilds.setNotificationChannel("guild-1", "channel-notifications");
    await matches.upsertMany([match]);

    expect(await deliveries.claim("guild-1", "match-1", "reminder", now)).toBe(true);
    expect(await deliveries.claim("guild-1", "match-1", "reminder", now)).toBe(false);

    await deliveries.markFailed(
      "guild-1",
      "match-1",
      "reminder",
      "Discord indisponible",
      now,
    );
    expect(await deliveries.claim("guild-1", "match-1", "reminder", now)).toBe(false);
    expect(
      await deliveries.claim(
        "guild-1",
        "match-1",
        "reminder",
        new Date("2026-09-05T07:31:01.000Z"),
      ),
    ).toBe(true);

    await deliveries.markSent(
      "guild-1",
      "match-1",
      "reminder",
      "discord-message-1",
      now,
    );
    expect(
      await deliveries.claim(
        "guild-1",
        "match-1",
        "reminder",
        new Date("2026-09-05T08:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("increments and aggregates public incident counters atomically", async () => {
    expect(await counters.increment("drooler", "spring", 2026, "T1")).toBe(1);
    expect(await counters.increment("drooler", "spring", 2026, "T1")).toBe(2);
    expect(await counters.increment("drooler", "spring", 2026, "Gen.G")).toBe(1);
    expect(await counters.increment("drooler", "summer", 2026, null)).toBe(1);
    expect(await counters.increment("hans", "spring", 2026, "T1")).toBe(1);

    expect(await counters.getTotal("drooler", { year: 2026 })).toBe(4);
    expect(await counters.getTotal("drooler", { year: 2026, split: "spring" })).toBe(3);
    expect(
      await counters.getTotal("drooler", { year: 2026, split: "spring", team: "T1" }),
    ).toBe(2);
    expect(await counters.getTotal("hans", { year: 2026 })).toBe(1);
    expect(await counters.listSplits("drooler", "spr")).toEqual(["spring"]);
    expect(await counters.listTeams("drooler", "gen")).toEqual(["Gen.G"]);
  });

  it("replaces one season catalog and exposes its teams to Drooler autocomplete", async () => {
    await teamCatalog.replaceSeason(2025, [{ key: "old-team", name: "Old Team" }]);
    await teamCatalog.replaceSeason(2026, [
      { key: "t1", name: "T1" },
      { key: "gen-g", name: "Gen.G" },
      { key: "kiwoom-drx", name: "Kiwoom DRX" },
    ]);
    await teamCatalog.replaceSeason(2026, [
      { key: "t1", name: "T1" },
      { key: "gen-g", name: "Gen.G" },
    ]);

    expect(await teamCatalog.listTeams()).toEqual([
      {
        key: "gen-g",
        name: "Gen.G",
        logoUrl: null,
        logoHash: null,
        emojiId: null,
        emojiName: null,
      },
      {
        key: "t1",
        name: "T1",
        logoUrl: null,
        logoHash: null,
        emojiId: null,
        emojiName: null,
      },
    ]);
    expect(await counters.listTeams("drooler", "")).toEqual(["Gen.G", "T1"]);
  });

  it("persists team logo metadata while refreshing the season catalog", async () => {
    await teamCatalog.replaceSeason(2026, [
      { key: "t1", name: "T1", logoUrl: "https://example.test/t1-v1.png" },
      { key: "gen-g", name: "Gen.G", logoUrl: "https://example.test/geng.png" },
    ]);
    await teamCatalog.saveEmoji("t1", {
      id: "emoji-1",
      name: "lck_t1_deadbeef",
      logoHash: "deadbeef",
    });
    await teamCatalog.replaceSeason(2026, [
      { key: "t1", name: "T1", logoUrl: "https://example.test/t1-v2.png" },
    ]);

    expect(await teamCatalog.findTeams(["t1", "gen-g"])).toEqual([
      {
        key: "t1",
        name: "T1",
        logoUrl: "https://example.test/t1-v2.png",
        logoHash: "deadbeef",
        emojiId: "emoji-1",
        emojiName: "lck_t1_deadbeef",
      },
    ]);
  });
});
