// test/sheet-registration.test.js
import { describe, it, expect } from "vitest";
import { missingSheetRegistrations } from "../scripts/logic/sheet-registration.mjs";

const SESSION_TYPE = "mej-campaign-companion.session";
const HUB_TYPE = "campaign-hub";
const CAMPAIGN_TYPE = "mej-campaign-companion.campaign";

describe("missingSheetRegistrations", () => {
  it("reports all three missing when sheetClasses is undefined", () => {
    expect(missingSheetRegistrations(undefined, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: true, hub: true, campaign: true
    });
  });

  it("reports all three missing when sheetClasses is empty", () => {
    expect(missingSheetRegistrations({}, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: true, hub: true, campaign: true
    });
  });

  it("reports all three missing when the type entries are present but empty (the dropped-registration case)", () => {
    const sheetClasses = { [SESSION_TYPE]: {}, [HUB_TYPE]: {}, [CAMPAIGN_TYPE]: {} };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: true, hub: true, campaign: true
    });
  });

  it("reports none missing when all three type entries have a registered scope", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: false, hub: false, campaign: false
    });
  });

  it("reports only the session missing when just the hub and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: {},
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: true, hub: false, campaign: false
    });
  });

  it("reports only the hub missing when just the session and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: {},
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: false, hub: true, campaign: false
    });
  });

  it("reports only the campaign missing when just the session and hub entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: {}
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE)).toEqual({
      session: false, hub: false, campaign: true
    });
  });
});
