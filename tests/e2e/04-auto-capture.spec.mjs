import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, withGmPage, timelineJournalIds, cleanupTimelineJournals,
  trackConsoleErrors, assertNoConsoleErrors, settle
} from "./helpers/foundry.mjs";

// Headless-canvas noise, not a companion bug: creating Tokens/a Combat makes
// Foundry's own combat tracker sidebar attempt a placeable-preview render
// regardless of whether any scene is "active" — the canvas layer isn't
// initialized in this harness (no scene is ever viewed), so PIXI's own
// container code throws "Cannot read properties of undefined (reading
// 'addChild')". Confirmed unrelated to auto-capture's own logic (the
// Encounter entry/merged rows/timepoint link all land correctly regardless).
const CANVAS_NOISE = /addChild/;

async function enableSetting(page, key, value) {
  await page.evaluate(async ({ key, value }) => {
    await game.settings.set("mej-campaign-companion", key, value);
  }, { key, value });
}

/**
 * Install a capture target this file OWNS, and prove auto-capture will
 * actually use it before any capture is triggered.
 *
 * hooks/auto-capture.mjs's fileOntoNewestTimepoint() resolves its destination
 * as captureCampaign() -> ensureTimelineJournal(campaign) ->
 * pickNewestTimepoint(). In a world that HOLDS campaigns that is always a
 * campaign timeline: a null target makes it "decline silently for media", and
 * the world singleton this file used to aim at is unreachable. So whatever
 * AUTO_CAPTURE_CAMPAIGN_SETTING happens to name receives the capture - in
 * World A a real, user-owned campaign. This file used to seed the world
 * singleton and then assert against it, which is how its fixtures ended up
 * filed onto someone else's timeline.
 *
 * So: create a TT- campaign, point the setting at it, ensure ITS default
 * timeline, and give that timeline the one timepoint captures will land on.
 * A campaign (not a bare timeline) is the target because that is the only
 * shape captureCampaign() accepts - it is auto-capture's real resolution with
 * the fewest moving parts.
 */
async function installCaptureTarget(page, { withTimepoint = true } = {}) {
  const target = await page.evaluate(async ({ prefix, withTimepoint }) => {
    const MODULE_ID = "mej-campaign-companion";
    const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const { ensureTimelineJournal } = await import("/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs");
    const { isCampaignFolder } = await import("/modules/mej-campaign-companion/scripts/logic/campaigns.mjs");
    const { pickNewestTimepoint } = await import("/modules/mej-campaign-companion/scripts/logic/auto-capture.mjs");
    const Timepoints = await import("/modules/mej-campaign-companion/scripts/data/timepoints.mjs");

    const campaign = await createCampaign(`${prefix}AutoCapture`);
    await game.settings.set(MODULE_ID, "autoCaptureCampaign", campaign.id);
    const journal = await ensureTimelineJournal(campaign);
    const tps = Timepoints.getTimepoints(journal);
    const tp = tps.length || !withTimepoint ? (tps[0] ?? null) : await Timepoints.addTimepoint(journal, `${prefix}Auto-capture anchor`);

    // Re-resolve exactly the way fileOntoNewestTimepoint() does, from the
    // setting outward - not from the objects created above - so the guard
    // below tests the module's own answer rather than this function's memory.
    const settingId = game.settings.get(MODULE_ID, "autoCaptureCampaign");
    const folder = settingId ? game.folders.get(settingId) : null;
    const resolvedCampaign = folder && isCampaignFolder(folder) ? folder : null;
    const resolvedJournal = resolvedCampaign ? await ensureTimelineJournal(resolvedCampaign) : null;
    const newest = resolvedJournal ? pickNewestTimepoint(Timepoints.getTimepoints(resolvedJournal)) : null;

    return {
      campaignId: campaign.id,
      timelineId: journal.id,
      timepointId: tp?.id ?? null,
      resolvedCampaignId: resolvedCampaign?.id ?? null,
      resolvedTimelineId: resolvedJournal?.id ?? null,
      resolvedTimepointId: newest?.id ?? null
    };
  }, { prefix: TT_PREFIX, withTimepoint });

  createdCampaignIds.add(target.campaignId);

  // Fail fast, BEFORE any capture runs. Without these three, a capture files
  // into whatever campaign the world setting happened to name.
  expect(target.resolvedCampaignId).toBe(target.campaignId);
  expect(target.resolvedTimelineId).toBe(target.timelineId);
  expect(target.resolvedTimepointId).toBe(target.timepointId);
  if (!withTimepoint) expect(target.timepointId).toBeNull();
  return target;
}

// Ids of every flagged timeline journal that existed BEFORE this file ran,
// snapshotted as a GM before any test opens a Hub: cleanup deletes only what
// this file itself induced.
// null, not []: an empty ledger would mean "nothing is protected" if the
// beforeAll snapshot below never ran (a withGmPage login failure still lets
// the cleanup hook run). cleanupTimelineJournals refuses to sweep without a
// real snapshot - see its doc comment.
let preexistingTimelines = null;

// The world's own auto-capture target, snapshotted before this file replaces
// it and restored in cleanupAll — it points at a REAL campaign in World A.
let captureCampaignPrior = "";
// The world's own autoCaptureEncounters value, restored in cleanupAll.
let encountersPrior = true;
// Campaign folders this file created, torn down by id (cascade).
const createdCampaignIds = new Set();

async function cleanupAll(page) {
  // Turn capture off FIRST: the combat deletes below fire deleteCombat, which
  // would otherwise merge into / re-create Encounters mid-cleanup.
  await page.evaluate(async () => {
    await game.settings.set("mej-campaign-companion", "autoCaptureEncounters", false);
  });
  await page.evaluate(async () => {
    // THE RULE: this file never selects or deletes a journal by a name it did
    // not itself write. Auto-captured Encounter entries are named
    // "Encounter: <scene> (<date>)" / "Encounter (<date>)" — a name a user's
    // own journal can carry just as easily — so they are NOT matched here.
    // They do not need to be: createEncounter() files them into the capture
    // campaign's folder (createMejEntry(..., campaign.id)), and this file's
    // capture target is a TT- campaign it created itself, so the folder
    // delete below (deleteContents: true) reclaims them by id-rooted cascade.
    // Only the TT- prefix — which this spec stamps on everything it makes —
    // is safe to match on.
    const ids = game.journal.filter((j) => j.name?.includes("TT-")).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const actorIds = game.actors.filter((a) => a.name?.startsWith("TT-")).map((a) => a.id);
    if (actorIds.length) await Actor.implementation.deleteDocuments(actorIds);
    const sceneIds = game.scenes.filter((s) => s.name?.startsWith("TT-")).map((s) => s.id);
    if (sceneIds.length) await Scene.implementation.deleteDocuments(sceneIds);
    const combatIds = game.combats.map((c) => c.id);
    if (combatIds.length) await Combat.implementation.deleteDocuments(combatIds);
    await game.settings.set("mej-campaign-companion", "autoCaptureSharedMedia", false);
  });
  // Restore the world's own auto-capture target and tear down the campaigns
  // this file created, by id (cascade covers the campaign's own timeline and
  // portal). Order matters: the setting must stop pointing at a folder that is
  // about to disappear.
  await page.evaluate(async ({ prior, owned, encPrior }) => {
    await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior);
    await game.settings.set("mej-campaign-companion", "autoCaptureEncounters", encPrior);
    for (const id of owned) {
      const folder = game.folders.get(id);
      if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
    }
  }, { prior: captureCampaignPrior, owned: [...createdCampaignIds], encPrior: encountersPrior });
  createdCampaignIds.clear();

  // Separate from the evaluate above: installCaptureTarget() (this spec's own
  // helper) can land a TT_PREFIX timepoint directly on World A's real,
  // pre-existing legacy timeline journal (ensureTimelineJournal() returns
  // that SAME real journal in a zero-campaign world, not a fresh one) -
  // unconditionally deleting anything named "Campaign Timeline" here used
  // to destroy that real content outright. Identity is now the module's own
  // timeline flag against a pre-run id snapshot, never the name - see
  // cleanupTimelineJournals's doc comment in helpers/foundry.mjs.
  await cleanupTimelineJournals(page, preexistingTimelines);
}

test.describe("04 auto-capture", () => {
  // Both tests in this file use the default `page` fixture directly (no
  // separate `browser` contexts), so this afterEach's `page` is the same
  // real, logged-in page the test itself used — no withGmPage() needed
  // here. (A leaked timepoint from a *different* spec file's afterEach
  // failing silently — 02/06, before their own fixes — could still bleed
  // into this file's installCaptureTarget()'s "reuse existing" behavior when the
  // whole suite runs together; fixed at the source in those files instead
  // of defensively here.)
  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (p) => {
      preexistingTimelines = await timelineJournalIds(p);
      captureCampaignPrior = await p.evaluate(() =>
        game.settings.get("mej-campaign-companion", "autoCaptureCampaign"));
      encountersPrior = await p.evaluate(() =>
        game.settings.get("mej-campaign-companion", "autoCaptureEncounters"));
    });
  });

  test.afterEach(async ({ page }) => {
    await cleanupAll(page);
  });

  /** Create a TT- scene with 2 unlinked goblins + 1 wolf and a Combat holding all three (not started). */
  async function makeCombat(page) {
    return page.evaluate(async (prefix) => {
      const goblin = await Actor.create({ name: `${prefix}Goblin`, type: "npc" });
      const wolf = await Actor.create({ name: `${prefix}Wolf`, type: "npc" });
      const scene = await Scene.create({ name: `${prefix}Ambush Scene`, width: 1000, height: 1000 });
      const [tok1, tok2, tok3] = await scene.createEmbeddedDocuments("Token", [
        { name: goblin.name, actorId: goblin.id, actorLink: false, x: 0, y: 0 },
        { name: goblin.name, actorId: goblin.id, actorLink: false, x: 100, y: 0 },
        { name: wolf.name, actorId: wolf.id, actorLink: false, x: 200, y: 0 }
      ]);
      // Deliberately not activating the scene (headless canvas noise, see
      // CANVAS_NOISE); combat.scene is enough for the scene name.
      const combat = await Combat.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", [
        { tokenId: tok1.id, sceneId: scene.id },
        { tokenId: tok2.id, sceneId: scene.id },
        { tokenId: tok3.id, sceneId: scene.id }
      ]);
      return { combatId: combat.id, goblinName: goblin.name };
    }, TT_PREFIX);
  }

  /** Poll for the Encounter page uuid on the Combat flag (written at combat start). */
  function waitForEncounterFlag(page, combatId) {
    return page.waitForFunction((id) =>
      game.combats.get(id)?.getFlag("mej-campaign-companion", "encounterPage") ?? false,
    combatId, { timeout: 15_000 }).then((h) => h.jsonValue());
  }

  /** Read an Encounter page by uuid: flags type, actor rows, text. */
  function readEncounter(page, uuid) {
    return page.evaluate((u) => {
      const doc = fromUuidSync(u);
      return doc ? {
        type: doc.getFlag("monks-enhanced-journal", "type"),
        rows: Object.values(doc.getFlag("monks-enhanced-journal", "actors") ?? {}),
        html: doc.text?.content ?? "",
        entryId: doc.parent?.id
      } : null;
    }, uuid);
  }

  /** Links of a timepoint, by ids. */
  function timepointLinks(page, timelineId, timepointId) {
    return page.evaluate(({ timelineId, timepointId }) => {
      const tp = game.journal.get(timelineId)?.getFlag("mej-campaign-companion", "timeline")
        ?.timepoints?.find((t) => t.id === timepointId);
      return tp?.links ?? [];
    }, { timelineId, timepointId });
  }

  test("combat start creates the Encounter with the opening roster; combat end merges into the same page", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [CANVAS_NOISE] });
    await login(page, "Gamemaster");
    // The setting now defaults to true and this test does not enable it. The
    // registered default is asserted instead; the world may hold a stored
    // `false` from an earlier run of the old spec, which is normalised to the
    // default here (cleanupAll restores the world's original value).
    expect(await page.evaluate(() =>
      game.settings.settings.get("mej-campaign-companion.autoCaptureEncounters").default)).toBe(true);
    await page.evaluate(async () => {
      if (!game.settings.get("mej-campaign-companion", "autoCaptureEncounters")) {
        await game.settings.set("mej-campaign-companion", "autoCaptureEncounters", true);
      }
    });
    const target = await installCaptureTarget(page);
    expect(target.timepointId).toBeTruthy();

    const { combatId, goblinName } = await makeCombat(page);

    // Nothing is created by building the Combat; it appears at START.
    const before = await page.evaluate((id) => game.combats.get(id).getFlag("mej-campaign-companion", "encounterPage") ?? null, combatId);
    expect(before).toBeNull();

    await page.evaluate((id) => { void game.combats.get(id).startCombat(); }, combatId);
    const uuid = await waitForEncounterFlag(page, combatId);

    const started = await readEncounter(page, uuid);
    expect(started?.type).toBe("encounter");
    // Opening roster: 2 unlinked Goblin tokens merge into one row (quantity "2"), Wolf has its own.
    expect(started.rows.find((r) => r.name === goblinName)?.quantity).toBe("2");
    expect(started.rows.length).toBe(2);
    // The flag's page is the one filed onto the timepoint.
    await expect.poll(async () =>
      (await timepointLinks(page, target.timelineId, target.timepointId)).filter((l) => l.uuid === uuid).length
    ).toBe(1);

    // End combat: merges into the SAME page, no second Encounter.
    await page.evaluate((id) => game.combats.get(id).delete(), combatId);
    await expect.poll(async () => (await readEncounter(page, uuid))?.html ?? "", { timeout: 15_000 })
      .not.toBe(started.html);

    const ended = await readEncounter(page, uuid);
    expect(ended.rows.length).toBe(2);
    expect(ended.rows.find((r) => r.name === goblinName)?.quantity).toBe("2");
    const encounterPages = await page.evaluate((campaignId) =>
      game.journal.filter((j) => j.folder?.id === campaignId)
        .flatMap((j) => j.pages.contents)
        .filter((p) => p.getFlag("monks-enhanced-journal", "type") === "encounter").length,
    target.campaignId);
    expect(encounterPages).toBe(1);
    const links = await timepointLinks(page, target.timelineId, target.timepointId);
    expect(links.filter((l) => l.type === "JournalEntryPage").length).toBe(1);

    assertNoConsoleErrors(errors);
  });

  test("with autoCaptureEncounters off, combat start and end create nothing", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [CANVAS_NOISE] });
    await login(page, "Gamemaster");
    await enableSetting(page, "autoCaptureEncounters", false);
    const target = await installCaptureTarget(page);
    const { combatId } = await makeCombat(page);

    await page.evaluate((id) => { void game.combats.get(id).startCombat(); }, combatId);
    await settle(page, 1500);
    const flag = await page.evaluate((id) => game.combats.get(id).getFlag("mej-campaign-companion", "encounterPage") ?? null, combatId);
    expect(flag).toBeNull();
    await page.evaluate((id) => game.combats.get(id).delete(), combatId);
    await settle(page, 1500);

    expect(await timepointLinks(page, target.timelineId, target.timepointId)).toEqual([]);
    const count = await page.evaluate((campaignId) =>
      game.journal.filter((j) => j.folder?.id === campaignId)
        .flatMap((j) => j.pages.contents)
        .filter((p) => p.getFlag("monks-enhanced-journal", "type") === "encounter").length,
    target.campaignId);
    expect(count).toBe(0);

    assertNoConsoleErrors(errors);
  });

  test("a timeline with zero timepoints gets one created and the Encounter filed onto it", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [CANVAS_NOISE] });
    await login(page, "Gamemaster");
    await enableSetting(page, "autoCaptureEncounters", true);
    const target = await installCaptureTarget(page, { withTimepoint: false });
    expect(target.timepointId).toBeNull();
    const { combatId } = await makeCombat(page);

    await page.evaluate((id) => { void game.combats.get(id).startCombat(); }, combatId);
    const uuid = await waitForEncounterFlag(page, combatId);

    await expect.poll(() => page.evaluate((timelineId) =>
      game.journal.get(timelineId)?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.length ?? 0,
    target.timelineId)).toBe(1);
    const tps = await page.evaluate((timelineId) =>
      game.journal.get(timelineId).getFlag("mej-campaign-companion", "timeline").timepoints, target.timelineId);
    expect(tps[0].links.some((l) => l.uuid === uuid && l.type === "JournalEntryPage")).toBe(true);

    assertNoConsoleErrors(errors);
  });

  test("sharing an image files it onto the newest timepoint; no libWrapper conflict warning", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const conflictWarnings = [];
    page.on("console", (msg) => {
      if (/conflict/i.test(msg.text()) && /mej-campaign-companion/i.test(msg.text())) conflictWarnings.push(msg.text());
    });
    await login(page, "Gamemaster");
    await enableSetting(page, "autoCaptureSharedMedia", true);
    const target = await installCaptureTarget(page);

    await page.evaluate(async () => {
      const popout = new foundry.applications.apps.ImagePopout({ src: "icons/svg/mystery-man.svg", window: { title: "TT- Shared Image" } });
      await popout.shareImage();
    });
    await settle(page, 500);

    // The timeline installCaptureTarget() proved auto-capture resolves to,
    // by id - never the world singleton this file used to assume.
    const links = await page.evaluate(({ timepointId, timelineId }) => {
      const j = game.journal.get(timelineId);
      const tp = j?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.find((t) => t.id === timepointId);
      return tp?.links ?? [];
    }, { timepointId: target.timepointId, timelineId: target.timelineId });
    expect(links.some((l) => l.src === "icons/svg/mystery-man.svg")).toBe(true);
    expect(conflictWarnings).toEqual([]);

    assertNoConsoleErrors(errors);
  });
});
