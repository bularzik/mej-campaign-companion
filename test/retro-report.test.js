// test/retro-report.test.js
import { describe, it, expect } from "vitest";
import { retroFailureMessage, describeError } from "../scripts/logic/retro-report.mjs";

const format = (key, data) => `${key}|${JSON.stringify(data)}`;

describe("describeError", () => {
  it("keeps the first line only and caps the length", () => {
    expect(describeError(new Error("type: \"campaign-record.place\" is not valid\n  at x"))).toBe("type: \"campaign-record.place\" is not valid");
    expect(describeError("x".repeat(500)).length).toBe(160);
    expect(describeError(null)).toBe("unknown error");
  });
});

describe("retroFailureMessage", () => {
  it("names each journal once with its reason", () => {
    const msg = retroFailureMessage([
      { page: "Intro", journal: "Radiant Citadel", reason: "campaign-record.place is not a valid type" },
      { page: "Arc 1", journal: "Radiant Citadel", reason: "campaign-record.place is not a valid type" },
      { page: "Notes", journal: "Other", reason: "boom" }
    ], format);
    expect(msg).toBe('MEJCampaignCompanion.retroLink.writeFailedDetail|{"count":3,"list":"Radiant Citadel (campaign-record.place is not a valid type); Other (boom)"}');
  });
});
