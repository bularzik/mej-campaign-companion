import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, withGmPage, timelineJournalIds, cleanupTimelineJournals,
  TT_PREFIX, createTtCampaign, deleteFoldersById,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const DOCX_PATH = "/Users/danbularzik/Claude/Projects/campaign-record/examples/Radiant Citadel.docx";

async function openImportWizard(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  // Not contents[0]: a timeline journal refuses to open in the MEJ shell
  // (hooks/timeline-open.mjs, spec 2026-09-03 §C), so picking one bootstraps
  // nothing and every later shell locator times out. See 16-multi-timeline's
  // openHub() for the full account.
  const anyEntryId = await page.evaluate(
    () => game.journal.contents.find((e) => !e.getFlag("mej-campaign-companion", "timeline"))?.id
  );
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  await shell.locator(".mej-cc-tools-summary").click();
  await shell.locator('.mej-cc-tools-menu button[data-action="openImportWizard"]').click();
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
// `campaignFolderIds` is the TT- campaign this file creates in beforeAll and
// imports into (0.28.0: the import no longer runs through the "__new"
// fallback, which would have named a campaign "Radiant Citadel" after the
// docx - the name of a real campaign in World A). Deleted by id, never by
// name, with its subfolders and contents.
// Ids of every flagged timeline journal that existed BEFORE this file ran,
// snapshotted as a GM before the first import: cleanup deletes only what this
// file itself induced.
// null, not []: an empty ledger would mean "nothing is protected" if the
// beforeAll snapshot below never ran (a withGmPage login failure still lets
// the cleanup hook run). cleanupTimelineJournals refuses to sweep without a
// real snapshot - see its doc comment.
let preexistingTimelines = null;

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
  // legacy timeline shares this exact fixed name. Identity is now the
  // module's own timeline flag against a pre-run id snapshot; see
  // cleanupTimelineJournals's doc comment in helpers/foundry.mjs.
  await cleanupTimelineJournals(page, preexistingTimelines);
}

test.describe("05 docx import", () => {
  // The real titles/campaign-folder-ids created by the test that just ran -
  // see cleanupImported's doc comment.
  let createdTitles = [];
  // The TT- campaign every import in this file targets: { folderId, timelineId, portalId }.
  let campaign = null;

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (p) => {
      // Snapshot first, so the ledger protects only what existed before this file ran.
      preexistingTimelines = await timelineJournalIds(p);
      campaign = await createTtCampaign(p, `${TT_PREFIX}05 Import ${Date.now().toString(36)}`);
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (p) => { await deleteFoldersById(p, [campaign?.folderId]); });
  });

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
      await cleanupAsGm(page, browser, (gmPage) => cleanupImported(gmPage, createdTitles, [campaign?.folderId].filter(Boolean)));
    } catch (error) {
      console.error("05-docx-import cleanup failed:", error);
      throw error;
    } finally {
      createdTitles = [];
    }
  });

  test("sections detected, types suggested, entries created and openable; dated session rows create timepoints", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
    await login(page, "Gamemaster");

    expect(campaign?.folderId, "beforeAll must have created the TT- import campaign").toBeTruthy();
    expect(campaign.timelineId).toBeTruthy();

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

    // State the destination explicitly: the wizard's select defaults to the
    // Hub's active campaign (or the first existing one). The import goes into
    // this file's own TT- campaign (the way 14-campaigns.spec.mjs test 5 does
    // it), never "__new", which would name a campaign "Radiant Citadel".
    const destination = wizard.locator('select[name="destination"]');
    // Spec 2026-09-03 A: the subfolder option is inapplicable for a new
    // campaign (its folder is already named after the document) - greyed
    // out there, re-enabled the moment an existing folder is picked.
    await destination.selectOption("__new");
    await expect(wizard.locator('input[name="subfolder"]')).toBeDisabled();
    await destination.selectOption({ value: campaign.folderId });
    await expect(wizard.locator('input[name="subfolder"]')).toBeEnabled();

    await wizard.locator('button[data-action="createImport"]').click();
    // Result is a toast (ui.notifications.info), not a dialog. Assert only
    // that the removed result dialog itself is gone (its "Import Results"
    // title, lang key import.resultTitle, no longer exists anywhere) rather
    // than that no dialog.application is open at all: this same import can
    // also raise the retro auto-link REVIEW dialog (hooks/retro-link.mjs), a
    // legitimate input dialog (Confirm mode) that races the toast and must
    // stay untouched.
    await expect(page.locator("#notifications li.notification.info", { hasText: /Imported \d+ entries/ }))
      .toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator("dialog.application", { hasText: /Import Results/ })).toHaveCount(0);
    await settle(page, 500);

    // Every folder in the TT- campaign's tree (the campaign folder plus the
    // import's subfolder): the import's entries are exactly the non-TT- named
    // journals in it (the campaign's own portal and timeline are TT- named).
    const treeFolderIds = await page.evaluate((rootId) => {
      const ids = [rootId];
      for (let i = 0; i < ids.length; i++) ids.push(...game.folders.filter((f) => f.folder?.id === ids[i]).map((f) => f.id));
      return ids;
    }, campaign.folderId);
    const importedInTree = await page.evaluate(({ ids, prefix }) =>
      game.journal.filter((j) => ids.includes(j.folder?.id) && !j.name?.startsWith(prefix)).length,
    { ids: treeFolderIds, prefix: TT_PREFIX });
    expect(importedInTree).toBeGreaterThan(10);

    // Spec 2026-09-06 §1: the campaign the import lands in is never a link
    // candidate for its own sections - its name in the prose stays plain
    // rather than pointing at the portal.
    const portalLinks = await page.evaluate(({ ids, portalId }) => {
      const needle = `@UUID[${game.journal.get(portalId).uuid}]`;
      return game.journal.filter((j) => ids.includes(j.folder?.id)).flatMap((e) => e.pages.contents)
        .filter((p) => (p.text?.content ?? "").includes(needle) || (p.system?.recap ?? "").includes(needle))
        .map((p) => p.name);
    }, { ids: treeFolderIds, portalId: campaign.portalId });
    expect(portalLinks).toEqual([]);

    const summary = await page.evaluate(({ campaignFolderIds, timelineId }) => {
      // Scoped to the TT- campaign's tree: World A's real content (the
      // Radiant Citadel campaign was imported from this same docx) carries
      // entries with the same section titles.
      const inTree = (j) => campaignFolderIds.includes(j.folder?.id);
      const sessionZero = game.journal.find((j) => inTree(j) && j.name?.startsWith("Session Zero"));
      const sessionPage = sessionZero?.pages?.contents?.[0];
      // The import's timepoints land on the destination campaign's own
      // timeline journal - the one createTtCampaign returned.
      const timeline = game.journal.get(timelineId);
      const timepoints = timeline?.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? [];
      // "Introduction" is a plain prose section (suggestType defaults it to
      // the "text" plan-row type) - since the import-followups change, text
      // rows are created as MEJ "Text and Image" (journalentry) entries, not
      // unflagged text pages, so they're indexed/searchable/linkable.
      const intro = game.journal.find((j) => j.name === "Introduction" && inTree(j));
      const introPage = intro?.pages?.contents?.[0];
      return {
        sessionZeroId: sessionZero?.id ?? null,
        importedCount: game.journal.filter((j) => inTree(j) && /^(Introduction|Session Zero|Arc \d)/.test(j.name ?? "")).length,
        sessionZeroFound: !!sessionZero,
        sessionZeroSourceType: sessionPage?._source?.type,
        sessionZeroFlagType: sessionPage?.getFlag("monks-enhanced-journal", "type"),
        introFound: !!intro,
        introNativeType: introPage?._source?.type,
        introFlagType: introPage?.getFlag("monks-enhanced-journal", "type"),
        timepointCount: timepoints.length,
        timepointLabels: timepoints.map((t) => t.label),
        // Spec 2026-09-03 B: standalone pictures survive splitting and are
        // uploaded under worlds/<id>/mej-campaign-companion/ by the wizard.
        // A page's html lives in `text.content` for the native "text" type
        // (createMejEntry) but in `system.recap` for the module's own
        // "session" subtype (buildSessionPageData) - most of this docx's
        // pictures sit in Arc/Session sections, so both fields are checked.
        pagesWithUploadedImages: game.journal
          .filter((j) => campaignFolderIds.includes(j.folder?.id))
          .flatMap((j) => j.pages.contents)
          .filter((p) => /<img [^>]*src="worlds\//.test((p.text?.content ?? "") + (p.system?.recap ?? ""))).length,
        pagesWithDataUriImages: game.journal
          .filter((j) => campaignFolderIds.includes(j.folder?.id))
          .flatMap((j) => j.pages.contents)
          .filter((p) => /<img [^>]*src="data:/.test((p.text?.content ?? "") + (p.system?.recap ?? ""))).length,
        // Default-images (2026-09-05): a page whose html carries an uploaded
        // picture takes its FIRST one as its own `src` (import-wizard.mjs's
        // #createPage); one with no picture at all keeps `src` empty. Pick
        // one concrete example of each from this run's own pages rather than
        // asserting over the whole set, since which section gets which
        // picture depends on the docx's own layout.
        ...(() => {
          const pages = game.journal
            .filter((j) => campaignFolderIds.includes(j.folder?.id))
            .flatMap((j) => j.pages.contents);
          const withImage = pages.find((p) =>
            /<img [^>]*src="worlds\//.test((p.text?.content ?? "") + (p.system?.recap ?? "")));
          const html = withImage ? ((withImage.text?.content ?? "") + (withImage.system?.recap ?? "")) : "";
          const firstImgSrc = withImage ? html.match(/<img [^>]*src="(worlds\/[^"]*)"/)?.[1] ?? null : null;
          const withoutImage = pages.find((p) =>
            !/<img [^>]*src="/.test((p.text?.content ?? "") + (p.system?.recap ?? "")));
          return {
            foundImagePage: !!withImage,
            imagePageFoundSrc: withImage?.src ?? null,
            imagePageFirstImgSrc: firstImgSrc,
            foundPicturelessPage: !!withoutImage,
            picturelessPageFoundSrc: withoutImage ? (withoutImage.src ?? "") : null
          };
        })()
      };
    }, { campaignFolderIds: treeFolderIds, timelineId: campaign.timelineId });
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
    // Radiant Citadel.docx carries 27 inline pictures, 17 of them in
    // picture-only paragraphs that used to be dropped before upload.
    expect(summary.pagesWithUploadedImages).toBeGreaterThan(0);
    expect(summary.pagesWithDataUriImages).toBe(0);
    // Default-images (2026-09-05): the created page's own `src` equals the
    // first uploaded picture found in its html; a picture-less page's `src`
    // stays empty. This also covers the import-accounting fix (a section
    // whose cover-image update() fails still counts as created, never
    // failed) end-to-end for the happy path exercised here - a real update()
    // failure isn't practical to induce from an e2e test, so that branch is
    // covered by the vitest-level per-row try/catch reasoning alone (no pure
    // helper exists to unit-test in isolation; the write lives inline in
    // ImportWizard#onCreate).
    //
    // Radiant Citadel.docx is known to carry pages of both kinds (17
    // picture-only paragraphs plus plenty of plain prose) - assert that
    // explicitly before trusting the `undefined`-safe src checks below,
    // rather than letting an absent fixture pass silently.
    expect(summary.foundImagePage).toBe(true);
    expect(summary.foundPicturelessPage).toBe(true);
    if (summary.foundImagePage) {
      expect(summary.imagePageFoundSrc).toMatch(/worlds\/.*mej-campaign-companion\//);
      expect(summary.imagePageFoundSrc).toBe(summary.imagePageFirstImgSrc);
    }
    if (summary.foundPicturelessPage) {
      expect(summary.picturelessPageFoundSrc).toBeFalsy();
    }

    // Opens correctly in MEJ.
    const sessionZeroId = summary.sessionZeroId;
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
