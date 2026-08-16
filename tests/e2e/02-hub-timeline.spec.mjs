import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm,
  trackConsoleErrors, assertNoConsoleErrors, settle
} from "./helpers/foundry.mjs";

const BASE_URL = "http://localhost:30000";

/** Open any journal entry (so the MEJ shell + its toolbar exist), then click
 * the Campaign Hub toolbar button. Returns the shell locator. */
async function openHubViaToolbar(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  const anyEntryId = await page.evaluate(() => game.journal.contents[0]?.id);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function cleanupTimelineJournal(page) {
  // The world's singleton timeline journal (Task 6) is tracked by a world
  // setting storing its id (data/timeline-journal.mjs), named "Campaign
  // Timeline" by ensureTimelineJournal() — clear it back out (and reset the
  // setting) so specs don't leak timepoints/links between runs. Deletes
  // *every* matching doc, not just the first: CampaignHubPage.mjs's
  // _prepareBodyContext preps the timeline tab's context (calling
  // ensureTimelineJournal()) on every render regardless of which tab is
  // active, so simply opening the Hub as GM can create this journal as a
  // side effect even in tests that never touch a timepoint.
  await page.evaluate(async () => {
    const ids = game.journal.filter((e) => e.name === "Campaign Timeline").map((e) => e.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
  });
}

test.describe("02 hub + timeline", () => {
  // Tests in this spec mix the default `page` fixture with tests that open
  // their own `browser` contexts (two-client tests) — an afterEach that
  // takes `page` still gets Playwright's default, never-logged-in page for
  // the latter regardless of what the test itself used. cleanupAsGm() reuses
  // `page` directly when it's already a live GM session (every test using
  // `page` alone); opening a *second* simultaneous GM session via
  // withGmPage() while the test's own `page` was still connected (Playwright
  // doesn't tear it down until after all hooks complete) was tried first and
  // confirmed live to silently fail — deleteDocuments() reported success
  // (deletedCount > 0, no thrown error) but the document reliably survived,
  // every time, only in that combination. See cleanupAsGm()'s own doc
  // comment.
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gmPage) => cleanupTimelineJournal(gmPage));
  });

  test("opens from the toolbar; reopens cleanly after a reload", async ({ page }) => {
    // NOTE narrowed from the brief's "tab persists across reload": verified
    // live that MEJ's own EnhancedJournal window does not survive a page
    // reload at all, for *any* tab (built-in entries included, not just the
    // Hub) — game.MonksEnhancedJournal.journal is simply unset after a fresh
    // page load, and its per-user "recently open tabs" bookkeeping
    // (tab.entityId/saveTabs(), apps/enhanced-journal.js) isn't restored
    // automatically either. This is a pre-existing MEJ characteristic, not
    // a companion bug or regression — asserting the shell "persists" would
    // be asserting something no MEJ tab does. What's verified here instead:
    // the Hub can be reopened cleanly post-reload (no stale state/errors).
    const errors = trackConsoleErrors(page);
    await login(page, "Gamemaster");
    const shell = await openHubViaToolbar(page);
    await expect(shell.locator(".mej-cc-hub-container")).toHaveCount(1);
    await expect(shell.locator('nav.sheet-tabs a[data-tab="index"]')).toHaveCount(1);

    await page.goto(`${BASE_URL}/game`);
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await settle(page, 500);
    const reopened = await openHubViaToolbar(page);
    await expect(reopened.locator(".mej-cc-hub-container")).toHaveCount(1);

    assertNoConsoleErrors(errors);
  });

  test("timepoint CRUD and drag-reorder", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page, "Gamemaster");
    const shell = await openHubViaToolbar(page);
    await shell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await settle(page, 200);

    // Create two timepoints.
    for (const label of [`${TT_PREFIX}Point A`, `${TT_PREFIX}Point B`]) {
      await shell.locator("button.mej-cc-add-timepoint").click();
      const dialog = page.locator("dialog.application").last();
      await dialog.locator('input[name="label"]').fill(label);
      await dialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);
    }
    await expect(shell.locator("li.mej-cc-timepoint")).toHaveCount(2);
    const labels = await shell.locator("li.mej-cc-timepoint").allTextContents();
    expect(labels.some((l) => l.includes("Point A"))).toBe(true);
    expect(labels.some((l) => l.includes("Point B"))).toBe(true);

    // Rename the first.
    const first = shell.locator("li.mej-cc-timepoint").first();
    await first.locator('button[data-action="renameTimepoint"]').click();
    const renameDialog = page.locator("dialog.application").last();
    await renameDialog.locator('input[name="label"]').fill(`${TT_PREFIX}Point A Renamed`);
    await renameDialog.locator('button[data-action="ok"]').click();
    await settle(page, 400);
    await expect(shell.locator("li.mej-cc-timepoint").first()).toContainText("Point A Renamed");

    // Drag-reorder: move the (now second) "Point B" before "Point A Renamed"
    // via the same synthetic-drop technique as 01-session's relationship
    // drag — Foundry's DragDrop reads a plain {kind,id} JSON payload from
    // dataTransfer, no OS-level pointer drag required to exercise the real
    // drop handler.
    const secondId = await shell.locator("li.mej-cc-timepoint").nth(1).getAttribute("data-timepoint-id");
    await page.evaluate(({ id }) => {
      const target = document.querySelector("li.mej-cc-timepoint[data-timepoint-id]");
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ kind: "mej-campaign-companion.timepoint", id }));
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    }, { id: secondId });
    await settle(page, 500);
    const orderAfterDrag = await shell.locator("li.mej-cc-timepoint").allTextContents();
    expect(orderAfterDrag[0]).toContain("Point B");

    // Delete both.
    for (let i = 0; i < 2; i++) {
      await shell.locator("li.mej-cc-timepoint").first().locator('button[data-action="deleteTimepoint"]').click();
      const confirmDialog = page.locator("dialog.application").last();
      await confirmDialog.locator('button[data-action="yes"]').click();
      await settle(page, 400);
    }
    await expect(shell.locator("li.mej-cc-timepoint")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("dropping a person entry and an image onto a timepoint", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page, "Gamemaster");

    const personId = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Hub Drop Person`,
        pages: [{ name: `${prefix}Hub Drop Person`, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      return entry.id;
    }, TT_PREFIX);
    const personUuid = await page.evaluate((id) => game.journal.get(id).uuid, personId);

    const shell = await openHubViaToolbar(page);
    await shell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await settle(page, 200);
    await shell.locator("button.mej-cc-add-timepoint").click();
    const dialog = page.locator("dialog.application").last();
    await dialog.locator('input[name="label"]').fill(`${TT_PREFIX}Drop Target`);
    await dialog.locator('button[data-action="ok"]').click();
    await settle(page, 400);

    // Drop the person entry onto the timepoint row.
    await page.evaluate(({ uuid }) => {
      const target = document.querySelector("li.mej-cc-timepoint[data-timepoint-id]");
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "JournalEntry", uuid }));
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    }, { uuid: personUuid });
    await settle(page, 500);
    await expect(shell.locator(`li.mej-cc-timepoint .mej-cc-link-chip[data-uuid="${personUuid}"]`)).toHaveCount(1);

    // Drop an image (Foundry-recognized path, not a raw OS file) onto the
    // same timepoint — accepts a text/uri-list fallback per timeline-links.mjs.
    page.once("dialog", (d) => d.accept());
    await page.evaluate(() => {
      const target = document.querySelector("li.mej-cc-timepoint[data-timepoint-id]");
      const dt = new DataTransfer();
      dt.setData("text/uri-list", "icons/svg/mystery-man.svg");
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    });
    await settle(page, 400);
    // A confirm dialog ("show to players?") may appear via DialogV2 rather
    // than a native window.confirm — handle both.
    const confirmBtn = page.locator('dialog.application button[data-action="yes"]');
    if (await confirmBtn.count()) await confirmBtn.click();
    await settle(page, 400);

    const links = await page.evaluate(async () => {
      const j = game.journal.find((e) => e.name === "Campaign Timeline");
      const tp = j?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.[0];
      return tp?.links ?? [];
    });
    // Both drops above landed on the same timepoint (the person entry, then
    // the image) - a >= 1 assertion here would pass even if the second drop
    // (the image) silently failed to attach, so require both links present.
    expect(links.length).toBeGreaterThanOrEqual(2);

    await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, personId);
    assertNoConsoleErrors(errors);
  });

  test("index row click opens the entry in MEJ; player sees no CRUD and no GM-hidden image links", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const personId = await gmPage.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Index Row Person`,
        pages: [{ name: `${prefix}Index Row Person`, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } } }],
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      return entry.id;
    }, TT_PREFIX);
    const personUuid = await gmPage.evaluate((id) => game.journal.get(id).uuid, personId);

    const gmShell = await openHubViaToolbar(gmPage);
    await settle(gmPage, 300);
    const row = gmShell.locator(`li.mej-cc-index-row[data-uuid="${personUuid}"]`);
    await expect(row).toHaveCount(1);
    await row.click();
    await settle(gmPage, 400);
    const opened = await gmPage.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name);
    expect(opened).toBe("PersonSheet");

    // Add both a GM-hidden AND a player-visible image link on a fresh
    // timepoint. The visible one is a positive control: without it, a
    // player-side render that failed entirely (blank Hub, wrong tab, a
    // client that never actually logged in) would make every "absence"
    // assertion below pass vacuously. Asserting the visible link shows up
    // proves the player's timeline tab genuinely rendered before we trust
    // it to correctly *omit* the hidden one and the CRUD controls.
    await gmShell.locator(".nav-button.campaign-hub").click();
    await settle(gmPage, 300);
    await gmShell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await settle(gmPage, 200);
    await gmShell.locator("button.mej-cc-add-timepoint").click();
    const dialog = gmPage.locator("dialog.application").last();
    await dialog.locator('input[name="label"]').fill(`${TT_PREFIX}Player View Point`);
    await dialog.locator('button[data-action="ok"]').click();
    await settle(gmPage, 400);
    await gmPage.evaluate(async () => {
      const j = game.journal.find((e) => e.name === "Campaign Timeline");
      const timeline = foundry.utils.duplicate(j.getFlag("mej-campaign-companion", "timeline"));
      timeline.timepoints[0].links = [
        { id: foundry.utils.randomID(), src: "icons/svg/hazard.svg", name: "GM-only", showPlayers: false },
        { id: foundry.utils.randomID(), src: "icons/svg/mystery-man.svg", name: "Visible-to-players", showPlayers: true }
      ];
      await j.setFlag("mej-campaign-companion", "timeline", timeline);
    });

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage);
    await login(playerPage, "User 1");
    const playerShell = await openHubViaToolbar(playerPage);
    await settle(playerPage, 300);
    await playerShell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await settle(playerPage, 200);
    // Positive control first.
    await expect(playerShell.locator('.mej-cc-link-chip[data-src="icons/svg/mystery-man.svg"]')).toHaveCount(1);
    await expect(playerShell.locator('button.mej-cc-add-timepoint')).toHaveCount(0);
    await expect(playerShell.locator('.mej-cc-link-chip[data-src="icons/svg/hazard.svg"]')).toHaveCount(0);

    assertNoConsoleErrors(errors);
    // Close both clients *before* deleting — same MEJ-side edge case as
    // 01-session.spec.mjs's cleanup ordering: any client with the MEJ shell
    // open (even just on the Hub, which lists every entry in its index) can
    // hit EnhancedJournal.renderSubSheet's unrelated compendium-visibility
    // bug when a document it can see gets deleted out from under it.
    await playerContext.close();
    await gmContext.close();
    const cleanupContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const cleanupPage = await cleanupContext.newPage();
    await login(cleanupPage, "Gamemaster");
    await cleanupPage.evaluate(async (id) => {
      const entry = game.journal.get(id);
      if (entry) await JournalEntry.implementation.deleteDocuments([id]);
    }, personId);
    await cleanupContext.close();
  });

  test("type-filter menu and sort menu open, and their state survives a Hub re-render", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page, "Gamemaster");
    const shell = await openHubViaToolbar(page);
    await settle(page, 300);

    await shell.locator('button.mej-cc-doctype-summary[data-action="toggleTypeMenu"]').click();
    await settle(page, 200);
    await expect(shell.locator("div.mej-cc-doctype-menu")).toBeVisible();

    await shell.locator('button.mej-cc-sort-summary[data-action="toggleSortMenu"]').click();
    await settle(page, 200);
    // Opening the sort menu closes the type menu (Task 7's fix — only one
    // menu open at a time) and the sort menu itself opens.
    await expect(shell.locator("div.mej-cc-sort-menu")).toBeVisible();

    // Trigger a re-render through the *shell* (not subsheet.render(), which
    // just repaints the same instance in place and would pass here even if
    // Task 7's fix were reverted — it never exercises the reuse-vs-
    // reconstruct decision the fix is actually about). EnhancedJournal's own
    // render() re-evaluates whether to *reuse* the mounted subsheet instance
    // or construct a fresh CampaignHubPage
    // (this.subsheet.type != this.document.type, apps/enhanced-journal.js's
    // renderSubSheet). Task 7's fix is the instance `get type()` mirror that
    // makes that comparison correctly evaluate to "equal" (reuse) for the
    // Hub; before it, subsheet.type always read undefined, so the shell
    // reconstructed a brand new instance on *every* render. So — counter to
    // an earlier draft of this test, which had the polarity backwards — the
    // fix being in place is what *avoids* reconstruction: assert the same
    // instance survives the shell-level render (confirmed live: it does,
    // with the fix present; reverting Task 7's `get type()` mirror would
    // flip this to false, a fresh instance every time), and that its own
    // `type`/`constructor.type` genuinely mirror HUB_PAGE_ID. The sort menu
    // — HUB_STATE, module-scope regardless of instance identity — surviving
    // on top of that is confirmation the whole path holds together, not the
    // primary signal for Task 7's fix itself (module-scope state would
    // survive a reconstruction too).
    const beforeInfo = await page.evaluate(() => {
      const s = game.MonksEnhancedJournal.journal.subsheet;
      s.__task14Marker = true;
      return { type: s.type, ctorType: s.constructor.type, className: s.constructor.name };
    });
    expect(beforeInfo).toEqual({ type: "campaign-hub", ctorType: "campaign-hub", className: "CampaignHubPage" });

    await page.evaluate(async () => { await game.MonksEnhancedJournal.journal.render(); });
    await settle(page, 400);
    const afterInfo = await page.evaluate(() => {
      const s = game.MonksEnhancedJournal.journal.subsheet;
      return { className: s?.constructor?.name, sameInstance: s?.__task14Marker === true };
    });
    expect(afterInfo.className).toBe("CampaignHubPage");
    expect(afterInfo.sameInstance).toBe(true);
    await expect(shell.locator("div.mej-cc-sort-menu")).toBeVisible();

    assertNoConsoleErrors(errors);
  });
});
