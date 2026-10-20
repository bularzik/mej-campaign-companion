// Session page redesign (spec 2026-10-19 §4.2, §4.3): start, restart and end
// from the sheet's header, one running session per campaign, and the Table
// talk drawer. One GM seat drives a TT- campaign with two prepared sessions.
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, waitCompanionWired, trackConsoleErrors, assertNoConsoleErrors, settle,
  createTtCampaign, deleteFoldersById, deleteJournalsByPrefix, deleteActorsByPrefix, cleanupStrandedTestFolders,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const PREFIX = "TT-40";
// world-b (Foundry 13) runs df-curvy-walls, whose Minus/Equal keybinds throw
// "Cannot read properties of null (reading 'segments')" on any hyphen typed
// into a rich-text editor while no canvas tool is active. Third-party, and
// unrelated to the session page; the specs type hyphens in the recap.
const KNOWN_DF_CURVY_WALLS_KEYBIND = /Cannot read properties of null \(reading 'segments'\)/;
// Likewise multi-token-edit's keybind throws "reading 'options'" when a key
// typed straight after a click reaches the keyboard manager before the editor
// has taken focus (test "typing straight after the click").
const KNOWN_MULTI_TOKEN_EDIT_KEYBIND = /Cannot read properties of null \(reading 'options'\)/;
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404, KNOWN_DF_CURVY_WALLS_KEYBIND, KNOWN_MULTI_TOKEN_EDIT_KEYBIND];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };

let gm; let player; let campaignId; let s9; let s10;

const shell = () => gm.page.locator("#MonksEnhancedJournal");
const header = () => shell().locator(".session-container .mej-cc-session-header");

async function openSession(entryId) {
  const name = await gm.page.evaluate((id) => game.journal.get(id)?.name ?? "", entryId);
  // Right after a Start the shell is still re-rendering the running session, and
  // that late render can put it back over an open issued in the meantime (seen
  // on Foundry 13): the previous header is on screen, so a bare header count
  // proves nothing. Re-issue the open until the header shows this entry.
  await expect(async () => {
    await gm.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), entryId);
    await settle(gm.page, 800);
    await expect(header()).toHaveCount(1, { timeout: 5_000 });
    await expect(header().locator('input[name="name"]')).toHaveValue(name, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

// A player watching S9 sees status changes without reloading (fix round 1, item 3).
const playerStatus = () => player.page.locator("#MonksEnhancedJournal .session-container .mej-cc-session-header .mej-cc-session-status");
const recapOf = (uuid) => gm.page.evaluate(async (uuid) => (await fromUuid(uuid))?.system?.recap ?? "", uuid);
const occurrences = (hay, needle) => hay.split(needle).length - 1;

const currentUuid = () => gm.page.evaluate(({ MOD, id }) => game.folders.get(id)?.flags?.[MOD]?.campaign?.currentSession?.uuid ?? null, { MOD, id: campaignId });
const sessionFlag = (uuid) => gm.page.evaluate(async ({ MOD, uuid }) => foundry.utils.deepClone((await fromUuid(uuid))?.flags?.[MOD]?.session ?? {}), { MOD, uuid });

test.describe("40 session page", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext(VIEWPORT);
    const page = await context.newPage();
    gm = { context, page, errors: trackConsoleErrors(page, { ignore: IGNORE }) };
    await login(page, "Gamemaster");
    await deleteJournalsByPrefix(page, PREFIX);
    await cleanupStrandedTestFolders(page, { prefix: PREFIX });
    ({ folderId: campaignId } = await createTtCampaign(page, `${PREFIX} Campaign`));
    [s9, s10] = await page.evaluate(async ({ folder, names }) => {
      const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
      const out = [];
      for (const [name, n] of names) {
        // No campaign date: the first start fills it from the world clock.
        const entry = await JournalEntry.create({ name, folder, ownership: { default: 2 }, pages: [buildSessionPageData(name, "", null, n)] });
        out.push({ id: entry.id, uuid: entry.pages.contents[0].uuid, name });
      }
      return out;
    }, { folder: campaignId, names: [[`${PREFIX} S9`, 9], [`${PREFIX} S10`, 10]] });
    const pContext = await browser.newContext(VIEWPORT);
    const pPage = await pContext.newPage();
    player = { context: pContext, page: pPage, errors: trackConsoleErrors(pPage, { ignore: IGNORE }) };
    await login(pPage, "User 1");
  });

  test.afterAll(async ({ browser }) => {
    await player?.context.close().catch(() => {});
    await gm?.context.close().catch(() => {});
    await withGmPage(browser, async (p) => {
      await deleteFoldersById(p, [campaignId]);
      await deleteJournalsByPrefix(p, PREFIX);
      await deleteActorsByPrefix(p, PREFIX);
      await cleanupStrandedTestFolders(p, { prefix: PREFIX });
    });
  });

  test("starting a second session ends the first", async () => {
    test.setTimeout(120_000);
    await openSession(s10.id);
    await header().locator('[data-action="startSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBe(s10.uuid);

    await openSession(s9.id);
    // Rename S9 from its header before its first start. MEJ's submit-on-change
    // sends every field, the five empty date inputs included, so the stored
    // campaignDate can become an object of blanks - which must still count as
    // "no date entered" (fix round 1, item 2).
    const renamed = `${PREFIX} S9 Renamed`;
    await header().locator('input[name="name"]').fill(renamed);
    await header().locator('input[name="name"]').blur();
    await expect.poll(() => gm.page.evaluate(async (uuid) => (await fromUuid(uuid))?.name, s9.uuid), { timeout: 10_000 }).toBe(renamed);
    s9.name = renamed;
    await settle(gm.page, 500);

    // The player watches S9 (not running yet) while the GM starts it.
    await player.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry((await fromUuid(uuid)).parent), s9.uuid);
    await settle(player.page, 800);
    await expect(playerStatus()).toHaveCount(0, { timeout: 15_000 });

    // With the Links rail open the recap stays inside the Recap tab: below the
    // header, left of the rail, and nothing covers the header's Start button
    // (a second, standalone Session sheet used to sit over the shell after a
    // start - its recap took this click).
    await gm.page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    await openSession(s9.id);
    await expect(shell().locator(".mej-cc-knowledge:not(.collapsed)")).toHaveCount(1, { timeout: 15_000 });
    const layout = await gm.page.evaluate(() => {
      const box = (sel) => document.querySelector(`#MonksEnhancedJournal ${sel}`)?.getBoundingClientRect();
      const recap = box(".session-container .editor-parent[data-editor-id='recap']");
      const head = box(".session-container .mej-cc-session-header");
      const rail = box(".mej-cc-knowledge");
      const button = document.querySelector("#MonksEnhancedJournal .mej-cc-session-header .mej-cc-session-button");
      const b = button.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { recapTop: recap.top, recapRight: recap.right, headerBottom: head.bottom, railLeft: rail.left, buttonHit: button.contains(hit) };
    });
    expect(layout.recapTop).toBeGreaterThanOrEqual(layout.headerBottom);
    expect(layout.recapRight).toBeLessThanOrEqual(layout.railLeft);
    expect(layout.buttonHit).toBe(true);
    await header().locator('[data-action="startSession"]').click();
    const dialog = gm.page.locator("dialog.application", { hasText: "Start this session?" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(`End ${s10.name} and start ${s9.name}?`);
    await dialog.locator('button[data-action="yes"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBe(s9.uuid);

    const ten = await sessionFlag(s10.uuid);
    expect(typeof ten.endedAt).toBe("number");
    const nine = await sessionFlag(s9.uuid);
    expect(typeof nine.startedAt).toBe("number");
    const world = await gm.page.evaluate(async () => {
      const { currentWorldComponents } = await import("/modules/mej-campaign-companion/scripts/logic/campaign-calendar.mjs");
      return currentWorldComponents();
    });
    expect(nine.campaignDate ?? null).toEqual(world);
    await expect(playerStatus()).toHaveClass(/\blive\b/, { timeout: 15_000 });
    assertNoConsoleErrors(gm.errors);
    assertNoConsoleErrors(player.errors);
  });

  test("end shows no dialog", async () => {
    test.setTimeout(90_000);
    await openSession(s9.id);
    await expect(header().locator(".mej-cc-session-status.live")).toHaveCount(1);
    const dialogs = await gm.page.locator("dialog.application").count();
    await header().locator('[data-action="endSession"]').click();
    await settle(gm.page, 1000);
    await expect(gm.page.locator("dialog.application")).toHaveCount(dialogs);
    await expect.poll(currentUuid, { timeout: 20_000 }).toBeNull();
    await expect(header().locator(".mej-cc-session-status.ended")).toHaveCount(1, { timeout: 10_000 });
    await expect(header().locator('[data-action="startSession"]')).toContainText("Restart");
    await expect(playerStatus()).toHaveClass(/\bended\b/, { timeout: 15_000 });
    assertNoConsoleErrors(gm.errors);
    assertNoConsoleErrors(player.errors);
  });

  // Spec 2026-10-19 §4.3. Also the home of spec 35's old draft-append
  // assertions: End no longer offers the draft, the drawer does.
  test("table talk opens while live, folds when ended", async () => {
    test.setTimeout(120_000);
    await openSession(s9.id);
    // Restart: nothing else is running, so no question.
    await header().locator('[data-action="startSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBe(s9.uuid);
    await openSession(s9.id);
    const drawer = shell().locator(".session-container .mej-cc-table-talk");
    await expect(drawer).toHaveClass(/\bopen\b/);
    const input = drawer.locator('input[name="session-note"]');
    await expect(input).toBeVisible();
    const text = `${PREFIX} the ferryman lied`;
    await input.fill(text);
    await input.press("Enter");
    await expect(drawer.locator(".mej-cc-note", { hasText: text })).toHaveCount(1, { timeout: 15_000 });

    await header().locator('[data-action="endSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBeNull();
    await expect(drawer).not.toHaveClass(/\bopen\b/, { timeout: 10_000 });
    await expect(drawer.locator(".mej-cc-table-talk-head")).toContainText("Table talk · 1");
    const add = drawer.locator('[data-action="addTableTalkToRecap"]');
    await expect(add).toHaveText("add to recap");
    await add.click();
    await expect.poll(() => recapOf(s9.uuid), { timeout: 15_000 }).toContain("the ferryman lied");
    await expect(drawer.locator('[data-action="addTableTalkToRecap"]')).toHaveText("added ✓", { timeout: 10_000 });

    // A newer note flips the link back; adding again appends only that note
    // (fix round 1, item 1): each line is in the recap exactly once.
    await drawer.locator('[data-action="toggleTableTalk"]').click();
    const later = `${PREFIX} the toll was doubled`;
    await drawer.locator('input[name="session-note"]').fill(later);
    await drawer.locator('input[name="session-note"]').press("Enter");
    await expect(drawer.locator(".mej-cc-note", { hasText: later })).toHaveCount(1, { timeout: 15_000 });
    await expect(drawer.locator('[data-action="addTableTalkToRecap"]')).toHaveText("add to recap", { timeout: 10_000 });
    await drawer.locator('[data-action="addTableTalkToRecap"]').click();
    await expect.poll(() => recapOf(s9.uuid), { timeout: 15_000 }).toContain("the toll was doubled");
    const both = await recapOf(s9.uuid);
    expect(occurrences(both, "the ferryman lied")).toBe(1);
    expect(occurrences(both, "the toll was doubled")).toBe(1);
    await expect(drawer.locator('[data-action="addTableTalkToRecap"]')).toHaveText("added ✓", { timeout: 10_000 });

    // With nothing newer, another add asks first; declining leaves the recap as it is.
    await drawer.locator('[data-action="addTableTalkToRecap"]').click();
    const confirm = gm.page.locator("dialog.application", { hasText: "already added to the recap" });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.locator('button[data-action="no"]').click();
    await settle(gm.page, 500);
    expect(await recapOf(s9.uuid)).toBe(both);
    assertNoConsoleErrors(gm.errors);
  });
  // Spec 2026-10-19 §4.6: chips in the header, the checklist, drop anywhere.
  test("attendee checklist", async () => {
    test.setTimeout(150_000);
    const chips = () => header().locator(".mej-cc-attendee-chip");
    const chipNames = () => chips().locator(".mej-cc-attendee-name").allTextContents();
    // Two players become contributors with an assigned TT- character; both are restored below.
    const setup = await gm.page.evaluate(async ({ MOD, folderId, prefix }) => {
      const folder = game.folders.get(folderId);
      const players = game.users.filter((u) => !u.isGM).slice(0, 2);
      const made = [];
      const saved = [];
      for (const [i, u] of players.entries()) {
        const actor = await Actor.create({ name: `${prefix} Hero ${i + 1}`, type: "character", ownership: { default: 0, [u.id]: 3 } });
        saved.push({ id: u.id, character: u.character?.id ?? null });
        await u.update({ character: actor.id });
        made.push(actor.uuid);
      }
      const third = await Actor.create({ name: `${prefix} Guest`, type: "npc" });
      const fourth = await Actor.create({ name: `${prefix} Elsewhere`, type: "npc" });
      await folder.update({ [`flags.${MOD}.campaign.contributors`]: { userIds: players.map((u) => u.id), groupIds: [] } });
      return { made, saved, third: third.uuid, fourth: fourth.uuid, thirdName: third.name };
    }, { MOD, folderId: campaignId, prefix: PREFIX });
    try {
      const entry = await gm.page.evaluate(async ({ folder, name }) => {
        const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
        const e = await JournalEntry.create({ name, folder, ownership: { default: 2 }, pages: [buildSessionPageData(name, "", null, 11)] });
        return { id: e.id, uuid: e.pages.contents[0].uuid };
      }, { folder: campaignId, name: `${PREFIX} S11` });
      await openSession(entry.id);
      await expect(chips()).toHaveCount(0);
      await header().locator('[data-action="manageAttendees"]').click();
      const dialog = gm.page.locator("dialog.application", { hasText: "Who's playing tonight?" });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      const boxes = dialog.locator('input[name="attendee"]');
      await expect(boxes).toHaveCount(2);
      await expect(dialog.locator('input[name="attendee"]:checked')).toHaveCount(2);
      await expect(dialog.locator('button[data-action="confirm"]')).toContainText("Add 2 attendees");
      await boxes.nth(1).uncheck();
      await dialog.locator('button[data-action="confirm"]').click();
      await expect(chips()).toHaveCount(1, { timeout: 15_000 });
      await expect(dialog).toHaveCount(0, { timeout: 10_000 });

      // Reopening keeps the unchecked one unchecked; confirming changes nothing.
      await header().locator('[data-action="manageAttendees"]').click();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(dialog.locator('input[name="attendee"]')).toHaveCount(2);
      await expect(dialog.locator('input[name="attendee"]:checked')).toHaveCount(1);
      await expect(dialog.locator('button[data-action="confirm"]')).toContainText("Save attendees");
      await dialog.locator('button[data-action="confirm"]').click();
      await expect(dialog).toHaveCount(0, { timeout: 10_000 });
      await settle(gm.page, 800);
      await expect(chips()).toHaveCount(1);

      // Drop a third character on the Recap tab's Table talk: a chip and an "Added" notice.
      const drop = (selector, uuid) => gm.page.evaluate(({ selector, uuid }) => {
        const el = document.querySelector(`#MonksEnhancedJournal ${selector}`);
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
        const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
        for (const t of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(t, opts));
      }, { selector, uuid });
      await drop(".session-container .mej-cc-table-talk", setup.third);
      await expect(chips()).toHaveCount(2, { timeout: 15_000 });
      await expect(gm.page.locator("#notifications .notification", { hasText: `Added ${setup.thirdName}` })).toHaveCount(1);

      // The Relationships tab keeps its own drops: no new chip.
      await drop(".session-container .tab[data-tab='relationships']", setup.fourth);
      await settle(gm.page, 1000);
      await expect(chips()).toHaveCount(2);
      expect(await chipNames()).not.toContain(`${PREFIX} Elsewhere`);
      assertNoConsoleErrors(gm.errors);
    } finally {
      await gm.page.evaluate(async ({ MOD, folderId, saved }) => {
        for (const s of saved) await game.users.get(s.id)?.update({ character: s.character });
        await game.folders.get(folderId)?.update({ [`flags.${MOD}.campaign.-=contributors`]: null });
      }, { MOD, folderId: campaignId, saved: setup.saved });
    }
  });
  // Spec 2026-10-19 §4.3 (reveal/media links) and §4.7 (rail notes name their session).
  test("note links", async () => {
    test.setTimeout(150_000);
    const mediaName = `${PREFIX} Harbor Map`;
    const other = await gm.page.evaluate(() => game.users.filter((u) => !u.isGM)[1]?.id ?? null);
    test.skip(!other, "needs a second non-GM user");
    // S10 runs; the GM shows an image to ONE player (not the one watching) - a media note filed on S10.
    await openSession(s10.id);
    await header().locator('[data-action="startSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBe(s10.uuid);
    await gm.page.evaluate(async ({ folderId, name, other }) => {
      const { fileMediaNote } = await import("/modules/mej-campaign-companion/scripts/hooks/reveal-filing.mjs");
      await fileMediaNote({ campaign: game.folders.get(folderId), src: "icons/svg/mystery-man.svg", name, users: [other] });
    }, { folderId: campaignId, name: mediaName, other });
    await openSession(s10.id);
    const link = shell().locator(".session-container .mej-cc-table-talk .mej-cc-note-link", { hasText: mediaName });
    await expect(link).toHaveCount(1, { timeout: 15_000 });

    // Clicking opens a local popout and never relays (no shareImage over the socket).
    await gm.page.evaluate(() => {
      window.__ccEmits = [];
      const emit = game.socket.emit.bind(game.socket);
      game.socket.emit = (...args) => { window.__ccEmits.push(JSON.stringify(args)); return emit(...args); };
    });
    const popouts = await gm.page.locator(".application.image-popout").count();
    await link.click();
    await expect(gm.page.locator(".application.image-popout")).toHaveCount(popouts + 1, { timeout: 10_000 });
    expect(await gm.page.evaluate(() => window.__ccEmits.filter((e) => /shareImage/i.test(e)))).toEqual([]);
    await gm.page.locator(".application.image-popout").last().locator('[data-action="close"]').click();

    // The player who was not shown the image has no such row.
    await player.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry((await fromUuid(uuid)).parent), s10.uuid);
    await settle(player.page, 1000);
    await expect(player.page.locator("#MonksEnhancedJournal .session-container .mej-cc-table-talk")).toHaveCount(1, { timeout: 15_000 });
    await expect(player.page.locator("#MonksEnhancedJournal .mej-cc-note-link")).toHaveCount(0);
    await header().locator('[data-action="endSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBeNull();

    // Rail: a note filed on S9 that mentions an entry opens with the session's name; clicking it opens S9.
    const person = await gm.page.evaluate(async ({ folderId, s9uuid, name }) => {
      const entry = await JournalEntry.create({
        name, folder: folderId, ownership: { default: 2 },
        pages: [{ name, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: "<p>x</p>" } }]
      });
      const { addNote } = await import("/modules/mej-campaign-companion/scripts/data/notes-store.mjs");
      await addNote(game.folders.get(folderId), { text: `saw @UUID[${entry.uuid}]{${name}} at the docks`, sessionUuid: s9uuid, mentions: [entry.uuid] });
      return { id: entry.id };
    }, { folderId: campaignId, s9uuid: s9.uuid, name: `${PREFIX} Harbormaster` });
    await gm.page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    await gm.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), person.id);
    await settle(gm.page, 800);
    const row = shell().locator(".mej-cc-knowledge .mej-cc-note", { hasText: "at the docks" });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    const sessionLink = row.locator('[data-action="openNoteSession"]');
    await expect(sessionLink).toHaveText(s9.name);
    expect((await row.locator(".mej-cc-note-meta").textContent()).trim().startsWith(s9.name)).toBe(true);
    await sessionLink.click();
    await expect(header().locator('input[name="name"]')).toHaveValue(s9.name, { timeout: 15_000 });
    // A rail row's image link on a Session page opens exactly one popout (the sheet's own
    // openNoteLink action must not also fire).
    await gm.page.evaluate(async ({ folderId, entryUuid }) => {
      const { addNote } = await import("/modules/mej-campaign-companion/scripts/data/notes-store.mjs");
      await addNote(game.folders.get(folderId), {
        text: "TT-40 rail image", kind: "reveal", mentions: [entryUuid],
        ref: { src: "icons/svg/mystery-man.svg", kind: "media" }
      });
    }, { folderId: campaignId, entryUuid: `JournalEntry.${s10.id}` });
    await gm.page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    await openSession(s10.id);
    const railLink = shell().locator(".mej-cc-knowledge .mej-cc-note-link", { hasText: "TT-40 rail image" });
    await expect(railLink).toHaveCount(1, { timeout: 15_000 });
    const popoutCount = () => gm.page.evaluate(() => [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.apps.ImagePopout).length);
    const before = await popoutCount();
    await railLink.click();
    await expect.poll(popoutCount, { timeout: 10_000 }).toBe(before + 1);
    await settle(gm.page, 800);
    expect(await popoutCount()).toBe(before + 1);
    assertNoConsoleErrors(gm.errors);
    assertNoConsoleErrors(player.errors);
  });

  // Spec 2026-10-19 §4.4: always-editable text with autosave.
  // `ownership` defaults to observer, which the campaign's ownership hook raises to owner for players.
  const newSession = (name, n, ownership = { default: 2 }) => gm.page.evaluate(async ({ folder, name, n, ownership }) => {
    const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
    const e = await JournalEntry.create({ name, folder, ownership, pages: [buildSessionPageData(name, "<p>Opening line.</p>", null, n)] });
    return { id: e.id, uuid: e.pages.contents[0].uuid, name };
  }, { folder: campaignId, name, n, ownership });
  const editorOf = (page, id) => page.locator(`#MonksEnhancedJournal .session-container .editor-parent[data-editor-id="${id}"]`);

  test("typing survives a live note", async () => {
    test.setTimeout(150_000);
    const s12 = await newSession(`${PREFIX} S12`, 12);
    await openSession(s12.id);
    await header().locator('[data-action="startSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBe(s12.uuid);
    // The player can file notes into this campaign (the GM seat owns the notes entry's ownership sync).
    const playerId = await player.page.evaluate(() => game.user.id);
    await expect.poll(() => gm.page.evaluate(({ MOD, folderId, playerId }) => {
      const e = game.journal.find((j) => j.flags?.[MOD]?.notesEntry === true && j.folder?.id === folderId);
      return e?.ownership?.[playerId] ?? null;
    }, { MOD, folderId: campaignId, playerId }), { timeout: 30_000 }).toBe(3);

    // The GM clicks into the recap - no pencil - and types.
    const recap = editorOf(gm.page, "recap");
    await recap.locator(".editor-display").click();
    await expect(recap.locator("prose-mirror")).toHaveClass(/active/, { timeout: 10_000 });
    await gm.page.keyboard.type(" The GM is mid-sentence");

    // A player files /note into the live session while the GM is typing.
    const noteText = `${PREFIX} the bridge is out`;
    await player.page.evaluate((text) => ui.chat.processMessage(`/note ${text}`), noteText);
    await expect(shell().locator(".session-container .mej-cc-table-talk .mej-cc-note", { hasText: noteText })).toHaveCount(1, { timeout: 20_000 });

    // Nothing re-rendered under the GM: the text, the focus and the editor are all still there.
    await expect(recap).toHaveClass(/\bediting\b/);
    await expect(recap.locator("prose-mirror .editor-content")).toContainText("The GM is mid-sentence");
    expect(await gm.page.evaluate(() => !!document.activeElement?.closest?.("#MonksEnhancedJournal .editor-parent[data-editor-id='recap'] prose-mirror"))).toBe(true);
    await gm.page.keyboard.type(" and keeps going.");

    // Clicking out saves it.
    await header().locator(".mej-cc-session-meta").click();
    await expect.poll(() => recapOf(s12.uuid), { timeout: 15_000 }).toContain("The GM is mid-sentence and keeps going.");
    await expect(recap).not.toHaveClass(/\bediting\b/);
    await expect(recap.locator(".mej-cc-save-state")).toHaveText("Saved", { timeout: 10_000 });
    await expect(recap.locator(".editor-display")).toContainText("and keeps going.");

    await header().locator('[data-action="endSession"]').click();
    await expect.poll(currentUuid, { timeout: 20_000 }).toBeNull();
    assertNoConsoleErrors(gm.errors);
    assertNoConsoleErrors(player.errors);
  });

  // Keystrokes that land before the collaborative join is live are held and
  // must be saved even when the user clicks away at once (spec §2 anti-goal).
  test("typing straight after the click, then clicking away, is kept", async () => {
    test.setTimeout(90_000);
    const s15 = await newSession(`${PREFIX} S15`, 15);
    await openSession(s15.id);
    const recap = editorOf(gm.page, "recap");
    await recap.locator(".editor-display").click();
    await gm.page.keyboard.type("quick");
    await header().locator(".mej-cc-session-meta").click();
    await expect.poll(() => recapOf(s15.uuid), { timeout: 15_000 }).toContain("quick");
    await expect(recap).not.toHaveClass(/\bediting\b/);
    await expect(recap.locator(".editor-display")).toContainText("quick");
    assertNoConsoleErrors(gm.errors);
  });

  // A collaborative join that goes live after the user already left the recap
  // must still end its server session: core skips destroy() for an editor that
  // was not active yet when it left the page, and the authority left behind
  // would autosave its stale copy over every later recap write.
  test("an abandoned recap join ends its editing session", async () => {
    test.setTimeout(90_000);
    const s16 = await newSession(`${PREFIX} S16`, 16);
    await openSession(s16.id);
    const instance = `${s16.uuid}#system.recap`;
    const gmId = await gm.page.evaluate(() => game.user.id);
    // Hold the join's reply so the click-away always lands while the join is in flight.
    await gm.page.evaluate((instance) => {
      window.__ccPmEnds = [];
      window.__ccEmitBefore40 = game.socket.emit;
      const emit = game.socket.emit.bind(game.socket);
      game.socket.emit = (ev, ...args) => {
        if (ev === "pm.endSession") window.__ccPmEnds.push(args[0]);
        if (ev === "pm.editDocument" && args[0] === instance && typeof args.at(-1) === "function") {
          const reply = args.pop();
          return emit(ev, ...args, (authority) => setTimeout(() => reply(authority), 1500));
        }
        return emit(ev, ...args);
      };
    }, instance);
    try {
      const recap = editorOf(gm.page, "recap");
      await recap.locator(".editor-display").click();
      await header().locator(".mej-cc-session-meta").click();
      await expect(recap).not.toHaveClass(/\bediting\b/);
      expect(await gm.page.evaluate(() => window.__ccPmEnds.length)).toBe(0);
      // The late join is ended by this client...
      await expect.poll(() => gm.page.evaluate(() => window.__ccPmEnds), { timeout: 10_000 }).toContain(instance);
      // ...and the server no longer counts the GM in it (a probe join lists who is).
      const users = await player.page.evaluate((instance) => new Promise((resolve) => {
        const state = ProseMirror.EditorState.create({ doc: ProseMirror.dom.parseString("") }).toJSON();
        game.socket.emit("pm.editDocument", instance, state, (authority) => {
          game.socket.emit("pm.endSession", instance);
          resolve(authority?.users ?? null);
        });
      }), instance);
      expect(users).not.toBeNull();
      expect(users).not.toContain(gmId);
      // A direct recap write (what Add to recap does) stays.
      await gm.page.evaluate(async (uuid) => (await fromUuid(uuid)).update({ "system.recap": "<p>TT-40 written after the join</p>" }), s16.uuid);
      await settle(gm.page, 3000);
      expect(await recapOf(s16.uuid)).toBe("<p>TT-40 written after the join</p>");
      await expect(recap.locator(".editor-display")).toContainText("TT-40 written after the join");
      assertNoConsoleErrors(gm.errors);
    } finally {
      await gm.page.evaluate(() => { if (window.__ccEmitBefore40) game.socket.emit = window.__ccEmitBefore40; });
    }
  });

  test("close saves", async () => {
    test.setTimeout(120_000);
    const s13 = await newSession(`${PREFIX} S13`, 13);
    await openSession(s13.id);
    await shell().locator('nav.sheet-tabs a[data-tab="session"]').click();
    const prep = editorOf(gm.page, "gmNotes");
    await prep.locator(".editor-display").click();
    await expect(prep.locator("prose-mirror")).toHaveClass(/active/, { timeout: 10_000 });
    await gm.page.keyboard.type("Prep: the ferryman owes the duke.");
    // Close the whole MEJ window at once: no "unsaved changes" question, and the text is kept.
    await gm.page.evaluate(() => game.MonksEnhancedJournal.journal.close());
    await expect(shell()).toHaveCount(0, { timeout: 10_000 });
    await expect(gm.page.locator("dialog.application")).toHaveCount(0);
    await expect.poll(() => gm.page.evaluate(async (uuid) => (await fromUuid(uuid))?.system?.gmNotes ?? "", s13.uuid), { timeout: 15_000 })
      .toContain("Prep: the ferryman owes the duke.");
    await openSession(s13.id);
    await shell().locator('nav.sheet-tabs a[data-tab="session"]').click();
    await expect(editorOf(gm.page, "gmNotes").locator(".editor-display")).toContainText("Prep: the ferryman owes the duke.");
    assertNoConsoleErrors(gm.errors);
  });

  // Final review item 3: a reveal patches the viewer's Details tab in place.
  test("a revealed secret shows on a player's open Details tab", async () => {
    test.setTimeout(90_000);
    const s17 = await newSession(`${PREFIX} S17`, 17);
    const secretsPath = `flags.${MOD}.session.secrets`;
    const writeSecrets = (secrets) => gm.page.evaluate(async ({ uuid, path, secrets }) =>
      (await fromUuid(uuid)).update({ [path]: secrets }), { uuid: s17.uuid, path: secretsPath, secrets });
    const hidden = { id: "tt40hidden", text: "TT-40 the duke is the thief", revealed: false, revealedAt: null };
    await writeSecrets([hidden]);
    await player.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry((await fromUuid(uuid)).parent), s17.uuid);
    const pShell = player.page.locator("#MonksEnhancedJournal");
    await expect(pShell.locator(".session-container .mej-cc-session-header input[name='name']")).toHaveValue(s17.name, { timeout: 15_000 });
    await pShell.locator('nav.sheet-tabs a[data-tab="session"]').click();
    const rows = pShell.locator(".session-container [data-cc-region='secrets'] .secrets-list li[data-id]");
    await expect(pShell.locator(".session-container [data-cc-region='secrets']")).toHaveCount(1);
    await expect(rows).toHaveCount(0);

    // The GM reveals one: it shows without a reload; the unrevealed one never does.
    const shown = { id: "tt40shown", text: "TT-40 the ferry runs at dawn", revealed: true, revealedAt: Date.now() };
    await writeSecrets([hidden, shown]);
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(rows.first()).toContainText(shown.text);
    await expect(pShell.locator(".session-container")).not.toContainText(hidden.text);

    // A folded section stays folded through the next reveal.
    await pShell.locator(".session-container .secrets-section > summary").click();
    await expect(pShell.locator(".session-container details.secrets-section")).not.toHaveAttribute("open", /.*/);
    await writeSecrets([hidden, shown, { id: "tt40second", text: "TT-40 the bell tolls twice", revealed: true, revealedAt: Date.now() }]);
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await expect(pShell.locator(".session-container details.secrets-section")).not.toHaveAttribute("open", /.*/);
    assertNoConsoleErrors(player.errors);
    assertNoConsoleErrors(gm.errors);
  });

  // Last: it logs the GM out and back in.
  test("My Notes without a GM", async ({ browser }) => {
    test.setTimeout(180_000);
    const playerId = await player.page.evaluate(() => game.user.id);
    // A view-only page for the player (default none - below observer, so the campaign's
    // ownership hook leaves it - plus an observer grant): My Notes saves go through MEJ's GM relay.
    const s14 = await newSession(`${PREFIX} S14`, 14, { default: 0, [playerId]: 2 });
    expect(await player.page.evaluate(async (uuid) => (await fromUuid(uuid))?.isOwner, s14.uuid)).toBe(false);
    await player.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry((await fromUuid(uuid)).parent), s14.uuid);
    await expect(player.page.locator("#MonksEnhancedJournal .session-container .mej-cc-session-header")).toHaveCount(1, { timeout: 15_000 });

    // The GM leaves.
    await gm.context.close();
    await expect.poll(() => player.page.evaluate(() => !!game.users.activeGM), { timeout: 20_000 }).toBe(false);

    const pShell = player.page.locator("#MonksEnhancedJournal");
    await pShell.locator('nav.sheet-tabs a[data-tab="notes"]').click();
    await expect(pShell.locator(".mej-cc-my-notes-hint")).toHaveText("These notes can only be seen by you.");
    const notes = editorOf(player.page, "myNotes");
    await notes.locator(".editor-display").click();
    await expect(notes.locator("prose-mirror")).toHaveClass(/active/, { timeout: 10_000 });
    await player.page.keyboard.type("Ask about the second key.");
    await pShell.locator(".mej-cc-my-notes-hint").click();
    await expect(notes.locator(".mej-cc-save-state")).toHaveText("Can't save until a GM connects", { timeout: 10_000 });
    await expect(notes.locator(".editor-display")).toContainText("Ask about the second key.");

    // A reload keeps the draft on this device: it is offered again, still waiting for a GM.
    await player.page.reload();
    await player.page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60_000 });
    await waitCompanionWired(player.page);
    await player.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry((await fromUuid(uuid)).parent), s14.uuid);
    await expect(pShell.locator(".session-container .mej-cc-session-header")).toHaveCount(1, { timeout: 15_000 });
    await pShell.locator('nav.sheet-tabs a[data-tab="notes"]').click();
    await expect(editorOf(player.page, "myNotes").locator(".editor-display")).toContainText("Ask about the second key.", { timeout: 10_000 });
    await expect(editorOf(player.page, "myNotes").locator(".mej-cc-save-state")).toHaveText("Can't save until a GM connects", { timeout: 10_000 });

    // The GM comes back: the draft is saved without the player doing anything.
    const context = await browser.newContext(VIEWPORT);
    const page = await context.newPage();
    gm = { context, page, errors: trackConsoleErrors(page, { ignore: IGNORE }) };
    await login(page, "Gamemaster");
    await expect.poll(() => gm.page.evaluate(async ({ uuid, playerId }) =>
      foundry.utils.getProperty(await fromUuid(uuid), `flags.monks-enhanced-journal.${playerId}.notes`) ?? "", { uuid: s14.uuid, playerId }), { timeout: 10_000 })
      .toContain("Ask about the second key.");
    await expect(editorOf(player.page, "myNotes").locator(".mej-cc-save-state")).toHaveText("Saved", { timeout: 10_000 });
    assertNoConsoleErrors(player.errors);
    assertNoConsoleErrors(gm.errors);
  });
});
