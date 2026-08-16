import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

async function openHubSearch(page) {
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
  await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
  await settle(page, 200);
  return shell;
}

async function search(shell, page, query) {
  await shell.locator('input.mej-cc-search-input').fill(query);
  // search-index.mjs debounces ~150ms (CampaignHubPage.mjs).
  await settle(page, 400);
}

test.describe("03 search", () => {
  test("finds a word in a person description, with a snippet", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Search Person`;
    const personId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{
          name: n,
          type: "monks-enhanced-journal.person",
          flags: { "monks-enhanced-journal": { type: "person" } },
          text: { content: "A wandering locksmith named Zephyrine who trades in rare keys." }
        }]
      });
      return entry.id;
    }, name);

    const shell = await openHubSearch(page);
    await search(shell, page, "locksmith");
    const row = shell.locator(`li.mej-cc-search-row[data-uuid]`, { hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".mej-cc-search-match-snippet")).toContainText(/locksmith/i);

    await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, personId);
    assertNoConsoleErrors(errors);
  });

  test("GM-only content (session gmNotes) is found by GM, not by player", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const name = `${TT_PREFIX}Search Session GM`;
    const entryId = await gmPage.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{
          name: n,
          type: "mej-campaign-companion.session",
          flags: { "monks-enhanced-journal": { type: "session" } },
          system: { gmNotes: "<p>The vault combination is whispered by a banshee.</p>" }
        }],
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      return entry.id;
    }, name);

    const gmShell = await openHubSearch(gmPage);
    await search(gmShell, gmPage, "banshee");
    await expect(gmShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage, { ignore: [...IGNORE, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG] });
    await login(playerPage, "User 1");
    const playerShell = await openHubSearch(playerPage);
    await search(playerShell, playerPage, "banshee");
    await expect(playerShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(0);

    assertNoConsoleErrors(errors);
    await playerContext.close();
    await gmPage.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, entryId);
    await gmContext.close();
  });

  test("index updates after an edit", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Search Reindex`;
    const personId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{
          name: n,
          type: "monks-enhanced-journal.person",
          flags: { "monks-enhanced-journal": { type: "person" } },
          text: { content: "An unremarkable innkeeper." }
        }]
      });
      return { entryId: entry.id, pageId: entry.pages.contents[0].id };
    }, name);

    const shell = await openHubSearch(page);
    await search(shell, page, "cartographer");
    await expect(shell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(0);

    await page.evaluate(async ({ entryId, pageId }) => {
      await game.journal.get(entryId).pages.get(pageId).update({
        text: { content: "A retired cartographer who maps the Underdark." }
      });
    }, personId);
    await settle(page, 400);

    await search(shell, page, "cartographer");
    await expect(shell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

    await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, personId.entryId);
    assertNoConsoleErrors(errors);
  });
});
