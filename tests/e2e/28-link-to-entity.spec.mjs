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
  vex: `${PREFIX}Vex${RUN}`, twin: `${PREFIX}Twin${RUN}`, none: `${PREFIX}None${RUN}`,
  new: `${PREFIX}New${RUN}`
};
const CREATE = "Create Entity from Selection";
const LINK = "Link to Entity";
const item = (page, label) => page.locator("#context-menu li", { hasText: label });
const picker = (page) => page.locator("dialog.application", { hasText: LINK });
const journalCount = (page) => page.evaluate(() => game.journal.size);
const entityDialog = (page) => page.locator("dialog.application", { hasText: CREATE });
async function makeContributor(page, folder, userName = "User 1") {
  await page.evaluate(async ({ folder, MOD, userName }) => {
    const u = game.users.getName(userName);
    await game.folders.get(folder).setFlag(MOD, "campaign.contributors", { userIds: [u.id], groupIds: [] });
  }, { folder, MOD, userName });
}
async function revealTo(page, entryId, sectionId, userName) {
  await page.evaluate(async ({ entryId, sectionId, userName, MOD }) => {
    const u = game.users.getName(userName);
    await game.journal.get(entryId).pages.contents[0].update({
      [`flags.${MOD}.secretReveals.${sectionId}`]: { users: [u.id], groups: [], all: false, revealedAt: Date.now() }
    });
  }, { entryId, sectionId, userName, MOD });
}

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

  test("Escape on the picker writes nothing", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const html = `<p>Meet ${N.twin} here.</p>`;
    const place = await createMejPage(page, N.place, html, folder);

    await openEntry(page, place.id);
    await selectAndOpenMenu(page, N.twin);
    await item(page, LINK).click();
    await expect(picker(page)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0, { timeout: 10_000 });
    await settle(page, 800);
    expect(await textOf(page, place.id)).toBe(html);
    assertNoConsoleErrors(errors);
  });

  test("a contributor chooses in the picker; the GM links the chosen entity", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    await createMejPage(page, N.twin, "<p>First.</p>", folder, "person");
    const second = await createMejPage(page, N.twin, "<p>Second.</p>", folder, "place");
    const place = await createMejPage(page, N.place, `<p>Meet ${N.twin} here.</p>`, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.twin);
      await item(u1.page, LINK).click();
      await expect(picker(u1.page)).toBeVisible({ timeout: 10_000 });
      await picker(u1.page).locator("select[name='entity']").selectOption(second.uuid);
      await picker(u1.page).locator("button[data-action='ok']").click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(`<p>Meet @UUID[${second.uuid}]{${N.twin}} here.</p>`);
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Create links on a page with a secret revealed to them", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const html = `<p>Ask ${N.new} now.</p><section class="secret" id="secret-lte1"><p>${N.new} is a spy.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await revealTo(page, place.id, "secret-lte1", "User 1");
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      const shell = await openEntry(u1.page, place.id);
      await expect(shell.locator("section.secret.mej-cc-revealed-to-you")).toBeVisible({ timeout: 15_000 });
      await selectAndOpenMenu(u1.page, N.new, 0);
      await item(u1.page, CREATE).click();
      const dialog = entityDialog(u1.page);
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator("input[name='linkOthers']").setChecked(false);
      await dialog.locator("button[data-action='ok']").click();
      await expect.poll(() => page.evaluate((n) => game.journal.getName(n)?.uuid ?? null, N.new), { timeout: 15_000 }).not.toBeNull();
      const uuid = await page.evaluate((n) => game.journal.getName(n).uuid, N.new);
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.new} now`, `Ask @UUID[${uuid}]{${N.new}} now`));
      await expect(u1.page.locator("#notifications li.notification.info", { hasText: "Created" })).toHaveCount(1, { timeout: 15_000 });
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Link inside a secret revealed to everyone", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const html = `<p>Intro.</p><section class="secret revealed" id="secret-lte2"><p>Ask ${N.vex} now.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.vex} now`, `Ask @UUID[${vex.uuid}]{${N.vex}} now`));
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });

  test("contributor Link leaves a secret they cannot see untouched", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const gmErrors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const vex = await createMejPage(page, N.vex, "<p>A person.</p>", folder, "person");
    const html = `<p>Ask ${N.vex} now.</p><section class="secret" id="secret-lte3"><p>${N.vex} is hidden.</p></section>`;
    const place = await createMejPage(page, N.place, html, folder);
    await makeContributor(page, folder);

    const u1 = await newSeat(browser, "User 1");
    try {
      await openEntry(u1.page, place.id);
      await selectAndOpenMenu(u1.page, N.vex);
      await item(u1.page, LINK).click();
      await expect.poll(() => textOf(page, place.id), { timeout: 15_000 })
        .toBe(html.replace(`Ask ${N.vex} now`, `Ask @UUID[${vex.uuid}]{${N.vex}} now`));
      assertNoConsoleErrors(u1.errors);
      assertNoConsoleErrors(gmErrors);
    } finally {
      await u1.context.close();
    }
  });
});
