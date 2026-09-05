import { test, expect } from "@playwright/test";
import { login, TT_PREFIX, trackConsoleErrors, assertNoConsoleErrors, settle, KNOWN_MEJ_SESSION_ICON_404 } from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const APPLY = "/modules/mej-campaign-companion/scripts/hooks/session-ownership-apply.mjs";

// World A is the user's real world: the confirm dialog is ALWAYS answered
// No here. The grant itself runs through applySessionOwnership on the one
// TT entry this test created - never on the world-wide candidate list.
test.describe("21 players write sessions", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "playersWriteSessions", false);
      const ids = game.journal.filter((j) => j.name?.startsWith("TT-")).map((j) => j.id);
      if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    });
  });

  test("turning the setting on offers ownership of existing sessions; No leaves them alone; the grant opens one up", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const entryId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{ name: n, type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "session" } } }],
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      return entry.id;
    }, `${TT_PREFIX}Existing Session`);

    const listed = await page.evaluate(async ({ id, mod }) => {
      const { sessionsNeedingOwnership } = await import(mod);
      return sessionsNeedingOwnership().some((e) => e.id === id);
    }, { id: entryId, mod: APPLY });
    expect(listed).toBe(true);

    await page.evaluate(() => game.settings.set("mej-campaign-companion", "playersWriteSessions", true));
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toContainText(/existing session/i);
    await dialog.locator('button[data-action="no"]').click();
    await settle(page, 300);
    // OBSERVER (the level this entry was created with) is 2, not 1 -
    // CONST.DOCUMENT_OWNERSHIP_LEVELS: NONE 0, LIMITED 1, OBSERVER 2, OWNER 3.
    expect(await page.evaluate((id) => game.journal.get(id).ownership.default, entryId)).toBe(2);

    const granted = await page.evaluate(async ({ id, mod }) => {
      const { applySessionOwnership } = await import(mod);
      const n = await applySessionOwnership([game.journal.get(id)]);
      return { n, level: game.journal.get(id).ownership.default };
    }, { id: entryId, mod: APPLY });
    expect(granted).toEqual({ n: 1, level: 3 });

    // Turning it off is silent.
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "playersWriteSessions", false));
    await settle(page, 300);
    await expect(page.locator("dialog.application")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
