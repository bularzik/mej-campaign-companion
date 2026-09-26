import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Foundry's Localization expands each language file (expandObject) and
// resolves a label with getProperty(translations, key): a dotted walk.
const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

describe("page subtype labels", () => {
  it("resolve Foundry's module-subtype keys", () => {
    expect(lookup(en, "TYPES.JournalEntryPage.mej-campaign-companion.session")).toBe("Session");
    expect(lookup(en, "TYPES.JournalEntryPage.mej-campaign-companion.campaign")).toBe("Campaign");
  });
  it("add only the companion's two subtypes", () => {
    expect(Object.keys(en.TYPES)).toEqual(["JournalEntryPage"]);
    expect(Object.keys(en.TYPES.JournalEntryPage)).toEqual(["mej-campaign-companion"]);
    expect(Object.keys(en.TYPES.JournalEntryPage["mej-campaign-companion"]).sort()).toEqual(["campaign", "session"]);
  });
});
