import cron from "node-cron";
import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { resolve } from "node:path";

import type { BotConfig } from "../config.js";
import { LEADERBOARD_CHANNEL_ID, PREDICTION_CHANNEL_ID } from "../config.js";
import { PredictionWorker } from "./prediction-worker.js";
import { PredictionTeamAssets } from "./prediction-team-assets.js";
import { closePool, createPool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { DeliveryRepository } from "../db/delivery-repository.js";
import { CounterRepository } from "../db/counter-repository.js";
import { GuildConfigRepository } from "../db/guild-config-repository.js";
import { MatchRepository } from "../db/match-repository.js";
import { PredictionRepository } from "../db/prediction-repository.js";
import { TeamCatalogRepository } from "../db/team-catalog-repository.js";
import { TeamRoleRepository } from "../db/team-role-repository.js";
import { fetchLeaguepediaMatchStates, fetchLeaguepediaTeams } from "../leaguepedia.js";
import { fetchLeaguepediaMatches } from "../leaguepedia.js";
import { ScheduleService } from "../schedule-service.js";
import { PARIS_TIME_ZONE } from "../week.js";
import { DiscordAdapter } from "./discord-adapter.js";
import { handleInteraction } from "./interactions.js";
import { MatchSync } from "./match-sync.js";
import { NotificationWorker } from "./notification-worker.js";
import { PanelService } from "./panel-service.js";
import { RoleService } from "./role-service.js";
import { TeamCatalogSync } from "./team-catalog-sync.js";
import { TeamEmojiSync } from "./team-emoji-sync.js";
import { WeeklyScheduleWorker } from "./weekly-schedule-worker.js";
import { CalendarWebhook } from "./calendar-webhook.js";
import { WeeklyScheduleRepository } from "../db/weekly-schedule-repository.js";
import { WeeklyLeaderboardRepository } from "../db/weekly-leaderboard-repository.js";
import { WeeklyLeaderboardWorker } from "./weekly-leaderboard-worker.js";
import { SubscriptionRepository } from "../db/subscription-repository.js";
import { fetchSubscriptionCompetitions } from "../subscription-source.js";
import { SubscriptionSync } from "./subscription-sync.js";
import { CompetitionPanelService } from "./competition-panel-service.js";

export interface RuntimeClient {
  login(token: string): Promise<unknown>;
  destroy(): void;
}

export interface RuntimeTask {
  stop(): void;
}

export interface RuntimeScheduler {
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options: { name: string; noOverlap: boolean; timezone?: string },
  ): RuntimeTask;
}

export interface RuntimeLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface RuntimeServicesOptions {
  token: string;
  client: RuntimeClient;
  scheduler?: RuntimeScheduler;
  sync(): Promise<unknown>;
  syncTeams(): Promise<unknown>;
  sendReminders(): Promise<unknown>;
  sendResults(): Promise<unknown>;
  sendPredictions?(): Promise<unknown>;
  sendWeeklySchedule(): Promise<unknown>;
  sendWeeklyLecSchedule?(): Promise<unknown>;
  sendWeeklyLeaderboard?(): Promise<unknown>;
  syncSubscriptions(): Promise<unknown>;
  logger?: RuntimeLogger;
}

const defaultScheduler: RuntimeScheduler = {
  schedule: (expression, callback, options) => cron.schedule(expression, callback, options),
};

const defaultLogger: RuntimeLogger = {
  info: (message) => console.log(message),
  error: (message, error) => console.error(message, error),
};

export async function startRuntimeServices(
  options: RuntimeServicesOptions,
): Promise<{ stop(): Promise<void> }> {
  const scheduler = options.scheduler ?? defaultScheduler;
  const logger = options.logger ?? defaultLogger;

  const guarded = async (name: string, operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      logger.error(`Échec de la tâche ${name} :`, error);
    }
  };

  await options.client.login(options.token);
  await guarded("match-sync", options.sync);
  await guarded("team-catalog-sync", options.syncTeams);
  await guarded("subscription-panels", options.syncSubscriptions);
  await guarded("weekly-schedule", options.sendWeeklySchedule);
  if (options.sendWeeklyLecSchedule) await guarded("weekly-lec-schedule", options.sendWeeklyLecSchedule);
  if (options.sendPredictions) await guarded("predictions", options.sendPredictions);
  if (options.sendWeeklyLeaderboard) await guarded("weekly-leaderboard", options.sendWeeklyLeaderboard);

  const tasks = [
    scheduler.schedule("*/15 * * * *", () => guarded("match-sync", options.sync), {
      name: "lck-match-sync",
      noOverlap: true,
    }),
    scheduler.schedule("0 4 * * *", () => guarded("team-catalog-sync", options.syncTeams), {
      name: "lck-team-catalog-sync",
      noOverlap: true,
    }),
    scheduler.schedule("* * * * *", () => guarded("reminders", options.sendReminders), {
      name: "lck-reminders",
      noOverlap: true,
    }),
    scheduler.schedule("*/5 * * * *", () => guarded("results", options.sendResults), {
      name: "lck-results",
      noOverlap: true,
    }),
    scheduler.schedule(
      "* * * * *",
      () => guarded("weekly-schedule", options.sendWeeklySchedule),
      {
        name: "lck-weekly-schedule",
        noOverlap: true,
        timezone: PARIS_TIME_ZONE,
      },
    ),
    scheduler.schedule("* * * * *", () => guarded("subscription-panels", options.syncSubscriptions), {
      name: "competition-subscription-panels",
      noOverlap: true,
      timezone: PARIS_TIME_ZONE,
    }),
  ];
  if (options.sendPredictions) {
    tasks.push(scheduler.schedule("* * * * *", () => guarded("predictions", options.sendPredictions!), {
      name: "match-predictions", noOverlap: true,
    }));
  }
  if (options.sendWeeklyLeaderboard) {
    tasks.push(scheduler.schedule("* * * * *", () => guarded("weekly-leaderboard", options.sendWeeklyLeaderboard!), {
      name: "weekly-prediction-leaderboard", noOverlap: true, timezone: PARIS_TIME_ZONE,
    }));
  }
  if (options.sendWeeklyLecSchedule) {
    tasks.push(scheduler.schedule("* * * * *", () => guarded("weekly-lec-schedule", options.sendWeeklyLecSchedule!), {
      name: "lec-weekly-schedule", noOverlap: true, timezone: PARIS_TIME_ZONE,
    }));
  }
  logger.info("Bot Discord prêt.");

  let stopped = false;
  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      for (const task of tasks) task.stop();
      options.client.destroy();
    },
  };
}

async function reportInteractionError(interaction: Interaction, error: unknown): Promise<void> {
  console.error("Échec d'une interaction Discord :", error);
  if (!interaction.isRepliable()) return;

  const content = "Une erreur est survenue. Vérifie les permissions du bot puis réessaie.";
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content }).catch(() => undefined);
  } else {
    await interaction
      .reply({ content, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }
}

export async function startBotRuntime(config: BotConfig): Promise<{ stop(): Promise<void> }> {
  const pool = createPool(config.databaseUrl);
  try {
    await runMigrations(pool, resolve(process.cwd(), "migrations"));

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const guildConfigs = new GuildConfigRepository(pool);
    const teamRoles = new TeamRoleRepository(pool);
    const matches = new MatchRepository(pool);
    const teamCatalog = new TeamCatalogRepository(pool);
    const deliveries = new DeliveryRepository(pool);
    const counters = new CounterRepository(pool);
    const predictions = new PredictionRepository(pool);
    const discord = new DiscordAdapter(client);
    const predictionTeamAssets = new PredictionTeamAssets({ findTeams: keys => teamCatalog.findPredictionTeams(keys) }, discord);
    const predictionWorker = new PredictionWorker(matches, deliveries, discord, async () => {
      const channel = await client.channels.fetch(PREDICTION_CHANNEL_ID);
      if (!channel?.isSendable() || !("guildId" in channel)) {
        throw new Error(`Salon de pronostics inaccessible : ${PREDICTION_CHANNEL_ID}`);
      }
      await guildConfigs.ensureGuild(channel.guildId);
      return { guildId: channel.guildId, channelId: PREDICTION_CHANNEL_ID };
    }, predictionTeamAssets);
    const weeklyLeaderboard = new WeeklyLeaderboardWorker(
      predictions, new WeeklyLeaderboardRepository(pool), discord, async () => {
        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel?.isSendable() || !("guildId" in channel)) {
          throw new Error(`Salon de classement inaccessible : ${LEADERBOARD_CHANNEL_ID}`);
        }
        await guildConfigs.ensureGuild(channel.guildId);
        return channel.guildId;
      },
    );
    const panels = new PanelService(guildConfigs, discord);
    const roles = new RoleService(teamRoles, discord);
    const subscriptionStore = new SubscriptionRepository(pool);
    const subscriptionSync = new SubscriptionSync(fetchSubscriptionCompetitions, subscriptionStore);
    const competitionPanels = new CompetitionPanelService(subscriptionStore, guildConfigs, discord, roles);
    const matchSync = new MatchSync(fetchLeaguepediaMatchStates, matches, predictions);
    const teamCatalogSync = new TeamCatalogSync(fetchLeaguepediaTeams, teamCatalog);
    const teamEmojiSync = new TeamEmojiSync(teamCatalog, discord);
    const worker = new NotificationWorker(
      matches,
      guildConfigs,
      teamRoles,
      deliveries,
      discord,
      (now) => matchSync.refreshResults(now),
      teamCatalog,
    );
    const calendarSchedule = new ScheduleService(fetchLeaguepediaMatches);
    const calendarWebhook = new CalendarWebhook(config.webhookUrl, guildConfigs);
    const weeklySchedule = new WeeklyScheduleWorker(
      calendarSchedule,
      calendarWebhook,
      teamCatalog,
      calendarWebhook,
      new WeeklyScheduleRepository(pool),
    );
    const lecCalendarWebhook = config.lecWebhookUrl ? new CalendarWebhook(config.lecWebhookUrl, guildConfigs) : undefined;
    const weeklyLecSchedule = lecCalendarWebhook ? new WeeklyScheduleWorker(
      calendarSchedule, lecCalendarWebhook, teamCatalog, lecCalendarWebhook,
      new WeeklyScheduleRepository(pool, "LEC"), "LEC",
    ) : undefined;

    const syncTeamAssets = async (now: Date): Promise<void> => {
      let catalogError: unknown;
      try {
        await teamCatalogSync.sync(now);
      } catch (error) {
        catalogError = error;
      }
      await teamEmojiSync.sync();
      predictionTeamAssets.invalidate();
      await panels.refreshConfiguredPanels(await teamCatalog.listTeams());
      if (catalogError) throw catalogError;
    };

    client.on(Events.InteractionCreate, (interaction) => {
      void handleInteraction(interaction, {
        config: { guildConfigs, matchCatalog: teamCatalog, panels },
        matchCatalog: teamCatalog,
        roles,
        counters,
        predictions,
        predictionTeamAssets,
        subscriptions: competitionPanels,
      }).catch((error: unknown) => reportInteractionError(interaction, error));
    });

    const services = await startRuntimeServices({
      token: config.discordToken,
      client,
      sync: () => matchSync.sync(new Date()),
      syncTeams: () => syncTeamAssets(new Date()),
      sendReminders: () => worker.sendDueReminders(new Date()),
      sendPredictions: () => predictionWorker.publish(new Date()),
      sendWeeklyLeaderboard: () => weeklyLeaderboard.publish(new Date()),
      sendResults: () => worker.refreshAndSendResults(new Date()),
      syncSubscriptions: async () => {
        const now = new Date();
        let sourceError: unknown;
        try {
          await subscriptionSync.sync(now);
        } catch (error) { sourceError = error; }
        // Cached dates still control J-10/expiry while Leaguepedia is unavailable.
        await competitionPanels.refresh(now);
        if (sourceError) throw sourceError;
      },
      sendWeeklySchedule: async () => {
        const sent = await weeklySchedule.publish(new Date());
        if (sent > 0) console.log(`Planning LCK hebdomadaire publié dans ${sent} salon(s).`);
      },
      sendWeeklyLecSchedule: weeklyLecSchedule ? async () => {
        const sent = await weeklyLecSchedule.publish(new Date());
        if (sent > 0) console.log(`Planning LEC hebdomadaire publié dans ${sent} salon(s).`);
      } : undefined,
    });

    let stopped = false;
    return {
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        await services.stop();
        await closePool(pool);
      },
    };
  } catch (error) {
    await closePool(pool);
    throw error;
  }
}
