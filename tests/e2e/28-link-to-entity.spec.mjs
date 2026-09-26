// "Link to Entity" (spec 2026-09-26 §6). Names are run-unique single tokens
// in this spec's "TT-Lte" slice of the harness "TT-" namespace, so global
// setup's crashed-run sweep reclaims them and stale entities from earlier
// runs never become extra matches. Helpers are copied from
// 24-entity-from-selection.spec.mjs (createMejPage gains an ownership arg).
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const MOD = "mej-campaign-companion";
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const RUN = Date.now();
// This spec's own slice of the harness "TT-" namespace (cleanup scope).
const PREFIX = "TT-Lte";
const N = {
  camp: `${PREFIX}Camp${RUN}`, place: `${PREFIX}Place${RUN}`,
  vex: `${PREFIX}Vex${RUN}`, twin: `${PREFIX}Twin${RUN}`, none: `${PREFIX}None${RUN}`
};
const CREATE = "Create Entity from Selection";
const LINK = "Link to Entity";
const item = (page, label) => page.locator("#context-menu li", { hasText: label });
const picker = (page) => page.locator("dialog.application", { hasText: LINK });
const journalCount = (page) => page.evaluate(() => game.journal.size);

async function setSettings(page, { autoLink, retroLinkMode }) {
  await page.evaluate(async ({ autoLink, retroLinkMode, MOD }) => {
    if (autoLink !== undefined) await game.settings.set(MOD, "autoLink", autoLink);
    if (retroLinkMode !== undefined) await game.settings.set(MOD, "retroLinkMode", retroLinkMode);
  }, { autoLink, retroLinkMode, MOD });
}

async function createCampaignFolder(page, name) {
  const id = await page.evaluate(async (n) => (await Folder.create({
    name: n, type: "JournalEntry",
    flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
  })).id, name);
  return id;
}

/** An MEJ page of `type`, filed into `folderId`; ownership.default = `ownership` (2 = player-visible). */
async function createMejPage(page, name, html, folderId, type = "place", ownership = 2) {
  return page.evaluate(async ({ n, html, folderId, type, ownership }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: ownership },
      pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type } }, text: { content: html } }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, html, folderId, type, ownership });
}

const textOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", id);
/** Open an entry in the MEJ shell (22-auto-link-sessions' openEntry, minus the knowledge panel). */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(shell.locator(".editor-parent .editor-display[data-key]").first()).toBeVisible({ timeout: 15_000 });
  return shell;
}

/**
 * Select `text` (nth occurrence, 0-based) inside the open sheet's description and open the context menu on it.
 * `root` defaults to the rendered (display-mode) description; test 4 passes the open ProseMirror editor.
 */
async function selectAndOpenMenu(page, text, nth = 0, root = ".editor-parent .editor-display[data-key]") {
  const box = await page.evaluate(({ text, nth, root }) => {
    const display = [...document.querySelectorAll(root)].find((d) => d.offsetParent);
    const walker = document.createTreeWalker(display, NodeFilter.SHOW_TEXT);
    let node, seen = 0, at = -1;
    while ((node = walker.nextNode())) {
      let i = -1;
      while ((i = node.data.indexOf(text, i + 1)) !== -1) { if (seen++ === nth) { at = i; break; } }
      if (at !== -1) break;
    }
    const r = document.createRange(); r.setStart(node, at); r.setEnd(node, at + text.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const rect = r.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { text, nth, root });
  await page.mouse.click(box.x, box.y, { button: "right" });
}
async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

/**
 * Deletes this spec's documents through the harness's prefix helpers (the
 * same ones global setup's crashed-run sweep uses), scoped to "TT-Lte": the
 * journals first (every entity this spec makes carries the prefix), then
 * the now-empty campaign folders.
 */
async function cleanup(gmPage) {
  // Capped: with an editor open MEJ's close() waits on its own
  // "unsaved changes" confirm, which nobody answers.
  await gmPage.evaluate(async () => {
    try {
      await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* nothing open */ }
  });
  await deleteJournalsByPrefix(gmPage, PREFIX);
  await cleanupStrandedTestFolders(gmPage, { prefix: PREFIX });
  await gmPage.evaluate(async (MOD) => {
    await game.settings.set(MOD, "autoLink", true);
    await game.settings.set(MOD, "retroLinkMode", "silent");
  }, MOD);
}

test.describe("28 link to entity", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("one match: Link replaces Create and links the selection, whatever its casing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const lower = N.vex.toLowerCase();
    const place = await createMejPage(page, N.place, `<p>Ask ${lower} now.</p>`, folder);
    const before = await journalCount(page);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, lower);
    await expect(item(page, LINK)).toHaveCount(1);
    await expect(item(page, CREATE)).toHaveCount(0);
    await item(page, LINK).click();

    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
      .toBe(`<p>Ask @UUID[${vex.uuid}]{${lower}} now.</p>`);
    expect(await journalCount(page)).toBe(before);
    await expect(page.locator("#notifications li.notification.info", { hasText: "Linked the selection" }))
      .toHaveCount(1, { timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });

  test("two matches: the picker links the chosen one; closing it writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    const second = await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const html = `<p>Meet ${N.twin} here.</p>`;
    const place = await createMejPage(page, N.place, html, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await expect(picker(page).locator("select[name='entity'] option")).toHaveCount(2);
    await picker(page).locator("button[data-action='close'], header button.close").first().click();
    await expect(picker(page)).toHaveCount(0, { timeout: 10_000 });
    await settle(page, 800);
    expect(await textOf(page, place.id)).toBe(html);

    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await picker(page).locator("select[name='entity']").selectOption(second.uuid);
    await picker(page).locator("button[data-action='ok']").click();
    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
      .toBe(`<p>Meet @UUID[${second.uuid}]{${N.twin}} here.</p>`);
    assertNoConsoleErrors(errors);
  });

  test("no match, or only the page's own entry: Create shows, Link does not", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>${N.none} and ${N.place}.</p>`, folder);

    await openEntry(page, place.id);
    for (const text of [N.none, N.place]) {
      await selectAndOpenMenu(page, text);
      await expect(item(page, CREATE)).toHaveCount(1);
      await expect(item(page, LINK)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.locator("#context-menu")).toHaveCount(0, { timeout: 5_000 });
    }
    assertNoConsoleErrors(errors);
  });

  test("a GM-only entity is not a match on a player-visible page", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.vex, "<p>Secret person.</p>", folder, "person", 0);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.vex} now.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.vex);
    await expect(item(page, CREATE)).toHaveCount(1);
    await expect(item(page, LINK)).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("a campaign contributor links through the GM", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const place = await createMejPage(page, N.place, `<p>Ask ${N.vex} now.</p>`, folder);
    await page.evaluate(async ({ folder, MOD }) => {
      const u1 = game.users.getName("User 1");
      await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u1.id], groupIds: [] });
    }, { folder, MOD });

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await expect(item(u1.page, LINK)).toHaveCount(1);
      await expect(item(u1.page, CREATE)).toHaveCount(0);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(`<p>Ask @UUID[${vex.uuid}]{${N.vex}} now.</p>`);
      await expect(u1.page.locator("#notifications li.notification.info", { hasText: "Linked the selection" }))
        .toHaveCount(1, { timeout: 15_000 });
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });
});
