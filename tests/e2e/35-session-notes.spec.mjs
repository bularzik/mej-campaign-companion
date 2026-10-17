// Session notes and the current session (spec 2026-10-15 items 1-3, 6, 1a).
// GM creates a campaign and starts a session; players (no GM needed for the
// write itself, but a GM stays online here to keep the run short) note via
// /note and the Session page; the GM ends the session and appends the draft.
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, ensureMejPlayerAccess, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const PREFIX = "TT-Notes";
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

const notesOf = (page, folderId) => page.evaluate(({ MOD, folderId }) => {
  const e = game.journal.find((j) => j.flags?.[MOD]?.notesEntry === true && j.folder?.id === folderId);
  return e ? Object.values(foundry.utils.deepClone(e.flags[MOD].notes ?? {})) : null;
}, { MOD, folderId });

let gm; let u1; let folderId; let duke; let sessionUuid;

test.describe("35 session notes", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    gm = await newSeat(browser, "Gamemaster");
    await ensureMejPlayerAccess(gm.page);
    await deleteJournalsByPrefix(gm.page, PREFIX);
    await cleanupStrandedTestFolders(gm.page, { prefix: PREFIX });
    folderId = await gm.page.evaluate(async ({ MOD, name }) => (await Folder.create({
      name, type: "JournalEntry", flags: { [MOD]: { campaign: { ownershipDefault: "observer" } } }
    })).id, { MOD, name: tagged("Camp") });
    duke = await gm.page.evaluate(async ({ name, folder }) => {
      const e = await JournalEntry.create({ name, folder, ownership: { default: 2 },
        pages: [{ name, type: "text", text: { content: `<p>${name}</p>` }, flags: { "monks-enhanced-journal": { type: "person" } } }] });
      return { id: e.id, uuid: e.uuid, name: e.name };
    }, { name: tagged("Duke"), folder: folderId });
    // The GM seat creates the notes entry on createFolder; wait for it and for the player to own it.
    u1 = await newSeat(browser, "User 1");
    const u1Id = await u1.page.evaluate(() => game.user.id);
    await expect.poll(() => gm.page.evaluate(({ MOD, folderId, u1Id }) => {
      const e = game.journal.find((j) => j.flags?.[MOD]?.notesEntry === true && j.folder?.id === folderId);
      return e?.ownership?.[u1Id] ?? null;
    }, { MOD, folderId, u1Id }), { timeout: 30_000 }).toBe(3);
  });

  test.afterAll(async ({ browser }) => {
    await u1?.context.close().catch(() => {});
    await gm?.context.close().catch(() => {});
    await withGmPage(browser, async (p) => {
      if (folderId) await p.evaluate((id) => game.folders.get(id)?.delete({ deleteSubfolders: true, deleteContents: true }), folderId);
      await deleteJournalsByPrefix(p, PREFIX);
      await cleanupStrandedTestFolders(p, { prefix: PREFIX });
    });
  });

  test("GM starts a session: flag set, player owns the recap", async () => {
    test.setTimeout(90_000);
    sessionUuid = await gm.page.evaluate(async (folderId) => {
      const { startSession } = await import("/modules/mej-campaign-companion/scripts/hooks/current-session.mjs");
      const page = await startSession(game.folders.get(folderId));
      return page?.uuid ?? null;
    }, folderId);
    expect(sessionUuid).toBeTruthy();
    const u1Id = await u1.page.evaluate(() => game.user.id);
    await expect.poll(() => u1.page.evaluate(async ({ sessionUuid, u1Id }) => (await fromUuid(sessionUuid))?.parent?.ownership?.[u1Id] ?? null, { sessionUuid, u1Id }), { timeout: 20_000 }).toBe(3);
    assertNoConsoleErrors(gm.errors);
  });

  test("/note files into the open session with the Duke linked", async () => {
    test.setTimeout(90_000);
    await u1.page.evaluate(() => ui.sidebar.changeTab?.("chat", "primary"));
    // Foundry 14's chat box is a <prose-mirror>, which Playwright cannot
    // fill(); submit the way the form does, through ChatLog#processMessage,
    // which fires the chatMessage hook note-command.mjs listens on.
    await u1.page.evaluate((text) => ui.chat.processMessage(text), `/note we think ${duke.name} is lying`);
    await expect.poll(async () => (await notesOf(u1.page, folderId))?.length ?? 0, { timeout: 20_000 }).toBe(1);
    const [note] = await notesOf(u1.page, folderId);
    expect(note.sessionUuid).toBe(sessionUuid);
    expect(note.text).toContain(`@UUID[${duke.uuid}]`);
    await expect(u1.page.locator("#chat .chat-message .mej-cc-note-echo", { hasText: "Noted in" }).last()).toBeVisible({ timeout: 15_000 });
    assertNoConsoleErrors(u1.errors);
  });

  test("the note shows on the Session page stream and on the Duke's Party notes", async () => {
    test.setTimeout(90_000);
    await u1.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry(await fromUuid(uuid)), sessionUuid);
    await settle(u1.page, 800);
    await expect(u1.page.locator("#MonksEnhancedJournal .mej-cc-notes-stream .mej-cc-note")).toHaveCount(1, { timeout: 15_000 });
    await u1.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), duke.id);
    await settle(u1.page, 800);
    await expect(u1.page.locator("#MonksEnhancedJournal .mej-cc-knowledge-notes .mej-cc-note")).toHaveCount(1, { timeout: 15_000 });
    assertNoConsoleErrors(u1.errors);
  });

  test("End session offers the draft; appending writes the recap", async () => {
    test.setTimeout(90_000);
    const done = gm.page.evaluate(async (folderId) => {
      const { endSession } = await import("/modules/mej-campaign-companion/scripts/hooks/current-session.mjs");
      await endSession(game.folders.get(folderId));
    }, folderId);
    const dialog = gm.page.locator("dialog.application", { hasText: "Recap draft" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator("button", { hasText: "Append to recap" }).click();
    await done;
    const recap = await gm.page.evaluate(async (uuid) => (await fromUuid(uuid))?.system?.recap ?? "", sessionUuid);
    expect(recap).toContain("is lying");
    const flag = await gm.page.evaluate(({ MOD, folderId }) => game.folders.get(folderId).flags?.[MOD]?.campaign?.currentSession ?? null, { MOD, folderId });
    expect(flag).toBeNull();
    assertNoConsoleErrors(gm.errors);
  });
});
