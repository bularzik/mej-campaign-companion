// test/sheet-registration.test.js
import { describe, it, expect } from "vitest";
import { missingSheetRegistrations } from "../scripts/logic/sheet-registration.mjs";

const SESSION_TYPE = "mej-campaign-companion.session";
const HUB_TYPE = "campaign-hub";
const CAMPAIGN_TYPE = "mej-campaign-companion.campaign";

describe("missingSheetRegistrations", () => {
  it("reports all three missing when sheetClasses is undefined", () => {
    expect(missingSheetRegistrations(undefined, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports all three missing when sheetClasses is empty", () => {
    expect(missingSheetRegistrations({}, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports all three missing when the type entries are present but empty (the dropped-registration case)", () => {
    const sheetClasses = { [SESSION_TYPE]: {}, [HUB_TYPE]: {}, [CAMPAIGN_TYPE]: {} };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports none missing when all three type entries have a registered scope", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: false, campaign: false, media: false
    });
  });

  it("reports only the session missing when just the hub and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: {},
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: false, campaign: false, media: false
    });
  });

  it("reports only the hub missing when just the session and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: {},
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: true, campaign: false, media: false
    });
  });

  it("reports only the campaign missing when just the session and hub entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: {}
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: false, campaign: true, media: false
    });
  });

  // Regression coverage (fix round 1): core itself registers a sheet for
  // pdf/video (CONFIG.JournalEntryPage.sheetClasses.pdf/.video always carry
  // a `core.JournalEntryPagePDFSheet`/`core.JournalEntryPageVideoSheet`
  // entry), so these use the REAL registerSheet key shape
  // (`${scope}.${sheetClass.name}`, per document-sheet-config.mjs) rather
  // than toy keys - a toy key like "a" can't distinguish "core registered
  // this" from "we registered this", which is exactly how the original bug
  // shipped: `missing.media` was permanently false because `has()` only
  // checked whether ANY key was present, and core's own entry always is.
  const OWNER_SCOPE = "mej-campaign-companion";
  const CORE_PDF = { "core.JournalEntryPagePDFSheet": {} };
  const CORE_VIDEO = { "core.JournalEntryPageVideoSheet": {} };
  const OUR_MEDIA = { "mej-campaign-companion.MediaPageSheet": {} };

  it("reports media missing when only core's native pdf/video sheets are registered (the regression)", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF }, video: { ...CORE_VIDEO }
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(true);
  });

  it("reports media registered when our own scope is present alongside core's on every media type", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO, ...OUR_MEDIA }
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(false);
  });

  it("reports media missing when our registration landed on only one of the two media types", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO } // video: core only - ours was dropped
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(true);
  });

  it("treats an empty media list as nothing missing, even with no ownerScope supplied", () => {
    expect(missingSheetRegistrations({}, "s", "h", "c", []).media).toBe(false);
  });

  it("never reports media as registered when ownerScope is omitted, even if a media type has entries", () => {
    // ownerScope defaults to "" - hasOurs() must not fall back to has()'s
    // "any key at all" check, or this silently reintroduces the bug.
    const classes = { pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO, ...OUR_MEDIA } };
    expect(missingSheetRegistrations(classes, "s", "h", "c", ["pdf", "video"]).media).toBe(true);
  });
});
