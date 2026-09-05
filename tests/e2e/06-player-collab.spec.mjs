import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const RECAP_EDITOR = ".editor-parent[data-editor-id='recap']";

/** Create a session directly with the given default ownership level, independent of the playersWriteSessions setting. */
async function createSession(page, name, level) {
  return page.evaluate(async ({ n, level }) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "mej-campaign-companion.session",
        flags: { "monks-enhanced-journal": { type: "session" } },
        system: { recap: "<p>GM opening line.</p>", gmNotes: "" }
      }],
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS[level] }
    });
    return entry.id;
  }, { n: name, level });
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

/** Open the recap editor, type, and commit the way a real blur does (the prose-mirror element's own change event). */
async function typeIntoRecap(page, shell, text) {
  await shell.locator('button[data-action="editRecap"]').click();
  const editor = shell.locator(`${RECAP_EDITOR} prose-mirror`);
  // The recap editor is `toggled`: the pencil only flips `open`, and
  // activation (construction of the ProseMirror view, plus the
  // collaborative join for an owner) happens asynchronously from there
  // (core adds the "active" class once it's actually up) - wait for it
  // before typing, rather than a fixed settle.
  await expect(editor).toHaveClass(/active/, { timeout: 10_000 });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await settle(page, 200);
}

async function commitRecap(page) {
  await page.evaluate((sel) => {
    document.querySelector(`${sel} prose-mirror`).dispatchEvent(new Event("change", { bubbles: true }));
  }, RECAP_EDITOR);
  await settle(page, 800);
}

async function recapOf(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).pages.contents[0].system.recap, entryId);
}

async function dropFileOnRecap(page, file) {
  await page.evaluate(async ({ sel, file }) => {
    let blob;
    if (file.zeros) blob = new Uint8Array(file.zeros);
    else blob = await (await fetch(file.url)).blob();
    const f = new File([blob], file.name, { type: file.type });
    const dt = new DataTransfer();
    dt.items.add(f);
    const el = document.querySelector(sel);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    el.dispatchEvent(new DragEvent("dragenter", opts));
    el.dispatchEvent(new DragEvent("dragover", opts));
    el.dispatchEvent(new DragEvent("drop", opts));
  }, { sel: RECAP_EDITOR, file });
}

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

test.describe("06 player collaboration", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((j) => j.name?.startsWith("TT-")).map((j) => j.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      });
    });
  });

  test("an owning player edits the shared recap; it persists to system.recap and every seat reads it", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Shared Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    const p1Shell = await openSession(p1.page, entryId);
    expect(await p1.page.evaluate((id) => game.journal.get(id).isOwner, entryId)).toBe(true);
    await typeIntoRecap(p1.page, p1Shell, " Player one adds the ambush.");
    await commitRecap(p1.page);

    await gm.page.waitForFunction(
      (id) => game.journal.get(id)?.pages?.contents?.[0]?.system?.recap?.includes("Player one adds the ambush."),
      entryId, { timeout: 10_000 }
    );
    const persisted = await recapOf(gm.page, entryId);
    expect(persisted).toContain("GM opening line.");
    expect(persisted).toContain("Player one adds the ambush.");
    // The per-player flag is gone for good - nothing writes it any more.
    expect(await gm.page.evaluate((id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "playerRecaps"), entryId)).toBeUndefined();

    const p2 = await newSeat(browser, "User 2");
    const p2Shell = await openSession(p2.page, entryId);
    await expect(p2Shell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("Player one adds the ambush.");
    // Exactly one recap editor on the tab - the Player Recaps section is gone.
    await expect(p2Shell.locator('.tab[data-tab="description"] prose-mirror')).toHaveCount(1);
    await expect(p2Shell.locator(".player-recaps-section, .player-recap-self, .other-recap")).toHaveCount(0);

    assertNoConsoleErrors(p1.errors);
    assertNoConsoleErrors(p2.errors);
    await p1.context.close();
    await p2.context.close();
    await gm.context.close();
  });

  test("a non-owner player sees the recap read-only: no pencil, disabled editor, drops ignored", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Observer Session`, "OBSERVER");

    const p1 = await newSeat(browser, "User 1");
    const shell = await openSession(p1.page, entryId);
    expect(await p1.page.evaluate((id) => game.journal.get(id).isOwner, entryId)).toBe(false);
    await expect(shell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("GM opening line.");
    await expect(shell.locator('button[data-action="editRecap"]')).toHaveCount(0);
    await expect(shell.locator(`${RECAP_EDITOR} prose-mirror`)).toHaveJSProperty("disabled", true);
    await expect(shell.locator(`${RECAP_EDITOR} prose-mirror`)).not.toHaveAttribute("collaborate", "");

    await dropFileOnRecap(p1.page, { url: "icons/svg/mystery-man.svg", name: "TT-ignored.svg", type: "image/svg+xml" });
    await settle(p1.page, 1500);
    expect(await recapOf(gm.page, entryId)).not.toContain("<img");
    // :not(.permanent) excludes this headless env's own persistent
    // "no hardware acceleration" warning (client-issues.mjs notifies it with
    // {permanent: true} at world load, unrelated to this test) - a genuinely
    // NEW notification from the ignored drop would still be caught here.
    await expect(p1.page.locator("#notifications li.notification:not(.permanent)")).toHaveCount(0);

    assertNoConsoleErrors(p1.errors);
    await p1.context.close();
    await gm.context.close();
  });

  test("two owners edit at once: both sentences persist (collaborative editor, not last-writer-wins)", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Concurrent Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    const p2 = await newSeat(browser, "User 2");
    const p1Shell = await openSession(p1.page, entryId);
    const p2Shell = await openSession(p2.page, entryId);
    await expect(p1Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toHaveAttribute("collaborate", "");

    await typeIntoRecap(p1.page, p1Shell, " Alpha sentence from one.");
    await typeIntoRecap(p2.page, p2Shell, " Beta sentence from two.");
    // Each seat's editor receives the other's steps before either saves.
    await expect(p1Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toContainText("Beta sentence from two.", { timeout: 10_000 });
    await expect(p2Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toContainText("Alpha sentence from one.", { timeout: 10_000 });
    await commitRecap(p1.page);
    await commitRecap(p2.page);

    await gm.page.waitForFunction(
      (id) => {
        const r = game.journal.get(id)?.pages?.contents?.[0]?.system?.recap ?? "";
        return r.includes("Alpha sentence from one.") && r.includes("Beta sentence from two.");
      },
      entryId, { timeout: 10_000 }
    );

    assertNoConsoleErrors(p1.errors);
    assertNoConsoleErrors(p2.errors);
    await p1.context.close();
    await p2.context.close();
    await gm.context.close();
  });

  test("relayed image: an owning player without FILES_UPLOAD drops an image, the GM relays it, it lands in the shared recap", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Relay Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    expect(await p1.page.evaluate(() => game.user.can("FILES_UPLOAD"))).toBe(false);
    const shell = await openSession(p1.page, entryId);
    await shell.locator(RECAP_EDITOR).waitFor();
    await dropFileOnRecap(p1.page, { url: "icons/svg/mystery-man.svg", name: "TT-relay-test.svg", type: "image/svg+xml" });

    // Relay is a multi-chunk socket round trip GM-side - give it real time.
    await gm.page.waitForFunction(
      (id) => (game.journal.get(id)?.pages?.contents?.[0]?.system?.recap ?? "").includes("<img"),
      entryId, { timeout: 15_000 }
    );
    const recap = await recapOf(gm.page, entryId);
    expect(recap).toContain("GM opening line.");
    expect(recap).toMatch(/worlds\/.*mej-campaign-companion.*uploads/);

    assertNoConsoleErrors(p1.errors);
    await p1.context.close();
    await gm.context.close();
  });

  test("an oversized file drop produces a clean client-side error, no upload attempted", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const entryId = await createSession(page, `${TT_PREFIX}Oversized Session`, "OBSERVER");
    const shell = await openSession(page, entryId);
    await shell.locator(RECAP_EDITOR).waitFor();
    // 11MB of zeros - over MAX_RELAY_FILE_BYTES (10MB); the size check runs before any upload.
    await dropFileOnRecap(page, { zeros: 11 * 1024 * 1024, name: "TT-too-big.png", type: "image/png" });
    await settle(page, 500);
    await expect(page.locator("#notifications li.notification.warning", { hasText: /too large/i })).toHaveCount(1);
    expect(await recapOf(page, entryId)).not.toContain("<img");
    assertNoConsoleErrors(errors);
  });
});
