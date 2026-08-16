// scripts/hooks/auto-capture.mjs
// Adapted from campaign-record's scripts/hooks/auto-capture.mjs. The
// companion has no "group"/records-container document: encounters become
// their own top-level JournalEntry (like any other MEJ entry) and the
// campaign timeline lives on the singleton timeline journal
// (data/timeline-journal.mjs), so filing means addLink() onto that
// journal's newest timepoint rather than campaign-record's per-group
// gallery pages. The companion also has no Media page type, so shared
// images are filed as plain {src, showPlayers:true} timeline links, not
// gallery entries (see data/timepoints.mjs's addLink/resolveLinks).
//
// MEJ Encounter shape (verified against the monks-enhanced-journal source,
// not guessed):
//  - sheets/EncounterSheet.js:73-75 `defaultObject` is
//    `{ items: {}, actors: {}, dcs: {} }`.
//  - sheets/EnhancedJournalSheet.js:2265-2283 `getItemData()` is what
//    EncounterSheet#addActor() stores per actor row:
//    `{ id, uuid, img, name, quantity: "1", type }`, keyed in the `actors`
//    flag object by that same `id`. See logic/encounter-capture.mjs for the
//    row-shape adapter (collapseParticipants() row -> MEJ actors-flag row).
//  - monks-enhanced-journal.js's real page-creation path (the
//    `JournalEntry.prototype._onCreate` patch, ~line 1032) creates the page
//    with Foundry's *native* `type: "text"` and stores the actual MEJ type
//    under `flags["monks-enhanced-journal"].type = "encounter"` (the SHORT,
//    unprefixed key - not "monks-enhanced-journal.encounter"). The
//    `page.type = type` line that follows only patches the in-memory
//    object; `MonksEnhancedJournal.fixType()` re-derives it from the flag on
//    every render, so it isn't persisted and doesn't need to be replicated.
//    We mirror this exactly rather than setting a namespaced page `type`,
//    which is what "mirror what MEJ's own entry-creation path produces"
//    means concretely here.
//  - sheets/PlaceSheet.js has no `scene` property anywhere: MEJ's own Place
//    type carries no scene link. matchPlaceForScene() (ported verbatim in
//    logic/auto-capture.mjs) is therefore never called from this file -
//    there is nothing to match against. Documented per the task's
//    "decide from evidence and document" instruction.
import {
  MODULE_ID, AUTO_CAPTURE_SETTING, MEDIA_CAPTURE_SETTING, ENCOUNTER_FLAG, DEPARTED_FLAG,
  MEJ_ENCOUNTER_TYPE, I18N
} from "../constants.mjs";
import { getTimelineJournal } from "../data/timeline-journal.mjs";
import { getTimepoints, addLink } from "../data/timepoints.mjs";
import {
  collapseParticipants, mergeParticipants, summarizeOutcome, pickNewestTimepoint,
  resolveSharedMediaShare, installShareImageWrap
} from "../logic/auto-capture.mjs";
import { buildEncounterActorRows, rowsFromEncounterActors, buildEncounterName } from "../logic/encounter-capture.mjs";

/** Live combatants as raw {actorUuid, name} entries. */
function combatParticipants(combat) {
  return combat.combatants.map((c) => ({ actorUuid: c.actor?.uuid ?? null, name: c.name }));
}

/** Best-effort current/max HP for an actor, or null when the system hides it. */
function actorHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  return hp && typeof hp.value === "number" && typeof hp.max === "number"
    ? { value: hp.value, max: hp.max }
    : null;
}

/** Note a departing combatant (with its defeated state) for the end summary. */
async function recordDeparture(combat, combatant) {
  try {
    const departed = [...(combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [])];
    departed.push({ actorUuid: combatant.actor?.uuid ?? null, name: combatant.name, defeated: combatant.isDefeated === true });
    await combat.setFlag(MODULE_ID, DEPARTED_FLAG, departed);
  } catch (err) {
    console.error(`${MODULE_ID} | auto-capture: recording combatant departure failed`, err);
  }
}

/** File a document link onto the timeline's newest timepoint. Silent no-op with no timeline/timepoints yet. */
async function fileOntoNewestTimepoint(link) {
  const journal = getTimelineJournal();
  if (!journal) {
    console.debug(`${MODULE_ID} | auto-capture: no timeline journal yet, skipping filing`);
    return;
  }
  const tp = pickNewestTimepoint(getTimepoints(journal));
  if (!tp) {
    console.debug(`${MODULE_ID} | auto-capture: no timepoints yet, skipping filing`);
    return;
  }
  await addLink(journal, tp.id, link);
}

/**
 * Build the outcome summary for a just-ended combat from its live roster
 * (`present`) plus whoever left mid-fight (the DEPARTED_FLAG combat flag).
 */
function buildOutcome(combat) {
  const present = combat.combatants.map((c) => ({
    name: c.name, defeated: c.isDefeated === true, hp: actorHp(c.actor)
  }));
  const departed = combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [];
  return summarizeOutcome({ present, departed }, {
    died: game.i18n.localize(`${I18N}.autoCapture.died`),
    injured: game.i18n.localize(`${I18N}.autoCapture.injured`),
    fled: game.i18n.localize(`${I18N}.autoCapture.fled`),
    none: game.i18n.localize(`${I18N}.autoCapture.noCasualties`)
  });
}

/**
 * Create a new Encounter JournalEntry+page for a just-ended combat, file it
 * onto the timeline's newest timepoint, and best-effort remember its uuid on
 * the combat flag so a repeat deleteCombat firing for this same combat id
 * (e.g. a module conflict or a dev hot-reload double-registering the hook)
 * merges into it instead of creating a duplicate. By the time deleteCombat
 * runs, the Combat document has already been deleted server-side (verified
 * against Foundry's ClientDatabaseBackend#_deleteDocuments: the "deleteX"
 * hook fires from the delete *response* handler, after the request already
 * completed) - so this write can legitimately fail, and does so silently:
 * the caller's try/catch (registerAutoCapture) is what makes that safe,
 * matching requirement #7's "never block combat end" contract. It is a
 * best-effort guard, not a guaranteed one.
 */
async function createEncounter(combat, participants, outcome, sceneName) {
  const name = buildEncounterName(sceneName, new Date().toLocaleDateString());
  const [entry] = await JournalEntry.create({
    name,
    pages: [{
      name,
      type: "text",
      text: { content: outcome ? `<p>${outcome}</p>` : "" },
      flags: {
        "monks-enhanced-journal": {
          type: MEJ_ENCOUNTER_TYPE,
          items: {},
          dcs: {},
          actors: buildEncounterActorRows(participants)
        }
      }
    }]
  });
  const page = entry.pages.contents[0];
  await fileOntoNewestTimepoint({ uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
  try {
    await combat.setFlag(MODULE_ID, ENCOUNTER_FLAG, page.uuid);
  } catch {
    // Expected: the combat is already deleted by this point (see the
    // doc comment above). Filing already succeeded; this flag is a
    // best-effort merge guard only.
  }
  return page;
}

/**
 * Additively merge a fresh roster + outcome into an already-linked Encounter
 * page (the merge-on-re-end path described in createEncounter's doc comment).
 */
async function mergeEncounter(page, participants, outcome) {
  const existing = rowsFromEncounterActors(page.getFlag("monks-enhanced-journal", "actors"));
  const merged = mergeParticipants(existing, participants);
  await page.update({
    "flags.monks-enhanced-journal.actors": buildEncounterActorRows(merged),
    "text.content": outcome ? `<p>${outcome}</p>` : ""
  });
}

/** Capture a just-ended combat as an Encounter entry, creating or merging as needed. */
async function captureCombatEnd(combat) {
  if (!game.settings.get(MODULE_ID, AUTO_CAPTURE_SETTING)) return;
  // Single-writer election, mirroring campaign-record's own reasoning: a
  // plain `game.user.isGM` guard would run this once per connected GM
  // client. deleteCombat broadcasts to every client (unlike combatStart or
  // preDeleteCombat, which only ever fire locally on whoever performed the
  // action), so - unlike those hooks - gating on the elected activeGM here
  // is both safe and necessary to avoid duplicate Encounter creation when
  // more than one GM is online.
  if (game.user !== game.users.activeGM) return;

  const scene = game.scenes?.current ?? combat.scene ?? null;
  const participants = collapseParticipants(combatParticipants(combat));
  const outcome = buildOutcome(combat);

  const existingUuid = combat.getFlag(MODULE_ID, ENCOUNTER_FLAG);
  const existingPage = existingUuid ? await fromUuid(existingUuid) : null;
  if (existingPage) await mergeEncounter(existingPage, participants, outcome);
  else await createEncounter(combat, participants, outcome, scene?.name ?? null);
}

/**
 * File a GM-shared image/video onto the timeline's newest timepoint
 * (Show Players capture).
 */
function captureSharedImage(src, caption) {
  if (!src) return;
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  fileOntoNewestTimepoint({ src, showPlayers: true, name: caption || "" })
    .catch((err) => console.error(`${MODULE_ID} | auto-capture: filing shared image failed`, err));
}

/** Install both shareImage capture wraps (see registerAutoCapture's comment for why two). */
function installShareCaptureWraps() {
  const libWrapperModule = game.modules.get("lib-wrapper");
  const libWrapper = globalThis.libWrapper;

  // Primary target, matching campaign-record: fires for any bare/native
  // ImagePopout "Show Players" click (dropped images, actor art via the
  // core flow, and any ImagePopout MEJ doesn't override - see below).
  const ImagePopout = foundry.applications.apps.ImagePopout;
  installShareImageWrap({
    libWrapperModule,
    libWrapper,
    moduleId: MODULE_ID,
    target: "foundry.applications.apps.ImagePopout.prototype.shareImage",
    wrapper: function (wrapped, options = {}) {
      const result = wrapped(options);
      const share = resolveSharedMediaShare({ isGM: game.user.isGM, options, appOptions: this.options });
      if (share) captureSharedImage(share.src, share.caption);
      return result;
    },
    registerManual: () => {
      const original = ImagePopout.prototype.shareImage;
      ImagePopout.prototype.shareImage = function (options = {}) {
        const result = original.call(this, options);
        const share = resolveSharedMediaShare({ isGM: game.user.isGM, options, appOptions: this.options });
        if (share) captureSharedImage(share.src, share.caption);
        return result;
      };
    },
    warn: (error) => console.warn(`${MODULE_ID} | libWrapper.register failed for ImagePopout#shareImage; falling back to manual patch`, error)
  });

  // Second target, beyond what campaign-record wraps: verified against the
  // Foundry v14 source (client/applications/sheets/journal/dialog-show.mjs
  // and client/documents/collections/journal.mjs) that MEJ's own "show
  // this picture to players" affordances (sheets/EnhancedJournalSheet.js,
  // sheets/JournalEntrySheet.js - they each reassign an ImagePopout
  // instance's own `shareImage` to `Journal.showDialog(doc, ...)` instead
  // of calling the prototype method) route through ShowToPlayersDialog,
  // whose "image only" submit path calls the *static*
  // `Journal.showImage(src, config)` - a different function that also emits
  // the "shareImage" socket but is never reached by the wrap above. Without
  // this second wrap, sharing an image from inside an MEJ sheet would not
  // be captured at all.
  const Journal = foundry.documents.collections.Journal;
  installShareImageWrap({
    libWrapperModule,
    libWrapper,
    moduleId: MODULE_ID,
    target: "foundry.documents.collections.Journal.showImage",
    wrapper: function (wrapped, src, config = {}) {
      const result = wrapped(src, config);
      const share = resolveSharedMediaShare({ isGM: game.user.isGM, options: { image: src, caption: config.caption, title: config.title } });
      if (share) captureSharedImage(share.src, share.caption);
      return result;
    },
    registerManual: () => {
      const original = Journal.showImage;
      Journal.showImage = function (src, config = {}) {
        const result = original.call(this, src, config);
        const share = resolveSharedMediaShare({ isGM: game.user.isGM, options: { image: src, caption: config.caption, title: config.title } });
        if (share) captureSharedImage(share.src, share.caption);
        return result;
      };
    },
    warn: (error) => console.warn(`${MODULE_ID} | libWrapper.register failed for Journal.showImage; falling back to manual patch`, error)
  });
}

/**
 * Register every auto-capture Foundry hook. Call once, from the
 * setupMonksEnhancedJournal handshake (campaign-companion.mjs), alongside
 * the module's other hook registrations.
 */
export function registerAutoCapture() {
  // Removal doesn't shrink the record; note who left (and whether defeated),
  // while the combat document is still alive so the flag write succeeds.
  Hooks.on("deleteCombatant", (combatant) => {
    if (game.user !== game.users.activeGM) return;
    if (!combatant.combat) return;
    recordDeparture(combatant.combat, combatant);
  });

  // Combat ends -> capture (or merge into) the Encounter entry.
  Hooks.on("deleteCombat", (combat) => {
    captureCombatEnd(combat).catch((err) => console.error(`${MODULE_ID} | auto-capture: combat capture failed`, err));
  });

  installShareCaptureWraps();
}
