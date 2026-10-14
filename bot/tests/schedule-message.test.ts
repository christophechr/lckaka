import { describe, expect, it } from "vitest";

import { createScheduleMessages } from "../src/schedule-message.js";
import { ScheduleService } from "../src/schedule-service.js";

describe("createScheduleMessages", () => {
  it("turns the current Paris week into a Discord embed payload", async () => {
    const service = new ScheduleService(async () => []);

    const [embed] = await createScheduleMessages(
      service,
      new Date("2026-09-03T08:00:00.000Z"),
    );

    expect(embed!.description).toContain("du 31 août au 6 septembre 2026");
    expect(embed!.description).toContain("Aucun match programmé");
    expect(embed!.title).toBe("LCK — Matchs de la semaine");
    expect(embed!.description).not.toContain("LEC");
  });
});
