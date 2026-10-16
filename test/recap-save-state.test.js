import { describe, it, expect } from "vitest";
import { recapClosePlan } from "../scripts/logic/recap-save-state.mjs";

describe("recapClosePlan", () => {
  it("saving when the live text differs from the stored recap", () => {
    expect(recapClosePlan({ live: "<p>new</p>", stored: "<p>old</p>" })).toBe("saving");
    expect(recapClosePlan({ live: "<p>new</p>", stored: undefined })).toBe("saving");
  });
  it("idle when nothing changed or the editor has no value", () => {
    expect(recapClosePlan({ live: "<p>same</p>", stored: "<p>same</p>" })).toBe("idle");
    expect(recapClosePlan({ live: undefined, stored: "<p>x</p>" })).toBe("idle");
  });
});
