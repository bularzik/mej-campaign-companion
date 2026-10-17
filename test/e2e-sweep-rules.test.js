import { describe, it, expect } from "vitest";
import { strandedTestFolderIds, autoCaptureNeedsReset, fallbackCampaignReclaimable } from "../tests/e2e/helpers/sweep-rules.mjs";

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

describe("fallbackCampaignReclaimable", () => {
  const portal = { name: "New Campaign", portal: true, timeline: false, timepointLabels: [] };
  const tl = (labels) => ({ name: "New Campaign — Timeline", portal: false, timeline: true, timepointLabels: labels });
  it("reclaims a fallback that holds only TT- sessions and TT- timepoints, or nothing at all", () => {
    expect(fallbackCampaignReclaimable([portal, tl(["TT-S1"]), { name: "TT-S1", portal: false, timeline: false }])).toBe(true);
    expect(fallbackCampaignReclaimable([portal, tl([])])).toBe(true);
    expect(fallbackCampaignReclaimable([])).toBe(true);
  });
  it("keeps a fallback with any real member or any real timepoint", () => {
    expect(fallbackCampaignReclaimable([portal, tl([]), { name: "Session 12", portal: false, timeline: false }])).toBe(false);
    expect(fallbackCampaignReclaimable([portal, tl(["TT-S1", "The Vault"])])).toBe(false);
  });
  it("keeps a fallback whose timeline holds an unlabelled timepoint (empty-string label)", () => {
    expect(fallbackCampaignReclaimable([portal, tl([""])])).toBe(false);
    expect(fallbackCampaignReclaimable([portal, tl(["TT-S1", ""])])).toBe(false);
  });
  it("treats an empty notes entry as structure and a notes entry holding notes as real content", () => {
    const notes = (count) => ({ name: "Notes — New Campaign", portal: false, timeline: false, notes: true, noteCount: count });
    expect(fallbackCampaignReclaimable([portal, tl([]), notes(0)])).toBe(true);
    expect(fallbackCampaignReclaimable([portal, tl([]), notes(1)])).toBe(false);
  });
});
