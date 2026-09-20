import { describe, it, expect } from "vitest";
import { strandedTestFolderIds, autoCaptureNeedsReset } from "../tests/e2e/helpers/sweep-rules.mjs";

describe("strandedTestFolderIds", () => {
  const folders = [
    { id: "f1", type: "JournalEntry", name: "TT-STOCKSMOKE Campaign" },
    { id: "f2", type: "JournalEntry", name: "Radiant Citadel" },
    { id: "f3", type: "Actor", name: "TT-Actors" },
    { id: "f4", type: "JournalEntry", name: "Notes TT-" },
    { id: "f5", type: "JournalEntry", name: null }
  ];

  it("selects only JournalEntry folders whose name starts with the prefix", () => {
    expect(strandedTestFolderIds(folders)).toEqual(["f1"]);
  });

  it("honours a custom prefix", () => {
    expect(strandedTestFolderIds(folders, "Radiant")).toEqual(["f2"]);
  });

  it("returns nothing for an empty world", () => {
    expect(strandedTestFolderIds([])).toEqual([]);
  });
});

describe("autoCaptureNeedsReset", () => {
  const existing = ["f2", "f9"];

  it("is false when the setting is unset", () => {
    expect(autoCaptureNeedsReset("", existing)).toBe(false);
    expect(autoCaptureNeedsReset(null, existing)).toBe(false);
    expect(autoCaptureNeedsReset(undefined, existing)).toBe(false);
  });

  it("is false when the setting names a folder that still exists", () => {
    expect(autoCaptureNeedsReset("f2", existing)).toBe(false);
  });

  it("is true when the setting names a folder that is gone", () => {
    expect(autoCaptureNeedsReset("f1", existing)).toBe(true);
  });
});
