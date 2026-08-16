import { test, expect } from "@playwright/test";
import {
  login, ensureModuleEnabled, ensureModuleDisabled, TT_PREFIX, MODULE_ID, MEJ_MODULE_ID,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED
} from "./helpers/foundry.mjs";

/**
 * Stage-1 regression spec (design doc §9). Everything else in this suite
 * assumes MEJ's extension API and the fixType foreign-subtype guard behave
 * exactly as documented in API.md — this spec is the one gate that would
 * catch an MEJ-side regression before it silently corrupts companion data.
 */
test.describe("00 MEJ extension API — stage-1 regression", () => {
  test("registers the session type; person/shop/session entries open with their MEJ sheets", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
    await login(page, "Gamemaster");

    // (a) externalTypes.session exists once the companion has registered.
    const externalType = await page.evaluate(() => {
      const t = game.MonksEnhancedJournal?.externalTypes?.session;
      return t ? { moduleId: t.moduleId, hasSheetClass: !!t.sheetClass } : null;
    });
    expect(externalType).toEqual({ moduleId: MODULE_ID, hasSheetClass: true });

    // (b) a built-in person entry still opens with PersonSheet (built-ins unchanged).
    // Foundry persists module-declared documentTypes subtypes namespaced as
    // "${moduleId}.${key}" (API.md) — MEJ's own built-in types are no
    // exception in v14: JournalEntryPage.TYPES only contains
    // "monks-enhanced-journal.person" etc., never the bare "person". MEJ's
    // fixType() coerces the in-memory .type to the bare form once it
    // recognizes the page's flag; the *persisted* create() call must use
    // the namespaced form.
    const personId = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Person A`,
        pages: [{
          name: `${prefix}Person A`,
          type: "monks-enhanced-journal.person",
          flags: { "monks-enhanced-journal": { type: "person" } }
        }]
      });
      return entry.id;
    }, TT_PREFIX);
    let sheetInfo = await page.evaluate(async (id) => {
      const entry = game.journal.get(id);
      await game.MonksEnhancedJournal.openJournalEntry(entry);
      await new Promise((r) => setTimeout(r, 300));
      const subsheet = game.MonksEnhancedJournal.journal?.subsheet;
      return { className: subsheet?.constructor?.name, type: subsheet?.constructor?.type };
    }, personId);
    expect(sheetInfo).toEqual({ className: "PersonSheet", type: "person" });

    // (b) a built-in shop entry still opens with ShopSheet.
    const shopId = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Shop A`,
        pages: [{
          name: `${prefix}Shop A`,
          type: "monks-enhanced-journal.shop",
          flags: { "monks-enhanced-journal": { type: "shop" } }
        }]
      });
      return entry.id;
    }, TT_PREFIX);
    sheetInfo = await page.evaluate(async (id) => {
      const entry = game.journal.get(id);
      await game.MonksEnhancedJournal.openJournalEntry(entry);
      await new Promise((r) => setTimeout(r, 300));
      const subsheet = game.MonksEnhancedJournal.journal?.subsheet;
      return { className: subsheet?.constructor?.name, type: subsheet?.constructor?.type };
    }, shopId);
    expect(sheetInfo).toEqual({ className: "ShopSheet", type: "shop" });

    // (c) a session entry opens with SessionSheet, via MEJ's own "New Entry"
    // creation path is exercised in 01-session.spec.mjs; here we only need a
    // page recognized as MEJ session type to confirm the sheet wiring.
    const sessionInfo = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Session API Check`,
        pages: [{
          name: `${prefix}Session API Check`,
          type: "mej-campaign-companion.session",
          flags: { "monks-enhanced-journal": { type: "session" } }
        }]
      });
      await game.MonksEnhancedJournal.openJournalEntry(entry);
      await new Promise((r) => setTimeout(r, 300));
      const subsheet = game.MonksEnhancedJournal.journal?.subsheet;
      return { entryId: entry.id, className: subsheet?.constructor?.name, type: subsheet?.constructor?.type };
    }, TT_PREFIX);
    expect(sessionInfo.className).toBe("SessionSheet");
    expect(sessionInfo.type).toBe("session");

    // cleanup
    await page.evaluate(async (ids) => {
      await JournalEntry.implementation.deleteDocuments(ids);
    }, [personId, shopId, sessionInfo.entryId]);

    assertNoConsoleErrors(errors);
  });

  test("fixType foreign-subtype guard: a session page's MEJ type flag survives a GM reload while the companion is disabled", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, {
      ignore: [KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED]
    });
    await login(page, "Gamemaster");
    await ensureModuleEnabled(page, MEJ_MODULE_ID);
    await ensureModuleEnabled(page, MODULE_ID);

    // Create the session page while the companion is active, so it gets the
    // real foreign-namespaced persisted type + the MEJ interop flag.
    const { entryId, pageId } = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}FixType Guard`,
        pages: [{
          name: `${prefix}FixType Guard`,
          type: "mej-campaign-companion.session",
          flags: { "monks-enhanced-journal": { type: "session" } }
        }]
      });
      return { entryId: entry.id, pageId: entry.pages.contents[0].id };
    }, TT_PREFIX);

    const before = await page.evaluate(({ entryId, pageId }) => {
      const p = game.journal.get(entryId).pages.get(pageId);
      return { type: p._source.type, flag: p.getFlag("monks-enhanced-journal", "type") };
    }, { entryId, pageId });
    expect(before).toEqual({ type: "mej-campaign-companion.session", flag: "session" });

    // Disable the companion — MonksEnhancedJournal.externalTypes.session
    // disappears, so fixType() no longer recognizes the page's flagged type.
    await ensureModuleDisabled(page, MODULE_ID);

    // A GM reload is exactly the scenario fixType()'s foreign-subtype guard
    // protects: the flag must not be stripped just because the owning
    // module is temporarily offline. fixType() only runs when MEJ actually
    // touches the document (e.g. opening it) — not passively on every
    // loaded page — so exercise the real code path via openJournalEntry()
    // (which calls fixType(doc) unconditionally at its top) rather than
    // just reading the flag back untouched.
    await page.goto("http://localhost:30000/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await settle(page, 500);

    await page.evaluate(async (entryId) => {
      const entry = game.journal.get(entryId);
      await game.MonksEnhancedJournal.openJournalEntry(entry);
    }, entryId);
    await settle(page, 300);

    // With the companion inactive, Foundry's own core schema validation (not
    // MEJ) no longer recognizes "mej-campaign-companion.session" as a valid
    // type at all (documentTypes merging is live-recomputed per client
    // connection from the currently-active module list) — so the entry
    // becomes an "invalid document" on this client and normal .get() no
    // longer returns it. That's expected and orthogonal to fixType()'s
    // guarantee: what matters is that the underlying *stored* data (and its
    // flag) was never mutated, which {invalid: true} lets us read back.
    const after = await page.evaluate(({ entryId, pageId }) => {
      const entry = game.journal.get(entryId);
      const p = entry.pages.get(pageId, { invalid: true });
      return { type: p._source.type, flag: p.getFlag("monks-enhanced-journal", "type") };
    }, { entryId, pageId });
    expect(after).toEqual({ type: "mej-campaign-companion.session", flag: "session" });

    // Re-enable and confirm the page is recognized again.
    await ensureModuleEnabled(page, MODULE_ID);
    const reRegistered = await page.evaluate(() => !!game.MonksEnhancedJournal?.externalTypes?.session);
    expect(reRegistered).toBe(true);

    // cleanup
    await page.evaluate(async (id) => {
      await JournalEntry.implementation.deleteDocuments([id]);
    }, entryId);

    assertNoConsoleErrors(errors);
  });
});
