import { describe, it, expect } from "vitest";
import { MODULE_ID } from "../scripts/constants.mjs";
import { adoptionPlan } from "../scripts/logic/campaigns.mjs";

const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function folder(id, { campaign = null, parent = null } = {}) {
  return { id, folder: parent, flags: campaign ? { [MODULE_ID]: { campaign } } : {} };
}
function entry(id, { folder: f = null, timeline = false } = {}) {
  return {
    id, documentName: "JournalEntry", folder: f,
    flags: timeline ? { [MODULE_ID]: { timeline: { timepoints: [] } } } : {}
  };
}

describe("campaigns module", async () => {
  const { campaignFlagOf, isCampaignFolder, campaignOf, campaignIdOf, isMemberOf, partitionByCampaign, isTimelineJournal, ownershipLevelFor, canAttachToTimeline } = await import("../scripts/logic/campaigns.mjs");

  describe("isCampaignFolder / campaignFlagOf", () => {
    it("detects the campaign flag", () => {
      const c = folder("c1", { campaign: { ownershipDefault: "owner" } });
      expect(isCampaignFolder(c)).toBe(true);
      expect(campaignFlagOf(c)).toEqual({ ownershipDefault: "owner" });
    });
    it("rejects plain folders and null", () => {
      expect(isCampaignFolder(folder("f1"))).toBe(false);
      expect(isCampaignFolder(null)).toBe(false);
      expect(campaignFlagOf(undefined)).toBe(null);
    });
  });

  describe("campaignOf", () => {
    const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
    it("resolves direct membership", () => {
      expect(campaignOf(entry("e1", { folder: camp }))).toBe(camp);
    });
    it("resolves through subfolders (ancestry)", () => {
      const sub = folder("s1", { parent: camp });
      expect(campaignOf(entry("e1", { folder: sub }))).toBe(camp);
    });
    it("nearest flagged ancestor wins (defensive nesting rule)", () => {
      const inner = folder("c2", { campaign: { ownershipDefault: "none" }, parent: camp });
      expect(campaignOf(entry("e1", { folder: inner }))).toBe(inner);
    });
    it("returns null for loose entries and null docs", () => {
      expect(campaignOf(entry("e1"))).toBe(null);
      expect(campaignOf(entry("e1", { folder: folder("f1") }))).toBe(null);
      expect(campaignOf(null)).toBe(null);
    });
    it("resolves a page via its parent entry", () => {
      const page = { documentName: "JournalEntryPage", parent: entry("e1", { folder: camp }) };
      expect(campaignOf(page)).toBe(camp);
    });
    it("campaignIdOf/isMemberOf wrap it", () => {
      expect(campaignIdOf(entry("e1", { folder: camp }))).toBe("c1");
      expect(campaignIdOf(entry("e1"))).toBe(null);
      expect(isMemberOf(entry("e1", { folder: camp }), camp)).toBe(true);
      expect(isMemberOf(entry("e1"), camp)).toBe(false);
      expect(isMemberOf(entry("e1", { folder: camp }), null)).toBe(false);
    });
  });

  describe("partitionByCampaign", () => {
    it("groups by campaign id with null for unfiled", () => {
      const camp = folder("c1", { campaign: {} });
      const a = entry("a", { folder: camp });
      const b = entry("b");
      const byId = partitionByCampaign([a, b]);
      expect(byId.get("c1")).toEqual([a]);
      expect(byId.get(null)).toEqual([b]);
    });
  });

  describe("isTimelineJournal", () => {
    it("detects the timeline flag", () => {
      expect(isTimelineJournal(entry("t", { timeline: true }))).toBe(true);
      expect(isTimelineJournal(entry("e"))).toBe(false);
      expect(isTimelineJournal(null)).toBe(false);
    });
  });

  describe("ownershipLevelFor", () => {
    it("maps keys, defaulting unknown to OBSERVER", () => {
      expect(ownershipLevelFor("none", LEVELS)).toBe(0);
      expect(ownershipLevelFor("observer", LEVELS)).toBe(2);
      expect(ownershipLevelFor("owner", LEVELS)).toBe(3);
      expect(ownershipLevelFor("banana", LEVELS)).toBe(2);
      expect(ownershipLevelFor(undefined, LEVELS)).toBe(2);
    });
  });

  describe("canAttachToTimeline (spec §3 attachment discipline)", () => {
    const camp = folder("c1", { campaign: {} });
    const other = folder("c2", { campaign: {} });
    it("allows same-campaign attachment", () => {
      expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { folder: camp, timeline: true }))).toBe(true);
    });
    it("refuses cross-campaign and unfiled-entry attachment", () => {
      expect(canAttachToTimeline(entry("e", { folder: other }), entry("t", { folder: camp, timeline: true }))).toBe(false);
      expect(canAttachToTimeline(entry("e"), entry("t", { folder: camp, timeline: true }))).toBe(false);
    });
    it("legacy un-campaigned timeline accepts anything (pre-adoption worlds)", () => {
      expect(canAttachToTimeline(entry("e"), entry("t", { timeline: true }))).toBe(true);
      expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { timeline: true }))).toBe(true);
    });
    it("only governs journal documents - a non-journal drop (e.g. an Actor) is never refused, even outside the timeline's campaign", () => {
      const otherFolder = { id: "af1", folder: null, flags: {} };
      const actor = { documentName: "Actor", folder: otherFolder };
      expect(canAttachToTimeline(actor, entry("t", { folder: camp, timeline: true }))).toBe(true);
    });
  });

  describe("bulkOwnershipPlan", () => {
    it("plans updates only for entries not already at the level", async () => {
      const { bulkOwnershipPlan } = await import("../scripts/logic/campaigns.mjs");
      const entries = [
        { id: "a", ownership: { default: 0 } },
        { id: "b", ownership: { default: 2 } },
        { id: "c", ownership: {} },
        { id: "d" }
      ];
      expect(bulkOwnershipPlan(entries, 2)).toEqual([
        { _id: "a", "ownership.default": 2 },
        { _id: "c", "ownership.default": 2 },
        { _id: "d", "ownership.default": 2 }
      ]);
      expect(bulkOwnershipPlan([], 2)).toEqual([]);
    });
    it("with skipLevel, also skips entries hidden (at skipLevel) - a bulk apply must not un-hide them", async () => {
      const { bulkOwnershipPlan } = await import("../scripts/logic/campaigns.mjs");
      const entries = [
        { id: "a", ownership: { default: 0 } }, // NONE - hidden via the eye toggle
        { id: "b", ownership: { default: 1 } }, // some other pre-existing level
        { id: "c", ownership: { default: 2 } }  // already at target level
      ];
      expect(bulkOwnershipPlan(entries, 2, { skipLevel: 0 })).toEqual([
        { _id: "b", "ownership.default": 2 }
      ]);
      // Without skipLevel, the NONE entry is un-hidden like any other (old behavior preserved).
      expect(bulkOwnershipPlan(entries, 2)).toEqual([
        { _id: "a", "ownership.default": 2 },
        { _id: "b", "ownership.default": 2 }
      ]);
    });
  });

});

describe("adoptionPlan (spec §6)", () => {
  const typed = (id) => ({ id, folder: null, documentName: "JournalEntry", flags: {} });
  const getMEJType = (e) => (e.id.startsWith("t") ? "person" : false);
  it("moves root-level MEJ-typed entries and the legacy timeline; skips foldered and untyped", () => {
    const entries = [
      typed("t1"),
      { ...typed("t2"), folder: { id: "f1", flags: {} } },   // user-foldered: preserved
      typed("plain"),                                        // untyped: manual filing
      typed("timeline-x")                                    // untyped but IS the legacy timeline
    ];
    expect(adoptionPlan(entries, getMEJType, "timeline-x")).toEqual(["t1", "timeline-x"]);
    expect(adoptionPlan([], getMEJType, null)).toEqual([]);
  });
});
