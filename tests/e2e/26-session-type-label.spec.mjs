// Session page-type label in MEJ's New Entry dialog (spec 2026-09-25
// session-type-label). The "Adventure Book" group lists Foundry's page
// types by CONFIG.JournalEntryPage.typeLabels; the companion's subtype used
// to show as its raw TYPES.* key. Also the guard: that option must create a
// working Session. Stock MEJ (World B, native mode) lists it under
// "Adventure Book" with value `mej-campaign-companion.session`; the fork with
// the extension API (World A) lists Session only under "Single Sheet"
// (value `session`, covered by 01-session), so the creation guard skips there.
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const PREFIX = "TT-Stl";
const RUN = Date.now();
const SESSION_TYPE = "mej-campaign-companion.session";

async function openNewEntryDialog(page) {
  await page.evaluate(async () => {
    try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
    await ui.journal.activate();
  });
  await settle(page, 300);
  await page.locator("#journal .directory-header [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  await expect(typeSelect).toBeVisible({ timeout: 10_000 });
  return { dialog, typeSelect };
}

test.describe("26 session type label", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gm) => {
      await gm.evaluate(async () => {
        try {
          await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]);
        } catch { /* nothing open */ }
      });
      await deleteJournalsByPrefix(gm, PREFIX);
    });
  });

  test("the dialog labels the Session type and shows no raw TYPES.* keys", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { typeSelect } = await openNewEntryDialog(page);
    const sessionOption = typeSelect.locator(`option[value="${SESSION_TYPE}"], option[value="session"]`);
    await expect(sessionOption.first()).toHaveText("Session");
    const texts = (await typeSelect.locator("option").allTextContents()).map((t) => t.trim());
    expect(texts.filter((t) => t.startsWith("TYPES."))).toEqual([]);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("choosing it creates a working Session", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${PREFIX}Session${RUN}`;
    const { dialog, typeSelect } = await openNewEntryDialog(page);
    // Skip on the extension-API fork only (same detection as 01-session's
    // mejApiPresent); on stock MEJ the Adventure Book option must exist.
    const apiMode = await page.evaluate(() => typeof game.MonksEnhancedJournal?.getApi === "function"
      || !!game.MonksEnhancedJournal?.externalTypes);
    test.skip(apiMode, "the extension-API fork lists Session only under Single Sheet; 01-session covers that path");
    await expect(typeSelect.locator(`option[value="${SESSION_TYPE}"]`)).toHaveCount(1);
    await dialog.locator('input[name="name"]').fill(name);
    await typeSelect.selectOption(SESSION_TYPE);
    await dialog.locator('button[data-action="ok"]').click();

    await expect.poll(() => page.evaluate((n) => game.journal.find((j) => j.name === n)?.id ?? null, name), { timeout: 10_000 }).not.toBeNull();
    const entryId = await page.evaluate((n) => game.journal.find((j) => j.name === n).id, name);
    expect(await page.evaluate((id) => {
      const p = game.journal.get(id).pages.contents[0];
      return { type: p?._source.type ?? null, flag: p?.getFlag("monks-enhanced-journal", "type") ?? null };
    }, entryId)).toEqual({ type: SESSION_TYPE, flag: "session" });

    await page.evaluate(async (id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), entryId);
    await expect.poll(
      () => page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name ?? null),
      { timeout: 15_000 }
    ).toBe("SessionSheet");
    await expect(page.locator("#MonksEnhancedJournal .session-container").first()).toBeVisible({ timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });

  test("a Session page created together with its entry gets MEJ's type flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const result = await page.evaluate(async (name) => {
      const entry = await JournalEntry.create({ name, pages: [
        { name: "s", type: "mej-campaign-companion.session" },
        { name: "t", type: "text" }
      ] });
      const out = entry.pages.contents.map((p) => ({ type: p.type, flag: p.getFlag("monks-enhanced-journal", "type") ?? null }));
      await entry.delete();
      return out;
    }, "TT-Embedded Session");
    expect(result).toContainEqual({ type: "mej-campaign-companion.session", flag: "session" });
    expect(result).toContainEqual({ type: "text", flag: null });
    assertNoConsoleErrors(errors);
  });
});
