// test/contrast.test.js
import { describe, it, expect } from "vitest";
import { parseCssColor, contrastRatio } from "../scripts/logic/contrast.mjs";

describe("parseCssColor", () => {
  it("parses rgb and rgba", () => {
    expect(parseCssColor("rgb(34, 34, 34)")).toEqual({ r: 34, g: 34, b: 34, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
  it("returns null for anything else", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 1);
    expect(contrastRatio("rgb(90, 90, 90)", "rgb(90, 90, 90)")).toBeCloseTo(1, 5);
  });
  it("fails the defect pair and passes the api-mode pair", () => {
    // Observed 2026-09-19: session text inside MEJ's page wrapper on 13.06 (dark scheme).
    expect(contrastRatio("rgb(34, 34, 34)", "rgb(28, 27, 24)")).toBeLessThan(4.5);
    // Observed the same day on Foundry 14 api mode, dark scheme.
    expect(contrastRatio("rgb(221, 221, 221)", "rgb(28, 27, 24)")).toBeGreaterThan(4.5);
  });
});
