import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEW = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const SECRET_HTML = '<p>Public intro.</p><section class="secret" id="secret-e2e1"><p>TT-secret-vampire</p></section>';

async function createPlaceWithSecret(page, name) {
  return page.evaluate(async ({ n, html }) => {
    const entry = await JournalEntry.create({
      name: n,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      pages: [{ name: n, type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: html } }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html: SECRET_HTML });
}

async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  return page.locator("#MonksEnhancedJournal");
}

// Scope to the enriched, read-only preview container. The MEJ/Foundry
// editor field scaffold *also* mounts a `<prose-mirror>` editable element
// carrying the page's raw (un-enriched) text.content — present in the DOM
// for any user who can open the sheet, editable or not, permanently
// 0x0/offsetParent-null (never actually rendered on screen) — independent
// of this module's secrets layer and present with or without it (confirmed
// live: same element shows up for a plain MEJ place page with a native
// `section.secret`, no companion involvement). An unscoped `section.secret`
// query double-counts it, and `.toContainText()` (which reads full
// `textContent`, not just visible text) would see straight through it too.
// The enriched `.editor-display` container is what a reveal actually
// controls and what a real user's screen shows, so that's what these tests
// assert against.
function contentPreview(shell) {
  return shell.locator('.editor-display[data-key="text.content"]');
}

test.describe("09 secrets", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "playerGroups", []);
      });
    });
  });

  test("GM reveals a block to User 1: A sees block + whisper, User 2 sees neither", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Secret-Place`);
    const gmShell = await openEntry(page, id);
    // GM sees the secret and the audience button.
    await expect(contentPreview(gmShell).locator("section.secret")).toHaveCount(1);
    const btn = gmShell.locator(".mej-cc-secret-audience");
    await expect(btn).toHaveCount(1);

    // Player 1 before reveal: no secret content.
    const p1Ctx = await browser.newContext(VIEW);
    const p1 = await p1Ctx.newPage();
    await login(p1, "User 1");
    const p1Shell = await openEntry(p1, id);
    await expect(contentPreview(p1Shell).locator("section.secret")).toHaveCount(0);
    await expect(contentPreview(p1Shell)).not.toContainText("TT-secret-vampire");

    // GM reveals to User 1.
    await btn.click();
    await settle(page, 300);
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toBeVisible();
    const u1Id = await page.evaluate(() => game.users.getName("User 1").id);
    await dialog.locator(`input[name="user-${u1Id}"]`).check();
    await dialog.locator('button[data-action="ok"]').click();
    await settle(page, 800);

    // Player 1 now sees the block (live update) and got a whisper.
    await expect(contentPreview(p1Shell).locator("section.secret.mej-cc-revealed-to-you")).toHaveCount(1);
    await expect(contentPreview(p1Shell)).toContainText("TT-secret-vampire");
    const whispered = await p1.evaluate(() =>
      game.messages.contents.some((m) => m.content?.includes("TT-secret-vampire") && m.whisper?.length)
    );
    expect(whispered).toBe(true);

    // Player 2 sees neither.
    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    const p2Shell = await openEntry(p2, id);
    await expect(contentPreview(p2Shell).locator("section.secret")).toHaveCount(0);
    const p2Whisper = await p2.evaluate(() =>
      game.messages.contents.some((m) => m.content?.includes("TT-secret-vampire") && m.whisper?.includes(game.user.id))
    );
    expect(p2Whisper).toBe(false);

    await p1Ctx.close();
    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });

  test("group reveal follows live membership", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Group-Place`);
    // Group contains only User 1; reveal to the group.
    await page.evaluate(async (entryId) => {
      const u1 = game.users.getName("User 1").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1] }]);
      const entry = game.journal.get(entryId);
      await entry.update({ "flags.mej-campaign-companion.secretReveals.secret-e2e1": { users: [], groups: ["gA"], all: false, revealedAt: 1 } });
    }, id);

    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    let p2Shell = await openEntry(p2, id);
    await expect(contentPreview(p2Shell).locator("section.secret")).toHaveCount(0);

    // User 2 joins the group -> sees the previously revealed secret.
    await page.evaluate(async () => {
      const u1 = game.users.getName("User 1").id;
      const u2 = game.users.getName("User 2").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1, u2] }]);
    });
    await settle(p2, 600);
    p2Shell = await openEntry(p2, id); // reopen to re-render with new membership
    await expect(contentPreview(p2Shell)).toContainText("TT-secret-vampire");

    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });
});
