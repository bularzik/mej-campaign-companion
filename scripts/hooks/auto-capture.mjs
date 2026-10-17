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
//    `{ id, uuid, img, name, quantity: "1", type }`. See
//    logic/encounter-capture.mjs for the row-shape adapter (including the
//    dot-free storage-key requirement - MEJ's monsters-tab form field names
//    interpolate that key raw, so a dotted uuid key corrupts the flag via
//    expandObject() on the next sheet save) and for why actor-less rows are
//    excluded from `actors` entirely rather than stored with a made-up key.
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
  MODULE_ID, AUTO_CAPTURE_SETTING, MEDIA_CAPTURE_SETTING, DEPARTED_FLAG, ENCOUNTER_PAGE_FLAG, MEJ_ENCOUNTER_TYPE, I18N,
  AUTO_CAPTURE_CAMPAIGN_SETTING
} from "../constants.mjs";
import { ensureTimelineJournal } from "../data/timeline-journal.mjs";
import { ensureFallbackCampaign } from "./session-filing.mjs";
import { getTimepoints, addTimepoint, addLink } from "../data/timepoints.mjs";
import { currentWorldComponents, formatCampaignDate } from "../logic/campaign-calendar.mjs";
import { createMejEntry } from "../data/mej-entry.mjs";
import { queueFiling } from "../logic/filing-queue.mjs";
import { getCampaigns, baselineOwnership } from "../data/campaign-store.mjs";
import {
  collapseParticipants, mergeParticipants, summarizeOutcome, pickNewestTimepoint,
  resolveSharedMediaShare, installShareImageWrap, resolveCaptureCampaign
} from "../logic/auto-capture.mjs";
import {
  buildEncounterActorRows, rowsFromEncounterActors, rekeyByBaseActor, describeUnlinkedParticipants, buildEncounterName,
  wrapOutcomeHtml, mergeOutcomeHtml
} from "../logic/encounter-capture.mjs";
import { fileMediaNote } from "./reveal-filing.mjs";

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

// Timepoint filings (Encounter links + shared-image links) are serialized
// through logic/filing-queue.mjs's shared queueFiling(), NOT a queue local
// to this file - the docx import wizard (apps/import-wizard.mjs) writes to
// the same singleton timeline journal's timepoints flag, and a combat
// ending or a Show-Players share firing while a GM is mid-import would
// otherwise race that write too. See filing-queue.mjs's header comment.

/** The campaign that receives captures, resolved per logic/auto-capture.mjs#resolveCaptureCampaign. Reason "none" (no campaigns) keeps the legacy loose behavior. */
function captureTarget() {
  const id = game.settings.get(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING);
  return resolveCaptureCampaign(id, getCampaigns());
}

/** A readable file name from a media src: last path segment, without ?query/#hash, URI-decoded. */
function mediaDisplayName(src) {
  const last = String(src ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** File a document/image link onto the timeline's newest timepoint. Resolves true when filed, false when it declined (no target / no timeline). */
async function fileOntoNewestTimepoint(link) {
  const { campaign, reason } = captureTarget();
  if (reason === "multi") return false; // several campaigns, no target chosen: decline silently for media
  // Spec D: this resolves the campaign's DEFAULT timeline; auto-filing
  // never prompts and never follows the Hub's currently-viewed one.
  // No target campaign (a world with none yet): the fallback campaign holds
  // the capture - a world timeline is never created (spec 2026-10-16 §1e).
  const journal = await ensureTimelineJournal(campaign ?? await ensureFallbackCampaign());
  if (!journal) {
    console.debug(`${MODULE_ID} | auto-capture: no timeline journal yet, skipping filing`);
    return false;
  }
  // A timeline with no timepoints used to drop the capture; give it one
  // dated "now" so the capture always lands somewhere.
  let tp = pickNewestTimepoint(getTimepoints(journal));
  if (!tp) {
    const now = currentWorldComponents();
    const label = (now && formatCampaignDate(now)) || new Date().toLocaleDateString();
    tp = await addTimepoint(journal, label, null, now);
  }
  await addLink(journal, tp.id, link);
  return true;
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

/** Combine the outcome summary with an actor-less-participants line into the page's description HTML. */
function buildDescriptionHtml(outcome, unlinkedNames) {
  const parts = [];
  if (outcome) parts.push(`<p>${outcome}</p>`);
  if (unlinkedNames) parts.push(`<p>${game.i18n.format(`${I18N}.autoCapture.unlinked`, { names: unlinkedNames })}</p>`);
  return parts.join("");
}

/**
 * Create a new Encounter JournalEntry+page for a combat, file it onto the
 * timeline's newest timepoint, and remember its uuid in the Combat's
 * ENCOUNTER_PAGE_FLAG so combat end merges into it instead of creating a
 * duplicate. The flag write needs the Combat document alive, which holds at
 * combatStart (and on the create-at-end fallback it is skipped quietly:
 * deleteCombat fires after the delete completed). Page shape (native type
 * "text" + the monks-enhanced-journal.type flag + defaultObject seed) comes
 * from data/mej-entry.mjs's createMejEntry, shared with the docx import
 * wizard - see that module's header comment for why MEJ pages are shaped
 * this way.
 */
async function createEncounter(combat, participants, outcome, unlinkedNames, sceneName) {
  const { campaign, reason } = captureTarget();
  if (reason === "multi") {
    ui.notifications.warn(game.i18n.localize(`${I18N}.hub.captureNoCampaign`));
    return null;
  }
  const name = buildEncounterName(sceneName, new Date().toLocaleDateString());
  // Wrapped in the outcome marker from the start so a later mergeEncounter()
  // can replace just this block instead of the GM's whole page body.
  const page = await createMejEntry(MEJ_ENCOUNTER_TYPE, name, wrapOutcomeHtml(buildDescriptionHtml(outcome, unlinkedNames)), {
    actors: buildEncounterActorRows(participants)
  }, campaign ? { default: baselineOwnership(campaign) } : null, campaign?.id ?? null);
  try {
    await combat.setFlag(MODULE_ID, ENCOUNTER_PAGE_FLAG, page.uuid);
  } catch {
    // Combat already deleted (create-at-end fallback): nothing left to link.
  }
  const filed = await queueFiling(() => fileOntoNewestTimepoint({ uuid: page.uuid, name: page.name, type: "JournalEntryPage" }));
  if (filed) ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.encounterCaptured`, { name: page.name }));
  return page;
}

/**
 * Additively merge a fresh roster + outcome into an already-linked Encounter
 * page (the merge-on-re-end path described in createEncounter's doc comment).
 *
 * "Additively" has to hold for the BODY as well as the roster: this used to
 * overwrite `text.content` outright, so a GM who wrote the encounter up
 * between the two firings lost all of it. mergeOutcomeHtml replaces only this
 * module's own generated block (logic/encounter-capture.mjs) and leaves
 * everything around it alone; a page created before that marker existed just
 * gains the block at the end rather than having its content replaced.
 */
async function mergeEncounter(page, participants, outcome, unlinkedNames) {
  const existing = rowsFromEncounterActors(page.getFlag("monks-enhanced-journal", "actors"));
  const merged = mergeParticipants(rekeyByBaseActor(existing), rekeyByBaseActor(participants));
  await page.update({
    "flags.monks-enhanced-journal.actors": buildEncounterActorRows(merged),
    "text.content": mergeOutcomeHtml(page.text?.content ?? "", buildDescriptionHtml(outcome, unlinkedNames))
  });
}

/** Start of combat -> create the Encounter entry from the opening roster. */
async function captureCombatStart(combat) {
  if (!game.settings.get(MODULE_ID, AUTO_CAPTURE_SETTING)) return;
  // combatStart fires only on the client that began combat, so no GM
  // election is needed (unlike the broadcast deleteCombat below).
  if (!game.user.isGM) return;
  if (combat.getFlag(MODULE_ID, ENCOUNTER_PAGE_FLAG)) return;

  const scene = combat.scene ?? game.scenes?.current ?? null;
  const participants = collapseParticipants(combatParticipants(combat));
  const unlinkedNames = describeUnlinkedParticipants(participants);
  await createEncounter(combat, participants, "", unlinkedNames, scene?.name ?? null);
}

/** Capture a just-ended combat: merge into the start-created Encounter, or create one when combat began before capture was on. */
async function captureCombatEnd(combat) {
  if (!game.settings.get(MODULE_ID, AUTO_CAPTURE_SETTING)) return;
  // Single-writer election: deleteCombat broadcasts to every client, so a
  // plain `game.user.isGM` guard would run once per connected GM.
  if (game.user !== game.users.activeGM) return;

  // C8: the combat's OWN scene first. game.scenes.current is whatever this
  // GM happens to be viewing, so ending a combat while looking elsewhere
  // used to name the Encounter after the wrong place.
  const scene = combat.scene ?? game.scenes?.current ?? null;
  const participants = collapseParticipants(combatParticipants(combat));
  const outcome = buildOutcome(combat);
  const unlinkedNames = describeUnlinkedParticipants(participants);

  const existingUuid = combat.getFlag(MODULE_ID, ENCOUNTER_PAGE_FLAG);
  const existingPage = existingUuid ? await fromUuid(existingUuid) : null;
  if (existingPage) {
    await mergeEncounter(existingPage, participants, outcome, unlinkedNames);
    ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.encounterUpdated`, { name: existingPage.name }));
  } else await createEncounter(combat, participants, outcome, unlinkedNames, scene?.name ?? null);
}

/**
 * File a GM-shared image/video onto the timeline's newest timepoint
 * (Show Players capture), and a note on the capture campaign's open session.
 */
function captureSharedImage(src, caption, users = []) {
  if (!src) return;
  // Showing players something files a note on the open session whether or
  // not media capture onto the timeline is on (spec 2026-10-15 §9). A share
  // to selected players files a note only those players can read.
  fileMediaNote({ campaign: captureTarget().campaign, src, name: caption || mediaDisplayName(src), users });
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  queueFiling(() => fileOntoNewestTimepoint({ src, showPlayers: true, name: caption || "" })).then((filed) => {
    if (filed) ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.mediaCaptured`, { name: caption || mediaDisplayName(src) }));
  });
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
      if (share) captureSharedImage(share.src, share.caption, share.users);
      return result;
    },
    registerManual: () => {
      const original = ImagePopout.prototype.shareImage;
      ImagePopout.prototype.shareImage = function (options = {}) {
        const result = original.call(this, options);
        const share = resolveSharedMediaShare({ isGM: game.user.isGM, options, appOptions: this.options });
        if (share) captureSharedImage(share.src, share.caption, share.users);
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
      const share = resolveSharedMediaShare({ isGM: game.user.isGM, options: { image: src, caption: config.caption, title: config.title, users: config.users } });
      if (share) captureSharedImage(share.src, share.caption, share.users);
      return result;
    },
    registerManual: () => {
      const original = Journal.showImage;
      Journal.showImage = function (src, config = {}) {
        const result = original.call(this, src, config);
        const share = resolveSharedMediaShare({ isGM: game.user.isGM, options: { image: src, caption: config.caption, title: config.title, users: config.users } });
        if (share) captureSharedImage(share.src, share.caption, share.users);
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
  // Gated on the same autoCaptureEncounters setting as the deleteCombat
  // capture below - there's no point tracking departures for an outcome
  // summary the feature-off path will never build.
  Hooks.on("deleteCombatant", (combatant) => {
    if (!game.settings.get(MODULE_ID, AUTO_CAPTURE_SETTING)) return;
    if (game.user !== game.users.activeGM) return;
    if (!combatant.combat) return;
    recordDeparture(combatant.combat, combatant);
  });

  // Combat starts -> create the Encounter entry.
  Hooks.on("combatStart", (combat) => {
    captureCombatStart(combat).catch((err) => console.error(`${MODULE_ID} | auto-capture: combat start capture failed`, err));
  });

  // Combat ends -> merge the final roster + outcome into it.
  Hooks.on("deleteCombat", (combat) => {
    captureCombatEnd(combat).catch((err) => console.error(`${MODULE_ID} | auto-capture: combat capture failed`, err));
  });

  // Observer pattern: a throw while installing the shareImage wraps (e.g. an
  // unexpected v14 API shape) must not abort registration of the combat
  // hooks above.
  try {
    installShareCaptureWraps();
  } catch (err) {
    console.error(`${MODULE_ID} | auto-capture: installing shareImage wraps failed`, err);
  }
}
