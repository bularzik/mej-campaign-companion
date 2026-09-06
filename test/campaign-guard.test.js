import { describe, it, expect } from "vitest";
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../scripts/constants.mjs";
import { classifyCampaignPageCreate, strayCampaignIntent, CAMPAIGN_OPTION_VALUES } from "../scripts/logic/campaign-guard.mjs";

describe("classifyCampaignPageCreate (spec 2026-09-06 §3 table)", () => {
  const base = { isPortal: false, isGM: true, entryPageCount: 0, entryInCampaign: false };
  it("ignores portal-marked pages regardless of anything else", () => {
    expect(classifyCampaignPageCreate({ ...base, isPortal: true, isGM: false, entryPageCount: 3, entryInCampaign: true })).toBe("ignore");
  });
  it("blocks non-GMs", () => {
    expect(classifyCampaignPageCreate({ ...base, isGM: false })).toBe("block-not-gm");
  });
  it("blocks a page added to an entry that already has pages", () => {
    expect(classifyCampaignPageCreate({ ...base, entryPageCount: 1 })).toBe("block-multipage");
  });
  it("blocks a page whose entry already sits inside a campaign", () => {
    expect(classifyCampaignPageCreate({ ...base, entryInCampaign: true })).toBe("block-in-campaign");
  });
  it("allows a fresh single-page campaign entry outside any campaign", () => {
    expect(classifyCampaignPageCreate(base)).toBe("allow");
  });
  it("multipage wins over in-campaign (both block; order is deterministic)", () => {
    expect(classifyCampaignPageCreate({ ...base, entryPageCount: 2, entryInCampaign: true })).toBe("block-multipage");
  });
});

describe("strayCampaignIntent", () => {
  it("returns null for entries with no campaign intent", () => {
    expect(strayCampaignIntent({ name: "x" })).toBe(null);
    expect(strayCampaignIntent({ name: "x", pages: [{ type: "text" }] })).toBe(null);
    expect(strayCampaignIntent(null)).toBe(null);
  });
  it("detects MEJ's New Entry pagetype flag, with or without a subtype suffix", () => {
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: CAMPAIGN_TYPE } } })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: "campaign:foo" } } })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: "person" } } })).toBe(null);
  });
  it("detects an inline campaign page and counts the other inline pages", () => {
    expect(strayCampaignIntent({ pages: [{ type: CAMPAIGN_DOCUMENT_TYPE }] })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ pages: [{ type: "text" }, { type: CAMPAIGN_DOCUMENT_TYPE }] })).toEqual({ otherPages: 1 });
  });
  it("ignores inline pages that carry the portal marker (ensureCampaignPortal's own creates)", () => {
    expect(strayCampaignIntent({ pages: [{ type: CAMPAIGN_DOCUMENT_TYPE, flags: { [MODULE_ID]: { campaignPortal: true } } }] })).toBe(null);
  });
});

describe("CAMPAIGN_OPTION_VALUES", () => {
  it("lists the bare MEJ key and the prefixed native subtype", () => {
    expect(CAMPAIGN_OPTION_VALUES).toEqual([CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE]);
  });
});
