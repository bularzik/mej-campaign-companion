// test/shell-shim-logic.test.js
import { describe, it, expect } from "vitest";
import {
  shellPageId, withCompanionTypes, isShellPageId, isCompanionPageType
} from "../scripts/logic/shell-shim-logic.mjs";

describe("shellPageId / isShellPageId", () => {
  it("builds and recognises the shell-page id", () => {
    expect(shellPageId("campaign-hub")).toBe("shellpage:campaign-hub");
    expect(isShellPageId("shellpage:campaign-hub", "campaign-hub")).toBe(true);
    expect(isShellPageId("JournalEntry.abc.JournalEntryPage.def", "campaign-hub")).toBe(false);
    expect(isShellPageId(undefined, "campaign-hub")).toBe(false);
  });
});

describe("withCompanionTypes", () => {
  it("adds the companion types without mutating MEJ's map", () => {
    const mej = { person: "P", place: "L" };
    const merged = withCompanionTypes(mej, { session: "S", "campaign-hub": "H" });
    expect(merged).toEqual({ person: "P", place: "L", session: "S", "campaign-hub": "H" });
    expect(mej).toEqual({ person: "P", place: "L" });
  });
  it("tolerates a missing map", () => {
    expect(withCompanionTypes(undefined, { session: "S" })).toEqual({ session: "S" });
  });
});

describe("isCompanionPageType", () => {
  const ID = "mej-campaign-companion";
  it("recognises every companion page subtype, not just the session one", () => {
    // The regression this exists for: the fixType carve-out named only the
    // session type, so a campaign portal's `type` stayed rewritten to the
    // bare "campaign" key and Foundry's sheet lookup threw (live, 13.06).
    expect(isCompanionPageType(`${ID}.session`, ID)).toBe(true);
    expect(isCompanionPageType(`${ID}.campaign`, ID)).toBe(true);
  });
  it("rejects MEJ's own bare keys, other modules' types and non-strings", () => {
    expect(isCompanionPageType("session", ID)).toBe(false);
    expect(isCompanionPageType("campaign", ID)).toBe(false);
    expect(isCompanionPageType("monks-enhanced-journal.shop", ID)).toBe(false);
    expect(isCompanionPageType("text", ID)).toBe(false);
    expect(isCompanionPageType(undefined, ID)).toBe(false);
    expect(isCompanionPageType(`${ID}.session`, "")).toBe(false);
  });
});
