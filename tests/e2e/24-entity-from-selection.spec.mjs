// "Create Entity from Selection" (spec 2026-09-22 §6, E2E cases 1-7).
//
// Names are run-unique single tokens (TT-Efs...${RUN}; auto-link's WORD_RE
// keeps an inner hyphen inside one word): the brief's "Elara" becomes
// TT-EfsElara${RUN} because the entity is named after the selection, and on
// World A every created document must carry the harness's "TT-" prefix so
// global setup's crashed-run sweep reclaims it. The run-unique name also
// keeps stale entities from earlier runs out of the retro pass's ambiguity
// check.
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
const PREFIX = "TT-Efs";
const N = {
  camp: `${PREFIX}Camp${RUN}`,
  place: `${PREFIX}Place${RUN}`,
  other: `${PREFIX}Other${RUN}`,
  elara: `${PREFIX}Elara${RUN}`,
  boren: `${PREFIX}Boren${RUN}`,
  // 81 characters, no whitespace: one past the 80-character cap.
  long: `${PREFIX}Long${RUN}`.padEnd(81, "z")
};
const MENU_LABEL = "Create Entity from Selection";

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

/** A player-visible (OBSERVER) MEJ page of `type`, filed into `folderId`. */
async function createMejPage(page, name, html, folderId, type = "place") {
  return page.evaluate(async ({ n, html, folderId, type }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: 2 },
      pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type } }, text: { content: html } }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, html, folderId, type });
}

const textOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", id);
const entryNamed = (page, name) => page.evaluate((n) => {
  const e = game.journal.find((j) => j.name === n);
  if (!e) return null;
  return {
    id: e.id, folder: e.folder?.id ?? null, ownershipDefault: e.ownership.default,
    type: e.pages.contents[0]?.getFlag("monks-enhanced-journal", "type") ?? null
  };
}, name);

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
const menuItem = (page) => page.locator("#context-menu li", { hasText: MENU_LABEL });
const entityDialog = (page) => page.locator("dialog.application", { hasText: MENU_LABEL });

/** Fill the open dialog and press Create. */
async function submitDialog(page, { type, linkOthers = true, name } = {}) {
  const dialog = entityDialog(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  if (type) await dialog.locator("select[name='type']").selectOption(type);
  if (name !== undefined) await dialog.locator("input[name='name']").fill(name);
  await dialog.locator("input[name='linkOthers']").setChecked(linkOthers);
  await dialog.locator("button[data-action='ok']").click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
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
 * same ones global setup's crashed-run sweep uses), scoped to "TT-Efs": the
 * journals first (the new entity lands in the campaign folder and carries
 * the prefix too), then the now-empty campaign folders.
 */
async function cleanup(gmPage) {
  // Capped: with an editor open (test 4) MEJ's close() waits on its own
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

test.describe("24 create entity from selection", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("GM happy path: creates a Person, links the selected occurrence and the other mentions, opens a background tab", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "auto" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.elara} about ${N.elara}.</p>`, folder);
    const other = await createMejPage(page, N.other, `<p>${N.elara} is here.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.elara, 1);
    await expect(menuItem(page)).toHaveCount(1);
    await menuItem(page).click();
    await submitDialog(page, { type: "person" });

    await expect.poll(() => entryNamed(page, N.elara), { timeout: 10_000 }).not.toBeNull();
    const entity = await entryNamed(page, N.elara);
    expect(entity.folder).toBe(folder);
    expect(entity.type).toBe("person");
    const link = `@UUID[JournalEntry.${entity.id}]{${N.elara}}`;
    // Only-the-selected-occurrence is proven by test 2 (exact content, no retro).
    // The selected (2nd) occurrence is linked. The retro pass (auto) may
    // link the 1st one as well once it runs, so only the 2nd is pinned here;
    // test 2 pins the exact pre-retro content.
    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 }).toContain(`about ${link}.`);
    await expect.poll(() => textOf(page, other.id), { timeout: 15_000 }).toContain(link);

    const tabs = await page.evaluate(() => (game.MonksEnhancedJournal.journal?.tabs ?? []).map((t) => ({ text: t.text, active: !!t.active })));
    expect(tabs.some((t) => t.text === N.elara)).toBe(true);
    expect(tabs.find((t) => t.active)?.text).toBe(N.place);
    await expect(page.locator("#notifications li.notification.info", { hasText: "Created" })).toHaveCount(1, { timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });

  test("Link other mentions unchecked: only the selection is linked", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "auto" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.elara} about ${N.elara}.</p>`, folder);
    const other = await createMejPage(page, N.other, `<p>${N.elara} is here.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.elara, 1);
    await menuItem(page).click();
    await submitDialog(page, { type: "person", linkOthers: false });

    await expect.poll(() => entryNamed(page, N.elara), { timeout: 10_000 }).not.toBeNull();
    const entity = await entryNamed(page, N.elara);
    const link = `@UUID[JournalEntry.${entity.id}]{${N.elara}}`;
    await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
      .toBe(`<p>Ask ${N.elara} about ${link}.</p>`);
    await settle(page, 3000);
    expect(await textOf(page, other.id)).not.toContain(`@UUID[JournalEntry.${entity.id}]`);
    expect(await textOf(page, place.id)).toBe(`<p>Ask ${N.elara} about ${link}.</p>`);
    assertNoConsoleErrors(errors);
  });

  test("a selection longer than 80 characters hides the item; MEJ's Extract stays", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    expect(N.long.length).toBe(81);
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>Before ${N.long} after.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.long);
    await expect(page.locator("#context-menu li", { hasText: "Extract to Journal Entry" })).toHaveCount(1);
    await expect(menuItem(page)).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("edit mode hides the item", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.elara} about it.</p>`, folder);

    const shell = await openEntry(page, place.id);
    await shell.locator(".editor-parent").filter({ has: page.locator(".editor-display[data-key]:visible") }).first()
      .locator(".editor-edit").click();
    const editing = shell.locator(".editor-parent.editing");
    await expect(editing).toHaveCount(1, { timeout: 10_000 });
    // The display element is hidden in edit mode: select inside the open
    // ProseMirror editor instead, the way a user would.
    await expect(editing.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });
    await selectAndOpenMenu(page, N.elara, 0, ".editor-parent.editing .ProseMirror");
    // The menu did open (MEJ's own item is there), so the absence is real.
    await expect(page.locator("#context-menu li", { hasText: "Extract to Journal Entry" })).toHaveCount(1);
    await expect(menuItem(page)).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("the last chosen type is preselected next time", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>From ${N.elara} to ${N.boren}.</p>`, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.elara);
    await menuItem(page).click();
    await submitDialog(page, { type: "place" });
    await expect.poll(() => entryNamed(page, N.elara), { timeout: 10_000 }).not.toBeNull();
    await settle(page, 800);

    await selectAndOpenMenu(page, N.boren);
    await menuItem(page).click();
    const dialog = entityDialog(page);
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator("select[name='type']")).toHaveValue("place");
    await dialog.locator("button[data-action='ok']").click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(() => entryNamed(page, N.boren), { timeout: 10_000 }).not.toBeNull();
    expect((await entryNamed(page, N.boren)).type).toBe("place");
    assertNoConsoleErrors(errors);
  });

  test("a campaign contributor creates through the GM: campaign baseline, selection linked, toast", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const place = await createMejPage(page, N.place, `<p>Ask ${N.elara} here.</p>`, folder);
    await page.evaluate(async ({ folder, MOD }) => {
      const u1 = game.users.getName("User 1");
      await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u1.id], groupIds: [] });
    }, { folder, MOD });

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.elara);
      await expect(menuItem(u1.page)).toHaveCount(1);
      await menuItem(u1.page).click();
      await submitDialog(u1.page, { type: "person" });

      await expect.poll(() => entryNamed(page, N.elara), { timeout: 15_000 }).not.toBeNull();
      const entity = await entryNamed(page, N.elara);
      expect(entity.ownershipDefault).toBe(2);
      expect(entity.folder).toBe(folder);
      await expect.poll(() => textOf(page, place.id), { timeout: 10_000 })
        .toContain(`@UUID[JournalEntry.${entity.id}]{${N.elara}}`);
      await expect(u1.page.locator("#notifications li.notification.info", { hasText: "Created" }))
        .toHaveCount(1, { timeout: 15_000 });
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("non-contributor sees no item; a contributor sees none once no GM is connected", async ({ browser }) => {
    test.setTimeout(180_000);
    const gm = await newSeat(browser, "Gamemaster");
    const folder = await createCampaignFolder(gm.page, N.camp);
    const place = await createMejPage(gm.page, N.place, `<p>Ask ${N.elara} here.</p>`, folder);
    await gm.page.evaluate(async ({ folder, MOD }) => {
      const u1 = game.users.getName("User 1");
      await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u1.id], groupIds: [] });
    }, { folder, MOD });

    const u2 = await newSeat(browser, "User 2");
    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u2.page, place.id);
      await selectAndOpenMenu(u2.page, N.elara);
      // The menu itself opens (MEJ's own entries are GM-only, so it may be
      // empty); the companion's item must not be in it.
      await settle(u2.page, 500);
      await expect(menuItem(u2.page)).toHaveCount(0);

      // Sanity: with the GM still connected, User 1 (listed) does see it.
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.elara);
      await expect(menuItem(u1.page)).toHaveCount(1);
      await u1.page.keyboard.press("Escape");
      await u1.page.mouse.click(5, 5);

      assertNoConsoleErrors(gm.errors);
      await gm.context.close();
      await u1.page.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });
      // The sheet's ContextMenu is built per render; re-open the entry so a
      // stale instance is not what is being tested.
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.elara);
      await settle(u1.page, 500);
      await expect(menuItem(u1.page)).toHaveCount(0);
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(u2.errors);
    } finally {
      await u1.context.close();
      await u2.context.close();
      await gm.context.close().catch(() => {});
    }
  });
});
