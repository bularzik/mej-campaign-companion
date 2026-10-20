import { describe, it, expect } from "vitest";
import { sessionData } from "../scripts/sheets/session-data.mjs";

describe("sessionData", () => {
  const page = (flag) => ({ getFlag: (scope, key) => (key === "session" ? flag : undefined) });
  it("fills defaults for a bare page", () => {
    expect(sessionData(page(undefined))).toEqual({
      sessionNumber: null, campaignDate: null, attendees: [], secrets: [], startedAt: null, endedAt: null
    });
  });
  it("defaults startedAt and endedAt to null", () => {
    const d = sessionData(page(undefined));
    expect(d.startedAt).toBeNull();
    expect(d.endedAt).toBeNull();
  });
  it("preserves stored values and fills gaps", () => {
    const d = sessionData(page({ sessionNumber: 12 }));
    expect(d.sessionNumber).toBe(12);
    expect(d.secrets).toEqual([]);
  });
});
