// tests/auto-link-baseline.test.js
import { describe, it, expect } from "vitest";
import { setBaseline, getBaseline, clearBaseline } from "../scripts/logic/auto-link-baseline.mjs";

describe("auto-link baseline store", () => {
  it("stores and retrieves per uuid+field", () => {
    setBaseline("p1", "system.description", "<p>hi</p>");
    expect(getBaseline("p1", "system.description")).toBe("<p>hi</p>");
    expect(getBaseline("p1", "system.gmNotes")).toBeUndefined();
  });

  it("clears an entry", () => {
    setBaseline("p2", "text.content", "x");
    clearBaseline("p2", "text.content");
    expect(getBaseline("p2", "text.content")).toBeUndefined();
  });
});
