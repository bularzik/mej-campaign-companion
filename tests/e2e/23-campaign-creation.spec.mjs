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
});
