import { test, expect } from "@playwright/test";
import {
  login,
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

async function cleanupImported(page) {
  await page.evaluate(async () => {
    const ids = game.journal.filter((j) =>
      /^(Introduction|Session Zero|Arc \d|Epilogue|Appendix)/.test(j.name ?? "")
    ).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const j = game.journal.find((e) => e.name === "Campaign Timeline");
    if (j) await JournalEntry.implementation.deleteDocuments([j.id]);
    await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
  });
}

test.describe("05 docx import", () => {
  test.afterEach(async ({ page }) => {
    await cleanupImported(page).catch(() => {});
  });

  test("sections detected, types suggested, entries created and openable; dated session rows create timepoints", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
    await login(page, "Gamemaster");

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
    const sessionZeroIndex = rows.findIndex((r) => r.title?.startsWith("Session Zero"));
    expect(sessionZeroIndex).toBeGreaterThanOrEqual(0);
    // Types suggested: every dated "session" row's type <select> at least
    // offers "session" as a choice (the review UI's whole point).
    expect(rows[sessionZeroIndex].typeOptions).toContain("session");
    // Dated session rows are pre-checked to become timepoints regardless of
    // the chosen entry type.
    expect(rows[sessionZeroIndex].timepoint).toBe(true);

    // Explicitly choose "session" for this one row so we can verify it
    // actually opens as a companion Session afterward.
    await wizard.locator(`select[name="type-${sessionZeroIndex}"]`).selectOption("session");

    await wizard.locator('button[data-action="createImport"]').click();
    // Result dialog (DialogV2.wait) reports created/timepoint counts.
    const resultDialog = page.locator("dialog.application", { hasText: /created|import/i }).last();
    await resultDialog.waitFor({ timeout: 60_000 });
    await settle(page, 300);
    const okBtn = resultDialog.locator('button[data-action="ok"]').first();
    if (await okBtn.count()) await okBtn.click();
    await settle(page, 500);

    const summary = await page.evaluate(() => {
      const sessionZero = game.journal.find((j) => j.name?.startsWith("Session Zero"));
      const sessionPage = sessionZero?.pages?.contents?.[0];
      const timeline = game.journal.find((j) => j.name === "Campaign Timeline");
      const timepoints = timeline?.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? [];
      return {
        importedCount: game.journal.filter((j) => /^(Introduction|Session Zero|Arc \d)/.test(j.name ?? "")).length,
        sessionZeroFound: !!sessionZero,
        sessionZeroSourceType: sessionPage?._source?.type,
        sessionZeroFlagType: sessionPage?.getFlag("monks-enhanced-journal", "type"),
        timepointCount: timepoints.length,
        timepointLabels: timepoints.map((t) => t.label)
      };
    });
    expect(summary.importedCount).toBeGreaterThan(10);
    expect(summary.sessionZeroFound).toBe(true);
    // Task 13's fix: an imported session page carries both the prefixed
    // native type and the bare MEJ interop flag (session-page-data.mjs).
    expect(summary.sessionZeroSourceType).toBe("mej-campaign-companion.session");
    expect(summary.sessionZeroFlagType).toBe("session");
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
