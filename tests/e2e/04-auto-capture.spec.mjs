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
async function installCaptureTarget(page) {
  const target = await page.evaluate(async (prefix) => {
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
    const tp = tps.length ? tps[0] : await Timepoints.addTimepoint(journal, `${prefix}Auto-capture anchor`);

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
      timepointId: tp.id,
      resolvedCampaignId: resolvedCampaign?.id ?? null,
      resolvedTimelineId: resolvedJournal?.id ?? null,
      resolvedTimepointId: newest?.id ?? null
    };
  }, TT_PREFIX);

  createdCampaignIds.add(target.campaignId);

  // Fail fast, BEFORE any capture runs. Without these three, a capture files
  // into whatever campaign the world setting happened to name.
  expect(target.resolvedCampaignId).toBe(target.campaignId);
  expect(target.resolvedTimelineId).toBe(target.timelineId);
  expect(target.resolvedTimepointId).toBe(target.timepointId);
  return target;
}

// Ids of every flagged timeline journal that existed BEFORE this file ran,
// snapshotted as a GM before any test opens a Hub: cleanup deletes only what
// this file itself induced.
let preexistingTimelines = [];

// The world's own auto-capture target, snapshotted before this file replaces
// it and restored in cleanupAll — it points at a REAL campaign in World A.
let captureCampaignPrior = "";
// Campaign folders this file created, torn down by id (cascade).
const createdCampaignIds = new Set();

async function cleanupAll(page) {
  await page.evaluate(async () => {
    // Auto-captured Encounter entries are named "Encounter: <scene> (<date>)"
    // / "Encounter (<date>)", not TT- prefixed — but every scene/actor this
    // spec creates for them is, so matching on that substring anywhere in
    // the name (not just startsWith) catches them too.
    const ids = game.journal.filter((j) => j.name?.includes("TT-") || j.name?.startsWith("Encounter")).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const actorIds = game.actors.filter((a) => a.name?.startsWith("TT-")).map((a) => a.id);
    if (actorIds.length) await Actor.implementation.deleteDocuments(actorIds);
    const sceneIds = game.scenes.filter((s) => s.name?.startsWith("TT-")).map((s) => s.id);
    if (sceneIds.length) await Scene.implementation.deleteDocuments(sceneIds);
    const combatIds = game.combats.map((c) => c.id);
    if (combatIds.length) await Combat.implementation.deleteDocuments(combatIds);
    await game.settings.set("mej-campaign-companion", "autoCaptureEncounters", false);
    await game.settings.set("mej-campaign-companion", "autoCaptureSharedMedia", false);
  });
  // Restore the world's own auto-capture target and tear down the campaigns
  // this file created, by id (cascade covers the campaign's own timeline and
  // portal). Order matters: the setting must stop pointing at a folder that is
  // about to disappear.
  await page.evaluate(async ({ prior, owned }) => {
    await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior);
    for (const id of owned) {
      const folder = game.folders.get(id);
      if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
    }
  }, { prior: captureCampaignPrior, owned: [...createdCampaignIds] });
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
    });
  });

  test.afterEach(async ({ page }) => {
    await cleanupAll(page);
  });

  test("combat end creates an Encounter entry with merged quantities and a timepoint link", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [CANVAS_NOISE] });
    await login(page, "Gamemaster");
    await enableSetting(page, "autoCaptureEncounters", true);
    const target = await installCaptureTarget(page);
    expect(target.timepointId).toBeTruthy();

    const result = await page.evaluate(async (prefix) => {
      const goblin = await Actor.create({ name: `${prefix}Goblin`, type: "npc" });
      const wolf = await Actor.create({ name: `${prefix}Wolf`, type: "npc" });
      const scene = await Scene.create({ name: `${prefix}Ambush Scene`, width: 1000, height: 1000 });
      const [tok1, tok2, tok3] = await scene.createEmbeddedDocuments("Token", [
        { name: goblin.name, actorId: goblin.id, actorLink: false, x: 0, y: 0 },
        { name: goblin.name, actorId: goblin.id, actorLink: false, x: 100, y: 0 },
        { name: wolf.name, actorId: wolf.id, actorLink: false, x: 200, y: 0 }
      ]);
      // Deliberately not activating the scene: captureCombatEnd reads
      // `game.scenes?.current ?? combat.scene`, and combat.scene (set via
      // Combat.create({scene})) is already enough — activating a scene
      // forces every headless client through software canvas rendering,
      // which crashed here ("Cannot read properties of undefined (reading
      // 'addChild')", a PIXI container error) without adding anything
      // auto-capture actually needs.
      const combat = await Combat.create({ scene: scene.id });
      await combat.createEmbeddedDocuments("Combatant", [
        { tokenId: tok1.id, sceneId: scene.id },
        { tokenId: tok2.id, sceneId: scene.id },
        { tokenId: tok3.id, sceneId: scene.id }
      ]);
      const combatId = combat.id;
      // "End Combat": deleteCombat is what auto-capture listens for.
      await combat.delete();
      await new Promise((r) => setTimeout(r, 600));

      const entry = game.journal.find((j) => j.name?.startsWith("Encounter"));
      const page0 = entry?.pages?.contents?.[0];
      const rows = page0 ? Object.values(page0.getFlag("monks-enhanced-journal", "actors") ?? {}) : [];
      return {
        entryFound: !!entry,
        entryFlagType: page0?.getFlag("monks-enhanced-journal", "type"),
        rows,
        goblinName: goblin.name,
        combatId
      };
    }, TT_PREFIX);

    expect(result.entryFound).toBe(true);
    expect(result.entryFlagType).toBe("encounter");
    // 2 unlinked Goblin tokens merge into a single row with quantity "2";
    // the Wolf gets its own row.
    const goblinRow = result.rows.find((r) => r.name === result.goblinName);
    expect(goblinRow?.quantity).toBe("2");
    expect(result.rows.length).toBe(2);

    // Timepoint link: the newest timepoint gained a link pointing at the
    // Encounter page.
    // The timeline installCaptureTarget() proved auto-capture resolves to,
    // by id - never the world singleton this file used to assume.
    const links = await page.evaluate(({ timepointId, timelineId }) => {
      const j = game.journal.get(timelineId);
      const tp = j?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.find((t) => t.id === timepointId);
      return tp?.links ?? [];
    }, { timepointId: target.timepointId, timelineId: target.timelineId });
    expect(links.some((l) => l.type === "JournalEntryPage")).toBe(true);

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
