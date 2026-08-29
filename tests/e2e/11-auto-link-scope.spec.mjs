import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
// Run-unique, single-token names (WORD_RE treats hyphenless alnum runs as one
// word): stale documents/chat from an earlier failed run can never satisfy
// this run's assertions (same lesson as 09-secrets' SECRET_TEXT).
const RUN = Date.now();
const N = {
  gmPage: `TTRetroGmPage${RUN}`,
  playerPage: `TTRetroPlayerPage${RUN}`,
  hero: `TTRetroHero${RUN}`,
  silentPage: `TTSilentPage${RUN}`,
  villain: `TTSilentVillain${RUN}`,
  burstPage: `TTBurstPage${RUN}`,
  burstA: `TTBurstAlpha${RUN}`,
  burstB: `TTBurstBravo${RUN}`,
  burstC: `TTBurstCharlie${RUN}`,
  gmSecret: `TTGmSecret${RUN}`,
  pubAlly: `TTPubAlly${RUN}`,
  typedPage: `TTTypedPage${RUN}`
};

/** Create a MEJ place entry (native text page + MEJ type flag), returning ids. */
async function createMejPlace(page, name, html, ownershipDefault) {
  return page.evaluate(async ({ n, html, own }) => {
    const entry = await JournalEntry.create({
      name: n,
      ownership: { default: own },
      pages: [{
        name: n, type: "text",
        flags: { "monks-enhanced-journal": { type: "place" } },
        text: { content: html }
      }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html, own: ownershipDefault });
}

async function setSettings(page, { autoLink, retroLinkMode }) {
  await page.evaluate(async ({ autoLink, retroLinkMode }) => {
    if (autoLink !== undefined) await game.settings.set("mej-campaign-companion", "autoLink", autoLink);
    if (retroLinkMode !== undefined) await game.settings.set("mej-campaign-companion", "retroLinkMode", retroLinkMode);
  }, { autoLink, retroLinkMode });
}

async function pageContent(page, entryId) {
  return page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", entryId);
}

async function cleanup(gmPage) {
  await gmPage.evaluate(async (run) => {
    const ids = game.journal.filter((j) => j.name?.includes(String(run))).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const msgs = game.messages.filter((m) => m.content?.includes(String(run))).map((m) => m.id);
    if (msgs.length) await ChatMessage.implementation.deleteDocuments(msgs);
    await game.settings.set("mej-campaign-companion", "autoLink", false);
    await game.settings.set("mej-campaign-companion", "retroLinkMode", "confirm");
  }, RUN);
}

test.describe("11 auto-link scoping", () => {
  test.afterEach(async ({ page, browser }) => {
    try {
      await cleanupAsGm(page, browser, (gmPage) => cleanup(gmPage));
    } catch (error) {
      console.error("11-auto-link-scope cleanup failed:", error);
      throw error;
    }
  });

  test("retroactive confirm: GM page linked via dialog, player-visible page excluded", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Setup docs with the pass disabled so their own creation can't trigger dialogs.
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    // Ownership levels are passed as plain numbers (0 = NONE, 2 = OBSERVER):
    // CONST only exists inside the browser context, not in Node test scope.
    const gmDoc = await createMejPlace(page, N.gmPage,
      `<p>Meet ${N.hero} at the gate.</p>`, 0);
    const playerDoc = await createMejPlace(page, N.playerPage,
      `<p>Meet ${N.hero} at the gate.</p>`, 2);

    await setSettings(page, { retroLinkMode: "confirm" });
    // Creating the entity triggers the pass on this (GM) client.
    const hero = await createMejPlace(page, N.hero, "<p>A hero.</p>", 0);

    const dialog = page.locator(".mej-cc-retro-link-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(N.gmPage);
    await expect(dialog).not.toContainText(N.playerPage);
    await dialog.locator('button[data-action="apply"]').click();
    await settle(page, 500);

    expect(await pageContent(page, gmDoc.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    expect(await pageContent(page, playerDoc.id)).not.toContain("@UUID[");
    assertNoConsoleErrors(errors);
  });

  // C7. A burst of creations (a multi-section docx import is the real case)
  // used to run one full-world walk AND one confirm dialog per entry: 50
  // sections meant 50 walks and 50 dialogs stacked in front of the GM. The
  // burst is now planned together - one dialog naming every entity, and one
  // write per page carrying all of their links at once.
  test("a burst of new entries is planned together: one dialog, one write per page", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const mention = await createMejPlace(page, N.burstPage,
      `<p>${N.burstA} and ${N.burstB} and ${N.burstC} were all here.</p>`, 0);

    await setSettings(page, { retroLinkMode: "confirm" });
    // Created back-to-back with no await between them, the way an import
    // creates its sections - this is what has to coalesce.
    const ids = await page.evaluate(async (names) => {
      const made = [];
      for (const n of names) {
        made.push((await JournalEntry.create({
          name: n, ownership: { default: 0 },
          pages: [{
            name: n, type: "text",
            flags: { "monks-enhanced-journal": { type: "place" } },
            text: { content: "<p>One of a burst.</p>" }
          }]
        })).id);
      }
      return made;
    }, [N.burstA, N.burstB, N.burstC]);

    const dialog = page.locator(".mej-cc-retro-link-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // ONE dialog, naming all three entities and the single page they share.
    await expect(page.locator(".mej-cc-retro-link-dialog")).toHaveCount(1);
    await expect(dialog).toContainText(N.burstPage);
    for (const name of [N.burstA, N.burstB, N.burstC]) await expect(dialog).toContainText(name);
    await dialog.locator('button[data-action="apply"]').click();
    await settle(page, 800);

    // One write carried every entity's link into that page.
    const content = await pageContent(page, mention.id);
    for (const id of ids) expect(content).toContain(`@UUID[JournalEntry.${id}]`);
    // And no second dialog followed the first.
    await expect(page.locator(".mej-cc-retro-link-dialog")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("retroactive silent: links written and GM whisper summary sent", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const mention = await createMejPlace(page, N.silentPage, `<p>${N.villain} was here.</p>`, 0);
    await setSettings(page, { retroLinkMode: "silent" });
    const villain = await createMejPlace(page, N.villain, "<p>A villain.</p>", 0);
    await settle(page, 1500);

    expect(await pageContent(page, mention.id)).toContain(`@UUID[JournalEntry.${villain.id}]`);
    const whisper = await page.evaluate((needle) =>
      game.messages.some((m) => m.whisper?.length && m.content?.includes(needle)), N.villain);
    expect(whisper).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("typing path: GM typing into a player-visible page links only player-visible entities", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: true, retroLinkMode: "off" });
    const secret = await createMejPlace(page, N.gmSecret, "<p>gm only</p>", 0);
    const ally = await createMejPlace(page, N.pubAlly, "<p>public</p>", 2);
    const typed = await createMejPlace(page, N.typedPage, "<p>start</p>", 2);

    await page.evaluate(async ({ id, html }) => {
      const p = game.journal.get(id).pages.contents[0];
      await p.update({ "text.content": html });
    }, { id: typed.id, html: `<p>start ${N.gmSecret} and ${N.pubAlly}</p>` });
    await settle(page, 500);

    const content = await pageContent(page, typed.id);
    expect(content).toContain(`@UUID[JournalEntry.${ally.id}]`);
    expect(content).not.toContain(`@UUID[JournalEntry.${secret.id}]`);
    assertNoConsoleErrors(errors);
  });
});
