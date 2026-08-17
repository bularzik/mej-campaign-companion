// Native mode: the companion running as if MEJ had no extension API.
// forceNativeMode makes the adapter ignore the API this world's MEJ fork
// does provide, so the fallback surfaces are exercisable here.
import { test, expect } from "@playwright/test";
import { login, settle } from "./helpers/foundry.mjs";

const RUN = Date.now().toString(36).slice(-5);

async function setForceNative(page, value) {
  await page.evaluate(async (v) => {
    await game.settings.set("mej-campaign-companion", "forceNativeMode", v);
  }, value);
  await page.reload();
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
  // Foundry rebuilds CONFIG.JournalEntryPage.sheetClasses asynchronously
  // after game.ready flips (confirmed live: DocumentSheetConfig throws
  // constructing a sheet for our synthetic Hub type if queried too soon
  // after ready). Give it room to settle before touching adapter/CONFIG state.
  await settle(page, 2500);
}

test.describe("native mode (no extension API)", () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, "Gamemaster");
    await page.evaluate(async (run) => {
      await game.settings.set("mej-campaign-companion", "forceNativeMode", false);
      const doomed = game.journal.filter((j) => j.name.includes(`TT${run}`));
      for (const entry of doomed) await entry.delete();
    }, RUN);
    await page.close();
  });

  test("resolves native mode and still registers core features", async ({ page }) => {
    await login(page, "Gamemaster");
    await setForceNative(page, true);

    const state = await page.evaluate(async (run) => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      // Behavioral check that the Session sheet is registered through core
      // Foundry: CONFIG.JournalEntryPage.sheetClasses stays an empty object
      // for our subtype in this Foundry build even after a successful
      // DocumentSheetConfig.registerSheet call (confirmed live) — sheet
      // resolution for a real, persisted page is the reliable signal.
      const name = `TT${run} sheet-registration probe`;
      const entry = await JournalEntry.create({
        name, pages: [{ name, type: "mej-campaign-companion.session" }]
      });
      const sessionSheetRegistered = entry.pages.contents[0].sheet?.constructor?.name === "SessionSheet";
      await entry.delete();

      return {
        mode: adapter.currentMode(),
        wiringFailed: adapter.wiringFailed(),
        sessionSheetRegistered,
        // Core features are wired by hooks, not by the API.
        hasSearchHook: Hooks.events.createJournalEntryPage?.length > 0
      };
    }, RUN);

    expect(state.mode).toBe("native");
    expect(state.wiringFailed).toBe(false);
    expect(state.sessionSheetRegistered).toBe(true);
    expect(state.hasSearchHook).toBe(true);
  });

  test("opens the Hub as a standalone window with working tabs", async ({ page }) => {
    await login(page, "Gamemaster");
    await setForceNative(page, true);

    const opened = await page.evaluate(async () => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");
      await adapter.openHub();
      await new Promise((r) => setTimeout(r, 800));
      const el = document.querySelector('[id^="CampaignHubPage-"]');
      const tabs = el ? el.querySelectorAll("[data-tab]") : [];
      // Clicking a tab proves activateListeners bound outside MEJ's shell.
      // The nav link is an <a data-tab>; the tab-content panel is a
      // <div class="tab" data-tab> (hub.hbs) — exclude the panel so the
      // click lands on the clickable nav element.
      const timeline = Array.from(tabs).find((n) => n.dataset.tab === "timeline" && n.tagName !== "DIV");
      timeline?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        rendered: !!el,
        tabCount: tabs.length,
        activeTab: el?.querySelector("div.tab.active")?.dataset?.tab ?? null,
        // No MEJ shell tab was created for the hub in this mode.
        shellOpen: !!game.MonksEnhancedJournal.journal?.rendered
      };
    });

    expect(opened.rendered).toBe(true);
    expect(opened.tabCount).toBeGreaterThan(0);
    expect(opened.activeTab).toBe("timeline");
    expect(opened.shellOpen).toBe(false);
  });

  test("a Session page is first-class: native sheet and indexed by type", async ({ page }) => {
    await login(page, "Gamemaster");
    await setForceNative(page, true);

    const result = await page.evaluate(async (run) => {
      const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      const name = `TT${run} native session`;
      const entry = await JournalEntry.create({ name, pages: [buildSessionPageData(name, "", null, null)] });
      const pageDoc = entry.pages.contents[0];

      // Stock MEJ would report false here; the adapter must still say session.
      const stockAnswer = game.MonksEnhancedJournal.getMEJType(pageDoc);
      const adapterAnswer = adapter.mejType(pageDoc);

      await pageDoc.sheet.render(true);
      await new Promise((r) => setTimeout(r, 800));
      const sheetEl = document.querySelector('[id^="SessionSheet-"]');
      const rendered = !!sheetEl;
      await pageDoc.sheet.close();

      return { stockAnswer, adapterAnswer, rendered, nativeType: pageDoc.type };
    }, RUN);

    expect(result.nativeType).toBe("mej-campaign-companion.session");
    expect(result.adapterAnswer).toBe("session");
    expect(result.rendered).toBe(true);
  });

  test("api mode still resolves when forceNativeMode is off", async ({ page }) => {
    await login(page, "Gamemaster");
    await setForceNative(page, false);

    // Regression coverage for a real bug found live: Foundry drains its
    // pre-ready registerSheet queue exactly once, before game.ready flips.
    // A prior refactor pushed our api-mode registerSheet calls past that
    // drain, so CONFIG.JournalEntryPage.sheetClasses stayed permanently
    // empty for our types and every Session page silently fell back to
    // Foundry's base sheet. Assert both the CONFIG shape and the actual
    // resolved sheet class for a real page, in api mode specifically.
    const result = await page.evaluate(async (run) => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      const sheetClasses = CONFIG.JournalEntryPage.sheetClasses["mej-campaign-companion.session"];
      const sheetClassesRegistered = Object.keys(sheetClasses ?? {}).length > 0;

      const name = `TT${run} api sheet-registration probe`;
      const entry = await JournalEntry.create({
        name, pages: [{ name, type: "mej-campaign-companion.session" }]
      });
      const sheetCtorName = entry.pages.contents[0].sheet?.constructor?.name ?? null;
      await entry.delete();

      return { mode: adapter.currentMode(), sheetClassesRegistered, sheetCtorName };
    }, RUN);

    expect(result.mode).toBe("api");
    expect(result.sheetClassesRegistered).toBe(true);
    expect(result.sheetCtorName).toBe("SessionSheet");
  });

  test("api mode re-stamps a MEJ type flag a stock install scrubbed", async ({ page }) => {
    await login(page, "Gamemaster");
    await setForceNative(page, false);

    // Create a session, then strip its MEJ type flag the way stock MEJ's
    // fixType() would, and confirm the sweep puts it back.
    const result = await page.evaluate(async (run) => {
      const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      const name = `TT${run} heal session`;
      const entry = await JournalEntry.create({ name, pages: [buildSessionPageData(name, "", null, null)] });
      const pageDoc = entry.pages.contents[0];

      await pageDoc.unsetFlag("monks-enhanced-journal", "type");
      const scrubbed = pageDoc.getFlag("monks-enhanced-journal", "type") ?? null;

      const healed = await adapter.healSessionFlags();
      const restored = pageDoc.getFlag("monks-enhanced-journal", "type") ?? null;

      return { scrubbed, healed, restored };
    }, RUN);

    expect(result.scrubbed).toBe(null);
    expect(result.healed).toBeGreaterThanOrEqual(1);
    expect(result.restored).toBe("session");
  });
});
