import { describe, it, expect } from "vitest";
import { inheritedOwnership } from "../scripts/logic/campaign-ownership.mjs";

const OBSERVER = 2;

describe("inheritedOwnership", () => {
  it("stamps the campaign baseline when the creation data has no ownership", () => {
    expect(inheritedOwnership({ name: "Eldin", folder: "f1" }, OBSERVER, { isGM: true })).toEqual({ default: OBSERVER });
  });
  it("treats ownership: null as absent", () => {
    expect(inheritedOwnership({ ownership: null }, OBSERVER, { isGM: true })).toEqual({ default: OBSERVER });
  });
  it("never overrides explicit ownership, even an empty record", () => {
    expect(inheritedOwnership({ ownership: { default: 0 } }, OBSERVER, { isGM: true })).toBe(null);
    expect(inheritedOwnership({ ownership: {} }, OBSERVER, { isGM: true })).toBe(null);
  });
  it("does nothing outside a campaign", () => {
    expect(inheritedOwnership({}, null, { isGM: true })).toBe(null);
    expect(inheritedOwnership({}, undefined, { isGM: true })).toBe(null);
  });
  it("does nothing for a non-GM creator", () => {
    expect(inheritedOwnership({}, OBSERVER, { isGM: false })).toBe(null);
  });
  it("stamps a NONE baseline too (GM-only campaigns stay GM-only)", () => {
    expect(inheritedOwnership({}, 0, { isGM: true })).toEqual({ default: 0 });
  });
  it("never lowers a level another hook already granted", () => {
    expect(inheritedOwnership({}, OBSERVER, { isGM: true, currentDefault: 3 })).toBe(null);
  });
  it("stamps the baseline when the pending document is still at Foundry's default", () => {
    expect(inheritedOwnership({}, OBSERVER, { isGM: true, currentDefault: 0 })).toEqual({ default: OBSERVER });
  });
});
