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
  await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
  await settle(page, 200);
  // Two distinct MEJ-side non-GM render bugs used to live on this path (see
  // KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG's doc comment in helpers/foundry.mjs
  // for the full history) - typing into the search box debounces a Hub
  // re-render, and for a non-GM client EnhancedJournal.renderSubSheet's
  // permission re-check (enhanced-journal.js ~494) used to either throw (the
  // missing `.compendium` getter, fixed at MEJ commit ec97385) or, once that
  // stopped throwing, silently fail the permission check anyway (BlankJournal
  // inheriting Document#testUserPermission's always-NONE default, fixed by
  // BlankJournal's own testUserPermission override). Both are fixed now, so
  // this no longer needs the `tempOwnership` steer-around it used to apply
  // here - a real non-GM client reaches the search tab and gets real results
  // without it (verified live).
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
          // recap is public (indexed as a plain field, unlike gmNotes) -
          // the positive control below searches for this word to prove the
          // player's search genuinely rendered results before trusting it
          // to correctly *omit* the GM-only "banshee" hit.
          system: {
            recap: "<p>The party found a hidden cartographerslodge.</p>",
            gmNotes: "<p>The vault combination is whispered by a banshee.</p>"
          }
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
    // Positive control: the player's search must find the public recap word.
    await search(playerShell, playerPage, "cartographerslodge");
    await expect(playerShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

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

  // S2 regression. live-index's recordFor() routes a person attribute into
  // the GM-only token set when MEJ's "sheet-settings" world setting marks its
  // key playerHidden - but that split is computed at INDEX time, and nothing
  // re-indexed when the setting itself changed. So a GM who marked an
  // attribute hidden left its value sitting in the PUBLIC token set, findable
  // by any player's search, until a world reload: the GM believes it is
  // hidden, and it is not.
  //
  // The assertion that matters is the one AFTER the flip, on the player's own
  // client - it is the player's index that has to rebuild, driven by the GM's
  // write replicating as an updateSetting hook. The pre-flip baseline and the
  // positive control are both here deliberately: without them this would pass
  // just as well against a search that silently returned nothing at all.
  test("marking a person attribute playerHidden re-indexes, so a player stops finding it", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const name = `${TT_PREFIX}Search Hidden Attr`;
    const settingBefore = await gmPage.evaluate(() =>
      foundry.utils.duplicate(game.settings.get("monks-enhanced-journal", "sheet-settings") ?? {}));

    let entryId = null;
    let playerContext = null;
    try {
      entryId = await gmPage.evaluate(async (n) => {
        const entry = await JournalEntry.create({
          name: n,
          pages: [{
            name: n,
            type: "monks-enhanced-journal.person",
            flags: {
              "monks-enhanced-journal": {
                type: "person",
                // Flat key -> string map (field-extractors.mjs). One attribute
                // gets hidden below; the other stays public as the control.
                attributes: { ttvaultcode: "zephyrquartz", ttrole: "cartographerslodge" }
              }
            },
            text: { content: "An unremarkable innkeeper." }
          }],
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
        return entry.id;
      }, name);

      playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
      const playerPage = await playerContext.newPage();
      const errors = trackConsoleErrors(playerPage, { ignore: [...IGNORE, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG] });
      await login(playerPage, "User 1");
      const playerShell = await openHubSearch(playerPage);

      // Baseline: not hidden yet, so the player CAN find it. This also builds
      // the player's index, which the rebuild below depends on already existing.
      await search(playerShell, playerPage, "zephyrquartz");
      await expect(playerShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

      // The GM marks that one attribute key playerHidden.
      await gmPage.evaluate(async (before) => {
        const next = foundry.utils.duplicate(before);
        foundry.utils.setProperty(next, "person.attributes.ttvaultcode.playerHidden", true);
        await game.settings.set("monks-enhanced-journal", "sheet-settings", next);
      }, settingBefore);
      await settle(playerPage, 800);

      // The player's client must have re-indexed off the replicated setting
      // write - without the updateSetting hook this still returns the row.
      await search(playerShell, playerPage, "zephyrquartz");
      await expect(playerShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(0);

      // Positive control: the un-hidden attribute is still findable, so the
      // absence above means this attribute got hidden - not that the index is
      // empty or the search pane broke.
      await search(playerShell, playerPage, "cartographerslodge");
      await expect(playerShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

      assertNoConsoleErrors(errors);
    } finally {
      await gmPage.evaluate(async ({ before, id }) => {
        await game.settings.set("monks-enhanced-journal", "sheet-settings", before);
        if (id && game.journal.get(id)) await JournalEntry.implementation.deleteDocuments([id]);
      }, { before: settingBefore, id: entryId });
      if (playerContext) await playerContext.close();
      await gmContext.close();
    }
  });
});
