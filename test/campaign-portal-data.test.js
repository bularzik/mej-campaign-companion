import { describe, it, expect } from "vitest";
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../scripts/constants.mjs";
import { buildCampaignPortalData, renameSyncPlan, missingPortalPlan } from "../scripts/logic/campaign-portal-data.mjs";
import { isCampaignPortal } from "../scripts/logic/campaigns.mjs";

describe("buildCampaignPortalData", () => {
  const data = buildCampaignPortalData("Radiant Citadel");
  it("uses the native subtype and the MEJ interop flag", () => {
    expect(data.type).toBe(CAMPAIGN_DOCUMENT_TYPE);
    expect(data.flags["monks-enhanced-journal"].type).toBe(CAMPAIGN_TYPE);
  });
  it("names the page after the campaign and marks it a portal", () => {
    expect(data.name).toBe("Radiant Citadel");
    expect(data.flags[MODULE_ID].campaignPortal).toBe(true);
  });
});

describe("renameSyncPlan", () => {
  it("no-op when names already match", () => {
    expect(renameSyncPlan({ folderName: "A", portalName: "A", changedSide: "folder" })).toBe(null);
  });
  it("folder change renames the portal", () => {
    expect(renameSyncPlan({ folderName: "New", portalName: "Old", changedSide: "folder" }))
      .toEqual({ target: "portal", name: "New" });
  });
  it("portal change renames the folder", () => {
    expect(renameSyncPlan({ folderName: "Old", portalName: "New", changedSide: "portal" }))
      .toEqual({ target: "folder", name: "New" });
  });
  it("is loop-safe: applying its own output yields a no-op", () => {
    const first = renameSyncPlan({ folderName: "New", portalName: "Old", changedSide: "folder" });
    expect(renameSyncPlan({ folderName: "New", portalName: first.name, changedSide: "portal" })).toBe(null);
  });
});

describe("missingPortalPlan", () => {
  const c1 = { id: "c1" }, c2 = { id: "c2" };
  it("lists campaigns lacking a portal, idempotently", () => {
    const portalOf = (c) => (c.id === "c1" ? { id: "p1" } : null);
    expect(missingPortalPlan([c1, c2], portalOf)).toEqual([c2]);
    expect(missingPortalPlan([c1, c2], () => ({ id: "p" }))).toEqual([]);
  });
});

describe("isCampaignPortal", () => {
  const portalPage = { documentName: "JournalEntryPage", type: CAMPAIGN_DOCUMENT_TYPE };
  it("detects a portal page directly", () => {
    expect(isCampaignPortal(portalPage)).toBe(true);
  });
  it("detects an entry via its pages", () => {
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [portalPage] } })).toBe(true);
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [{ type: "text" }] } })).toBe(false);
  });
  it("is false for null and plain docs", () => {
    expect(isCampaignPortal(null)).toBe(false);
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [] } })).toBe(false);
  });

  // C1 regression: MEJ's fixType() normalizes an OPENED portal page's
  // in-memory `.type` to the bare mejType key ("campaign") for the rest of
  // the session - `_source.type` keeps the real, persisted, prefixed value.
  // isCampaignPortal must still recognize the page in every form it can take
  // once mounted, or campaignEntries/unfiledEntries/campaignPortal()/the
  // rename-sync hooks all silently stop excluding or finding it.
  it("detects a page whose .type MEJ normalized to the bare mejType key", () => {
    const normalizedPage = {
      documentName: "JournalEntryPage",
      type: "campaign",
      _source: { type: CAMPAIGN_DOCUMENT_TYPE }
    };
    expect(isCampaignPortal(normalizedPage)).toBe(true);
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [normalizedPage] } })).toBe(true);
  });

  it("detects a page via the companion's own campaignPortal flag alone, independent of .type", () => {
    const flagMarkedPage = {
      documentName: "JournalEntryPage",
      type: "text",
      flags: { [MODULE_ID]: { campaignPortal: true } }
    };
    expect(isCampaignPortal(flagMarkedPage)).toBe(true);
  });

  it("is false for an ordinary text page with no portal marker at all", () => {
    expect(isCampaignPortal({ documentName: "JournalEntryPage", type: "text" })).toBe(false);
  });
});
