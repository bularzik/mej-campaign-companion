// Party relationships (spec 2026-10-10 §6), on v13 and v14. The GM builds a
// campaign with User 1 and User 2 as Contributors, waits for the GM seat to
// create the party notebook, then disconnects: every player step runs with
// NO GM online (the point of the redesign). The tests share that setup and
// run in order; the non-Contributor test runs last because it removes User 2
// from the Contributors.
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, ensureMejPlayerAccess, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const PREFIX = "TT-Party";
const RUN = Date.now();
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const tagged = (name) => `${PREFIX}${name}${RUN}`;

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

/** A MEJ entry of `type` in `folder`, OBSERVER by default; returns { id, uuid, name }. */
async function createEntry(gm, name, type, { ownership = 2, folder = null } = {}) {
  return gm.evaluate(async ({ name, type, ownership, folder }) => {
    const e = await JournalEntry.create({
      name, folder, ownership: { default: ownership },
      pages: [{ name, type: "text", text: { content: `<p>${name}</p>` }, flags: { "monks-enhanced-journal": { type } } }]
    });
    return { id: e.id, uuid: e.uuid, name: e.name };
  }, { name, type, ownership, folder });
}

async function openEntry(page, id) {
  // A GM-created entry reaches each client asynchronously.
  await page.waitForFunction((id) => !!game.journal.get(id), id, { timeout: 15_000 });
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    // Keep the shell clear of the sidebar, so a sidebar row can be dragged onto it.
    game.MonksEnhancedJournal.journal?.setPosition({ left: 20, top: 20, width: 960, height: 820 });
  }, id);
  await settle(page, 600);
}
async function closeShell(page) {
  await page.evaluate(async () => {
    try { await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* none open */ }
  });
  await settle(page, 300);
}
const relTabLink = (page) => page.locator(
  '#MonksEnhancedJournal nav.tabs a[data-tab="relationships"], #MonksEnhancedJournal nav.sheet-tabs a[data-tab="relationships"]').first();
const toast = (page, text) => page.locator("#notifications .notification", { hasText: text });

async function openRelTab(page, id) {
  await openEntry(page, id);
  await relTabLink(page).click();
  await settle(page, 400);
}

const relTab = (page) => page.locator('#MonksEnhancedJournal .tab.active[data-tab="relationships"]');
const partyOnly = (page, uuid) => relTab(page).locator(`li.mej-cc-party-only[data-uuid="${uuid}"]`);
const gmRow = (page, uuid) => relTab(page).locator(`li.item:not(.mej-cc-party-only)[data-uuid="${uuid}"]`);
/** The party line (not the empty "add a label" placeholder) for the pair with `uuid`. */
const lineFor = (page, uuid) => relTab(page).locator(`li.item[data-uuid="${uuid}"] .mej-cc-party-line:not(.new)`);
const addButton = (page) => relTab(page).locator(".mej-cc-party-add button");
const picker = (page) => page.locator(".mej-cc-party-picker");

/** The campaign's notebook, as the seat sees it: { id, ownership, rows }. */
const notebookOf = (page, folderId) => page.evaluate(({ MOD, folderId }) => {
  const nb = game.journal.find((e) => e.flags?.[MOD]?.partyNotebook === true && e.folder?.id === folderId);
  return nb ? { id: nb.id, ownership: { ...nb.ownership }, rows: foundry.utils.deepClone(nb.flags[MOD].partyRows ?? {}) } : null;
}, { MOD, folderId });
const rowFor = async (page, folderId, a, b) => Object.values((await notebookOf(page, folderId))?.rows ?? {})
  .find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? null;
const labelOn = (row, uuid) => (row ? row.labels?.[row.a === uuid ? "a" : "b"] : undefined);

async function pickViaAdd(page, target) {
  await addButton(page).click();
  const d = picker(page);
  await expect(d).toBeVisible({ timeout: 10_000 });
  await d.locator('input[type="search"]').fill(target.name);
  await d.locator(`.mej-cc-party-pick[data-uuid="${target.uuid}"]`).click();
  await expect(d).toHaveCount(0, { timeout: 10_000 });
  await settle(page, 600);
}

/**
 * Drag a sidebar journal row onto the Relationships list - a real drag when
 * the row can be shown in Foundry's sidebar, else the same DragEvent a drop
 * delivers (recorded as an annotation, never silently).
 */
async function dragFromSidebar(page, entry, folderId) {
  await page.evaluate(async (folderId) => {
    ui.sidebar.changeTab?.("journal", "primary");
    ui.sidebar.expand?.();
    const folder = game.folders.get(folderId);
    if (folder) game.folders._expanded[folder.uuid] = true;
    await ui.journal.render({ force: true });
  }, folderId);
  await settle(page, 500);
  const source = page.locator(`#sidebar [data-entry-id="${entry.id}"]`).first();
  const target = relTab(page).locator(".relationships .items-list");
  if (await source.isVisible().catch(() => false)) {
    await source.dragTo(target);
    return "real";
  }
  test.info().annotations.push({ type: "drop", description: "sidebar row not visible; synthetic drop used" });
  await target.evaluate((el, uuid) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "JournalEntry", uuid }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, entry.uuid);
  return "synthetic";
}

// Shared across the serial tests below.
let u1;
let u2;
let folderId;
let ilva;
let mara;
let bram;
let quest;
let ids;

test.describe("33 party relationships", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const gm = await newSeat(browser, "Gamemaster");
    try {
      await ensureMejPlayerAccess(gm.page);
      await deleteJournalsByPrefix(gm.page, PREFIX);
      await cleanupStrandedTestFolders(gm.page, { prefix: PREFIX });
      ids = await gm.page.evaluate(() => ({ u1: game.users.getName("User 1").id, u2: game.users.getName("User 2").id }));
      folderId = await gm.page.evaluate(async ({ MOD, name }) => (await Folder.create({
        name, type: "JournalEntry", flags: { [MOD]: { campaign: { ownershipDefault: "observer" } } }
      })).id, { MOD, name: tagged("Camp") });
      ilva = await createEntry(gm.page, tagged("Ilva"), "person", { folder: folderId });
      mara = await createEntry(gm.page, tagged("Mara"), "person", { folder: folderId });
      bram = await createEntry(gm.page, tagged("Bram"), "person", { folder: folderId });
      quest = await createEntry(gm.page, tagged("Q"), "quest", { folder: folderId });
      // The GM's own relationship Ilva -> Bram (canon), in the shape MEJ's
      // addRelationship stores (row id = target entry id). page.sheet is not
      // MEJ's sheet class outside the shell, so the flag is written directly.
      await gm.page.evaluate(async ({ ilvaId, bramId, bramUuid }) => {
        await game.journal.get(ilvaId).pages.contents[0].setFlag("monks-enhanced-journal", "relationships",
          { [bramId]: { id: bramId, uuid: bramUuid, hidden: false, relationship: "Mentor" } });
      }, { ilvaId: ilva.id, bramId: bram.id, bramUuid: bram.uuid });
      // Contributors arrive as an update: the GM seat creates the notebook on it.
      await gm.page.evaluate(({ MOD, folderId, u1, u2 }) => game.folders.get(folderId)
        .update({ [`flags.${MOD}.campaign.contributors`]: { userIds: [u1, u2], groupIds: [] } }), { MOD, folderId, ...ids });
      await expect.poll(async () => {
        const nb = await notebookOf(gm.page, folderId);
        return nb ? [nb.ownership[ids.u1], nb.ownership[ids.u2]] : null;
      }, { timeout: 30_000 }).toEqual([3, 3]);
    } finally {
      await gm.context.close();
    }
    u1 = await newSeat(browser, "User 1");
    u2 = await newSeat(browser, "User 2");
    for (const seat of [u1, u2]) {
      await seat.page.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });
    }
  });

  test.afterAll(async ({ browser }) => {
    for (const seat of [u1, u2]) await seat?.context.close().catch(() => {});
    await withGmPage(browser, async (gm) => {
      await closeShell(gm);
      if (folderId) {
        await gm.evaluate((id) => game.folders.get(id)?.delete({ deleteSubfolders: true, deleteContents: true }), folderId);
      }
      await deleteJournalsByPrefix(gm, PREFIX);
      await cleanupStrandedTestFolders(gm, { prefix: PREFIX });
    });
  });

  test("drop creates a row with an empty label; typing saves; both ends show it", async () => {
    test.setTimeout(120_000);
    await openRelTab(u1.page, ilva.id);
    // Live check (b): MEJ's _toggleDisabled must not reach the party controls.
    await expect(addButton(u1.page)).toBeEnabled();
    await expect(gmRow(u1.page, bram.uuid).locator(".mej-cc-party-line.new input")).toBeEnabled();

    const how = await dragFromSidebar(u1.page, mara, folderId);
    test.info().annotations.push({ type: "drop-mode", description: how });
    const input = partyOnly(u1.page, mara.uuid).locator("input.mej-cc-party-input");
    await expect(input).toHaveValue("", { timeout: 15_000 });
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await u1.page.keyboard.type("Sister of");
    await settle(u1.page, 600);
    await expect.poll(async () => labelOn(await rowFor(u1.page, folderId, ilva.uuid, mara.uuid), ilva.uuid), { timeout: 15_000 })
      .toBe("Sister of");

    // Mara's side has its own (empty) label; Ilva's side is not shown there.
    await openRelTab(u2.page, mara.id);
    const back = partyOnly(u2.page, ilva.uuid);
    await expect(back.locator("input.mej-cc-party-input")).toHaveValue("", { timeout: 15_000 });
    await expect(back).not.toContainText("Sister of");
    await openRelTab(u2.page, ilva.id);
    await expect(lineFor(u2.page, mara.uuid).locator("input.mej-cc-party-input")).toHaveValue("Sister of", { timeout: 15_000 });
    await expect(lineFor(u2.page, mara.uuid).locator(".mej-cc-party-edited")).toHaveText("edited by User 1");
    for (const seat of [u1, u2]) assertNoConsoleErrors(seat.errors);
  });

  test("Add button opens a search-only picker; choosing creates the row", async () => {
    test.setTimeout(90_000);
    await openRelTab(u1.page, ilva.id);
    await addButton(u1.page).click();
    const d = picker(u1.page);
    await expect(d).toBeVisible({ timeout: 10_000 });
    await expect(d.locator("input, select, textarea")).toHaveCount(1);
    await expect(d.locator('input[type="search"]')).toHaveCount(1);
    await d.locator('input[type="search"]').fill("Bra");
    await expect(d.locator(`.mej-cc-party-pick[data-uuid="${bram.uuid}"]`)).toBeVisible();
    await expect(d.locator(`.mej-cc-party-pick[data-uuid="${mara.uuid}"]`)).toBeHidden();
    // The search filters; nothing else narrows the list (a quest is an allowed type here).
    await expect(d.locator(`.mej-cc-party-pick[data-uuid="${quest.uuid}"]`)).toBeHidden();
    await expect(d.locator(`.mej-cc-party-pick[data-uuid="${ilva.uuid}"]`)).toHaveCount(0); // never itself
    await d.locator(`.mej-cc-party-pick[data-uuid="${bram.uuid}"]`).click();
    await expect(d).toHaveCount(0, { timeout: 10_000 });

    const line = gmRow(u1.page, bram.uuid).locator(".mej-cc-party-line:not(.new)");
    await expect(line).toHaveCount(1, { timeout: 15_000 });
    await expect(line.locator("input.mej-cc-party-input")).toBeFocused();
    await expect(partyOnly(u1.page, bram.uuid)).toHaveCount(0);
    expect(await rowFor(u1.page, folderId, ilva.uuid, bram.uuid)).not.toBeNull();
    assertNoConsoleErrors(u1.errors);
  });

  test("another Contributor edits and deletes the row", async () => {
    test.setTimeout(90_000);
    await openRelTab(u2.page, ilva.id);
    const theirs = lineFor(u2.page, mara.uuid).locator("input.mej-cc-party-input");
    await theirs.fill("Rival");
    await settle(u2.page, 600);
    await expect.poll(async () => labelOn(await rowFor(u2.page, folderId, ilva.uuid, mara.uuid), ilva.uuid), { timeout: 15_000 })
      .toBe("Rival");

    await openRelTab(u1.page, ilva.id);
    await expect(lineFor(u1.page, mara.uuid).locator("input.mej-cc-party-input")).toHaveValue("Rival", { timeout: 15_000 });
    await expect(lineFor(u1.page, mara.uuid).locator(".mej-cc-party-edited")).toHaveText("edited by User 2");

    await theirs.evaluate((el) => el.blur());
    await lineFor(u2.page, mara.uuid).locator(".mej-cc-party-delete").click();
    await expect.poll(() => rowFor(u2.page, folderId, ilva.uuid, mara.uuid), { timeout: 15_000 }).toBeNull();
    await openRelTab(u1.page, ilva.id);
    await expect(partyOnly(u1.page, mara.uuid)).toHaveCount(0, { timeout: 15_000 });
    for (const seat of [u1, u2]) assertNoConsoleErrors(seat.errors);
  });

  test("duplicate add focuses the existing line", async () => {
    test.setTimeout(90_000);
    await openRelTab(u1.page, ilva.id);
    await pickViaAdd(u1.page, mara);
    const input = partyOnly(u1.page, mara.uuid).locator("input.mej-cc-party-input");
    await expect(input).toHaveCount(1, { timeout: 15_000 });
    await input.evaluate((el) => el.blur());
    await expect(input).not.toBeFocused();

    await pickViaAdd(u1.page, mara);
    await expect(relTab(u1.page).locator(`li.item[data-uuid="${mara.uuid}"] .mej-cc-party-line`)).toHaveCount(1);
    await expect(input).toBeFocused();
    const rows = Object.values((await notebookOf(u1.page, folderId)).rows)
      .filter((r) => [r.a, r.b].includes(ilva.uuid) && [r.a, r.b].includes(mara.uuid));
    expect(rows).toHaveLength(1);
    assertNoConsoleErrors(u1.errors);
  });

  test("graph shows a party edge", async () => {
    test.setTimeout(120_000);
    const page = u1.page;
    await openEntry(page, ilva.id);
    await page.evaluate(async () => (await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs")).openHub());
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".mej-cc-hub-container")).toHaveCount(1, { timeout: 15_000 });
    const scope = shell.locator('select[name="campaign-scope"]');
    if (await scope.count()) {
      await scope.selectOption(folderId).catch(() => scope.selectOption(""));
      await settle(page, 500);
    }
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(page, 600);
    const allMode = shell.locator('button[data-action="setGraphMode"][data-mode="all"]');
    if (await allMode.count()) await allMode.click();
    await settle(page, 600);
    const pane = shell.locator(".mej-cc-graph-pane");
    await expect.poll(() => pane.locator(".mej-cc-graph-edge.party").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(pane.locator(".mej-cc-graph-node", { hasText: mara.name })).toHaveCount(1);
    await closeShell(page);
    assertNoConsoleErrors(u1.errors);
  });

  test("typing survives a save from another seat (Review Focus 2)", async () => {
    test.setTimeout(120_000);
    await openRelTab(u1.page, ilva.id);
    await openRelTab(u2.page, ilva.id);
    const mine = lineFor(u1.page, mara.uuid).locator("input.mej-cc-party-input");
    const theirs = lineFor(u2.page, bram.uuid).locator("input.mej-cc-party-input");
    await expect(mine).toHaveCount(1, { timeout: 15_000 });
    await expect(theirs).toHaveCount(1, { timeout: 15_000 });
    await u1.page.evaluate(() => {
      window.__partyRenders = 0;
      Hooks.on("renderJournalPageSheet", () => { window.__partyRenders += 1; });
    });
    const text = "Half-sister, estranged";
    await mine.click();
    await mine.fill("");
    // User 1 types slowly (each keystroke saves, debounced) while User 2 saves another line.
    const typing = mine.pressSequentially(text, { delay: 120 });
    await settle(u2.page, 400);
    await theirs.fill("Old mentor");
    await theirs.evaluate((el) => el.blur());
    await typing;
    await expect.poll(async () => labelOn(await rowFor(u1.page, folderId, ilva.uuid, bram.uuid), ilva.uuid), { timeout: 15_000 })
      .toBe("Old mentor");
    await expect.poll(() => u1.page.evaluate(() => window.__partyRenders), { timeout: 15_000 }).toBeGreaterThan(0);
    await settle(u1.page, 800);
    await expect(mine).toHaveValue(text);
    await expect(mine).toBeFocused();
    await expect.poll(async () => labelOn(await rowFor(u2.page, folderId, ilva.uuid, mara.uuid), ilva.uuid), { timeout: 15_000 })
      .toBe(text);
    // Once the edit settles, User 1's list catches up with User 2's save.
    await mine.evaluate((el) => el.blur());
    await expect(lineFor(u1.page, bram.uuid).locator("input.mej-cc-party-input")).toHaveValue("Old mentor", { timeout: 15_000 });
    for (const seat of [u1, u2]) assertNoConsoleErrors(seat.errors);
  });

  test("a non-Contributor reads rows but has no controls", async ({ browser }) => {
    test.setTimeout(180_000);
    const gm = await newSeat(browser, "Gamemaster");
    let ownershipAfter = null;
    try {
      await gm.page.evaluate(({ MOD, folderId, u1 }) => game.folders.get(folderId)
        .update({ [`flags.${MOD}.campaign.contributors`]: { userIds: [u1], groupIds: [] } }), { MOD, folderId, u1: ids.u1 });
      // Live check (a): the removed Contributor loses OWNER (ownership.-=<id>).
      await expect.poll(async () => (await notebookOf(gm.page, folderId))?.ownership?.[ids.u2] ?? "removed", { timeout: 20_000 })
        .toBe("removed");
      ownershipAfter = (await notebookOf(gm.page, folderId)).ownership;
      test.info().annotations.push({ type: "notebook-ownership", description: JSON.stringify(ownershipAfter) });
      expect(ownershipAfter[ids.u1]).toBe(3);

      // Live check (d): the GM edits MEJ's own relationship field as before.
      await openRelTab(gm.page, ilva.id);
      const field = gmRow(gm.page, bram.uuid).locator(`input[name="flags.monks-enhanced-journal.relationships.${bram.id}.relationship"]`);
      await expect(field).toHaveValue("Mentor");
      await expect(field).toBeEnabled();
      await field.fill("Mentor, once");
      await field.press("Tab");
      await expect.poll(() => gm.page.evaluate(({ id, rid }) => game.journal.get(id).pages.contents[0]
        .getFlag("monks-enhanced-journal", "relationships")?.[rid]?.relationship, { id: ilva.id, rid: bram.id }), { timeout: 15_000 })
        .toBe("Mentor, once");
      // The party line under it is untouched.
      expect(labelOn(await rowFor(gm.page, folderId, ilva.uuid, bram.uuid), ilva.uuid)).toBe("Old mentor");
      await closeShell(gm.page);
      assertNoConsoleErrors(gm.errors);
    } finally {
      await gm.context.close();
    }

    await u2.page.waitForFunction(({ MOD, folderId, u2 }) => {
      const nb = game.journal.find((e) => e.flags?.[MOD]?.partyNotebook === true && e.folder?.id === folderId);
      return nb && nb.ownership[u2] === undefined;
    }, { MOD, folderId, u2: ids.u2 }, { timeout: 15_000 });
    await closeShell(u2.page);
    await openRelTab(u2.page, ilva.id);
    const line = lineFor(u2.page, bram.uuid);
    await expect(line.locator(".mej-cc-party-label")).toHaveText("Old mentor", { timeout: 15_000 });
    await expect(relTab(u2.page).locator(".mej-cc-party-line input")).toHaveCount(0);
    await expect(relTab(u2.page).locator(".mej-cc-party-add")).toHaveCount(0);
    await expect(relTab(u2.page).locator(".mej-cc-party-delete")).toHaveCount(0);
    await expect(lineFor(u2.page, mara.uuid).locator(".mej-cc-party-label")).toHaveText("Half-sister, estranged");
    assertNoConsoleErrors(u2.errors);
  });
});
