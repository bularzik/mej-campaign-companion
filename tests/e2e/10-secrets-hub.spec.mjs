import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

// Load-bearing render guard (same rationale as 09-secrets.spec.mjs's
// openEntry()): this file's flow eventually asserts things are ABSENT (a
// filtered-out tracker row, a not-yet-revealed session flag) — confirm the
// shell actually mounted this entry's real content first, via a positive
// anchor unique to what was just created, so a later negative check can't
// pass vacuously against a shell that silently failed to render.
async function openEntry(page, entryId, anchorText) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(shell).toBeVisible();
  await expect(shell).toContainText(anchorText);
  return shell;
}

test.describe("10 secrets hub + prep board", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "playerGroups", []);
        const chatIds = game.messages.filter((m) => m.content?.includes("TT-")).map((m) => m.id);
        if (chatIds.length) await ChatMessage.implementation.deleteDocuments(chatIds);
      });
    });
  });

  test("tracker lists block + session secrets; player filter narrows; prep board reveals", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const { placeId, sessionId } = await page.evaluate(async ({ prefix }) => {
      const place = await JournalEntry.create({
        name: `${prefix}Tracker-Place`,
        pages: [{ name: "p", type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: '<section class="secret" id="secret-t1"><p>tracker-block-secret</p></section>' } }]
      });
      const session = await JournalEntry.create({
        name: `${prefix}Tracker-Session`,
        pages: [{
          name: "s",
          type: "mej-campaign-companion.session",
          flags: {
            "mej-campaign-companion": { session: { sessionNumber: 1, campaignDate: null, attendees: [], secrets: [{ id: "c1", text: "tracker-clue", revealed: false, revealedAt: null }] } },
            "monks-enhanced-journal": { type: "session" }
          }
        }]
      });
      const u1 = game.users.getName("User 1").id;
      await place.update({ "flags.mej-campaign-companion.secretReveals.secret-t1": { users: [u1], groups: [], all: false, revealedAt: 1 } });
      return { placeId: place.id, sessionId: session.id };
    }, { prefix: TT_PREFIX });

    // Open Hub -> Secrets tab. (GM always sees the block secret's own text,
    // so it doubles as this entry's render anchor.)
    const shell = await openEntry(page, placeId, "tracker-block-secret");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator('nav.sheet-tabs a[data-tab="secrets"]').click();
    await settle(page, 300);

    const rows = shell.locator(".mej-cc-secret-row");
    await expect(rows.filter({ hasText: "tracker-block-secret" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "tracker-clue" })).toHaveCount(1);

    // "What does User 1 know" -> only the block secret remains.
    await shell.locator('.mej-cc-secrets-controls button[data-filter="player"]', { hasText: "User 1" }).click();
    await settle(page, 300);
    await expect(shell.locator(".mej-cc-secret-row").filter({ hasText: "tracker-clue" })).toHaveCount(0);
    await expect(shell.locator(".mej-cc-secret-row").filter({ hasText: "tracker-block-secret" })).toHaveCount(1);

    // Prep board: opened directly through the module's own openPrepBoard()
    // entry point rather than clicking the ".mej-cc-open-prep" header
    // button MEJ renders for it (confirmed live: MEJ-side bug, not this
    // module's — apps/enhanced-journal.js's subsheet-header-button injection
    // does `$('> header a.close', this.element).insertBefore(...)` to place
    // every getDocumentSheetHeaderButtons button, but v14's ApplicationV2
    // shell header has no `<a class="close">` at all — the close control is
    // now `<button data-action="close">` — so the jQuery selector always
    // matches nothing and .insertBefore() on an empty set is a silent no-op.
    // Confirmed this isn't specific to the prep-board button: MEJ's OWN
    // "mej-cc-open-graph" header button, injected through the exact same
    // hook, is equally absent from the DOM. Out of scope to fix here — it's
    // monks-enhanced-journal's apps/enhanced-journal.js, a different repo
    // with its own release/branch rules, not mej-campaign-companion. This
    // still exercises the real PrepBoardApp code path end-to-end (same
    // openPrepBoard() call the button's onclick would make) — only the
    // broken header-button wiring itself is bypassed.
    // Unlike the block secret above, a GM's own checklist-item text renders
    // inside an `<input class="secret-text" value="...">` (session.hbs),
    // not as text content — `.toContainText()` reads `textContent`, which
    // never sees an <input>'s `value` (same gotcha 07-knowledge.spec.mjs's
    // attribute-table comment calls out). Anchor on the entry's own unique
    // name instead (rendered in the shell's page-navigation/ToC sidebar),
    // which still proves *this* entry — not just some shell — mounted.
    await openEntry(page, sessionId, `${TT_PREFIX}Tracker-Session`);
    await page.evaluate(async (id) => {
      const { openPrepBoard } = await import("/modules/mej-campaign-companion/scripts/apps/prep-board-app.mjs");
      const pageDoc = game.journal.get(id).pages.contents[0];
      await openPrepBoard({ pageUuid: pageDoc.uuid });
    }, sessionId);
    await settle(page, 500);
    const board = page.locator(".mej-cc-prep-board");
    await expect(board.locator(".mej-cc-prep-secrets li", { hasText: "tracker-clue" })).toHaveCount(1);
    await board.locator('.mej-cc-prep-secrets li a[data-action="toggleSecret"]').first().click();
    await settle(page, 500);
    const revealed = await page.evaluate((id) => {
      const pageDoc = game.journal.get(id).pages.contents[0];
      return pageDoc.flags["mej-campaign-companion"].session.secrets[0].revealed;
    }, sessionId);
    expect(revealed).toBe(true);

    assertNoConsoleErrors(errors);
  });
});
