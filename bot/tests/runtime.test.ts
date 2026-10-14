import { describe, expect, it } from "vitest";

import {
  startRuntimeServices,
  type RuntimeClient,
  type RuntimeLogger,
  type RuntimeScheduler,
  type RuntimeTask,
} from "../src/bot/runtime.js";

class FakeClient implements RuntimeClient {
  readonly loginTokens: string[] = [];
  destroyCalls = 0;

  async login(token: string): Promise<void> {
    this.loginTokens.push(token);
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

class FakeTask implements RuntimeTask {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeScheduler implements RuntimeScheduler {
  readonly tasks: Array<{ expression: string; task: FakeTask; callback: () => void | Promise<void> }> = [];

  schedule(expression: string, callback: () => void | Promise<void>): RuntimeTask {
    const task = new FakeTask();
    this.tasks.push({ expression, task, callback });
    return task;
  }
}

describe("bot runtime services", () => {
  it("runs the LEC calendar even when the LCK calendar fails", async () => {
    const scheduler = new FakeScheduler();
    const calls: string[] = [];
    const runtime = await startRuntimeServices({
      token: "token", client: new FakeClient(), scheduler,
      sync: async () => undefined, syncTeams: async () => undefined,
      sendReminders: async () => undefined, sendResults: async () => undefined,
      syncSubscriptions: async () => undefined,
      sendWeeklySchedule: async () => { calls.push("LCK"); throw new Error("Webhook LCK indisponible"); },
      sendWeeklyLecSchedule: async () => { calls.push("LEC"); },
      logger: { info: () => undefined, error: () => undefined },
    });
    expect(calls).toEqual(["LCK", "LEC"]);
    expect(scheduler.tasks.at(-1)?.expression).toBe("* * * * *");
    await scheduler.tasks.at(-1)!.callback();
    expect(calls).toEqual(["LCK", "LEC", "LEC"]);
    await runtime.stop();
    expect(scheduler.tasks.every(entry => entry.task.stopped)).toBe(true);
  });
  it("checks the weekly prediction summary at startup and every minute", async () => {
    const scheduler = new FakeScheduler();
    const calls: string[] = [];
    const runtime = await startRuntimeServices({
      token: "token", client: new FakeClient(), scheduler,
      sync: async () => { calls.push("sync"); }, syncTeams: async () => undefined,
      sendReminders: async () => undefined, sendResults: async () => undefined,
      sendWeeklySchedule: async () => undefined, syncSubscriptions: async () => undefined,
      sendWeeklyLeaderboard: async () => { calls.push("leaderboard"); },
    });
    expect(calls).toEqual(["sync", "leaderboard"]);
    expect(scheduler.tasks.at(-1)?.expression).toBe("* * * * *");
    await scheduler.tasks.at(-1)!.callback();
    expect(calls).toEqual(["sync", "leaderboard", "leaderboard"]);
    await runtime.stop();
    expect(scheduler.tasks.every(entry => entry.task.stopped)).toBe(true);
  });

  it("publishes prediction embeds at startup and every minute independently of reminders", async () => {
    const scheduler = new FakeScheduler();
    const calls: string[] = [];
    const runtime = await startRuntimeServices({
      token: "token", client: new FakeClient(), scheduler,
      sync: async () => { calls.push("sync"); }, syncTeams: async () => undefined,
      sendReminders: async () => { calls.push("reminders"); }, sendResults: async () => undefined,
      sendWeeklySchedule: async () => undefined, syncSubscriptions: async () => undefined,
      sendPredictions: async () => { calls.push("predictions"); },
    });
    expect(calls).toEqual(["sync", "predictions"]);
    expect(scheduler.tasks.at(-1)?.expression).toBe("* * * * *");
    await scheduler.tasks.at(-1)!.callback();
    expect(calls).toEqual(["sync", "predictions", "predictions"]);
    await runtime.stop();
    expect(scheduler.tasks.every(entry => entry.task.stopped)).toBe(true);
  });

  it("logs in, performs an initial sync and starts all worker schedules", async () => {
    const client = new FakeClient();
    const scheduler = new FakeScheduler();
    let syncCalls = 0;
    let teamSyncCalls = 0;
    let weeklyCalls = 0;
    let subscriptionCalls = 0;

    const runtime = await startRuntimeServices({
      token: "discord-token",
      client,
      scheduler,
      sync: async () => {
        syncCalls += 1;
      },
      syncTeams: async () => {
        teamSyncCalls += 1;
      },
      sendReminders: async () => undefined,
      sendResults: async () => undefined,
      sendWeeklySchedule: async () => { weeklyCalls += 1; },
      syncSubscriptions: async () => { subscriptionCalls += 1; },
    });

    expect(client.loginTokens).toEqual(["discord-token"]);
    expect(syncCalls).toBe(1);
    expect(teamSyncCalls).toBe(1);
    expect(weeklyCalls).toBe(1);
    expect(subscriptionCalls).toBe(1);
    expect(scheduler.tasks.map((entry) => entry.expression)).toEqual([
      "*/15 * * * *",
      "0 4 * * *",
      "* * * * *",
      "*/5 * * * *",
      "* * * * *",
      "* * * * *",
    ]);

    await runtime.stop();
    await runtime.stop();
    expect(scheduler.tasks.every((entry) => entry.task.stopped)).toBe(true);
    expect(client.destroyCalls).toBe(1);
  });

  it("keeps running when the initial Leaguepedia sync fails", async () => {
    const client = new FakeClient();
    const errors: unknown[] = [];
    const logger: RuntimeLogger = {
      info: () => undefined,
      error: (_message, error) => errors.push(error),
    };

    const runtime = await startRuntimeServices({
      token: "discord-token",
      client,
      scheduler: new FakeScheduler(),
      sync: async () => {
        throw new Error("Leaguepedia indisponible");
      },
      syncTeams: async () => undefined,
      sendReminders: async () => undefined,
      sendResults: async () => undefined,
      sendWeeklySchedule: async () => undefined,
      syncSubscriptions: async () => undefined,
      logger,
    });

    expect(client.loginTokens).toEqual(["discord-token"]);
    expect(errors).toHaveLength(1);
    await runtime.stop();
  });
});
