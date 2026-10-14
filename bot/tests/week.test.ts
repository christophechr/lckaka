import { describe, expect, it } from "vitest";

import { getParisWeekRange } from "../src/week.js";

describe("getParisWeekRange", () => {
  it("uses Paris Monday boundaries across the daylight-saving transition", () => {
    const range = getParisWeekRange(new Date("2026-03-26T12:00:00.000Z"));

    expect(range.start.toISOString()).toBe("2026-03-22T23:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(range.label).toBe("du 23 au 29 mars 2026");
  });
});
