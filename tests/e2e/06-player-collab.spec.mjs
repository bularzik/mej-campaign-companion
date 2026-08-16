import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

/** Create a GM-owned (not player-owned) session directly, with both players
 * granted OBSERVER so they can open it. */
async function createGmOwnedSession(page, name) {
  return page.evaluate(async (n) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "mej-campaign-companion.session",
        flags: { "monks-enhanced-journal": { type: "session" } }
      }],
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
    });
    return entry.id;
  }, name);
}

async function openSession(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator('nav.sheet-tabs a[data-tab="description"]').click();
  await settle(page, 200);
  return shell;
}

test.describe("06 player collaboration", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      const ids = game.journal.filter((j) => j.name?.startsWith("TT-")).map((j) => j.id);
      if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      await game.settings.set("mej-campaign-companion", "playersWriteSessions", false);
    }).catch(() => {});
  });

  test("a non-owner player can write their recap on a GM-owned session (relay path); persists; another player reads it read-only; only the author can edit it", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");
    const entryId = await createGmOwnedSession(gmPage, `${TT_PREFIX}Collab Session`);
    // Enabled *after* creation, deliberately: shouldOwnSessionEntry() only
    // grants ownership at creation time (preCreateJournalEntry), so a
    // session that already existed before the setting was turned on stays
    // GM-owned — exactly the "GM-owned session" scenario the brief asks
    // for, with the setting genuinely on (not just never touched).
    await gmPage.evaluate(async () => { await game.settings.set("mej-campaign-companion", "playersWriteSessions", true); });

    const p1Context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const p1Page = await p1Context.newPage();
    const p1Errors = trackConsoleErrors(p1Page, { ignore: IGNORE });
    await login(p1Page, "User 1");
    const p1Shell = await openSession(p1Page, entryId);

    // ⚠️ parked item: a non-owner player's recap editor is genuinely
    // interactive (SessionSheet._disableFields/subRender re-enable it for
    // every user regardless of document ownership — see that class's own
    // header comment), even though the rest of the form is disabled for them.
    const isOwner = await p1Page.evaluate((id) => game.journal.get(id).isOwner, entryId);
    expect(isOwner).toBe(false);
    const p1Editor = p1Shell.locator('.player-recap-self prose-mirror');
    await expect(p1Editor).not.toHaveAttribute("disabled", "");
    await expect(p1Editor).toHaveJSProperty("disabled", false);

    await p1Shell.locator('button[data-action="editPlayerRecap"]').click();
    await settle(p1Page, 200);
    await p1Editor.click();
    await p1Page.keyboard.type("My in-character recollections of the ambush.");
    // Commit: the prose-mirror custom element's own "change" event is what
    // the shell's submitOnChange form listens for (bubbles up to
    // SessionSheet.onSubmit -> savePlayerRecap -> recapWriteRoute() ===
    // "relay" since User 1 isn't the document owner). In a real browser
    // this fires on the editor's own internal blur; Playwright's synthetic
    // Tab/keyboard focus movement doesn't reliably trigger a shadow-DOM
    // custom element's internal blur handling, so dispatch the same event
    // it would raise directly (verified live to be otherwise equivalent —
    // the save logic itself is unaffected by how "change" gets raised).
    await p1Page.evaluate(() => {
      document.querySelector(".player-recap-self prose-mirror").dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(p1Page, 800);

    const p1UserId = await p1Page.evaluate(() => game.user.id);
    await gmPage.waitForFunction(
      ({ id, userId }) => {
        const p = game.journal.get(id)?.pages?.contents?.[0];
        return !!p?.getFlag("mej-campaign-companion", "playerRecaps")?.[userId];
      },
      { id: entryId, userId: p1UserId },
      { timeout: 10_000 }
    );
    const persisted = await gmPage.evaluate(({ id, userId }) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.getFlag("mej-campaign-companion", "playerRecaps")?.[userId];
    }, { id: entryId, userId: p1UserId });
    expect(persisted).toContain("My in-character recollections of the ambush.");

    // A second player reads it, read-only, and cannot type into it.
    const p2Context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const p2Page = await p2Context.newPage();
    const p2Errors = trackConsoleErrors(p2Page, { ignore: IGNORE });
    await login(p2Page, "User 2");
    const p2Shell = await openSession(p2Page, entryId);
    await expect(p2Shell.locator('.other-recap', { hasText: "My in-character recollections of the ambush." })).toHaveCount(1);
    // The other-recaps-list has no editor controls at all — it's rendered
    // as plain enriched HTML (template's {{{recap.enrichedHtml}}}), not an
    // editable field, so there is no element to even attempt typing into.
    await expect(p2Shell.locator('.other-recap prose-mirror, .other-recap [contenteditable="true"]')).toHaveCount(0);

    // Only the author's own key was ever written; the GM-side relay handler
    // targets flags.playerRecaps.<sender's own userId> exclusively.
    const p2UserId = await p2Page.evaluate(() => game.user.id);
    const p2FlagAbsent = await gmPage.evaluate(({ id, userId }) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.getFlag("mej-campaign-companion", "playerRecaps")?.[userId] === undefined;
    }, { id: entryId, userId: p2UserId });
    expect(p2FlagAbsent).toBe(true);

    assertNoConsoleErrors(p1Errors);
    assertNoConsoleErrors(p2Errors);
    await p1Context.close();
    await p2Context.close();
    await gmContext.close();
  });

  test("player image relay: a player without FILES_UPLOAD drops an image, the GM relays it, it renders in the player's recap", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");
    const entryId = await createGmOwnedSession(gmPage, `${TT_PREFIX}Relay Session`);

    const p1Context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const p1Page = await p1Context.newPage();
    const errors = trackConsoleErrors(p1Page, { ignore: IGNORE });
    await login(p1Page, "User 1");
    const canUpload = await p1Page.evaluate(() => game.user.can("FILES_UPLOAD"));
    expect(canUpload).toBe(false);

    const shell = await openSession(p1Page, entryId);
    const dropTarget = shell.locator(".player-recap-self");
    await dropTarget.waitFor();
    await p1Page.evaluate(async (selector) => {
      const res = await fetch("icons/svg/mystery-man.svg");
      const blob = await res.blob();
      const file = new File([blob], "TT-relay-test.svg", { type: "image/svg+xml" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector(selector);
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      el.dispatchEvent(new DragEvent("dragenter", opts));
      el.dispatchEvent(new DragEvent("dragover", opts));
      el.dispatchEvent(new DragEvent("drop", opts));
    }, ".player-recap-self");

    // Relay is a multi-chunk socket round trip GM-side — give it real time.
    const p1UserId = await p1Page.evaluate(() => game.user.id);
    await gmPage.waitForFunction(
      ({ id, userId }) => {
        const p = game.journal.get(id)?.pages?.contents?.[0];
        const recap = p?.getFlag("mej-campaign-companion", "playerRecaps")?.[userId];
        return typeof recap === "string" && recap.includes("<img");
      },
      { id: entryId, userId: p1UserId },
      { timeout: 15_000 }
    );
    const recap = await gmPage.evaluate(({ id, userId }) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.getFlag("mej-campaign-companion", "playerRecaps")?.[userId];
    }, { id: entryId, userId: p1UserId });
    expect(recap).toContain("<img");
    // Uploaded to the world's relay directory, not served back from the
    // original (player-inaccessible) module path.
    expect(recap).toMatch(/worlds\/.*mej-campaign-companion.*uploads/);

    assertNoConsoleErrors(errors);
    await p1Context.close();
    await gmContext.close();
  });

  test("an oversized file drop produces a clean client-side error, no upload attempted", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const entryId = await createGmOwnedSession(page, `${TT_PREFIX}Oversized Session`);
    const shell = await openSession(page, entryId);
    const dropTarget = shell.locator(".player-recap-self");
    await dropTarget.waitFor();

    await page.evaluate(async (selector) => {
      // 11MB of zeros — over MAX_RELAY_FILE_BYTES (10MB) — never touches
      // the network either way (the client-side size check in
      // _ingestRecapImage runs before any upload attempt).
      const bytes = new Uint8Array(11 * 1024 * 1024);
      const file = new File([bytes], "TT-too-big.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector(selector);
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      el.dispatchEvent(new DragEvent("dragenter", opts));
      el.dispatchEvent(new DragEvent("dragover", opts));
      el.dispatchEvent(new DragEvent("drop", opts));
    }, ".player-recap-self");
    await settle(page, 500);

    await expect(page.locator("#notifications li.notification.warning", { hasText: /too large/i })).toHaveCount(1);
    const recap = await page.evaluate((id) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.getFlag("mej-campaign-companion", "playerRecaps")?.[game.user.id];
    }, entryId);
    expect(recap ?? "").not.toContain("<img");

    assertNoConsoleErrors(errors);
  });
});
