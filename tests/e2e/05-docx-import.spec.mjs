import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, cleanupTimelineJournal,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const DOCX_PATH = "/Users/danbularzik/Claude/Projects/campaign-record/examples/Radiant Citadel.docx";

async function openImportWizard(page) {
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
  await shell.locator("button.mej-cc-import-open").click();
  await settle(page, 300);
  return { shell, wizard: page.locator(".mej-cc-import-wizard-app") };
}

// Imported entries aren't TT_PREFIX-ed (the wizard names each entry after its
// docx section heading verbatim, not after anything this suite controls), so
// cleanup can't rely on that convention the way every other spec's cleanup
// does. `exactNames` is the real list of section titles the test itself saw
// the wizard about to create (captured from the review table before
// `createImport` runs) - deleting by that exact set, rather than only a
// best-guess prefix regex, means cleanup actually removes what this run
// created even if a title doesn't happen to match the regex below. The regex
// is kept as a secondary safety net for any pre-existing leaked docs from an
// earlier failed run (e.g. before this exact-name list existed).
//
// `campaignFolderIds` is the id (or ids) of whatever campaign Folder(s) the
// import wizard's "__new" destination fallback actually created THIS run -
// captured via a before/after diff around createImport (same id-tracking
// pattern as 14-campaigns.spec.mjs's "New Session" test), never matched by
// name. A real GM could legitimately own a real campaign literally named
// "Radiant Citadel" (the docx's own title, which is exactly what the "__new"
// fallback names its campaign after) - deleting by that name match would
// destroy that real content, the same bug class commit 9750e0d eliminated
// for the legacy singleton timeline journal.
async function cleanupImported(page, exactNames = [], campaignFolderIds = []) {
  await page.evaluate(async ({ names, campaignFolderIds }) => {
    const byName = new Set(names);
    // Delete strictly the campaign folder(s) THIS run's diff identified -
    // cascades to every entry, the subfolder, and any per-campaign timeline
    // journal the import auto-created inside it.
    for (const id of campaignFolderIds) {
      const f = game.folders.get(id);
      if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
    }

    // Fallback for anything left outside those folders (older
    // pre-campaign-feature builds, or a doc whose title differs).
    const ids = game.journal.filter((j) =>
      byName.has(j.name) || /^(Introduction|Session Zero|Arc \d|Epilogue|Appendix)/.test(j.name ?? "")
    ).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
  }, { names: exactNames, campaignFolderIds });
  // Legacy-singleton fallback (older pre-campaign-feature builds, or a
  // world where the import somehow still fell to the legacy path): never
  // unconditionally delete-by-name - World A's own real, pre-existing
  // legacy timeline shares this exact fixed name. See
  // cleanupTimelineJournal's doc comment in helpers/foundry.mjs.
  await cleanupTimelineJournal(page);
}

test.describe("05 docx import", () => {
  // The real titles/campaign-folder-ids created by the test that just ran -
  // see cleanupImported's doc comment.
  let createdTitles = [];
  let createdCampaignFolderIds = [];

  test.afterEach(async ({ page, browser }) => {
    // No .catch(() => {}) here: a cleanup failure must be visible (logged),
    // not silently swallowed - a swallowed failure here previously meant
    // state leaked between runs with no signal anything had gone wrong (the
    // same failure mode cleanupAsGm's own doc comment describes for other
    // specs). cleanupAsGm also makes sure cleanup actually runs against a
    // live, logged-in GM session rather than Playwright's default
    // never-navigated `page` fixture, which this spec's own test already
    // leaves as a live GM session (the common case cleanupAsGm optimizes
    // for), but routing through it keeps this spec consistent with 02/06's
    // cleanup pattern and safe if that ever changes.
    try {
      await cleanupAsGm(page, browser, (gmPage) => cleanupImported(gmPage, createdTitles, createdCampaignFolderIds));
    } catch (error) {
      console.error("05-docx-import cleanup failed:", error);
      throw error;
    } finally {
      createdTitles = [];
      createdCampaignFolderIds = [];
    }
  });

  test("sections detected, types suggested, entries created and openable; dated session rows create timepoints", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
    await login(page, "Gamemaster");

    // Before/after id diff (same pattern as 14-campaigns.spec.mjs's "New
    // Session" test) - identifies exactly which campaign Folder(s) this
    // run's import wizard creates via its "__new" destination fallback,
    // for cleanup and for scoping the timeline lookup below. Never matched
    // by name - see cleanupImported's doc comment.
    const beforeCampaignFolderIds = await page.evaluate(() =>
      game.folders.filter((f) => f.type === "JournalEntry" && f.flags?.["mej-campaign-companion"]?.campaign).map((f) => f.id));

    const { wizard } = await openImportWizard(page);
    await wizard.locator("input[type=file][name=file]").setInputFiles(DOCX_PATH);
    await wizard.locator(".mej-cc-import-review").waitFor({ timeout: 60_000 });

    const rowCount = await wizard.locator("table.mej-cc-import-sections tbody tr").count();
    // Sections detected — the real Radiant Citadel.docx has an Introduction
    // plus a run of dated "Arc N Session M" headings.
    expect(rowCount).toBeGreaterThan(10);

    const rows = await wizard.locator("table.mej-cc-import-sections tbody tr").evaluateAll((trs) =>
      trs.map((tr) => ({
        title: tr.querySelector("input[name^='title-']")?.value,
        type: tr.querySelector("select[name^='type-']")?.value,
        typeOptions: Array.from(tr.querySelectorAll("select[name^='type-'] option")).map((o) => o.value),
        timepoint: tr.querySelector("input[name^='timepoint-']")?.checked
      }))
    );
    // Record the exact section titles the wizard is about to create from, for
    // afterEach's cleanup to delete by exact name (see cleanupImported's doc
    // comment) - captured regardless of each row's chosen type, since a
    // "skip" row creates nothing and simply won't match anything at cleanup.
    createdTitles = rows.map((r) => r.title).filter(Boolean);
    const sessionZeroIndex = rows.findIndex((r) => r.title?.startsWith("Session Zero"));
    expect(sessionZeroIndex).toBeGreaterThanOrEqual(0);
    // Session-shaped sections arrive SUGGESTED as session (spec A §1) — the
    // import below relies on the suggestion; no manual retype. Before
    // 2026-08-23 this test had to selectOption("session") by hand.
    expect(rows[sessionZeroIndex].typeOptions).toContain("session");
    expect(rows[sessionZeroIndex].type).toBe("session");

    // Dated session rows are pre-checked to become timepoints.
    expect(rows[sessionZeroIndex].timepoint).toBe(true);

    // The retired "text" pseudo-type is gone — journalentry is the only
    // prose option (spec A §2: exactly one "Text and Image" in the list).
    expect(rows[sessionZeroIndex].typeOptions).not.toContain("text");
    expect(rows[sessionZeroIndex].typeOptions.filter((v) => v === "journalentry")).toHaveLength(1);

    // Detection is visible in the review step, with the right count: the
    // pre-checked timepoint rows ARE the isSession sections, so their tally
    // is the expected number.
    const sessionsDetected = rows.filter((r) => r.timepoint).length;
    await expect(wizard.locator(".mej-cc-import-sessions-detected")).toContainText(String(sessionsDetected));

    // Must be campaign-agnostic: the wizard's destination select defaults to
    // the Hub's active campaign (or the first existing one) whenever World A
    // already has campaigns, so a real world is not the "zero-campaign"
    // world this test used to assume - state the destination explicitly
    // rather than relying on an empty world to fall through to "__new".
    await wizard.locator('select[name="destination"]').selectOption("__new");

    await wizard.locator('button[data-action="createImport"]').click();
    // Result dialog (DialogV2.wait) reports created/timepoint counts.
    const resultDialog = page.locator("dialog.application", { hasText: /created|import/i }).last();
    await resultDialog.waitFor({ timeout: 60_000 });
    await settle(page, 300);
    const okBtn = resultDialog.locator('button[data-action="ok"]').first();
    if (await okBtn.count()) await okBtn.click();
    await settle(page, 500);

    createdCampaignFolderIds = await page.evaluate((beforeIds) =>
      game.folders
        .filter((f) => f.type === "JournalEntry" && f.flags?.["mej-campaign-companion"]?.campaign && !beforeIds.includes(f.id))
        .map((f) => f.id),
      beforeCampaignFolderIds);

    const summary = await page.evaluate((campaignFolderIds) => {
      const sessionZero = game.journal.find((j) => j.name?.startsWith("Session Zero"));
      const sessionPage = sessionZero?.pages?.contents?.[0];
      // Spec-mandated behavior change from the campaign-container feature
      // (tasks 1-11): the import wizard always resolves a real campaign
      // destination now - in a zero-campaign world (this spec's expected
      // environment) that's the "__new" fallback, which creates a campaign
      // named after the docx's title ("Radiant Citadel") with its OWN
      // timeline journal ("Radiant Citadel — Timeline"), not the legacy
      // singleton "Campaign Timeline". Find whichever timeline journal
      // actually received this import's timepoints, SCOPED to the campaign
      // folder(s) this run's own before/after diff identified (same
      // alphaFolder.contents pattern as 14-campaigns.spec.mjs's scenario
      // 5) - a global game.journal.find() risks a real journal elsewhere
      // in the world that happens to carry a similarly-labeled "Session
      // Zero..." timepoint hijacking this assertion.
      const timeline = campaignFolderIds
        .map((id) => game.folders.get(id))
        .filter(Boolean)
        .flatMap((f) => f.contents)
        .find((j) => {
          const tps = j.getFlag("mej-campaign-companion", "timeline")?.timepoints;
          return Array.isArray(tps) && tps.some((t) => t.label?.startsWith("Session Zero"));
        });
      const timepoints = timeline?.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? [];
      // "Introduction" is a plain prose section (suggestType defaults it to
      // the "text" plan-row type) - since the import-followups change, text
      // rows are created as MEJ "Text and Image" (journalentry) entries, not
      // unflagged text pages, so they're indexed/searchable/linkable.
      const intro = game.journal.find((j) =>
        j.name === "Introduction" &&
        (campaignFolderIds.includes(j.folder?.id) || campaignFolderIds.includes(j.folder?.folder?.id)));
      const introPage = intro?.pages?.contents?.[0];
      return {
        importedCount: game.journal.filter((j) => /^(Introduction|Session Zero|Arc \d)/.test(j.name ?? "")).length,
        sessionZeroFound: !!sessionZero,
        sessionZeroSourceType: sessionPage?._source?.type,
        sessionZeroFlagType: sessionPage?.getFlag("monks-enhanced-journal", "type"),
        introFound: !!intro,
        introNativeType: introPage?._source?.type,
        introFlagType: introPage?.getFlag("monks-enhanced-journal", "type"),
        timepointCount: timepoints.length,
        timepointLabels: timepoints.map((t) => t.label)
      };
    }, createdCampaignFolderIds);
    expect(summary.importedCount).toBeGreaterThan(10);
    expect(summary.sessionZeroFound).toBe(true);
    // Task 13's fix: an imported session page carries both the prefixed
    // native type and the bare MEJ interop flag (session-page-data.mjs).
    expect(summary.sessionZeroSourceType).toBe("mej-campaign-companion.session");
    expect(summary.sessionZeroFlagType).toBe("session");
    // Text rows land as MEJ "Text and Image" entries (native text page +
    // journalentry MEJ flag - the same shape createMejEntry stamps).
    expect(summary.introFound).toBe(true);
    expect(summary.introNativeType).toBe("text");
    expect(summary.introFlagType).toBe("journalentry");
    expect(summary.timepointCount).toBeGreaterThan(5);
    expect(summary.timepointLabels.some((l) => l.startsWith("Session Zero"))).toBe(true);

    // Opens correctly in MEJ.
    const sessionZeroId = await page.evaluate(() => game.journal.find((j) => j.name?.startsWith("Session Zero"))?.id);
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, sessionZeroId);
    await settle(page, 400);
    const openedAs = await page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name);
    expect(openedAs).toBe("SessionSheet");

    // Visible in the Hub index (Task 13 round-2 fix) and search.
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 400);
    await expect(shell.locator('li.mej-cc-index-row', { hasText: "Session Zero" })).toHaveCount(1);
    await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
    await settle(page, 200);
    await shell.locator("input.mej-cc-search-input").fill("Session Zero");
    await settle(page, 400);
    await expect(shell.locator('li.mej-cc-search-row', { hasText: "Session Zero" })).toHaveCount(1);

    assertNoConsoleErrors(errors);
  });
});
