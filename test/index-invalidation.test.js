import { describe, it, expect } from "vitest";
import { MEJ_SHEET_SETTINGS_KEY, invalidatesSearchIndex } from "../scripts/logic/index-invalidation.mjs";

// S2: live-index.mjs splits a person's attributes into public (record.fields)
// and GM-only (record.gmFields) using MEJ's "sheet-settings" world setting,
// read at INDEX time. Nothing re-indexed when that setting changed, so an
// attribute a GM newly marked playerHidden stayed in the public token set -
// searchable by players - until a world reload. The Setting document's `key`
// is the namespaced "<scope>.<key>" form, which is what this matches on.
describe("invalidatesSearchIndex", () => {
  it("names MEJ's sheet-settings key in its namespaced form", () => {
    expect(MEJ_SHEET_SETTINGS_KEY).toBe("monks-enhanced-journal.sheet-settings");
  });

  it("invalidates on MEJ's sheet-settings, the source of the hidden-attribute split", () => {
    expect(invalidatesSearchIndex(MEJ_SHEET_SETTINGS_KEY)).toBe(true);
  });

  it("ignores every other setting, including this module's own", () => {
    expect(invalidatesSearchIndex("mej-campaign-companion.playerGroups")).toBe(false);
    expect(invalidatesSearchIndex("mej-campaign-companion.savedQueries")).toBe(false);
    expect(invalidatesSearchIndex("monks-enhanced-journal.something-else")).toBe(false);
    expect(invalidatesSearchIndex("core.rollMode")).toBe(false);
  });

  it("ignores the bare key without its scope, which is not what Setting#key carries", () => {
    expect(invalidatesSearchIndex("sheet-settings")).toBe(false);
  });

  it("tolerates junk rather than throwing inside a hook", () => {
    expect(invalidatesSearchIndex(undefined)).toBe(false);
    expect(invalidatesSearchIndex(null)).toBe(false);
    expect(invalidatesSearchIndex(42)).toBe(false);
    expect(invalidatesSearchIndex({})).toBe(false);
  });
});
