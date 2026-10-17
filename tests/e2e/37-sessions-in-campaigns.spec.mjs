// Sessions always live in a campaign (spec 2026-10-16 §1). GM seat, World A.
// The "New Campaign" fallback may legitimately exist in the world before this
// spec runs; each test records whether it did and deletes it only if the test
// created it. All sessions and folders here are TT- named.
//
// Test 6 note: the Hub's Start Session button lives in the Tonight strip,
// which renders only when the Hub has a campaign (the scoped one, or the only
// capture-eligible one - CampaignHubPage #tonightCampaign). In Unfiled or All
// scope with two or more campaigns there is no strip and so no button; with
// exactly one campaign the button starts a session in it WITHOUT a prompt. So
// the prompt path is reached by running the Hub's own registered
// `startSession` action on the live Hub instance (exactly what a click would
// run), after making sure two or more campaigns exist (a TT- one is created).
import { test, expect } from "@playwright/test";
import {
  login, settle, reloadGame, TT_PREFIX, trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404,
  unfiledBootstrapEntryId, createTtPlainFolder, createTtCampaign, deleteFoldersById, deleteJournalsByPrefix,
  fallbackCampaignId, cleanupFallbackCampaign
} from "./helpers/foundry.mjs";
import { openHub, scopeHub } from "./helpers/hub.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const MOD = "/modules/mej-campaign-companion/scripts";

/**
 * Create a session entry via the API; `folder` null = folderless.
 * buildSessionPageData opts out of the auto timepoint (autoTimepoint: false -
 * it is the import's builder, and the Hub's New Session uses it too);
 * `timepoint: true` drops that opt-out so the session wants one, like a
 * session made through MEJ's own New Entry.
 */
async function createSession(page, name, { folder = null, ownership = null, timepoint = false } = {}) {
  return page.evaluate(async ({ n, f, own, mod, tp }) => {
    const { buildSessionPageData } = await import(`${mod}/logic/session-page-data.mjs`);
    const data = buildSessionPageData(n, "<p>Filing test.</p>", null, null);
    if (tp) delete data.flags["mej-campaign-companion"].session.autoTimepoint;
    const entry = await JournalEntry.create({
      name: n, ...(f ? { folder: f } : {}), ...(own ? { ownership: own } : {}),
      pages: [data]
    });
    return entry.id;
  }, { n: name, f: folder, own: ownership, mod: MOD, tp: timepoint });
}

const folderOf = (page, id) => page.evaluate((i) => game.journal.get(i)?.folder?.id ?? null, id);
const worldState = (page) => page.evaluate(() => ({
  timelineSetting: game.settings.get("mej-campaign-companion", "timelineJournalId"),
  rootTimelines: game.journal.filter((e) => !e.folder && !!e.getFlag("mej-campaign-companion", "timeline")).map((e) => e.id).sort()
}));

test.describe("37 sessions in campaigns", () => {
  let before;
  let fallbackExistedBefore;

  test.beforeEach(async ({ page }) => {
    await login(page, "Gamemaster");
    before = await worldState(page);
    fallbackExistedBefore = !!(await fallbackCampaignId(page));
    // Make the shell bootstrap entry exist so Unfiled scope is offered.
    await unfiledBootstrapEntryId(page);
  });

  test.afterEach(async ({ page }) => {
    // Capture first, clean up always, assert last: a failing guard must not
    // strand TT- sessions or the spec's own fallback in World A.
    const after = await worldState(page);
    let fallbackLeft = null;
    try {
      await deleteJournalsByPrefix(page);
    } finally {
      if (!fallbackExistedBefore) {
        await cleanupFallbackCampaign(page);
        fallbackLeft = await fallbackCampaignId(page);
      }
    }
    // No world timeline may appear and the legacy setting may not change (§1e).
    expect(after.timelineSetting).toBe(before.timelineSetting);
    expect(after.rootTimelines).toEqual(before.rootTimelines);
    // The suite's own fallback must be reclaimable once its TT- sessions are gone.
    if (!fallbackExistedBefore) expect(fallbackLeft).toBeNull();
  });

  // The Hub's New Session builds its page with buildSessionPageData, which
  // opts out of the auto timepoint, so it makes no timepoint at all (true
  // before 0.28.0 too). Where a filed session's timepoint lands (§1d) is
  // checked in test 2 with a session that wants one.
  test("1. Hub New Session with the campaign prompt dismissed files the session into \"New Campaign\"", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const sessionName = await page.evaluate(() => game.i18n.localize("MEJCampaignCompanion.hub.newSession"));
    const beforeIds = await page.evaluate((n) => game.journal.filter((j) => j.name === n).map((j) => j.id), sessionName);
    const readCreated = () => page.evaluate(({ n, beforeIds }) => {
      const e = game.journal.find((j) => j.name === n && !beforeIds.includes(j.id));
      return e ? { id: e.id, folder: e.folder?.id ?? null, folderName: e.folder?.name ?? null } : null;
    }, { n: sessionName, beforeIds });
    try {
      const shell = await openHub(page);
      await scopeHub(shell, page, "unfiled");
      await shell.locator("button.mej-cc-new-session").click();
      const dialog = page.locator("dialog.application").last();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('select[name="campaign"]')).toHaveCount(1);
      await page.keyboard.press("Escape");

      await expect.poll(async () => (await readCreated())?.folder ?? null, { timeout: 10_000 }).not.toBeNull();
      const created = await readCreated();
      expect(created).toBeTruthy();
      const fallback = await fallbackCampaignId(page);
      expect(fallback).toBeTruthy();
      expect(created.folder).toBe(fallback);
      expect(created.folderName).toBe("New Campaign");
      assertNoConsoleErrors(errors);
    } finally {
      // The "New session" has no TT- name, so no sweep would reclaim it (and
      // it would keep the fallback unreclaimable): delete every same-named
      // journal not in the pre-test snapshot, even when an assertion failed.
      await page.evaluate(async ({ n, beforeIds }) => {
        const ids = game.journal.filter((j) => j.name === n && !beforeIds.includes(j.id)).map((j) => j.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      }, { n: sessionName, beforeIds }).catch(() => {});
    }
  });

  test("2. a folderless session created through the API is filed by the GM client: default ownership raised to the session-aware level, explicit per-user ownership kept, its timepoint on the fallback campaign's timeline", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const user1 = await page.evaluate(() => game.users.getName("User 1").id);
    const id = await createSession(page, `${TT_PREFIX}SIC Loose ${RUN}`, { ownership: { default: 2, [user1]: 1 }, timepoint: true });
    await expect.poll(() => folderOf(page, id), { timeout: 10_000 }).not.toBeNull();
    const fallback = await fallbackCampaignId(page);
    expect(await folderOf(page, id)).toBe(fallback);
    const own = await page.evaluate((i) => game.journal.get(i).ownership, id);
    expect(own.default).toBe(3);      // observer campaign -> sessions are player-owned
    expect(own[user1]).toBe(1);       // the explicit grant is untouched
    // The timepoint sits on the fallback campaign's own timeline (§1d).
    const sessionFlag = () => page.evaluate((i) => game.journal.get(i)?.pages.contents[0]?.getFlag("mej-campaign-companion", "session") ?? null, id);
    await expect.poll(async () => (await sessionFlag())?.timepointId ?? null, { timeout: 10_000 }).not.toBeNull();
    const flag = await sessionFlag();
    const campaignTimeline = await page.evaluate(async ({ fid, mod }) => {
      const { campaignTimelineJournal } = await import(`${mod}/data/timeline-journal.mjs`);
      return campaignTimelineJournal(game.folders.get(fid))?.id ?? null;
    }, { fid: fallback, mod: MOD });
    expect(campaignTimeline).toBeTruthy();
    expect(flag.timelineId).toBe(campaignTimeline);
    const linked = await page.evaluate(({ tl, tp, i }) => {
      const uuid = game.journal.get(i).pages.contents[0].uuid;
      const t = game.journal.get(tl)?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.find((x) => x.id === tp);
      return !!t?.links?.some((l) => l.uuid === uuid);
    }, { tl: flag.timelineId, tp: flag.timepointId, i: id });
    expect(linked).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("3. two folderless sessions created together share one fallback campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const ids = await page.evaluate(async ({ prefix, run, mod }) => {
      const { buildSessionPageData } = await import(`${mod}/logic/session-page-data.mjs`);
      const make = (n) => JournalEntry.create({ name: n, pages: [buildSessionPageData(n, "", null, null)] });
      const [a, b] = await Promise.all([make(`${prefix}SIC Burst A ${run}`), make(`${prefix}SIC Burst B ${run}`)]);
      return [a.id, b.id];
    }, { prefix: TT_PREFIX, run: RUN, mod: MOD });
    for (const id of ids) await expect.poll(() => folderOf(page, id), { timeout: 10_000 }).not.toBeNull();
    const folders = await page.evaluate((list) => list.map((i) => game.journal.get(i).folder.id), ids);
    expect(folders[0]).toBe(folders[1]);
    const count = await page.evaluate(() => game.folders.filter((f) => f.type === "JournalEntry" && !f.folder && f.name === "New Campaign").length);
    expect(count).toBe(1);
    assertNoConsoleErrors(errors);
  });

  test("4. a session created inside a plain TT- folder is not moved", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const plain = await createTtPlainFolder(page, `${TT_PREFIX}SIC Plain ${RUN}`);
    try {
      const id = await createSession(page, `${TT_PREFIX}SIC Kept ${RUN}`, { folder: plain });
      await settle(page, 2000);
      expect(await folderOf(page, id)).toBe(plain);
      assertNoConsoleErrors(errors);
    } finally {
      await deleteFoldersById(page, [plain]);
    }
  });

  test("5. the ready-time sweep files a folderless session left over from an earlier load", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const plain = await createTtPlainFolder(page, `${TT_PREFIX}SIC Sweep ${RUN}`);
    const id = await createSession(page, `${TT_PREFIX}SIC Stranded ${RUN}`, { folder: plain });
    // Only CREATE is hooked: moving the entry out of its folder leaves it
    // folderless, exactly the state a pre-0.28.0 world is in.
    await page.evaluate(async (i) => { await game.journal.get(i).update({ folder: null }); }, id);
    await deleteFoldersById(page, [plain]);
    expect(await folderOf(page, id)).toBeNull();
    await reloadGame(page);
    await expect.poll(() => folderOf(page, id), { timeout: 20_000 }).not.toBeNull();
    expect(await folderOf(page, id)).toBe(await fallbackCampaignId(page));
    assertNoConsoleErrors(errors);
  });

  test("6. Start Session with its campaign prompt dismissed starts nothing", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    // Two or more campaigns, so promptCampaignChoice shows its dialog rather
    // than starting a session in the only one (see the header note).
    const { folderId } = await createTtCampaign(page, `${TT_PREFIX}SIC Start ${RUN}`);
    try {
      expect(await page.evaluate(async (mod) => {
        const { getCampaigns } = await import(`${mod}/data/campaign-store.mjs`);
        return getCampaigns().length;
      }, MOD)).toBeGreaterThanOrEqual(2);
      const countSessions = () => page.evaluate(() => game.journal.filter((e) => e.pages.some((p) => p._source?.type === "mej-campaign-companion.session")).length);
      const openSessions = () => page.evaluate(() => game.folders.filter((f) => !!f.getFlag("mej-campaign-companion", "campaign")?.currentSession).map((f) => f.id).sort());
      const n0 = await countSessions();
      const open0 = await openSessions();
      const shell = await openHub(page);
      await scopeHub(shell, page, "unfiled");
      // No campaign in scope -> no Tonight strip; run the Hub's own action.
      const fired = await page.evaluate(() => {
        const sub = game.MonksEnhancedJournal.journal?.subsheet;
        const action = sub?.options?.actions?.startSession;
        if (sub?.constructor?.name !== "CampaignHubPage" || typeof action !== "function") return false;
        const handler = action.handler ?? action;
        void handler.call(sub, new PointerEvent("click"), null);
        return true;
      });
      expect(fired).toBe(true);
      const dialog = page.locator("dialog.application").last();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('select[name="campaign"]')).toHaveCount(1);
      await page.keyboard.press("Escape");
      await settle(page, 1000);
      expect(await countSessions()).toBe(n0);
      expect(await openSessions()).toEqual(open0);
      expect(!!(await fallbackCampaignId(page))).toBe(fallbackExistedBefore);
      assertNoConsoleErrors(errors);
    } finally {
      await deleteFoldersById(page, [folderId]);
    }
  });
});
