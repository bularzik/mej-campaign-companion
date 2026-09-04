// Timeline journal affordance (spec 2026-09-03 §C/§D): opening a campaign's
// "<name> — Timeline" journal - sidebar click, sheet.render(), player or GM,
// api or native mode - opens the Hub on its Timeline tab with that timeline
// selected and never shows the generic JournalEntry editor. Fixtures are a
// single TT- campaign created by createCampaign() and deleted by id in
// afterAll (folder cascade covers the portal and the timeline journal).
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, trackConsoleErrors, assertNoConsoleErrors, reloadGame, settle, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const RUN = Date.now().toString(36).slice(-5);
const CAMPAIGN_NAME = `TT-TLOPEN ${RUN}`;
const CAMPAIGN_STORE_MOD = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const TIMELINE_JOURNAL_MOD = "/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs";
const ADAPTER_MOD = "/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs";
const SHEET_CLASS = "mej-campaign-companion.TimelineJournalSheet";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

let campaignId = null;
let timelineId = null;

async function createFixture(page) {
  const created = await page.evaluate(async ({ storeMod, tlMod, name }) => {
    const { createCampaign } = await import(storeMod);
    const { ensureTimelineJournal } = await import(tlMod);
    const campaign = await createCampaign(name, { ownershipDefault: "observer" });
    const timeline = await ensureTimelineJournal(campaign);
    return { campaignId: campaign.id, timelineId: timeline.id, sheetClass: timeline.getFlag("core", "sheetClass") };
  }, { storeMod: CAMPAIGN_STORE_MOD, tlMod: TIMELINE_JOURNAL_MOD, name: CAMPAIGN_NAME });
  campaignId = created.campaignId;
  timelineId = created.timelineId;
  return created;
}

/** Click the real sidebar row's action anchor in-page (see 13-stock-smoke for why not locator.click()). */
async function clickSidebarRow(page, id) {
  await page.evaluate(async () => { await ui.journal.activate(); });
  const row = page.locator(`#journal .directory-item[data-entry-id="${id}"]`).first();
  await expect(row).toHaveCount(1);
  await row.evaluate((el) => el.querySelector("a.entry-name").click());
}

/**
 * Where the Hub is (shell subsheet in api mode, standalone window in native),
 * which tab is active, what the picker shows, and whether any sheet for `id`
 * rendered. `.mej-cc-hub-container`, not hub.hbs's outer `.mej-cc-hub`: that
 * outer div is the root PART element, which Foundry (and MEJ's own
 * renderSubSheet) flattens into the application root - it never reaches the
 * DOM. Same selector every other Hub spec uses.
 */
async function hubState(page, id) {
  return page.evaluate((journalId) => {
    const shell = game.MonksEnhancedJournal?.journal;
    const shellHub = shell?.rendered && shell.subsheet?.constructor?.name === "CampaignHubPage" ? shell.element : null;
    const root = shellHub ?? document.querySelector('[id^="CampaignHubPage-"]');
    const hub = root?.querySelector(".mej-cc-hub-container") ?? null;
    const journalSheets = [...foundry.applications.instances.values()]
      .filter((a) => a.rendered && a.document?.id === journalId)
      .map((a) => a.constructor.name);
    return {
      hubOpen: !!hub,
      viaShell: !!shellHub,
      activeTab: hub?.querySelector("div.tab.active")?.dataset?.tab ?? null,
      picker: hub?.querySelector("select.mej-cc-timeline-select")?.value ?? null,
      journalSheets
    };
  }, id);
}

async function expectHubOnTimeline(page, id) {
  await expect.poll(async () => (await hubState(page, id)).activeTab, { timeout: 15_000 }).toBe("timeline");
  const state = await hubState(page, id);
  expect(state.hubOpen).toBe(true);
  expect(state.picker).toBe(id);
  expect(state.journalSheets).toEqual([]);
  return state;
}

test.describe("20 timeline journal open", () => {
  test.describe.configure({ mode: "serial" });

  let scopeBefore = null;
  let selectionBefore = null;

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (page) => {
      await page.evaluate(async ({ cid, scope, selection }) => {
        await game.settings.set("mej-campaign-companion", "forceNativeMode", false);
        if (scope !== null) await game.settings.set("mej-campaign-companion", "hubCampaignScope", scope);
        if (selection !== null) await game.settings.set("mej-campaign-companion", "hubTimelineSelection", selection);
        const f = cid ? game.folders.get(cid) : null;
        if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
      }, { cid: campaignId, scope: scopeBefore, selection: selectionBefore });
    });
  });

  test("1. a new timeline journal is stamped with the redirect sheet class", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    [scopeBefore, selectionBefore] = await page.evaluate(() => [
      game.settings.get("mej-campaign-companion", "hubCampaignScope"),
      game.settings.get("mej-campaign-companion", "hubTimelineSelection")
    ]);
    const created = await createFixture(page);
    expect(created.sheetClass).toBe(SHEET_CLASS);
    assertNoConsoleErrors(errors);
  });

  test("2. api mode: sidebar click opens the Hub on that timeline, no journal editor", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await clickSidebarRow(page, timelineId);
    const state = await expectHubOnTimeline(page, timelineId);
    expect(state.viaShell).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("3. api mode: sheet.render(true) (content links, fromUuid) takes the same route", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    // Open the Hub on ANOTHER scope first, so the hand-off is exercised
    // against an already-open Hub instance (Task 3 review ruling) rather
    // than a fresh one that would read the setting anyway.
    await page.evaluate(async (mod) => {
      const adapter = await import(mod);
      await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
      await adapter.openHub();
    }, ADAPTER_MOD);
    // viaShell, not just hubOpen, on BOTH the bootstrap and the assertion:
    // hubState() falls back to the standalone `[id^="CampaignHubPage-"]`
    // window, so a run where the dynamically imported adapter resolved with
    // mode === null would take openHub()'s native branch and still satisfy
    // hubOpen - going green without ever exercising the api-mode
    // already-open-shell hand-off this test exists to cover.
    await expect.poll(async () => (await hubState(page, timelineId)).viaShell, { timeout: 15_000 }).toBe(true);
    await page.evaluate(async (id) => {
      const journal = game.journal.get(id);
      await journal.sheet.render(true);
    }, timelineId);
    const state = await expectHubOnTimeline(page, timelineId);
    expect(state.viaShell).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("4. a player who can see the journal gets the Hub too", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    await clickSidebarRow(page, timelineId);
    await expectHubOnTimeline(page, timelineId);
    assertNoConsoleErrors(errors);
  });

  test("5. v5 migration stamps a pre-existing timeline journal lacking the sheet class", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    expect(versionBefore).toBe(5);
    await page.evaluate(async (id) => {
      await game.journal.get(id).unsetFlag("core", "sheetClass");
      await game.settings.set("mej-campaign-companion", "dataVersion", 4);
    }, timelineId);
    await reloadGame(page);
    await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 5, null, { timeout: 60_000 });
    const stamped = await page.evaluate((id) => game.journal.get(id).getFlag("core", "sheetClass"), timelineId);
    expect(stamped).toBe(SHEET_CLASS);
    assertNoConsoleErrors(errors);
  });

  /** fa-timeline class on the row icon inside `root` (core sidebar or MEJ shell sidebar). */
  async function rowIconClass(page, id, root) {
    return page.evaluate(({ journalId, which }) => {
      const scope = which === "shell" ? game.MonksEnhancedJournal?.journal?.element : document.querySelector("#journal");
      return scope?.querySelector(`[data-entry-id="${journalId}"] .entry-name .journal-type`)?.className ?? null;
    }, { journalId: id, which: root });
  }

  test("6. the row carries the timeline icon on both sidebars (api mode)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await page.evaluate(async () => { await ui.journal.activate(); });
    await expect.poll(() => rowIconClass(page, timelineId, "core"), { timeout: 15_000 }).toContain("fa-timeline");
    await clickSidebarRow(page, timelineId);
    await expectHubOnTimeline(page, timelineId);
    await expect.poll(() => rowIconClass(page, timelineId, "shell"), { timeout: 15_000 }).toContain("fa-timeline");
    assertNoConsoleErrors(errors);
  });

  test("7. native mode: sidebar click opens the standalone Hub window on the timeline; icon present", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await page.evaluate(async () => { await game.settings.set("mej-campaign-companion", "forceNativeMode", true); });
    await reloadGame(page);
    // Foundry rebuilds CONFIG.*.sheetClasses asynchronously after ready (see 12-native-mode.spec.mjs).
    await settle(page, 2500);
    try {
      await page.evaluate(async () => { await ui.journal.activate(); });
      await expect.poll(() => rowIconClass(page, timelineId, "core"), { timeout: 15_000 }).toContain("fa-timeline");
      await clickSidebarRow(page, timelineId);
      const state = await expectHubOnTimeline(page, timelineId);
      expect(state.viaShell).toBe(false);
    } finally {
      await page.evaluate(async () => { await game.settings.set("mej-campaign-companion", "forceNativeMode", false); });
    }
    assertNoConsoleErrors(errors);
  });
});
