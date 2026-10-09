// GM player-access check (spec 2026-10-08 player-access-check). MEJ's
// "allow-player" world setting defaults to off, and with it off MEJ opens
// every journal for a player in Foundry's default editor - the reported
// "new entity in a campaign folder opens outside MEJ" for players. The
// companion offers the GM to turn it on at login and asks connected players
// to reload. Every test restores allow-player = true and warnPlayerAccess =
// true (the global-setup baseline).
import { test, expect } from "@playwright/test";
import {
  login, reloadGame, withGmPage, cleanupAsGm, deleteJournalsByPrefix,
  cleanupStrandedTestFolders, ensureMejPlayerAccess, settle
} from "./helpers/foundry.mjs";

const PREFIX = "TT-Pac";
const TITLE = "Campaign Companion: players need Enhanced Journal access";

const setAccess = (page, { allow, warn }) => page.evaluate(async ({ allow, warn }) => {
  await game.settings.set("monks-enhanced-journal", "allow-player", allow);
  await game.settings.set("mej-campaign-companion", "warnPlayerAccess", warn);
}, { allow, warn });

const readAccess = (page) => page.evaluate(() => ({
  allow: game.settings.get("monks-enhanced-journal", "allow-player"),
  warn: game.settings.get("mej-campaign-companion", "warnPlayerAccess")
}));

const accessDialog = (page) => page.locator("dialog.application.mej-campaign-companion-player-access");

// World A (v14) players lack JOURNAL_CREATE; the test grants it and restores
// the saved permissions in afterEach (idempotent: only when a copy was saved).
let savedPermissions = null;

test.describe("30 player access check", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gm) => {
      if (savedPermissions) {
        await gm.evaluate((perms) => game.settings.set("core", "permissions", perms), savedPermissions);
        savedPermissions = null;
      }
      await gm.evaluate(() => game.settings.set("mej-campaign-companion", "warnPlayerAccess", true));
      await ensureMejPlayerAccess(gm);
      await deleteJournalsByPrefix(gm, PREFIX);
      await cleanupStrandedTestFolders(gm, { prefix: PREFIX });
    });
  });

  test("GM enables player access; a connected player reloads and a new entity opens in MEJ", async ({ page, browser }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: false, warn: true });
    savedPermissions = await page.evaluate(() => foundry.utils.deepClone(game.settings.get("core", "permissions")));
    await page.evaluate(async () => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      perms.JOURNAL_CREATE = [...new Set([...(perms.JOURNAL_CREATE ?? []), CONST.USER_ROLES.PLAYER])];
      await game.settings.set("core", "permissions", perms);
    });
    const folderId = await page.evaluate(async (name) => {
      const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      return (await createCampaign(name)).id;
    }, `${PREFIX} Campaign`);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const player = await playerContext.newPage();
      await login(player, "User 1");

      await reloadGame(page);
      const dialog = accessDialog(page);
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toContainText(TITLE);
      await dialog.locator('button[data-action="enable"]').click();
      await expect.poll(() => readAccess(page)).toEqual({ allow: true, warn: true });

      const prompt = player.locator("dialog.application", { hasText: "Your GM has enabled Campaign Companion for players" });
      await expect(prompt).toBeVisible({ timeout: 15_000 });
      await Promise.all([
        player.waitForEvent("load", { timeout: 60_000 }),
        prompt.locator('button[data-action="yes"]').click()
      ]);
      await login(player, "User 1");

      // The original report: the player creates a new entity in a campaign folder.
      const entryName = `${PREFIX} Person`;
      const opened = await player.evaluate(async ({ name, folder }) => {
        await JournalEntry.create({ name, folder, flags: { "monks-enhanced-journal": { pagetype: "person" } } }, { renderSheet: true });
        await new Promise((r) => setTimeout(r, 2500));
        const rendered = [...foundry.applications.instances.values()].filter((a) => a.rendered && a.document);
        return {
          inShell: game.MonksEnhancedJournal.journal?.rendered === true
            && game.MonksEnhancedJournal.journal.document?.parent?.name === name,
          standalone: rendered.filter((a) => a.constructor.name !== "EnhancedJournal"
            && (a.document.name === name || a.document.parent?.name === name)).map((a) => a.constructor.name)
        };
      }, { name: entryName, folder: folderId });
      expect(opened).toEqual({ inShell: true, standalone: [] });
    } finally {
      await playerContext.close();
    }
  });

  test("'Don't show this again' with the window closed silences later logins", async ({ page }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: false, warn: true });
    await reloadGame(page);
    const dialog = accessDialog(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator('input[name="dontShowAgain"]').check();
    await dialog.locator('button[data-action="close"]').click();
    await expect.poll(() => readAccess(page)).toEqual({ allow: false, warn: false });

    await reloadGame(page);
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });

  test("a player login never shows the dialog", async ({ page, browser }) => {
    await withGmPage(browser, (gm) => setAccess(gm, { allow: false, warn: true }));
    await login(page, "User 1");
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });

  test("no dialog when player access is already on", async ({ page }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: true, warn: true });
    await reloadGame(page);
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });
});
