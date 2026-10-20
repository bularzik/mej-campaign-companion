import { describe, it, expect, beforeEach, afterEach } from "vitest";

// view-refresh imports session-regions, which imports Foundry-served modules
// only lazily; the globals below are all poppedOutPageSheets reads.
class JournalEntryPage {}
const page = new JournalEntryPage();

describe("poppedOutPageSheets", () => {
  let mod;
  beforeEach(async () => {
    globalThis.JournalEntryPage = JournalEntryPage;
    mod = await import("../scripts/hooks/view-refresh.mjs");
  });
  afterEach(() => {
    delete globalThis.JournalEntryPage;
    delete globalThis.foundry;
    delete globalThis.game;
  });

  it("never lists MEJ's shell (its document is the page it shows) or its subsheet", () => {
    const subsheet = { rendered: true, document: page };
    const shell = { rendered: true, document: page, subsheet };
    const popout = { rendered: true, document: page };
    globalThis.game = { MonksEnhancedJournal: { journal: shell } };
    globalThis.foundry = { applications: { instances: new Map([["a", shell], ["b", subsheet], ["c", popout]]) } };
    expect(mod.poppedOutPageSheets()).toEqual([popout]);
  });
  it("lists popped-out page sheets with no shell open", () => {
    const popout = { rendered: true, document: page };
    globalThis.game = { MonksEnhancedJournal: { journal: null } };
    globalThis.foundry = { applications: { instances: new Map([["c", popout], ["d", { rendered: false, document: page }]]) } };
    expect(mod.poppedOutPageSheets()).toEqual([popout]);
  });
});
