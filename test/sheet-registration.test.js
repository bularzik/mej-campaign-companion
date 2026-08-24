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

  it("reports missing media sheet registrations", () => {
    const classes = { session: { a: {} }, "campaign-hub": { a: {} }, campaign: { a: {} } };
    expect(missingSheetRegistrations(classes, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(true);
  });
  it("reports media registered only when EVERY media type has a class", () => {
    const partial = { session: { a: {} }, "campaign-hub": { a: {} }, campaign: { a: {} }, pdf: { a: {} } };
    expect(missingSheetRegistrations(partial, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(true);
    const full = { ...partial, video: { a: {} } };
    expect(missingSheetRegistrations(full, "session", "campaign-hub", "campaign", ["pdf", "video"]).media).toBe(false);
  });
  it("treats an empty media list as nothing missing", () => {
    expect(missingSheetRegistrations({}, "s", "h", "c", []).media).toBe(false);
  });
});
