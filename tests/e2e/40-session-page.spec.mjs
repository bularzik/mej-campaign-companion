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

let gm; let campaignId; let s9; let s10;

const shell = () => gm.page.locator("#MonksEnhancedJournal");
const header = () => shell().locator(".session-container .mej-cc-session-header");

async function openSession(entryId) {
  await gm.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), entryId);
  await settle(gm.page, 800);
  await expect(header()).toHaveCount(1, { timeout: 15_000 });
}

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
        const entry = await JournalEntry.create({ name, folder, pages: [buildSessionPageData(name, "", null, n)] });
        out.push({ id: entry.id, uuid: entry.pages.contents[0].uuid, name });
      }
      return out;
    }, { folder: campaignId, names: [[`${PREFIX} S9`, 9], [`${PREFIX} S10`, 10]] });
  });

  test.afterAll(async ({ browser }) => {
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
    assertNoConsoleErrors(gm.errors);
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
    assertNoConsoleErrors(gm.errors);
  });
});
