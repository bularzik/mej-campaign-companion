// test/sheet-registration.test.js
import { describe, it, expect } from "vitest";
import { missingSheetRegistrations } from "../scripts/logic/sheet-registration.mjs";

const SESSION_TYPE = "mej-campaign-companion.session";
const HUB_TYPE = "campaign-hub";

describe("missingSheetRegistrations", () => {
  it("reports both missing when sheetClasses is undefined", () => {
    expect(missingSheetRegistrations(undefined, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: true, hub: true
    });
  });

  it("reports both missing when sheetClasses is empty", () => {
    expect(missingSheetRegistrations({}, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: true, hub: true
    });
  });

  it("reports both missing when both type entries are present but empty (the dropped-registration case)", () => {
    const sheetClasses = { [SESSION_TYPE]: {}, [HUB_TYPE]: {} };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: true, hub: true
    });
  });

  it("reports neither missing when both type entries have a registered scope", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: false, hub: false
    });
  });

  it("reports only the session missing when just the hub entry is populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: {},
      [HUB_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: true, hub: false
    });
  });

  it("reports only the hub missing when just the session entry is populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: {}
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE)).toEqual({
      session: false, hub: true
    });
  });
});
