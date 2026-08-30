// Multiple named timelines e2e (task-4 of the multi-timeline sub-project):
// the Hub's timeline picker (per-campaign timelines + world timelines +
// GM-only creation), default-timeline management (make-default/rename/
// delete), auto-filing targeting the campaign DEFAULT regardless of which
// timeline is currently viewed, world timelines and their cross-campaign
// attachment discipline, and the player seat's read-only/visibility-filtered
// view of all of the above.
//
// Every fixture this file creates is TT_PREFIX-named and torn down in a
// describe-level afterAll (folder cascade delete covers campaign-scoped
// timelines/members; a world timeline and any loose fixtures are deleted by
// id) — World A's real, pre-existing content is never touched. Each test
// also resets BOTH client-scoped Hub settings (campaign scope, timeline
// selection) to "" in its own finally, per the task-4 brief's contract —
// belt-and-suspenders against a fresh Playwright context not already
// guaranteeing this (a new `page`/`browser.newContext()` starts with empty
// localStorage, so these settings default to "" anyway, but a test that
// reuses `page.evaluate` directly against a live GM session, as this suite's
// API-driven scenarios do, could otherwise leave the picker mid-selection
// for whatever runs next in the same context).
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, withGmPage, timelineJournalIds, cleanupTimelineJournals,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MODULE_ID = "mej-campaign-companion";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

const TIMELINE_JOURNAL_MOD = "/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs";
const TIMEPOINTS_MOD = "/modules/mej-campaign-companion/scripts/data/timepoints.mjs";
const CAMPAIGN_STORE_MOD = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const CAMPAIGNS_LOGIC_MOD = "/modules/mej-campaign-companion/scripts/logic/campaigns.mjs";

/** Open any journal entry (bootstraps the MEJ shell), then open the Campaign Hub. Lands on the Index tab. */
async function openHub(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  const anyEntryId = await page.evaluate(() => game.journal.contents[0]?.id);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function gotoTab(shell, page, tab) {
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 200);
}

/** Select the Hub's campaign-scope <select> ("" = All, "unfiled", or a campaign Folder id). */
async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 300);
}

/** Select the Hub's timeline-scope <select> (options: "", timeline ids, "__sep" disabled, GM-only "__newtl"). */
async function selectTimeline(shell, page, value) {
  await shell.locator('select[name="timeline-select"]').selectOption(value);
  await settle(page, 300);
}

/** Reset both client-scoped Hub settings this suite touches. */
async function resetHubState(page) {
  await page.evaluate(async (moduleId) => {
    await game.settings.set(moduleId, "hubCampaignScope", "");
    await game.settings.set(moduleId, "hubTimelineSelection", "");
  }, MODULE_ID);
}

test.describe.serial("16 multi-timeline", () => {
  const CAMPAIGN_NAME = `${TT_PREFIX}MultiTL`;
  const PLAYER_CAMPAIGN_NAME = `${TT_PREFIX}PlayerCamp`;

  // Shared across the serial scenarios (1 -> 5 build directly on each
  // other's fixtures, same pattern as 14-campaigns.spec.mjs).
  let campaignId, tl1Id, tl2Id, worldTlId, playerCampaignId, crossCampaignId;

  // Fix 6 (campaign-store.mjs's createCampaign): seeds AUTO_CAPTURE_CAMPAIGN_SETTING
  // (a world setting) when it's the world's FIRST campaign - true for this
  // suite's own campaignId creation whenever World A currently has zero
  // campaigns. Snapshot in test 1 (before that call), restore in afterAll -
  // same discipline 14-campaigns.spec.mjs uses around its own first-campaign
  // creation, so this suite never leaves a dangling campaign id behind in a
  // world setting after its own campaign folder is deleted below.
  let captureCampaignPrior;

  // Ids of every flagged timeline journal that existed BEFORE this file ran -
  // snapshotted as a GM before test 1 opens a Hub, so afterAll deletes only
  // the timelines this suite itself induced (campaign-owned ones included,
  // which the old name filter never even saw).
  // null, not []: an empty ledger would mean "nothing is protected" if the
  // beforeAll snapshot below never ran (a withGmPage login failure still lets
  // the cleanup hook run). cleanupTimelineJournals refuses to sweep without a
  // real snapshot - see its doc comment.
  let preexistingTimelines = null;

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (p) => { preexistingTimelines = await timelineJournalIds(p); });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (page) => {
      await resetHubState(page);
      const ids = [campaignId, playerCampaignId, crossCampaignId].filter(Boolean);
      for (const id of ids) {
        const gone = await page.evaluate(async (fid) => {
          const f = game.folders.get(fid);
          if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
          return true;
        }, id);
        void gone;
      }
      if (worldTlId) {
        await page.evaluate(async (id) => {
          const j = game.journal.get(id);
          if (j) await JournalEntry.implementation.deleteDocuments([id]);
        }, worldTlId);
      }
      // Any other loose TT- fixtures this suite created directly (the
      // world-timeline-link scenario's campaign member).
      await page.evaluate(async (prefix) => {
        const loose = game.journal.filter((j) => !j.folder && j.name.startsWith(prefix));
        if (loose.length) await JournalEntry.implementation.deleteDocuments(loose.map((j) => j.id));
      }, TT_PREFIX);
      if (captureCampaignPrior !== undefined) {
        await page.evaluate(async (prior) => {
          await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior);
        }, captureCampaignPrior);
      }
      // Every GM Hub open in this suite (openHub()'s own render, regardless
      // of tab) preps timeline context unconditionally - in a zero-campaign
      // world (true before test 1's campaignId exists, and again after
      // afterAll's own folder deletes above run) that lazily creates/touches
      // the legacy singleton "Campaign Timeline" journal via
      // ensureTimelineJournal() (see 02-hub-timeline.spec.mjs's and
      // 14-campaigns.spec.mjs's own header comments for the same mechanism).
      // cleanupTimelineJournals() only ever removes a FLAGGED timeline that
      // appeared after this file's own snapshot and whose timepoints are
      // empty/TT-prefixed - never World A's real legacy content.
      await cleanupTimelineJournals(page, preexistingTimelines);
    });
  });

  test("1. second timeline in a campaign: picker switches panes", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    try {
      await login(page, "Gamemaster");
      captureCampaignPrior = await page.evaluate(() => game.settings.get("mej-campaign-companion", "autoCaptureCampaign"));

      campaignId = await page.evaluate(async ({ mod, name }) => {
        const { createCampaign } = await import(mod);
        const c = await createCampaign(name, { ownershipDefault: "observer" });
        return c.id;
      }, { mod: CAMPAIGN_STORE_MOD, name: CAMPAIGN_NAME });
      expect(campaignId).toBeTruthy();

      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTab(shell, page, "timeline");

      // Timeline #1 is created lazily the moment a GM scopes to the
      // campaign (CampaignHubPage's own #prepareBodyContext).
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);
      tl1Id = await shell.locator(".mej-cc-timeline-stack").first().getAttribute("data-journal-id");
      expect(tl1Id).toBeTruthy();

      await shell.locator("button.mej-cc-add-timepoint").click();
      const tpDialog = page.locator("dialog.application").last();
      await tpDialog.locator('input[name="label"]').fill(`${TT_PREFIX}TP-One`);
      await tpDialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);
      await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}TP-One` })).toHaveCount(1);

      // Picker -> "__newtl" -> name "TT-Second" -> created and selected.
      await shell.locator('select[name="timeline-select"]').selectOption("__newtl");
      const newDialog = page.locator("dialog.application").last();
      await newDialog.locator('input[name="name"]').fill(`${TT_PREFIX}Second`);
      await newDialog.locator('button[data-action="ok"]').click();
      await settle(page, 500);

      tl2Id = await shell.locator('select[name="timeline-select"]').inputValue();
      expect(tl2Id).toBeTruthy();
      expect(tl2Id).not.toBe(tl1Id);

      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveAttribute("data-journal-id", tl2Id);
      await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}TP-One` })).toHaveCount(0);

      // Switch back to the first timeline: TT-TP-One is visible again.
      await selectTimeline(shell, page, tl1Id);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveAttribute("data-journal-id", tl1Id);
      await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}TP-One` })).toHaveCount(1);

      // Extra assertion (a): an explicit pick outranks Unfiled's own empty
      // default (regression pinned from Task 3 review) - switching campaign
      // scope to Unfiled with tl1 still explicitly selected must keep
      // rendering tl1's stack, not go blank. Final-review Finding 1: the
      // PICKER must agree with the pane, not just render its content - a
      // <select> with no `selected:true` option silently paints its first
      // option ("All timelines in scope"), which is exactly the
      // picker/pane contradiction this ruling exists to prevent. Assert
      // the select's own displayed value, not just the rendered stack.
      await scopeHub(shell, page, "unfiled");
      await gotoTab(shell, page, "timeline");
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveAttribute("data-journal-id", tl1Id);
      await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}TP-One` })).toHaveCount(1);
      await expect(shell.locator('select[name="timeline-select"]')).toHaveValue(tl1Id);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
    }
  });

  test("2. auto-filing targets the default, not the viewed timeline", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    try {
      await login(page, "Gamemaster");
      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTab(shell, page, "timeline");
      await selectTimeline(shell, page, tl2Id); // TT-Second is the viewed timeline

      const filedJournalId = await page.evaluate(async ({ tlMod, tpMod, campaignId, label }) => {
        const { ensureTimelineJournal } = await import(tlMod);
        const { addTimepoint } = await import(tpMod);
        const folder = game.folders.get(campaignId);
        const j = await ensureTimelineJournal(folder);
        await addTimepoint(j, label);
        return j.id;
      }, { tlMod: TIMELINE_JOURNAL_MOD, tpMod: TIMEPOINTS_MOD, campaignId, label: `${TT_PREFIX}Filed` });

      // ensureTimelineJournal() resolves the campaign DEFAULT (tl1), not the
      // currently-viewed timeline (tl2) - proven both by the returned
      // journal id and by reading each journal's own timepoint labels.
      expect(filedJournalId).toBe(tl1Id);

      const labels = await page.evaluate(({ tpMod, tl1Id, tl2Id }) => {
        return import(tpMod).then(({ getTimepoints }) => ({
          onTl1: getTimepoints(game.journal.get(tl1Id)).some((t) => t.label.includes("TT-Filed")),
          onTl2: getTimepoints(game.journal.get(tl2Id)).some((t) => t.label.includes("TT-Filed"))
        }));
      }, { tpMod: TIMEPOINTS_MOD, tl1Id, tl2Id });
      expect(labels.onTl1).toBe(true);
      expect(labels.onTl2).toBe(false);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
    }
  });

  test("3. Make default changes where filing lands", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    try {
      await login(page, "Gamemaster");
      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTab(shell, page, "timeline");
      await selectTimeline(shell, page, tl2Id);

      await shell.locator("button.mej-cc-timeline-default").click();
      await settle(page, 400);

      const defaultId = await page.evaluate((campaignId) => {
        const f = game.folders.get(campaignId);
        return f.flags?.["mej-campaign-companion"]?.campaign?.defaultTimelineId ?? null;
      }, campaignId);
      expect(defaultId).toBe(tl2Id);

      const filedJournalId = await page.evaluate(async ({ tlMod, tpMod, campaignId, label }) => {
        const { ensureTimelineJournal } = await import(tlMod);
        const { addTimepoint } = await import(tpMod);
        const folder = game.folders.get(campaignId);
        const j = await ensureTimelineJournal(folder);
        await addTimepoint(j, label);
        return j.id;
      }, { tlMod: TIMELINE_JOURNAL_MOD, tpMod: TIMEPOINTS_MOD, campaignId, label: `${TT_PREFIX}Filed2` });
      expect(filedJournalId).toBe(tl2Id);

      const onTl2 = await page.evaluate(({ tpMod, tl2Id }) => {
        return import(tpMod).then(({ getTimepoints }) =>
          getTimepoints(game.journal.get(tl2Id)).some((t) => t.label.includes("TT-Filed2")));
      }, { tpMod: TIMEPOINTS_MOD, tl2Id });
      expect(onTl2).toBe(true);

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
    }
  });

  test("4. world timeline: appears in All and accepts a campaign entry's link", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    let memberId = null;
    let otherCampaignId = null;
    try {
      await login(page, "Gamemaster");
      const shell = await openHub(page);
      await scopeHub(shell, page, ""); // All, no campaign scoped
      await gotoTab(shell, page, "timeline");

      await shell.locator('select[name="timeline-select"]').selectOption("__newtl");
      const newDialog = page.locator("dialog.application").last();
      await newDialog.locator('input[name="name"]').fill(`${TT_PREFIX}World`);
      await newDialog.locator('button[data-action="ok"]').click();
      await settle(page, 500);

      worldTlId = await shell.locator('select[name="timeline-select"]').inputValue();
      expect(worldTlId).toBeTruthy();

      const folderId = await page.evaluate((id) => game.journal.get(id)?.folder?.id ?? null, worldTlId);
      expect(folderId).toBeNull();

      // Add a timepoint to attach the link to.
      await shell.locator("button.mej-cc-add-timepoint").click();
      const tpDialog = page.locator("dialog.application").last();
      await tpDialog.locator('input[name="label"]').fill(`${TT_PREFIX}World Point`);
      await tpDialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);

      // In All scope with picker "" it appears as its own stack.
      await selectTimeline(shell, page, "");
      const worldStack = shell.locator(`.mej-cc-timeline-stack[data-journal-id="${worldTlId}"]`);
      await expect(worldStack).toHaveCount(1);

      const result = await page.evaluate(async ({ campaignsMod, tpMod, storeMod, tlMod, campaignId, worldTlId, prefix }) => {
        const { canAttachToTimeline } = await import(campaignsMod);
        const { addLink } = await import(tpMod);
        const { createCampaign } = await import(storeMod);
        const { ensureTimelineJournal } = await import(tlMod);

        const member = await JournalEntry.create({
          name: `${prefix}World Link Member`,
          folder: campaignId,
          pages: [{
            name: `${prefix}World Link Member`, type: "monks-enhanced-journal.person",
            flags: { "monks-enhanced-journal": { type: "person" } }
          }]
        });

        const worldJournal = game.journal.get(worldTlId);
        const tp = (worldJournal.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? [])[0];
        const canAttachToWorld = canAttachToTimeline(member, worldJournal);

        const other = await createCampaign(`${prefix}OtherCamp`, { ownershipDefault: "observer" });
        const otherTimeline = await ensureTimelineJournal(other);
        const canAttachToOther = canAttachToTimeline(member, otherTimeline);

        let linked = null;
        if (tp) linked = await addLink(worldJournal, tp.id, { uuid: member.uuid, name: member.name });

        return {
          memberId: member.id, memberUuid: member.uuid,
          otherCampaignId: other.id,
          canAttachToWorld, canAttachToOther,
          linked: !!linked
        };
      }, {
        campaignsMod: CAMPAIGNS_LOGIC_MOD, tpMod: TIMEPOINTS_MOD, storeMod: CAMPAIGN_STORE_MOD, tlMod: TIMELINE_JOURNAL_MOD,
        campaignId, worldTlId, prefix: TT_PREFIX
      });
      memberId = result.memberId;
      otherCampaignId = result.otherCampaignId;

      // The discipline that must survive: attach ok against the world
      // timeline (no campaign of its own), refused against another
      // campaign's timeline.
      expect(result.canAttachToWorld).toBe(true);
      expect(result.canAttachToOther).toBe(false);
      expect(result.linked).toBe(true);

      await selectTimeline(shell, page, worldTlId);
      await expect(shell.locator(`.mej-cc-link-chip[data-uuid="${result.memberUuid}"]`)).toHaveCount(1);

      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async ({ memberId, otherCampaignId }) => {
        if (memberId && game.journal.get(memberId)) await JournalEntry.implementation.deleteDocuments([memberId]);
        if (otherCampaignId) {
          const f = game.folders.get(otherCampaignId);
          if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
        }
      }, { memberId, otherCampaignId });
      await resetHubState(page);
    }
  });

  test("5. rename and delete", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    try {
      await login(page, "Gamemaster");
      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTab(shell, page, "timeline");
      await selectTimeline(shell, page, tl2Id);

      // L1 (spec Group L): .mej-cc-timeline-controls had no rule at all, so it
      // stayed display:block and the picker, Make default, rename and delete
      // each took their own line. Every sibling control row in the stylesheet
      // (.mej-cc-index-controls, .mej-cc-graph-controls, .mej-cc-secrets-controls)
      // is a flex row; this one was simply never given one.
      const selectBox = await shell.locator("select.mej-cc-timeline-select").boundingBox();
      const renameBox = await shell.locator("button.mej-cc-timeline-rename").boundingBox();
      const centre = (b) => b.y + b.height / 2;
      expect(Math.abs(centre(selectBox) - centre(renameBox))).toBeLessThan(6);

      // The other two declarations in that block, which the row-centre check
      // above cannot see. `.mej-cc-timeline-select {flex:1 1 auto; min-width:0}`
      // is what makes the picker absorb the row's slack: without it the select
      // is content-width and the buttons stop well short of the row's right
      // edge. `button {flex:0 0 auto}` is what keeps them from being squeezed
      // by it - so every button stays on the one row and none is narrower than
      // its own content.
      const rowBox = await shell.locator(".mej-cc-timeline-controls").boundingBox();
      const btnBoxes = await shell.locator(".mej-cc-timeline-controls button").evaluateAll(
        (els) => els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, scrollW: el.scrollWidth, clientW: el.clientWidth };
        }));
      expect(btnBoxes.length).toBeGreaterThan(1);
      for (const b of btnBoxes) {
        expect(Math.abs((b.y + b.h / 2) - centre(selectBox))).toBeLessThan(6);
        // Not shrunk below its own content (flex-shrink: 0).
        expect(b.scrollW - b.clientW).toBeLessThanOrEqual(1);
      }
      // The last button ends flush with the row: only true when the select grew.
      const lastBtn = btnBoxes.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
      expect(rowBox.x + rowBox.width - (lastBtn.x + lastBtn.w)).toBeLessThan(2);

      await shell.locator("button.mej-cc-timeline-rename").click();
      const renameDialog = page.locator("dialog.application").last();
      await renameDialog.locator('input[name="name"]').fill(`${TT_PREFIX}Renamed`);
      await renameDialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);
      await expect(shell.locator(`select[name="timeline-select"] option[value="${tl2Id}"]`)).toContainText(`${TT_PREFIX}Renamed`);

      const countBefore = await page.evaluate((id) => {
        const j = game.journal.get(id);
        return (j.getFlag("mej-campaign-companion", "timeline")?.timepoints ?? []).length;
      }, tl2Id);
      expect(countBefore).toBeGreaterThan(0); // scenario 3 filed TT-Filed2 onto it

      await shell.locator("button.mej-cc-timeline-delete").click();
      const confirmDialog = page.locator("dialog.application").last();
      await expect(confirmDialog).toContainText(String(countBefore));
      await confirmDialog.locator('button[data-action="yes"]').click();
      await settle(page, 500);

      const stillExists = await page.evaluate((id) => !!game.journal.get(id), tl2Id);
      expect(stillExists).toBe(false);
      await expect(shell.locator(`select[name="timeline-select"] option[value="${tl2Id}"]`)).toHaveCount(0);
      await expect(shell.locator('select[name="timeline-select"]')).toHaveValue("");

      assertNoConsoleErrors(errors);
    } finally {
      await resetHubState(page);
    }
  });

  test("6. cross-campaign pick survives a scope switch; management acts on the picked timeline's own campaign", async ({ page }) => {
    // Final-review Finding 1: HUB_STATE.timelineId is a GLOBAL pointer, but
    // the picker's option list and the management gating are SCOPE-LOCAL.
    // Pick a timeline in campaign A, switch scope to a second campaign B
    // (never touching the pick), and assert both halves of the fix: the
    // <select> still displays the A pick (not "All timelines in scope"),
    // and Make default / Delete still act on A's own campaign flag - never
    // silently on B's.
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    let tl3Id = null;
    try {
      await login(page, "Gamemaster");

      crossCampaignId = await page.evaluate(async ({ mod, name }) => {
        const { createCampaign } = await import(mod);
        const c = await createCampaign(name, { ownershipDefault: "observer" });
        return c.id;
      }, { mod: CAMPAIGN_STORE_MOD, name: `${TT_PREFIX}CrossCamp` });
      expect(crossCampaignId).toBeTruthy();

      const shell = await openHub(page);
      await scopeHub(shell, page, campaignId);
      await gotoTab(shell, page, "timeline");

      // A second timeline in campaign A, not yet its default (tl1 - the
      // sole survivor of scenario 5's delete - still resolves as the
      // fallback default at this point).
      await shell.locator('select[name="timeline-select"]').selectOption("__newtl");
      const newDialog = page.locator("dialog.application").last();
      await newDialog.locator('input[name="name"]').fill(`${TT_PREFIX}Cross3`);
      await newDialog.locator('button[data-action="ok"]').click();
      await settle(page, 500);
      tl3Id = await shell.locator('select[name="timeline-select"]').inputValue();
      expect(tl3Id).toBeTruthy();
      expect(tl3Id).not.toBe(tl1Id);

      // Switch scope to campaign B. The pick (tl3, campaign A's timeline)
      // is neither in B's option list nor visible in the world group -
      // per the fix it must still be the select's displayed value.
      await scopeHub(shell, page, crossCampaignId);
      await gotoTab(shell, page, "timeline");
      await expect(shell.locator('select[name="timeline-select"]')).toHaveValue(tl3Id);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);
      await expect(shell.locator(".mej-cc-timeline-stack")).toHaveAttribute("data-journal-id", tl3Id);

      // Management trio still renders (GM, and the pick resolves to a real
      // timeline entry) - "Make default" included, since tl3 isn't yet A's default.
      await expect(shell.locator("button.mej-cc-timeline-default")).toHaveCount(1);
      await expect(shell.locator("button.mej-cc-timeline-rename")).toHaveCount(1);
      await expect(shell.locator("button.mej-cc-timeline-delete")).toHaveCount(1);

      await shell.locator("button.mej-cc-timeline-default").click();
      await settle(page, 400);

      const flags = await page.evaluate(({ campaignId, crossCampaignId }) => {
        const a = game.folders.get(campaignId);
        const b = game.folders.get(crossCampaignId);
        return {
          aDefault: a.flags?.["mej-campaign-companion"]?.campaign?.defaultTimelineId ?? null,
          bDefault: b.flags?.["mej-campaign-companion"]?.campaign?.defaultTimelineId ?? null
        };
      }, { campaignId, crossCampaignId });
      // Acts on the picked timeline's OWN campaign (A) ...
      expect(flags.aDefault).toBe(tl3Id);
      // ... and never silently writes a foreign id into the scoped campaign (B).
      expect(flags.bDefault).not.toBe(tl3Id);
      expect(flags.bDefault).toBeFalsy();

      // Still scoped to B: "Make default" is now hidden (tl3 IS A's
      // default), but Delete remains and still targets A's timeline.
      await expect(shell.locator("button.mej-cc-timeline-default")).toHaveCount(0);
      await shell.locator("button.mej-cc-timeline-delete").click();
      const confirmDialog = page.locator("dialog.application").last();
      await confirmDialog.locator('button[data-action="yes"]').click();
      await settle(page, 500);

      const tl3Gone = await page.evaluate((id) => !game.journal.get(id), tl3Id);
      expect(tl3Gone).toBe(true);
      const tl1Untouched = await page.evaluate((id) => !!game.journal.get(id), tl1Id);
      expect(tl1Untouched).toBe(true); // campaign A's other timeline, unaffected

      // The raw flag still names the now-deleted tl3 (delete never clears
      // it, same as any other stale-default case) - but resolution falls
      // back to A's one remaining timeline, restoring the state scenario
      // 2/3 relied on for anything that re-reads it after this test.
      const resolvedDefaultId = await page.evaluate(async ({ mod, campaignId }) => {
        const { defaultTimeline } = await import(mod);
        return defaultTimeline(game.folders.get(campaignId))?.id ?? null;
      }, { mod: TIMELINE_JOURNAL_MOD, campaignId });
      expect(resolvedDefaultId).toBe(tl1Id);

      assertNoConsoleErrors(errors);
    } finally {
      if (crossCampaignId) {
        await page.evaluate(async (fid) => {
          const f = game.folders.get(fid);
          if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
        }, crossCampaignId);
        crossCampaignId = null;
      }
      await resetHubState(page);
    }
  });

  test("7. player seat: only observable timelines, no management controls", async ({ browser }) => {
    let visibleId, hiddenId;
    try {
      await withGmPage(browser, async (gmPage) => {
        const ids = await gmPage.evaluate(async ({ storeMod, tlMod, prefix }) => {
          const { createCampaign } = await import(storeMod);
          const { setDefaultTimeline } = await import(tlMod);
          const camp = await createCampaign(`${prefix}PlayerCamp`, { ownershipDefault: "observer" });
          const visible = await JournalEntry.create({
            name: `${prefix}Visible TL`, folder: camp.id,
            flags: { "mej-campaign-companion": { timeline: { timepoints: [] } } },
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
          });
          const hidden = await JournalEntry.create({
            name: `${prefix}Hidden TL`, folder: camp.id,
            flags: { "mej-campaign-companion": { timeline: { timepoints: [] } } },
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
          });
          await setDefaultTimeline(camp, visible.id);
          return { campaignId: camp.id, visibleId: visible.id, hiddenId: hidden.id };
        }, { storeMod: CAMPAIGN_STORE_MOD, tlMod: TIMELINE_JOURNAL_MOD, prefix: TT_PREFIX });
        playerCampaignId = ids.campaignId;
        visibleId = ids.visibleId;
        hiddenId = ids.hiddenId;
      });

      const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
      const playerPage = await playerContext.newPage();
      const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
      try {
        await login(playerPage, "User 1");
        const shell = await openHub(playerPage);
        await scopeHub(shell, playerPage, playerCampaignId);
        await gotoTab(shell, playerPage, "timeline");

        await expect(shell.locator(`select[name="timeline-select"] option[value="${visibleId}"]`)).toHaveCount(1);
        await expect(shell.locator(`select[name="timeline-select"] option[value="${hiddenId}"]`)).toHaveCount(0);
        await expect(shell.locator("button.mej-cc-timeline-default")).toHaveCount(0);
        await expect(shell.locator("button.mej-cc-timeline-rename")).toHaveCount(0);
        await expect(shell.locator("button.mej-cc-timeline-delete")).toHaveCount(0);

        // Extra assertion (b): the picker's "★"-marked default and the
        // campaign's stack shown in All scope must agree - the Hub never
        // shows a player a different default than auto-filing targets.
        const starredOption = shell.locator('select[name="timeline-select"] option', { hasText: "★" });
        await expect(starredOption).toHaveCount(1);
        const starredValue = await starredOption.getAttribute("value");
        expect(starredValue).toBe(visibleId);

        await scopeHub(shell, playerPage, "");
        await gotoTab(shell, playerPage, "timeline");
        const campStack = shell.locator(".mej-cc-timeline-stack", { hasText: `${TT_PREFIX}PlayerCamp` });
        await expect(campStack).toHaveCount(1);
        await expect(campStack).toHaveAttribute("data-journal-id", visibleId);

        assertNoConsoleErrors(errors);
      } finally {
        await resetHubState(playerPage);
        await playerContext.close();
      }
    } finally {
      await withGmPage(browser, async (gmPage) => { await resetHubState(gmPage); });
    }
  });

  test("8. Finding 2: a GM-only default timeline never renders its timepoint labels to a player in All scope", async ({ browser }) => {
    // #timelineContext has no visibility check of its own (defaultTimeline()
    // resolves unfiltered by design - it's the single source of truth
    // auto-filing and the picker's ★ share) - the guard has to be applied
    // at the render seam (#visibleTimeline), for every branch that stacks a
    // campaign's default in All scope. Reuses scenario 7's playerCampaignId
    // (still exists; deleted in afterAll), re-pointing its default at a
    // brand-new NONE-ownership timeline so it's the DEFAULT that's hidden,
    // not merely a non-default timeline (scenario 7's own `hiddenId`).
    let hiddenDefaultId = null;
    try {
      await withGmPage(browser, async (gmPage) => {
        hiddenDefaultId = await gmPage.evaluate(async ({ tpMod, tlMod, campaignId, prefix }) => {
          const { addTimepoint } = await import(tpMod);
          const { setDefaultTimeline } = await import(tlMod);
          const camp = game.folders.get(campaignId);
          const hiddenDefault = await JournalEntry.create({
            name: `${prefix}HiddenDefault TL`, folder: camp.id,
            flags: { "mej-campaign-companion": { timeline: { timepoints: [] } } },
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
          });
          await addTimepoint(hiddenDefault, `${prefix}SecretPoint`);
          await setDefaultTimeline(camp, hiddenDefault.id);
          return hiddenDefault.id;
        }, { tpMod: TIMEPOINTS_MOD, tlMod: TIMELINE_JOURNAL_MOD, campaignId: playerCampaignId, prefix: TT_PREFIX });
      });
      expect(hiddenDefaultId).toBeTruthy();

      const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
      const playerPage = await playerContext.newPage();
      const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
      try {
        await login(playerPage, "User 1");
        const shell = await openHub(playerPage);
        await scopeHub(shell, playerPage, ""); // All scope
        await gotoTab(shell, playerPage, "timeline");

        // The campaign's stack still renders (no crash), but the
        // now-invisible default resolves to an empty pane, not a leak.
        const campStack = shell.locator(".mej-cc-timeline-stack", { hasText: `${TT_PREFIX}PlayerCamp` });
        await expect(campStack).toHaveCount(1);
        await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}SecretPoint` })).toHaveCount(0);
        await expect(shell.locator(`text=${TT_PREFIX}SecretPoint`)).toHaveCount(0);

        assertNoConsoleErrors(errors);
      } finally {
        await resetHubState(playerPage);
        await playerContext.close();
      }
    } finally {
      await withGmPage(browser, async (gmPage) => {
        if (hiddenDefaultId) {
          await gmPage.evaluate(async (id) => {
            const j = game.journal.get(id);
            if (j) await JournalEntry.implementation.deleteDocuments([id]);
          }, hiddenDefaultId);
        }
        await resetHubState(gmPage);
      });
    }
  });
});
