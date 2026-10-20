// Session page redesign (spec 2026-10-19 §4.2, §4.3): start, restart and end
// from the sheet's header, one running session per campaign, and the Table
// talk drawer. One GM seat drives a TT- campaign with two prepared sessions.
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, trackConsoleErrors, assertNoConsoleErrors, settle,
  createTtCampaign, deleteFoldersById, deleteJournalsByPrefix, cleanupStrandedTestFolders,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const PREFIX = "TT-40";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };

let gm; let player; let campaignId; let s9; let s10;

const shell = () => gm.page.locator("#MonksEnhancedJournal");
const header = () => shell().locator(".session-container .mej-cc-session-header");

async function openSession(entryId) {
  await gm.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), entryId);
  await settle(gm.page, 800);
  await expect(header()).toHaveCount(1, { timeout: 15_000 });
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
});
