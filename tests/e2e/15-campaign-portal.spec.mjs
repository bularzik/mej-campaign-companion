// Campaign portal e2e (task-5, spec C sub-project): the live gate for the
// campaign-portal branch. Portals are auto-created by createCampaign() and
// by the dataVersion-2 migration ONLY - raw Folder.create-flagged fixtures
// (the pattern every other spec's campaign fixtures use) get no portal, by
// design (see campaign-store.mjs's ensureCampaignPortal). Every campaign
// this file creates is TT_PREFIX-named, created via the createCampaign()
// API for determinism, and torn down by folder-cascade delete (which
// removes the portal along with everything else) in a try/finally per
// test; the client-scoped Hub campaign-scope setting is reset to "" at the
// end of every test regardless of outcome.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, settle,
  trackConsoleErrors, assertNoConsoleErrors, BASE_URL,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MODULE_ID = "mej-campaign-companion";
const CAMPAIGN_DOCUMENT_TYPE = `${MODULE_ID}.campaign`;
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

/** Open any journal entry (bootstraps the MEJ shell), then open the Campaign Hub. Lands on the Index tab. */
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

/** Open a journal entry directly (no forced Hub-nav click) - for portal entries, whose own
 * page type routes MEJ straight to the Hub sheet. Bootstraps the shell via the sidebar first. */
async function openEntryDirect(page, entryId) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  return page.locator("#MonksEnhancedJournal");
}

/** GM-only createCampaign() via the production API, for deterministic fixtures. */
async function apiCreateCampaign(page, name, ownershipDefault = "observer") {
  return page.evaluate(async ({ name, ownershipDefault }) => {
    const { createCampaign, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const folder = await createCampaign(name, { ownershipDefault });
    const portal = campaignPortal(folder);
    const page0 = portal?.pages?.contents?.[0] ?? null;
    return {
      folderId: folder.id,
      portalId: portal?.id ?? null,
      portalName: portal?.name ?? null,
      pageType: page0?.type ?? null,
      pageName: page0?.name ?? null,
      ownershipDefault: portal?.ownership?.default ?? null
    };
  }, { name, ownershipDefault });
}

/** Folder-cascade delete (covers the portal, timeline journal, and every member). */
async function deleteCampaignFolder(page, folderId) {
  if (!folderId) return;
  await page.evaluate(async (id) => {
    const f = game.folders.get(id);
    if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
  }, folderId);
}

/** Contract: scope select reset to "" before each test ends. */
async function resetScope(page) {
  await page.evaluate(() => game.settings.set("mej-campaign-companion", "hubCampaignScope", ""));
}

// Not .serial: every test below is fully self-contained (its own campaign
// fixture, its own try/finally cleanup) - a failure in one must not skip
// the rest.
test.describe("15 campaign portal", () => {
  test("1. creating a campaign creates its portal; opening the portal lands on the scoped Hub", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const NAME = `${TT_PREFIX}PortalCamp`;
    let folderId = null;
    try {
      const created = await apiCreateCampaign(page, NAME, "observer");
      folderId = created.folderId;

      expect(created.portalId).toBeTruthy();
      expect(created.portalName).toBe(NAME);
      expect(created.pageType).toBe(CAMPAIGN_DOCUMENT_TYPE);
      const observerLevel = await page.evaluate(() => CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
      expect(created.ownershipDefault).toBe(observerLevel);

      // Exactly one portal entry in the folder.
      const portalCount = await page.evaluate(async (id) => {
        const { isCampaignPortal } = await import("/modules/mej-campaign-companion/scripts/logic/campaigns.mjs");
        return game.folders.get(id).contents.filter((e) => isCampaignPortal(e)).length;
      }, folderId);
      expect(portalCount).toBe(1);

      const shell = await openEntryDirect(page, created.portalId);
      await expect(shell.locator(".mej-cc-hub-header")).toBeVisible();
      await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue(folderId);

      // C1 regression: after OPENING the portal, MEJ's fixType() normalizes
      // its in-memory page .type to bare "campaign" for the rest of the
      // session. isCampaignPortal must still recognize it, or three things
      // break silently: (a) the Hub index gains a spurious row for the
      // portal itself, (b) campaignPortal() stops finding it and the
      // settings dialog offers a duplicate-creating Restore, and (c) the
      // rename-sync hooks no-op. Assert all three still hold post-open.

      // (a) No index row for the portal, in the campaign's own scope (lands
      // on Index tab by default - static TABS.initial).
      const nameCell = (name) => shell.locator("li.mej-cc-index-row .mej-cc-index-name", { hasText: name });
      await expect(nameCell(NAME)).toHaveCount(0);

      // (b) The edit-campaign dialog does NOT show Restore - the portal
      // still resolves as existing.
      await shell.locator("button.mej-cc-edit-campaign").click();
      const dialog = page.locator("dialog.application").last();
      await expect(dialog.locator('button[data-action="restorePortal"]')).toHaveCount(0);
      await dialog.locator('button[data-action="cancel"], button[data-action="close"]').first().click().catch(() => dialog.evaluate((d) => d.close()));
      await settle(page, 300);

      // (c) A folder rename still syncs to the portal (both entry and page name).
      const RENAMED = `${NAME} Renamed`;
      await page.evaluate(async ({ id, name }) => { await game.folders.get(id).update({ name }); }, { id: folderId, name: RENAMED });
      await settle(page, 400);
      const afterRename = await page.evaluate((id) => {
        const entry = game.journal.get(id);
        return { entryName: entry.name, pageName: entry.pages.contents[0]?.name };
      }, created.portalId);
      expect(afterRename.entryName).toBe(RENAMED);
      expect(afterRename.pageName).toBe(RENAMED);

      assertNoConsoleErrors(errors);
    } finally {
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("2. rename syncs both ways", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ORIGINAL = `${TT_PREFIX}RenameCamp`;
    const VIA_FOLDER = `${TT_PREFIX}RenameCamp Folder-Led`;
    const VIA_PORTAL = `${TT_PREFIX}RenameCamp Portal-Led`;
    let folderId = null;
    try {
      const created = await apiCreateCampaign(page, ORIGINAL, "observer");
      folderId = created.folderId;
      const portalId = created.portalId;

      // Rename the folder via API -> portal entry AND its page name follow.
      await page.evaluate(async ({ id, name }) => { await game.folders.get(id).update({ name }); }, { id: folderId, name: VIA_FOLDER });
      await settle(page, 400);
      const afterFolderRename = await page.evaluate((id) => {
        const entry = game.journal.get(id);
        return { entryName: entry.name, pageName: entry.pages.contents[0]?.name };
      }, portalId);
      expect(afterFolderRename.entryName).toBe(VIA_FOLDER);
      expect(afterFolderRename.pageName).toBe(VIA_FOLDER);

      // Rename the portal entry via API -> folder name follows.
      await page.evaluate(async ({ id, name }) => { await game.journal.get(id).update({ name }); }, { id: portalId, name: VIA_PORTAL });
      await settle(page, 400);
      const afterPortalRename = await page.evaluate((id) => game.folders.get(id).name, folderId);
      expect(afterPortalRename).toBe(VIA_PORTAL);

      assertNoConsoleErrors(errors);
    } finally {
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("3. deleting the portal leaves the campaign; restore recreates it (and never touches the ownership baseline)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const NAME = `${TT_PREFIX}RestoreCamp`;
    let folderId = null;
    try {
      const created = await apiCreateCampaign(page, NAME, "observer");
      folderId = created.folderId;

      const baselineBefore = await page.evaluate(
        (id) => game.folders.get(id).flags?.["mej-campaign-companion"]?.campaign?.ownershipDefault,
        folderId
      );
      expect(baselineBefore).toBe("observer");

      // Delete the portal entry by id.
      await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, created.portalId);
      await settle(page, 300);

      const afterDelete = await page.evaluate(async (id) => {
        const { isCampaignFolder } = await import("/modules/mej-campaign-companion/scripts/logic/campaigns.mjs");
        const { campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const folder = game.folders.get(id);
        return { folderExists: !!folder, stillFlagged: folder ? isCampaignFolder(folder) : false, portal: campaignPortal(folder) };
      }, folderId);
      expect(afterDelete.folderExists).toBe(true);
      expect(afterDelete.stillFlagged).toBe(true);
      expect(afterDelete.portal).toBeNull();

      // Hub still scopes to the (portal-less) campaign.
      const shell = await openHub(page);
      await scopeHub(shell, page, folderId);
      await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue(folderId);

      // Campaign settings dialog offers the restore control only because
      // the portal is missing (dialog order: [Confirm, Restore campaign entry]).
      await shell.locator("button.mej-cc-edit-campaign").click();
      const dialog = page.locator("dialog.application").last();
      const restoreBtn = dialog.locator('button[data-action="restorePortal"]');
      await expect(restoreBtn).toHaveCount(1);
      await expect(restoreBtn).toContainText(/restore/i);
      await restoreBtn.click();
      await settle(page, 400);

      const afterRestore = await page.evaluate(async (id) => {
        const { campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const folder = game.folders.get(id);
        const portal = campaignPortal(folder);
        return {
          portalId: portal?.id ?? null,
          portalName: portal?.name ?? null,
          baseline: folder.flags?.["mej-campaign-companion"]?.campaign?.ownershipDefault
        };
      }, folderId);
      expect(afterRestore.portalId).toBeTruthy();
      expect(afterRestore.portalName).toBe(NAME);
      // The exact bug this scenario guards against: restore must be a pure
      // create, never a corrupting write-through of the baseline flag.
      expect(afterRestore.baseline).toBe(baselineBefore);

      assertNoConsoleErrors(errors);
    } finally {
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("4. folder context menu opens the scoped Hub", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const NAME = `${TT_PREFIX}CtxMenuCamp`;
    let folderId = null;
    try {
      const created = await apiCreateCampaign(page, NAME, "observer");
      folderId = created.folderId;

      // Core journal sidebar (ui.sidebar journal tab) - drive the DOM
      // directly for the context-menu invocation itself.
      await page.locator('[data-tab="journal"][data-action="tab"]').click();
      await settle(page, 300);

      const folderHeader = page.locator(".folder-header", { hasText: NAME });
      await expect(folderHeader).toHaveCount(1);
      await folderHeader.click({ button: "right" });
      await settle(page, 300);

      const menuItem = page.locator("#context-menu .context-item", { hasText: "Open Campaign Hub" });
      await expect(menuItem).toHaveCount(1);
      await menuItem.click();
      await settle(page, 500);

      const shell = page.locator("#MonksEnhancedJournal");
      await expect(shell.locator(".mej-cc-hub-header")).toBeVisible();
      await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue(folderId);

      assertNoConsoleErrors(errors);
    } finally {
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("5. portals are absent from Hub index rows in every scope", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const CAMPAIGN_NAME = `${TT_PREFIX}IdxCamp`;
    const MEMBER_NAME = `${TT_PREFIX}IdxMember`;
    let folderId = null;
    try {
      const created = await apiCreateCampaign(page, CAMPAIGN_NAME, "observer");
      folderId = created.folderId;
      await page.evaluate(async ({ name, folder }) => {
        await JournalEntry.create({ name, folder, pages: [{ name, text: { content: "member" } }] });
      }, { name: MEMBER_NAME, folder: folderId });

      const shell = await openHub(page);
      // Scoped to the row's own name (.mej-cc-index-name), not the whole
      // <li> - in All scope a FILED row also carries a campaign-name BADGE
      // (.mej-cc-row-campaign, see 14-campaigns.spec.mjs scenario 2's
      // comment), so a whole-row hasText match on the campaign's own name
      // would false-positive on the member's own (legitimately badged) row.
      const nameCell = (name) => shell.locator("li.mej-cc-index-row .mej-cc-index-name", { hasText: name });

      await scopeHub(shell, page, folderId);
      await expect(nameCell(CAMPAIGN_NAME)).toHaveCount(0);
      await expect(nameCell(MEMBER_NAME)).toHaveCount(1);

      await scopeHub(shell, page, ""); // All
      await expect(nameCell(CAMPAIGN_NAME)).toHaveCount(0);

      await scopeHub(shell, page, "unfiled");
      await expect(nameCell(CAMPAIGN_NAME)).toHaveCount(0);

      assertNoConsoleErrors(errors);
    } finally {
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("6. migration backfills a portal for a legacy campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const NAME = `${TT_PREFIX}LegacyCamp`;
    let folderId = null;
    try {
      // Raw Folder.create, flagged as a campaign but with NO portal - the
      // exact shape a pre-portal-feature world's campaigns are in.
      folderId = await page.evaluate(async (name) => {
        const f = await Folder.create({
          name, type: "JournalEntry", folder: null,
          flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
        });
        return f.id;
      }, NAME);

      const portalBefore = await page.evaluate(async (id) => {
        const { campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        return campaignPortal(game.folders.get(id));
      }, folderId);
      expect(portalBefore).toBeNull();

      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 1));
      await page.reload();
      await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
      // The ready hook's migration runs async after game.ready flips - poll
      // for dataVersion to actually reach CURRENT_DATA_VERSION rather than
      // racing a fixed settle().
      await page.waitForFunction(
        () => game.settings.get("mej-campaign-companion", "dataVersion") === 2,
        null, { timeout: 30_000 }
      );

      const after = await page.evaluate(async (id) => {
        const { campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        return {
          dataVersion: game.settings.get("mej-campaign-companion", "dataVersion"),
          portal: campaignPortal(game.folders.get(id))
        };
      }, folderId);
      expect(after.dataVersion).toBe(2);
      expect(after.portal).toBeTruthy();
      expect(after.portal.name).toBe(NAME);

      assertNoConsoleErrors(errors);
    } finally {
      // Restore: delete fixtures; dataVersion stays 2 (the real steady state).
      await deleteCampaignFolder(page, folderId);
      await resetScope(page);
    }
  });

  test("7. player seat: portal opens the scoped read view; no restore control", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    const NAME = `${TT_PREFIX}PlayerSeatCamp`;
    let folderId = null;
    let portalId = null;
    try {
      await login(gmPage, "Gamemaster");
      const created = await apiCreateCampaign(gmPage, NAME, "observer");
      folderId = created.folderId;
      portalId = created.portalId;

      const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
      const playerPage = await playerContext.newPage();
      const playerErrors = trackConsoleErrors(playerPage, { ignore: IGNORE });
      try {
        await login(playerPage, "User 1");
        const shell = await openEntryDirect(playerPage, portalId);
        await expect(shell.locator(".mej-cc-hub-header")).toBeVisible();
        await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue(folderId);

        // No GM chrome: no edit-campaign pencil, Tools offers only the Guide.
        await expect(shell.locator(".mej-cc-edit-campaign")).toHaveCount(0);
        // The mount-scope write above (state.campaignId + the client setting)
        // triggers a follow-up re-render that transiently disables header
        // controls mid-render - wait for it to settle before clicking rather
        // than racing it.
        const toolsButton = shell.locator(".mej-cc-tools-summary");
        await expect(toolsButton).toBeEnabled();
        await toolsButton.click();
        const menu = shell.locator(".mej-cc-tools-menu");
        await expect(menu.locator("button")).toHaveCount(1);
        await expect(menu.locator('button[data-action="openHelp"]')).toHaveCount(1);

        assertNoConsoleErrors(playerErrors);
      } finally {
        await resetScope(playerPage);
        await playerContext.close();
      }
    } finally {
      await deleteCampaignFolder(gmPage, folderId);
      await resetScope(gmPage);
      await gmContext.close();
    }
  });
});
