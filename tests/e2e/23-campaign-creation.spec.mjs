// Campaign creation (spec 2026-09-06): one atomic structure (folder +
// portal + timeline), a sidebar front door, folder conversion, the stray-
// page guard, and the v7 migration. Fixtures are id-tracked and deleted in
// afterEach; the shell is closed first because an open Hub re-creates a
// scoped campaign's timeline while cleanup runs (spec 22's lesson).
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle, reloadGame,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";
import { CURRENT_DATA_VERSION } from "../../scripts/constants.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const MOD = "mej-campaign-companion";
const STORE = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const RUN = Date.now().toString(36).slice(-5);
const name = (tag) => `TT-CC ${tag} ${RUN}`;
const created = { folders: [], journals: [] };

/** Folder id + portal/timeline presence for one campaign folder. */
async function structureOf(page, folderId) {
  return page.evaluate((id) => {
    const f = game.folders.get(id);
    if (!f) return null;
    const flag = f.getFlag("mej-campaign-companion", "campaign") ?? null;
    const portal = f.contents.find((e) => e.pages.contents.some((p) => p.getFlag("mej-campaign-companion", "campaignPortal") === true));
    const timelines = f.contents.filter((e) => e.getFlag("mej-campaign-companion", "timeline"));
    return { flag, portalId: portal?.id ?? null, portalName: portal?.name ?? null, timelineNames: timelines.map((t) => t.name), parent: f.folder?.id ?? null };
  }, folderId);
}

async function cleanup(gm) {
  await gm.evaluate(async ({ journals, folders, MOD, version }) => {
    try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
    const tracked = new Set(folders);
    const inTracked = () => game.journal.contents.filter((e) => tracked.has(e.folder?.id)).map((e) => e.id);
    let extra = inTracked();
    for (let i = 0; i < 6 && extra.length === 0 && folders.length; i++) {
      await new Promise((r) => setTimeout(r, 300));
      extra = inTracked();
    }
    const jids = [...new Set([...journals.filter((id) => game.journal.get(id)), ...extra])];
    if (jids.length) await JournalEntry.implementation.deleteDocuments(jids);
    const fids = folders.filter((id) => game.folders.get(id));
    if (fids.length) await Folder.implementation.deleteDocuments(fids, { deleteContents: true });
    if (game.settings.get(MOD, "dataVersion") !== version) await game.settings.set(MOD, "dataVersion", version);
  }, { ...created, MOD, version: CURRENT_DATA_VERSION });
  created.folders.length = 0;
  created.journals.length = 0;
}

test.describe("23 campaign creation", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("1. createCampaign() builds folder, portal and timeline in one call", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Atomic");
    const folderId = await page.evaluate(async ({ STORE, n }) => {
      const { createCampaign } = await import(STORE);
      return (await createCampaign(n, { ownershipDefault: "observer" })).id;
    }, { STORE, n });
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "observer" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    expect(s.parent).toBe(null);
    assertNoConsoleErrors(errors);
  });

  test("2. convertFolderToCampaign() promotes a plain root folder in place and refuses nested/campaign folders", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Convert");
    const ids = await page.evaluate(async (n) => {
      const root = await Folder.create({ name: n, type: "JournalEntry" });
      const nested = await Folder.create({ name: `${n} nested`, type: "JournalEntry", folder: root.id });
      const member = await JournalEntry.create({ name: `${n} member`, folder: root.id, pages: [{ name: "p", type: "text" }] });
      return { root: root.id, nested: nested.id, member: member.id };
    }, n);
    created.folders.push(ids.root, ids.nested);
    created.journals.push(ids.member);
    const result = await page.evaluate(async ({ STORE, ids }) => {
      const { convertFolderToCampaign } = await import(STORE);
      const nestedResult = await convertFolderToCampaign(game.folders.get(ids.nested), { ownershipDefault: "owner" });
      const rootResult = await convertFolderToCampaign(game.folders.get(ids.root), { ownershipDefault: "owner" });
      const again = await convertFolderToCampaign(game.folders.get(ids.root), { ownershipDefault: "none" });
      return { nested: nestedResult?.id ?? null, root: rootResult?.id ?? null, again: again?.id ?? null, memberFolder: game.journal.get(ids.member).folder?.id ?? null };
    }, { STORE, ids });
    expect(result.nested).toBe(null);
    expect(result.root).toBe(ids.root);
    expect(result.again).toBe(null);
    expect(result.memberFolder).toBe(ids.root);
    const s = await structureOf(page, ids.root);
    expect(s.flag).toEqual({ ownershipDefault: "owner" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    assertNoConsoleErrors(errors);
  });

  /** Bring the core journal sidebar to the front (the MEJ shell covers it while open). */
  async function showSidebar(page) {
    await page.evaluate(async () => {
      try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
      await ui.journal.activate();
    });
    await settle(page, 300);
  }

  /** Fill the New Campaign DialogV2 and confirm. */
  async function confirmNewCampaign(page, n, baseline = "observer") {
    const dialog = page.locator(".application.dialog:has(input[name='name'])").last();
    await expect(dialog).toBeVisible();
    await dialog.locator("input[name='name']").fill(n);
    await dialog.locator("select[name='baseline']").selectOption(baseline);
    await dialog.locator("button[data-action='ok']").click();
  }

  test("3. the sidebar New Campaign button creates folder, portal and timeline and toasts", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await showSidebar(page);
    const button = page.locator("#journal .directory-header button.mej-cc-create-campaign");
    await expect(button).toHaveCount(1);
    await expect(button).toContainText("New Campaign");
    const n = name("Sidebar");
    await button.click();
    await confirmNewCampaign(page, n, "owner");
    await expect(page.locator("#notifications .notification", { hasText: `Campaign "${n}" created.` })).toBeVisible();
    const folderId = await page.evaluate((n) => game.folders.find((f) => f.type === "JournalEntry" && f.name === n)?.id ?? null, n);
    expect(folderId).not.toBe(null);
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "owner" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    // The row is a campaign now: flag icon + class, on the same render.
    const row = page.locator(`#journal li.folder[data-folder-id="${folderId}"]`);
    await expect(row).toHaveClass(/mej-cc-campaign-folder/);
    await expect(row.locator(":scope > .folder-header > i.fa-flag")).toHaveCount(1);
    assertNoConsoleErrors(errors);
  });

  test("4. MEJ's shell sidebar carries the same button; plain folders carry no flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const plainId = await page.evaluate(async (n) => (await Folder.create({ name: n, type: "JournalEntry" })).id, name("Plain"));
    created.folders.push(plainId);
    await showSidebar(page);
    const plainRow = page.locator(`#journal li.folder[data-folder-id="${plainId}"]`);
    await expect(plainRow).toHaveCount(1);
    await expect(plainRow).not.toHaveClass(/mej-cc-campaign-folder/);
    await expect(plainRow.locator(":scope > .folder-header > i.fa-flag")).toHaveCount(0);
    // Open the shell on any non-timeline entry and look at its sidebar copy.
    await page.evaluate(async () => {
      const entry = game.journal.contents.find((e) => !e.getFlag("mej-campaign-companion", "timeline"));
      await game.MonksEnhancedJournal.openJournalEntry(entry);
    });
    await settle(page, 500);
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".directory-header button.mej-cc-create-campaign")).toHaveCount(1);
    assertNoConsoleErrors(errors);
  });

  test("5. a player seat sees no New Campaign button", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    await showSidebar(page);
    await expect(page.locator("#journal .directory-header")).toBeVisible();
    await expect(page.locator("#journal .directory-header button.mej-cc-create-campaign")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("6. right-click 'Make this folder a campaign' converts a root folder in place; nested and campaign folders don't offer it", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Ctx");
    const ids = await page.evaluate(async (n) => {
      const root = await Folder.create({ name: n, type: "JournalEntry" });
      const nested = await Folder.create({ name: `${n} nested`, type: "JournalEntry", folder: root.id });
      const member = await JournalEntry.create({ name: `${n} member`, folder: root.id, pages: [{ name: "p", type: "text" }] });
      return { root: root.id, nested: nested.id, member: member.id };
    }, n);
    created.folders.push(ids.root, ids.nested);
    created.journals.push(ids.member);
    await showSidebar(page);
    const item = page.locator("#context-menu .context-item", { hasText: "Make this folder a campaign" });

    // Nested folder: expand the root so the nested row is visible, right-click it, no option.
    const rootRow = page.locator(`#journal li.folder[data-folder-id="${ids.root}"]`);
    if (!(await rootRow.evaluate((el) => el.classList.contains("expanded")))) await rootRow.locator(":scope > .folder-header").click();
    await page.locator(`#journal li.folder[data-folder-id="${ids.nested}"] > .folder-header`).click({ button: "right" });
    await expect(page.locator("#context-menu")).toBeVisible();
    await expect(item).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Root folder: option present; rename in the dialog; converted in place.
    await rootRow.locator(":scope > .folder-header").click({ button: "right" });
    await expect(item).toHaveCount(1);
    await item.click();
    const renamed = `${n} renamed`;
    await confirmNewCampaign(page, renamed, "none");
    await expect(page.locator("#notifications .notification", { hasText: `Folder "${renamed}" is now a campaign.` })).toBeVisible();
    const s = await structureOf(page, ids.root);
    expect(s.flag).toEqual({ ownershipDefault: "none" });
    expect(s.portalName).toBe(renamed);
    expect(s.timelineNames).toEqual([`${renamed} — Timeline`]);
    expect(await page.evaluate((id) => game.journal.get(id).folder?.id, ids.member)).toBe(ids.root);

    // Campaign folder now: option gone.
    await rootRow.locator(":scope > .folder-header").click({ button: "right" });
    await expect(page.locator("#context-menu")).toBeVisible();
    await expect(item).toHaveCount(0);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("7. neither MEJ's New Entry dialog nor the core Create Page dialog offers Campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await showSidebar(page);
    await page.locator("#journal .directory-header button.create-entry").click();
    const mejSelect = page.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
    await expect(mejSelect).toBeVisible();
    await expect(mejSelect.locator('option[value="campaign"], option[value="mej-campaign-companion.campaign"]')).toHaveCount(0);
    await expect(mejSelect.locator('option[value="session"]')).toHaveCount(1); // Session stays (api mode)
    await page.keyboard.press("Escape");
    await settle(page, 200);

    const hostId = await page.evaluate(async (n) => (await JournalEntry.create({ name: n, pages: [{ name: "p", type: "text" }] })).id, name("Host"));
    created.journals.push(hostId);
    // MEJ's JournalEntryPage.createDialog libWrapper (onCreatePageDialog, monks-enhanced-journal.js:1574)
    // unconditionally sets `options.journalentrypage = true` on the 3rd positional
    // arg with no undefined guard, so a 2-arg call crashes before the dialog ever
    // opens; pass an explicit (empty) options object to reach the dialog at all.
    // createDialog()'s own promise only resolves once the dialog is closed, so it
    // is fired without awaiting it here (awaiting would deadlock against the
    // Escape press below, which is what actually closes it).
    await page.evaluate((id) => { JournalEntryPage.createDialog({}, { parent: game.journal.get(id) }, {}); }, hostId);
    await settle(page, 300);
    const coreSelect = page.locator('.application.dialog select[name="type"]').last();
    await expect(coreSelect).toBeVisible();
    await expect(coreSelect.locator('option[value="mej-campaign-companion.campaign"]')).toHaveCount(0);
    await expect(coreSelect.locator('option[value="text"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("8. a loose campaign page created by API is upgraded into a campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Stray");
    const entryId = await page.evaluate(async (n) =>
      (await JournalEntry.create({ name: n, pages: [{ name: n, type: "mej-campaign-companion.campaign" }] })).id, n);
    created.journals.push(entryId);
    await expect(page.locator("#notifications .notification", { hasText: `Created campaign "${n}" from this entry.` })).toBeVisible({ timeout: 15_000 });
    const folderId = await page.evaluate((id) => game.journal.get(id).folder?.id ?? null, entryId);
    expect(folderId).not.toBe(null);
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "observer" });
    expect(s.portalId).toBe(entryId);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    const pageFlags = await page.evaluate((id) => game.journal.get(id).pages.contents[0].flags, entryId);
    expect(pageFlags["mej-campaign-companion"].campaignPortal).toBe(true);
    expect(pageFlags["monks-enhanced-journal"].type).toBe("campaign");
    assertNoConsoleErrors(errors);
  });

  test("9. a campaign page inside a campaign, into a multipage entry, or via MEJ's dialog intent into a campaign folder is refused", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Refuse");
    const campaignId = await page.evaluate(async ({ STORE, n }) => {
      const { createCampaign } = await import(STORE);
      return (await createCampaign(n)).id;
    }, { STORE, n });
    created.folders.push(campaignId);
    const hostId = await page.evaluate(async (n) => (await JournalEntry.create({ name: `${n} host`, pages: [{ name: "p", type: "text" }] })).id, n);
    created.journals.push(hostId);
    const results = await page.evaluate(async ({ campaignId, hostId, n }) => {
      const T = "mej-campaign-companion.campaign";
      const inCampaign = await JournalEntry.create({ name: `${n} in`, folder: campaignId, pages: [{ name: "c", type: T }] });
      const intent = await JournalEntry.create({ name: `${n} intent`, folder: campaignId, flags: { "monks-enhanced-journal": { pagetype: "campaign" } } });
      const multipage = await JournalEntryPage.create({ name: "c", type: T }, { parent: game.journal.get(hostId) });
      return {
        inCampaign: inCampaign?.id ?? null,
        intent: intent?.id ?? null,
        multipage: multipage?.id ?? null,
        hostPages: game.journal.get(hostId).pages.size,
        warnings: [...document.querySelectorAll("#notifications .notification")].filter((el) => /New Campaign button/.test(el.textContent)).length
      };
    }, { campaignId, hostId, n });
    expect(results.inCampaign).toBe(null);
    expect(results.intent).toBe(null);
    expect(results.multipage).toBe(null);
    expect(results.hostPages).toBe(1);
    expect(results.warnings).toBeGreaterThanOrEqual(1);
    assertNoConsoleErrors(errors);
  });
});
