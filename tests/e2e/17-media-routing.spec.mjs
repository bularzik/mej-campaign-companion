// Native pdf/video page routing e2e (media-routing task 4): Foundry's OWN
// `pdf` and `video` JournalEntryPage types now mount inside MEJ's shell via
// the companion's MediaPageSheet instead of opening a separate Foundry
// window, the knowledge panel injects for them, and the Hub's index derives
// their row type/icon/filter chip from the entry's first page's native type.
//
// WHERE TO INSPECT: these pages mount one level DOWN from the shell subsheet.
// MEJ keeps its own JournalEntrySheet as the subsheet for an entry whose page
// carries no MEJ type flag, and MediaPageSheet renders per page inside it -
// see mountedMediaPage()'s header for the cited mechanism. Assert on the
// rendered DOM first and the page sheet's class second; `ej.subsheet` is the
// wrong object here and reads "JournalEntrySheet" by design.
//
// Harness discipline (World A is the user's REAL world - treat it as
// production): every fixture is TT_PREFIX-named, created through the game
// API rather than by driving UI wizards (fast, and independent per test), and
// torn down BY DOCUMENT ID - the campaign Folder id created by the test
// itself, cascade-deleted, never a name-matched sweep. Each test also
// snapshots/restores autoCaptureCampaign (createCampaign seeds it when the
// world has no campaign yet) and resets both client-scoped Hub settings; the
// describe-level afterAll additionally runs cleanupTimelineJournal(), since
// any GM Hub open can lazily create a "Campaign Timeline" journal.
//
// Every test seeds its own campaign and opens its own shell, so a single
// `--grep "17 media routing.*3\."`-style run of one scenario works standalone.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, withGmPage, cleanupTimelineJournal,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG
} from "./helpers/foundry.mjs";

const MODULE_ID = "mej-campaign-companion";
const CAMPAIGN_STORE_MOD = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";

// PDF.js runs inside the viewer iframe this feature deliberately mounts, and
// its own console output reaches Playwright's page-level console listener.
// trackConsoleErrors tests every ignore pattern against BOTH msg.text() and
// msg.location().url, so a bare "/scripts/pdfjs/" substring would also
// swallow a genuine companion error whose TEXT merely happens to mention
// that path (e.g. a malformed viewerSrc value logged inside an error
// message) even though its location() points at our own code, not PDF.js's.
// Anchored so the path only counts when it forms an actual URL - at the very
// start of the string, or right after a "://host" - which is exactly the
// shape msg.location().url always has for PDF.js's own console output
// (every PDF.js script is served from under that path), so genuine
// PDF.js-origin noise is still caught while a message that just quotes the
// path inside a sentence is not.
const KNOWN_PDFJS_VIEWER_NOISE = /^\/?scripts\/pdfjs\/|:\/\/[^/\s]*\/scripts\/pdfjs\//;
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404, KNOWN_PDFJS_VIEWER_NOISE];

// Real files served by this Foundry install (verified 200 on both):
//   - the sample PDF Foundry's bundled PDF.js ships with, and
//   - one of core's own UI toolclips, a plain (non-YouTube) .webm.
// Neither is world content, so nothing under Data/ is touched by these tests.
const PDF_SRC = "scripts/pdfjs/web/compressed.tracemonkey-pldi-09.pdf";
const VIDEO_SRC = "toolclips/tools/token-select.webm";

// Campaign Folder ids created by any test in this file, so afterAll can sweep
// a survivor from a crashed run BY ID (never by name).
const createdCampaignIds = new Set();

/** Open a journal entry in the MEJ shell (bootstrapping the shell first, as 14-campaigns' openHub does). */
async function openEntry(page, entryId) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 800);
  return page.locator("#MonksEnhancedJournal");
}

/** Open any journal entry (bootstraps the MEJ shell), then the Campaign Hub. Lands on the Index tab. */
async function openHub(page) {
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

/** Select the Hub's campaign-scope <select> ("" = All, "unfiled", or a campaign Folder id). */
async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 300);
}

/** Reset both client-scoped Hub settings this suite can move. */
async function resetHubState(page) {
  await page.evaluate(async (moduleId) => {
    await game.settings.set(moduleId, "hubCampaignScope", "");
    await game.settings.set(moduleId, "hubTimelineSelection", "");
  }, MODULE_ID);
}

async function snapshotCaptureCampaign(page) {
  return page.evaluate((moduleId) => game.settings.get(moduleId, "autoCaptureCampaign"), MODULE_ID);
}

/**
 * Seed a TT- campaign holding the requested native-media entries, entirely
 * through the game API (no UI wizard) so a single scenario runs fast and
 * standalone. `ownership: "observer"` puts both the campaign baseline and the
 * created entries at OBSERVER (the player-seat scenario's precondition);
 * pages are left at Foundry's inherit default.
 */
async function seedMediaCampaign(page, { name, pdf = false, video = false, ownership = "none" }) {
  const seeded = await page.evaluate(async ({ mod, name, pdf, video, pdfSrc, videoSrc, ownership }) => {
    const { createCampaign } = await import(mod);
    const campaign = await createCampaign(name, { ownershipDefault: ownership });
    const level = ownership === "observer"
      ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    const out = { campaignId: campaign.id, pdfId: null, videoId: null };
    if (pdf) {
      const entry = await JournalEntry.create({
        name: `${name} Doc`,
        folder: campaign.id,
        ownership: { default: level },
        pages: [{ name: `${name} Doc`, type: "pdf", src: pdfSrc }]
      });
      out.pdfId = entry.id;
    }
    if (video) {
      const entry = await JournalEntry.create({
        name: `${name} Clip`,
        folder: campaign.id,
        ownership: { default: level },
        pages: [{ name: `${name} Clip`, type: "video", src: videoSrc }]
      });
      out.videoId = entry.id;
    }
    return out;
  }, { mod: CAMPAIGN_STORE_MOD, name, pdf, video, pdfSrc: PDF_SRC, videoSrc: VIDEO_SRC, ownership });
  createdCampaignIds.add(seeded.campaignId);
  return seeded;
}

/** Id-tracked teardown: cascade-delete the campaign Folder this test created, restore the world setting. */
async function teardownSeed(page, campaignId, captureCampaignPrior) {
  await page.evaluate(async ({ moduleId, campaignId, captureCampaignPrior }) => {
    if (campaignId) {
      const folder = game.folders.get(campaignId);
      if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
    }
    if (captureCampaignPrior !== undefined) {
      await game.settings.set(moduleId, "autoCaptureCampaign", captureCampaignPrior ?? "");
    }
  }, { moduleId: MODULE_ID, campaignId, captureCampaignPrior });
  if (campaignId) createdCampaignIds.delete(campaignId);
}

/**
 * What actually rendered for the open entry's first page - inspected ONE LEVEL
 * DOWN from the shell subsheet, which is where these pages mount.
 *
 * MEJ demotes a JournalEntry to its single page (mounting that page's own
 * sheet AS the shell subsheet) only when the page carries
 * `flags.monks-enhanced-journal.type` AND that type is in getDocumentTypes()
 * (enhanced-journal.js:482-493). A native `pdf`/`video` page has no MEJ type
 * flag, and its key can never enter the `externalTypes` map that
 * api.registerSheetType feeds (the reason Session/campaign-portal pages DO get
 * demoted), so the demotion never fires and enhanced-journal.js:538 hard-codes
 * MEJ's own `JournalEntrySheet` as the shell subsheet. That is CORRECT and
 * expected; MediaPageSheet mounts inside it, per page: JournalEntrySheet.js's
 * `getPageSheet()` (:932) resolves `page._getSheetClass()` - our
 * DocumentSheetConfig registration - caches it in `this.sheets[page.id]`, and
 * `_renderPageViews` (:591-604) renders it into a
 * `.journal-entry-page[data-page-id]` container inside the shell DOM.
 *
 * `sheets[pageId]` is read rather than calling `getPageSheet(pageId)`, so this
 * stays a pure observation of what rendered: `getPageSheet()` CONSTRUCTS a
 * sheet on demand and would manufacture a passing answer.
 */
async function mountedMediaPage(page, entryId) {
  return page.evaluate((id) => {
    const ej = game.MonksEnhancedJournal?.journal;
    const shellSheet = ej?.subsheet ?? null;
    const pageDoc = game.journal.get(id)?.pages?.contents?.[0] ?? null;
    const out = {
      // Captured for failure messages, deliberately NOT asserted on: which
      // class the shell itself mounts is MEJ's internal business (see above).
      shellSheetClass: shellSheet?.constructor?.name ?? null,
      pageId: pageDoc?.id ?? null,
      pageSheetClass: null,
      registeredClass: null,
      mediaType: null,
      shellEditable: ej?.isEditable ?? null,
      error: null
    };
    try {
      const pageSheet = shellSheet?.sheets?.[pageDoc?.id] ?? null;
      out.pageSheetClass = pageSheet?.constructor?.name ?? null;
      out.mediaType = pageSheet?.mediaType ?? null;
      out.registeredClass = pageDoc?._getSheetClass?.()?.name ?? null;
    } catch (err) {
      out.error = String(err);
    }
    return out;
  }, entryId);
}

/**
 * Any application window rendered OUTSIDE the MEJ shell that is (or contains)
 * a journal-page viewer - i.e. the separate Foundry window this feature exists
 * to prevent. Checked from both the live application registry and the DOM, so
 * a window that escaped one is still caught by the other.
 */
async function strayPageWindows(page) {
  return page.evaluate(() => {
    const shell = document.querySelector("#MonksEnhancedJournal");
    const outside = (el) => !!el?.isConnected && !(shell && (el === shell || shell.contains(el)));
    const found = new Set();
    const instances = foundry.applications?.instances;
    if (instances) {
      for (const app of instances.values()) {
        let el = null;
        try { el = app.element; } catch { el = null; }
        if (!outside(el)) continue;
        if (el.classList.contains("journal-entry-page") || el.querySelector(".mej-cc-media-page")) {
          found.add(`app:${app.constructor?.name ?? "?"}`);
        }
      }
    }
    for (const el of document.querySelectorAll(".journal-entry-page, .mej-cc-media-page")) {
      const win = el.closest(".application, .window-app, .app") ?? el;
      if (outside(win)) found.add(`dom:${win.id || win.className}`);
    }
    return [...found];
  });
}

/**
 * Every control inside the rendered page view (our media markup, plus the
 * knowledge panel appended beside it) that is currently disabled - i.e. the
 * "frozen viewer" symptom.
 *
 * `_toggleDisabled(true)` is invoked at exactly one site,
 * enhanced-journal.js:646, and always on the SHELL subsheet - which for these
 * entries is MEJ's own JournalEntrySheet, not MediaPageSheet. Its inherited
 * implementation (EnhancedJournalSheet.js:1119-1144) sweeps the whole subsheet
 * element, so it reaches straight through the page-view container into our
 * markup. The property under test is therefore: after MEJ's own sweep has run
 * for a non-owner, the viewer is still usable.
 */
async function disabledInsideMediaMount(page) {
  return page.evaluate(() => {
    const media = document.querySelector("#MonksEnhancedJournal .mej-cc-media-page");
    if (!media) return ["MISSING .mej-cc-media-page"];
    const mount = media.closest(".journal-entry-page") ?? media.parentElement ?? media;
    return [...mount.querySelectorAll("input, select, textarea, button, video, iframe, a")]
      .filter((el) => el.disabled === true || el.hasAttribute("disabled") || el.classList.contains("disabled"))
      .map((el) => `${el.tagName.toLowerCase()}|${el.className || ""}`);
  });
}

test.describe.serial("17 media routing", () => {
  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (page) => {
      await resetHubState(page);
      // Id-tracked survivor sweep only - a crashed test's own campaign Folder,
      // never a name match against World A's real content.
      for (const id of [...createdCampaignIds]) {
        await page.evaluate(async (fid) => {
          const folder = game.folders.get(fid);
          if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
        }, id);
        createdCampaignIds.delete(id);
      }
      // A GM Hub open preps timeline context on every render and can lazily
      // create the legacy singleton "Campaign Timeline"; this only ever
      // removes an empty/TT-only copy, never World A's real legacy content.
      await cleanupTimelineJournal(page);
    });
  });

  test("1. a pdf page opens inside the MEJ shell, not a separate window", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const captureCampaignPrior = await snapshotCaptureCampaign(page);
    let seeded = null;
    try {
      seeded = await seedMediaCampaign(page, { name: `${TT_PREFIX}MediaPdf`, pdf: true });

      const shell = await openEntry(page, seeded.pdfId);
      const mounted = await mountedMediaPage(page, seeded.pdfId);

      // PRIMARY CHECK - the DOM: our viewer markup really rendered, inside the
      // shell's own page-view container. Class resolution (below) only proves
      // the registration resolved; this is what the user actually sees.
      const pageView = shell.locator(`.journal-entry-page[data-page-id="${mounted.pageId}"]`);
      await expect(pageView).toHaveCount(1);
      // The assertion that caught the detached-element bug: MEJ transplants a
      // page sheet's rendered element into this container, and a sheet that
      // breaks ApplicationV2's awaitable render contract is silently never
      // transplanted (see MediaPageSheet's render() override).

      await expect(pageView.locator(".mej-cc-media-page")).toHaveCount(1);
      // Inside the shell chrome - and nowhere else on the page.
      await expect(shell.locator(".mej-cc-media-page")).toHaveCount(1);
      await expect(page.locator(".mej-cc-media-page")).toHaveCount(1);

      // With a real src, the PDF.js viewer iframe (not the raw file, not the
      // missing-src notice) is what renders.
      const iframe = pageView.locator("iframe.mej-cc-media-pdf");
      await expect(iframe).toHaveCount(1);
      await expect(iframe).toHaveAttribute("src", /scripts\/pdfjs\/web\/viewer\.html\?file=/);
      await expect(shell.locator(".mej-cc-media-page p.notes")).toHaveCount(0);
      await expect(shell.locator("video.mej-cc-media-video")).toHaveCount(0);

      // ...and it is genuinely OUR sheet that produced it (see
      // mountedMediaPage's header for why this is read one level down from
      // the shell subsheet, not off `ej.subsheet`).
      expect(mounted.error).toBeNull();
      expect(mounted.registeredClass).toBe("MediaPageSheet");
      expect(mounted.pageSheetClass).toBe("MediaPageSheet");
      expect(mounted.mediaType).toBe("pdf");

      // The scenario's real point: no standalone journal-page window opened
      // outside the shell.
      expect(await strayPageWindows(page)).toEqual([]);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
      await teardownSeed(page, seeded?.campaignId ?? null, captureCampaignPrior);
    }
  });

  test("2. a video page mounts the native video element with working controls", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const captureCampaignPrior = await snapshotCaptureCampaign(page);
    let seeded = null;
    try {
      seeded = await seedMediaCampaign(page, { name: `${TT_PREFIX}MediaVid`, video: true });

      const shell = await openEntry(page, seeded.videoId);
      const mounted = await mountedMediaPage(page, seeded.videoId);

      const pageView = shell.locator(`.journal-entry-page[data-page-id="${mounted.pageId}"]`);
      await expect(pageView).toHaveCount(1);
      await expect(pageView.locator(".mej-cc-media-page")).toHaveCount(1);
      await expect(shell.locator(".mej-cc-media-page")).toHaveCount(1);
      await expect(page.locator(".mej-cc-media-page")).toHaveCount(1);
      expect(await strayPageWindows(page)).toEqual([]);

      // A plain (non-YouTube) source mounts a real <video>, carrying controls -
      // not the YouTube embed branch, not the missing-src notice.
      const video = pageView.locator("video.mej-cc-media-video");
      await expect(video).toHaveCount(1);
      await expect(video).toHaveAttribute("src", VIDEO_SRC);
      expect(await video.getAttribute("controls")).not.toBeNull();
      await expect(video).toHaveJSProperty("controls", true);
      expect(await video.getAttribute("disabled")).toBeNull();
      await expect(shell.locator("iframe.mej-cc-media-youtube")).toHaveCount(0);
      await expect(shell.locator(".mej-cc-media-page p.notes")).toHaveCount(0);

      expect(mounted.error).toBeNull();
      expect(mounted.registeredClass).toBe("MediaPageSheet");
      expect(mounted.pageSheetClass).toBe("MediaPageSheet");
      expect(mounted.mediaType).toBe("video");

      // Nothing in the rendered page view is frozen. This is the GM (editable)
      // baseline for the _toggleDisabled regression; the non-owner case, where
      // MEJ's sweep actually runs, is scenario 5.
      //
      // Deliberately NOT done here: calling `_toggleDisabled(true)` by hand to
      // simulate the non-owner path. That call site (enhanced-journal.js:646)
      // always targets the SHELL subsheet, which for these entries is MEJ's own
      // JournalEntrySheet - so a manual call would run MEJ's real sweep over
      // the whole subsheet element and correctly disable the GM knowledge
      // panel's tag input, failing this assertion against entirely correct
      // behavior. Scenario 5 gets the real thing from a real player seat.
      expect(await disabledInsideMediaMount(page)).toEqual([]);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
      await teardownSeed(page, seeded?.campaignId ?? null, captureCampaignPrior);
    }
  });

  test("3. the knowledge panel injects for media pages", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const captureCampaignPrior = await snapshotCaptureCampaign(page);
    let seeded = null;
    try {
      seeded = await seedMediaCampaign(page, { name: `${TT_PREFIX}MediaKnow`, pdf: true });

      const shell = await openEntry(page, seeded.pdfId);
      const mounted = await mountedMediaPage(page, seeded.pdfId);
      const pageView = shell.locator(`.journal-entry-page[data-page-id="${mounted.pageId}"]`);
      await expect(pageView.locator(".mej-cc-media-page")).toHaveCount(1);

      // Injected into the same page view as the viewer, and genuinely rendered
      // (not an empty husk): its editable GM affordances are present.
      const panel = pageView.locator(".mej-cc-knowledge");
      await expect(panel).toHaveCount(1);
      await expect(panel.locator(".mej-cc-tag-input")).toHaveCount(1);
      await expect(panel.locator(".mej-cc-attr-add")).toHaveCount(1);
      // It is bound to THIS page, not some other still-open sheet's document.
      const pageUuid = await page.evaluate(
        (id) => game.journal.get(id)?.pages?.contents?.[0]?.uuid ?? null, seeded.pdfId);
      expect(pageUuid).toBeTruthy();
      await expect(panel).toHaveAttribute("data-page-uuid", pageUuid);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
      await teardownSeed(page, seeded?.campaignId ?? null, captureCampaignPrior);
    }
  });

  test("4. media entries get their own Hub index rows and filter chips", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const captureCampaignPrior = await snapshotCaptureCampaign(page);
    const NAME = `${TT_PREFIX}MediaRows`;
    let seeded = null;
    try {
      seeded = await seedMediaCampaign(page, { name: NAME, pdf: true, video: true });

      const shell = await openHub(page);
      await scopeHub(shell, page, seeded.campaignId);

      const pdfRow = shell.locator("li.mej-cc-index-row", { hasText: `${NAME} Doc` });
      const videoRow = shell.locator("li.mej-cc-index-row", { hasText: `${NAME} Clip` });
      await expect(pdfRow).toHaveCount(1);
      await expect(videoRow).toHaveCount(1);

      // Row type derived from the entry's FIRST page's native type: the pdf
      // entry is a "Document" with the pdf icon, the video a "Recording" with
      // the film icon - neither falls back to the generic Journal/book pair.
      await expect(pdfRow.locator("i.mej-cc-index-icon")).toHaveClass(/fa-file-pdf/);
      await expect(pdfRow.locator("i.mej-cc-index-icon")).not.toHaveClass(/fa-book/);
      await expect(pdfRow.locator(".mej-cc-index-type")).toHaveText("Document");
      await expect(videoRow.locator("i.mej-cc-index-icon")).toHaveClass(/fa-film/);
      await expect(videoRow.locator("i.mej-cc-index-icon")).not.toHaveClass(/fa-book/);
      await expect(videoRow.locator(".mej-cc-index-type")).toHaveText("Recording");

      // The type-filter menu offers a chip per row type present in scope.
      await shell.locator('button.mej-cc-doctype-summary[data-action="toggleTypeMenu"]').click();
      await settle(page, 200);
      const menu = shell.locator("div.mej-cc-doctype-menu");
      await expect(menu).toBeVisible();
      const docOption = menu.locator("label.mej-cc-doctype-option", { hasText: "Document" });
      const recOption = menu.locator("label.mej-cc-doctype-option", { hasText: "Recording" });
      await expect(docOption).toHaveCount(1);
      await expect(recOption).toHaveCount(1);
      await expect(docOption.locator("i")).toHaveClass(/fa-file-pdf/);
      await expect(recOption.locator("i")).toHaveClass(/fa-film/);

      // Checking both types is the "everything in scope" selection; unchecking
      // Document must drop the pdf row alone and leave the video row listed.
      await docOption.locator('input[name="doctype-check"]').check();
      await settle(page, 300);
      await menu.locator("label.mej-cc-doctype-option", { hasText: "Recording" })
        .locator('input[name="doctype-check"]').check();
      await settle(page, 300);
      await expect(pdfRow).toHaveCount(1);
      await expect(videoRow).toHaveCount(1);

      await menu.locator("label.mej-cc-doctype-option", { hasText: "Document" })
        .locator('input[name="doctype-check"]').uncheck();
      await settle(page, 300);
      await expect(pdfRow).toHaveCount(0);
      await expect(videoRow).toHaveCount(1);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
      await teardownSeed(page, seeded?.campaignId ?? null, captureCampaignPrior);
    }
  });

  test("5. player seat: observer can view a media page, sees no GM chrome", async ({ browser }) => {
    const NAME = `${TT_PREFIX}MediaPlayer`;
    let seeded = null;
    let captureCampaignPrior;

    // GM pre-creates the campaign at the OBSERVER baseline, then disconnects -
    // the player seat below is a genuinely separate client.
    await withGmPage(browser, async (gmPage) => {
      captureCampaignPrior = await snapshotCaptureCampaign(gmPage);
      seeded = await seedMediaCampaign(gmPage, { name: NAME, pdf: true, ownership: "observer" });
    });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await context.newPage();
    const playerErrors = trackConsoleErrors(playerPage, {
      ignore: [...IGNORE, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG]
    });
    try {
      await login(playerPage, "User 1");
      const shell = await openEntry(playerPage, seeded.pdfId);
      const mounted = await mountedMediaPage(playerPage, seeded.pdfId);

      const pageView = shell.locator(`.journal-entry-page[data-page-id="${mounted.pageId}"]`);
      await expect(pageView).toHaveCount(1);
      await expect(pageView.locator(".mej-cc-media-page")).toHaveCount(1);
      await expect(playerPage.locator(".mej-cc-media-page")).toHaveCount(1);
      await expect(pageView.locator("iframe.mej-cc-media-pdf")).toHaveCount(1);
      expect(await strayPageWindows(playerPage)).toEqual([]);

      expect(mounted.error).toBeNull();
      expect(mounted.registeredClass).toBe("MediaPageSheet");
      expect(mounted.pageSheetClass).toBe("MediaPageSheet");
      expect(mounted.mediaType).toBe("pdf");
      // Precondition that makes the freeze assertions below non-vacuous: the
      // shell regards this mount as non-editable for an OBSERVER, which is the
      // exact gate on enhanced-journal.js:646 - so MEJ's blanket
      // _toggleDisabled(true) sweep DID run across this page view.
      expect(mounted.shellEditable).toBe(false);

      // Forward guard, not proof that MediaPageSheet's _toggleDisabled
      // no-op override is load-bearing here: MEJ's sweep is invoked on the
      // SHELL subsheet (MEJ's own JournalEntrySheet for these entries, see
      // that override's comment), and media-page.hbs has no
      // input/select/textarea/button for the sweep to reach in the first
      // place, while knowledge-panel.hbs already gates every input on
      // canEdit for a non-owner - so disabledInsideMediaMount() returns []
      // regardless of whether our override exists. What this actually
      // guards is a future regression: sweepable markup added to the media
      // mount, or a change to the knowledge panel's non-owner gating.
      const external = pageView.locator("a.mej-cc-media-external");
      await expect(external).toHaveCount(1);
      expect(await external.getAttribute("disabled")).toBeNull();
      await expect(external).not.toHaveClass(/\bdisabled\b/);
      expect(await disabledInsideMediaMount(playerPage)).toEqual([]);

      // No GM chrome anywhere on the player's screen.
      await expect(playerPage.locator(".mej-cc-edit-campaign")).toHaveCount(0);

      assertNoConsoleErrors(playerErrors);
    } finally {
      await context.close();
      await withGmPage(browser, async (gmPage) => {
        await resetHubState(gmPage);
        await teardownSeed(gmPage, seeded?.campaignId ?? null, captureCampaignPrior);
      });
    }
  });
});
