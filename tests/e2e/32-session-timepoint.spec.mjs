// Session -> timepoint e2e (spec 2026-10-09 session-timepoint-encounter-start §1-2):
// creating a Session page adds a timepoint to its campaign's default timeline
// (label = page name, campaignDate = the session's date or the world date,
// the session linked on the timepoint, ids stored on the session flag);
// renaming / re-dating the page syncs the timepoint; autoTimepoint=false opts
// out; and the Hub's Add Timepoint button works for a GM in an empty timeline
// and when a campaign has no timeline journal yet.
//
// Everything is TT--prefixed and lives in TT- campaigns torn down by folder id.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, withGmPage, timelineJournalIds, cleanupTimelineJournals,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MODULE_ID = "mej-campaign-companion";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const CAMPAIGN_STORE_MOD = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const TIMELINE_JOURNAL_MOD = "/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs";
const RUN = Date.now();

let preexistingTimelines = null;
let captureCampaignPrior;
const campaignIds = [];

async function newCampaign(page, label) {
  const id = await page.evaluate(async ({ mod, name }) => {
    const { createCampaign } = await import(mod);
    return (await createCampaign(name, { ownershipDefault: "observer" })).id;
  }, { mod: CAMPAIGN_STORE_MOD, name: `${TT_PREFIX}SessTP-${label}-${RUN}` });
  campaignIds.push(id);
  return id;
}

/** Default timeline journal id + its timepoints for a campaign. */
async function timelineOf(page, campaignId) {
  return page.evaluate(async ({ mod, campaignId }) => {
    const { ensureTimelineJournal } = await import(mod);
    const j = await ensureTimelineJournal(game.folders.get(campaignId));
    return { id: j.id, timepoints: j.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? [] };
  }, { mod: TIMELINE_JOURNAL_MOD, campaignId });
}

/** Create a TT- Session entry in a campaign; returns {entryId, pageId, uuid}. */
async function createSession(page, campaignId, name, sessionFlag = null) {
  return page.evaluate(async ({ campaignId, name, sessionFlag }) => {
    const flags = { "monks-enhanced-journal": { type: "session" } };
    if (sessionFlag) flags["mej-campaign-companion"] = { session: sessionFlag };
    const e = await JournalEntry.create({
      name, folder: campaignId, ownership: { default: 2 },
      pages: [{ name, type: "mej-campaign-companion.session", flags }]
    });
    const p = e.pages.contents[0];
    return { entryId: e.id, pageId: p.id, uuid: p.uuid };
  }, { campaignId, name, sessionFlag });
}

const sessionFlagOf = (page, uuid) =>
  page.evaluate((u) => fromUuidSync(u)?.getFlag("mej-campaign-companion", "session") ?? null, uuid);

/** Wait until the session page has been linked to a timepoint; returns the session flag. */
async function waitLinked(page, uuid) {
  await expect.poll(async () => (await sessionFlagOf(page, uuid))?.timepointId ?? null, { timeout: 15_000 }).toBeTruthy();
  return sessionFlagOf(page, uuid);
}

async function openHub(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  const anyEntryId = await page.evaluate(
    () => game.journal.contents.find((e) => !e.getFlag("mej-campaign-companion", "timeline"))?.id
  );
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 300);
}

async function gotoTimelineTab(shell, page) {
  await shell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
  await settle(page, 200);
}

test.describe.serial("32 session timepoint", () => {
  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (p) => {
      preexistingTimelines = await timelineJournalIds(p);
      captureCampaignPrior = await p.evaluate(() => game.settings.get("mej-campaign-companion", "autoCaptureCampaign"));
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (page) => {
      await page.evaluate(async ({ ids, prior }) => {
        try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
        await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
        await game.settings.set("mej-campaign-companion", "hubTimelineSelection", "");
        for (const id of ids) {
          const f = game.folders.get(id);
          if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
        }
        await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior);
      }, { ids: campaignIds, prior: captureCampaignPrior ?? "" });
      await cleanupTimelineJournals(page, preexistingTimelines);
    });
  });

  test("creating a session adds a timepoint with the session's date, linked both ways", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "Create");
    const date = { year: 1492, month: 2, day: 14, hour: 19, minute: 30 };
    const name = `${TT_PREFIX}Session Dated ${RUN}`;
    const s = await createSession(page, campaignId, name, { sessionNumber: 1, campaignDate: date });

    const flag = await waitLinked(page, s.uuid);
    const tl = await timelineOf(page, campaignId);
    expect(flag.timelineId).toBe(tl.id);
    const tp = tl.timepoints.find((t) => t.id === flag.timepointId);
    expect(tp).toBeTruthy();
    expect(tp.label).toBe(name);
    expect(tp.campaignDate).toEqual(date);
    expect(tp.links.some((l) => l.uuid === s.uuid && l.type === "JournalEntryPage")).toBe(true);
    expect(tl.timepoints.filter((t) => t.label === name).length).toBe(1);
    // The session keeps its own date.
    expect(flag.campaignDate).toEqual(date);
    assertNoConsoleErrors(errors);
  });

  test("a session without a date is stamped with the world date, on the timepoint and the session", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "NoDate");
    const worldDate = await page.evaluate(async () => {
      const { currentWorldComponents } = await import("/modules/mej-campaign-companion/scripts/logic/campaign-calendar.mjs");
      return currentWorldComponents();
    });
    const name = `${TT_PREFIX}Session Undated ${RUN}`;
    const s = await createSession(page, campaignId, name);

    const flag = await waitLinked(page, s.uuid);
    const tl = await timelineOf(page, campaignId);
    const tp = tl.timepoints.find((t) => t.id === flag.timepointId);
    expect(tp.label).toBe(name);
    // With a calendar both carry the world date; without one both stay null.
    expect(tp.campaignDate ?? null).toEqual(worldDate);
    expect(flag.campaignDate ?? null).toEqual(worldDate);
    assertNoConsoleErrors(errors);
  });

  test("renaming the page and editing its campaignDate updates the timepoint", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "Sync");
    const name = `${TT_PREFIX}Session Sync ${RUN}`;
    const s = await createSession(page, campaignId, name, { campaignDate: { year: 1500, month: 0, day: 1, hour: 0, minute: 0 } });
    const flag = await waitLinked(page, s.uuid);
    const tpOf = async () => (await timelineOf(page, campaignId)).timepoints.find((t) => t.id === flag.timepointId);

    const renamed = `${TT_PREFIX}Session Renamed ${RUN}`;
    await page.evaluate(({ uuid, renamed }) => fromUuidSync(uuid).update({ name: renamed }), { uuid: s.uuid, renamed });
    await expect.poll(async () => (await tpOf())?.label, { timeout: 15_000 }).toBe(renamed);

    const newDate = { year: 1501, month: 5, day: 9, hour: 8, minute: 15 };
    await page.evaluate(({ uuid, newDate }) =>
      fromUuidSync(uuid).update({ "flags.mej-campaign-companion.session.campaignDate": newDate }), { uuid: s.uuid, newDate });
    await expect.poll(async () => (await tpOf())?.campaignDate, { timeout: 15_000 }).toEqual(newDate);

    // Still one timepoint for this session (sync never recreates or duplicates).
    const tl = await timelineOf(page, campaignId);
    expect(tl.timepoints.length).toBe(1);
    assertNoConsoleErrors(errors);
  });

  test("autoTimepoint=false opts a session out of getting a timepoint", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "OptOut");
    const s = await createSession(page, campaignId, `${TT_PREFIX}Session OptOut ${RUN}`, { autoTimepoint: false });
    await settle(page, 2000);
    const flag = await sessionFlagOf(page, s.uuid);
    expect(flag?.timepointId ?? null).toBeNull();
    const tl = await timelineOf(page, campaignId);
    expect(tl.timepoints).toEqual([]);
    assertNoConsoleErrors(errors);
  });

  test("Hub Timeline: GM can add a timepoint to a campaign timeline that has none", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "HubEmpty");
    const label = `${TT_PREFIX}Hub TP ${RUN}`;
    try {
      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTimelineTab(shell, page);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);
      await expect(shell.locator("li.mej-cc-timepoint")).toHaveCount(0);
      const add = shell.locator("button.mej-cc-add-timepoint");
      await expect(add).toHaveCount(1);
      await add.click();
      const dlg = page.locator("dialog.application").last();
      await dlg.locator('input[name="label"]').fill(label);
      await dlg.locator('button[data-action="ok"]').click();
      await settle(page, 500);
      await expect(shell.locator("li.mej-cc-timepoint", { hasText: label })).toHaveCount(1);
      const tl = await timelineOf(page, campaignId);
      expect(tl.timepoints.map((t) => t.label)).toEqual([label]);
    } finally {
      await page.evaluate(async () => {
        await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
        try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
      });
    }
    assertNoConsoleErrors(errors);
  });

  test("Hub Timeline (All scope): a campaign with no timeline journal shows Add Timepoint, which creates that campaign's timeline", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignId = await newCampaign(page, "NoTimeline");
    const campaignName = await page.evaluate((id) => game.folders.get(id).name, campaignId);
    const label = `${TT_PREFIX}Hub TP NoTL ${RUN}`;
    try {
      // Remove this TT- campaign's own timeline journal so the All-scope Hub
      // (which never lazily creates timelines) renders the "not created yet"
      // stack for it. Only journals flagged as timelines inside THIS TT- folder.
      await page.evaluate(async (id) => {
        const ids = game.journal.filter((j) => j.folder?.id === id && j.getFlag("mej-campaign-companion", "timeline")).map((j) => j.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      }, campaignId);

      const shell = await openHub(page);
      await scopeHub(shell, page, "");
      await gotoTimelineTab(shell, page);
      const stack = shell.locator(".mej-cc-timeline-stack", { has: page.locator(`h3:text-is("${campaignName}")`) });
      await expect(stack).toHaveCount(1);
      const add = stack.locator("button.mej-cc-add-timepoint");
      await expect(add).toHaveCount(1);
      // All scope stacks every campaign; other stacks' sticky headings can
      // cover the button, so dispatch the click rather than hit-test it.
      await add.dispatchEvent("click");
      const dlg = page.locator("dialog.application").last();
      await dlg.locator('input[name="label"]').fill(label);
      await dlg.locator('button[data-action="ok"]').click();
      await settle(page, 700);

      const result = await page.evaluate((id) => {
        const tl = game.journal.filter((j) => j.folder?.id === id && j.getFlag("mej-campaign-companion", "timeline"));
        return tl.map((j) => j.getFlag("mej-campaign-companion", "timeline").timepoints.map((t) => t.label));
      }, campaignId);
      expect(result).toEqual([[label]]);
    } finally {
      await page.evaluate(async () => {
        try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
      });
    }
    assertNoConsoleErrors(errors);
  });
});
