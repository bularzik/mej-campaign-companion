// Hub UX fixes (spec 2026-09-25 hub-ux-fixes): menus dismiss like real
// menus, the Timeline tab scrolls, the Graph pans.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

/** Open any entry (so the MEJ shell exists) then click the Campaign Hub
 * toolbar button. Idempotent: a second call on a page that already has the
 * shell open (this file calls it more than once per page, to re-check state
 * after a GM-side edit) skips the sidebar-navigation dance - with the shell
 * already rendered, it can cover/intercept the sidebar's own "journal" tab
 * button, hanging that click forever (confirmed live). */
async function openHub(page) {
  const alreadyOpen = await page.evaluate(() => !!document.querySelector("#MonksEnhancedJournal"));
  if (!alreadyOpen) {
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
  }
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function openHubTab(page, tab) {
  const shell = await openHub(page);
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 300);
  return shell;
}

// HUB_STATE is module-private, so there is no state-reset helper: each test
// leaves every menu closed when it ends.
test.describe("27 Hub UX", () => {
  test("menus: an outside click closes the Type menu", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleTypeMenu"]').click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    // Inside click keeps it open (multi-select).
    await shell.locator('.mej-cc-doctype-menu input[name="doctype-check"]').first().check();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    await shell.locator('.mej-cc-doctype-menu input[name="doctype-check"]').first().uncheck();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    // Outside click on inert Hub space closes it.
    await shell.locator(".mej-cc-index-controls input[name='index-filter']").click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toHaveCount(0);
    await expect(shell.locator('button[data-action="toggleTypeMenu"]')).toHaveAttribute("aria-expanded", "false");
    assertNoConsoleErrors(errors);
  });

  test("menus: an outside click on a tab closes the Tools menu and switches tab", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleToolsMenu"]').click();
    await expect(shell.locator(".mej-cc-tools-menu")).toBeVisible();
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await expect(shell.locator(".mej-cc-tools-menu")).toHaveCount(0);
    await expect(shell.locator('.tab[data-tab="graph"]')).toHaveClass(/active/);
    assertNoConsoleErrors(errors);
  });

  test("menus: one toggle switches menus; Escape closes without closing the window", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleTypeMenu"]').click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    await shell.locator('button[data-action="toggleSortMenu"]').click();
    await expect(shell.locator(".mej-cc-sort-menu")).toBeVisible();
    await expect(shell.locator(".mej-cc-doctype-menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(shell.locator(".mej-cc-sort-menu")).toHaveCount(0);
    await expect(page.locator("#MonksEnhancedJournal")).toBeVisible();
    // A later render must not resurrect it (state was cleared, not just DOM).
    await shell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await shell.locator('nav.sheet-tabs a[data-tab="index"]').click();
    await expect(shell.locator('.tab[data-tab="index"]')).toHaveClass(/active/);
    await expect(shell.locator(".mej-cc-sort-menu")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
