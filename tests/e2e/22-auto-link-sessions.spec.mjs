import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now();
const N = {
  camp: `TTLinkCamp${RUN}`,
  person: `TTLinkPerson${RUN}`,
  session: `TTLinkSession${RUN}`,
  textPage: `TTLinkText${RUN}`,
  late: `TTLinkLate${RUN}`,
  hubPerson: `TTHubPerson${RUN}`,
  hubSession: `TTHubSession${RUN}`
};
const MOD = "mej-campaign-companion";
const created = { folders: [], journals: [] };

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
  created.folders.push(id);
  return id;
}

async function createPerson(page, name, html, folderId) {
  const r = await page.evaluate(async ({ n, html, folderId }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: 2 },
      pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: html } }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, html, folderId });
  created.journals.push(r.id);
  return r;
}

async function createSession(page, name, recap, gmNotes, folderId) {
  const r = await page.evaluate(async ({ n, recap, gmNotes, folderId }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: 2 },
      pages: [{
        name: n, type: "mej-campaign-companion.session",
        flags: { "monks-enhanced-journal": { type: "session" } },
        system: { recap, gmNotes }
      }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, recap, gmNotes, folderId });
  created.journals.push(r.id);
  return r;
}

const recapOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.recap ?? "", id);
const notesOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.gmNotes ?? "", id);
const textOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", id);

/** Open an entry in the MEJ shell and return its knowledge panel (same steps as 07-knowledge's openEntry). */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  const panel = shell.locator(".mej-cc-knowledge");
  await expect(panel).toHaveCount(1);
  return { shell, panel };
}

/**
 * Open the Hub scoped to one campaign: bootstrap the shell on a non-timeline
 * entry (a timeline journal refuses the shell), set the scope through the
 * exported setHubScope, then click the Hub nav button (08-query-graph's
 * openHub, plus the scope step).
 */
async function openHubScoped(page, campaignFolderId, bootstrapEntryId) {
  await page.evaluate(async ({ id, folder }) => {
    const { setHubScope } = await import("/modules/mej-campaign-companion/scripts/apps/CampaignHubPage.mjs");
    setHubScope(folder);
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, { id: bootstrapEntryId, folder: campaignFolderId });
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function cleanup(gmPage) {
  await gmPage.evaluate(async ({ journals, folders, MOD }) => {
    // The Hub, if left open (test 3 never closes it), re-renders on the
    // deleteJournalEntry hooks the deletes below fire, and its own
    // _prepareContext re-resolves ensureTimelineJournal(campaign) for the
    // still-live campaign scope mid-cleanup - confirmed live: closing the
    // shell first (before anything is deleted) is what actually stops a
    // fresh timeline being (re)created out from under this same cleanup.
    try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
    // Opening the Hub scoped to a campaign folder auto-creates that
    // campaign's timeline journal (ensureTimelineJournal), asynchronously,
    // as a side effect of rendering - the click that opens the Hub can
    // return (and this cleanup can start) before that create() lands. It's
    // never in `journals`, so pick it up (and anything else the module filed
    // into a tracked folder) by folder id, not by name - polling briefly
    // first so a still-in-flight create isn't missed by an early snapshot.
    const tracked = new Set(folders);
    const inTrackedFolders = () => game.journal.contents.filter((e) => tracked.has(e.folder?.id)).map((e) => e.id);
    let extra = inTrackedFolders();
    for (let i = 0; i < 6 && extra.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 300));
      extra = inTrackedFolders();
    }
    const jids = [...new Set([...journals.filter((id) => game.journal.get(id)), ...extra])];
    if (jids.length) await JournalEntry.implementation.deleteDocuments(jids);
    const fids = folders.filter((id) => game.folders.get(id));
    // deleteContents as defense-in-depth: catches anything the module still
    // manages to file into the folder between the snapshot above and this
    // delete, rather than letting it survive the folder as a root orphan.
    if (fids.length) await Folder.implementation.deleteDocuments(fids, { deleteContents: true });
    await game.settings.set(MOD, "autoLink", true);
    await game.settings.set(MOD, "retroLinkMode", "silent");
  }, { ...created, MOD });
  created.folders.length = 0;
  created.journals.length = 0;
}

test.describe("22 auto-link sessions", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("forward: a name typed into a session recap is linked and appears in Mentioned in", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: true, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const person = await createPerson(page, N.person, "<p>A person.</p>", folder);
    const session = await createSession(page, N.session, "<p>Opening.</p>", "", folder);

    await page.evaluate(async ({ id, html }) => {
      await game.journal.get(id).pages.contents[0].update({ "system.recap": html });
    }, { id: session.id, html: `<p>Opening. Then ${N.person} arrived.</p>` });
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${person.id}]{${N.person}}`);

    const { panel } = await openEntry(page, person.id);
    const backlinks = panel.locator(".mej-cc-knowledge-backlinks");
    const row = backlinks.locator(".mej-cc-backlink-row", { hasText: N.session });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row.locator(".mej-cc-backlink-count")).toHaveText("×1");
    assertNoConsoleErrors(errors);
  });

  test("create-time (silent default): recap, GM notes and a text page are linked in one pass with one toast", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const session = await createSession(page, N.session, `<p>${N.late} in recap.</p>`, `<p>${N.late} in notes.</p>`, folder);
    const text = await createPerson(page, N.textPage, `<p>${N.late} in text.</p>`, folder);
    await setSettings(page, { retroLinkMode: "silent" });
    const late = await createPerson(page, N.late, "<p>Late arrival.</p>", folder);

    // 3 places: recap, GM notes, text page.
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 3 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("dialog.application")).toHaveCount(0);
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    expect(await notesOf(page, session.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    expect(await textOf(page, text.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    assertNoConsoleErrors(errors);
  });

  test("Hub 'Link mentions': confirm dialog lists the campaign's matches; Link Checked links and toasts", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const hero = await createPerson(page, N.hubPerson, "<p>Hero.</p>", folder);
    const session = await createSession(page, N.hubSession, `<p>${N.hubPerson} saved the day.</p>`, "", folder);
    await setSettings(page, { retroLinkMode: "silent" });

    const shell = await openHubScoped(page, folder, hero.id);
    const button = shell.locator("button[data-action='linkMentions']");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();

    const dialog = page.locator("dialog.application.mej-cc-retro-link-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(N.hubSession);
    await dialog.locator("button[data-action='apply']").click();
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 1 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    assertNoConsoleErrors(errors);
  });
});
