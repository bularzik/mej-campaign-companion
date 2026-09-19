// test/shell-shim-logic.test.js
import { describe, it, expect } from "vitest";
import { shellPageId, withCompanionTypes, isShellPageId } from "../scripts/logic/shell-shim-logic.mjs";

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
