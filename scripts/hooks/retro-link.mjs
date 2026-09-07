// scripts/hooks/retro-link.mjs
// Retroactive auto-link pass (spec Part 2). The creating client stamps
// flags[MODULE_ID].retroLinkPending on every new MEJ-typed JournalEntry
// (preCreateJournalEntry fires locally only, and a creator always owns the
// document they just made — this is the "catch-up queue": no world-setting
// write, so players can enqueue too). The ACTIVE GM's client processes and
// clears the flag, either immediately (createJournalEntry broadcast) or at
// login (ready sweep) for entities created while no GM was connected.
import { buildRetroPlanBatch } from "../logic/retro-link.mjs";
import { viewerIds } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import {
  MODULE_ID, I18N, RETRO_LINK_MODE_SETTING, RETRO_LINK_PENDING_FLAG, NO_AUTO_LINK_FLAG
} from "../constants.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { campaignIdOf, isTimelineJournal, isCampaignPortal, isLinkableEntity } from "../logic/campaigns.mjs";

/**
 * MEJ's own New Entry dialog creates the entry FIRST (with
 * flags["monks-enhanced-journal"].pagetype) and its _onCreate patch adds the
 * typed page afterward — so at preCreate time getMEJType(entry) can still be
 * false for a dialog-created entry. Check both the constructed document and
 * the raw entry-level MEJ flags. A campaign portal (MEJ type "campaign",
 * created with its marked page inline) and a timeline journal are never
 * candidates (spec 2026-09-06 §1) — the pending document already carries
 * its pages and flags, so both predicates work on it here.
 */
function isMejCandidate(entry) {
  if (isTimelineJournal(entry) || isCampaignPortal(entry)) return false;
  if (mejType(entry)) return true;
  const mejFlags = entry.flags?.["monks-enhanced-journal"];
  return !!(mejFlags?.pagetype || mejFlags?.type);
}

/**
 * Plan for a whole burst of new entities against ONE walk of the world (C7).
 *
 * This used to run per created entity: a 50-section docx import did 50
 * consecutive full-world walks, each computing every entry's viewer set and
 * copying every page's text, and (in confirm mode) put 50 dialogs in front of
 * the GM one after another. The work is now shared - one walk, one plan, one
 * write per affected page, one dialog.
 */
function planForBurst(entries) {
  const users = game.users.contents;
  const entities = entries
    .filter((entry) => isLinkableEntity(entry, mejType))
    .map((entry) => ({
      uuid: entry.uuid, name: entry.name, campaignId: campaignIdOf(entry),
      viewerIds: viewerIds(entry, users, isVisibleToUser)
    }));

  // Same-named twins, resolved for every entity in the burst in one pass over
  // the journal rather than one pass each. An entity in the burst can be
  // another's twin, so the burst is included in the search. Twins carry
  // their campaign so the planner can ignore one that is out of a page's
  // reach (spec §1).
  const byName = new Map();
  for (const e of game.journal.contents) {
    if (!isLinkableEntity(e, mejType)) continue;
    const norm = e.name.trim().toLowerCase();
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(e);
  }
  const otherSameNamed = {};
  for (const entity of entities) {
    const norm = entity.name.trim().toLowerCase();
    otherSameNamed[entity.uuid] = (byName.get(norm) ?? [])
      .filter((e) => e.uuid !== entity.uuid)
      .map((e) => ({ viewerIds: viewerIds(e, users, isVisibleToUser), campaignId: campaignIdOf(e) }));
  }

  // One planner row per linkable REGION (text.content, or a session's recap
  // and GM notes), so session pages are scanned at last. GM notes have no
  // non-GM viewers, so their audience is empty and containment passes.
  const gmNotesLabel = game.i18n.localize(`${I18N}.retroLink.gmNotes`);
  const pages = [];
  for (const e of game.journal.contents) {
    if (isTimelineJournal(e) || isCampaignPortal(e)) continue;
    const entryViewers = viewerIds(e, users, isVisibleToUser);
    const campaignId = campaignIdOf(e);
    for (const p of e.pages.contents) {
      const noAutoLink = !!p.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG);
      const baseName = e.name === p.name ? e.name : `${e.name}: ${p.name}`;
      for (const region of linkableRegions(p)) {
        if (!region.content) continue;
        pages.push({
          uuid: p.uuid,
          key: region.key,
          name: region.gmOnly ? `${baseName} — ${gmNotesLabel}` : baseName,
          content: region.content,
          viewerIds: region.gmOnly ? [] : entryViewers,
          campaignId,
          noAutoLink,
          entryUuid: e.uuid
        });
      }
    }
  }
  return buildRetroPlanBatch({ entities, pages, otherSameNamed });
}

/**
 * "Elara (2), Gandalf (1)" - which entities a page gained links for. A burst
 * of one keeps the old, quieter phrasing: one entity's name, no per-row
 * repetition of it.
 */
function matchLabel(row, single) {
  const esc = foundry.utils.escapeHTML;
  if (single) return `${esc(row.pageName)} (${row.matches[0]?.count ?? 0})`;
  const who = row.matches.map((m) => `${esc(m.entityName)} (${m.count})`).join(", ");
  return `${esc(row.pageName)} — ${who}`;
}

function reportList(rows, single, bucket, headingKey) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.filter((r) => r[bucket].length).map((r) => {
    const who = single ? "" : ` — ${r[bucket].map((m) => esc(m.entityName)).join(", ")}`;
    return `<li>${esc(r.pageName)}${who}</li>`;
  });
  if (!items.length) return "";
  return `<p>${game.i18n.localize(`${I18N}.retroLink.${headingKey}`)}</p><ul>${items.join("")}</ul>`;
}

/** Returns the writable rows the GM checked, or null on cancel/skip. */
async function confirmDialog(entities, rows) {
  const esc = foundry.utils.escapeHTML;
  const single = entities.length === 1;
  const writable = rows.filter((r) => r.newHtml && r.matches.length);
  const rowsHtml = writable.map((r, i) =>
    `<label class="mej-cc-retro-row"><input type="checkbox" name="row-${i}" checked> `
    + `${matchLabel(r, single)}</label>`
  ).join("");
  const intro = single
    ? game.i18n.format(`${I18N}.retroLink.intro`, { name: esc(entities[0].name) })
    : game.i18n.format(`${I18N}.retroLink.introMany`, { count: entities.length });
  const content = `<div class="mej-cc-retro-link"><p>${intro}</p>`
    + rowsHtml + reportList(rows, single, "ambiguous", "ambiguous") + reportList(rows, single, "hidden", "hidden")
    + `</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.localize(`${I18N}.retroLink.${single ? "title" : "titleMany"}`)
    },
    classes: ["mej-cc-retro-link-dialog"],
    content,
    buttons: [
      { action: "skip", label: `${I18N}.retroLink.skip` },
      {
        action: "apply", label: `${I18N}.retroLink.apply`, default: true,
        callback: (event, button) => [...button.form.elements]
          .filter((el) => el.name?.startsWith("row-") && el.checked)
          .map((el) => Number(el.name.slice(4)))
      }
    ],
    rejectClose: false
  });
  return Array.isArray(result) ? result.map((i) => writable[i]) : null;
}

/**
 * Report a finished pass (spec §3): an info toast with the counts when
 * anything was written; an error toast when `failed` (an actual write threw,
 * or its page had vanished by write time) is nonzero; a warn toast when
 * nothing was written and nothing failed, only because every match was
 * ambiguous; a warn toast naming the entity when nothing was written, nothing
 * failed, and no ambiguity was reported, only because the page's readers
 * cannot see it; nothing at all when nothing matched. `writable` is the
 * pre-dialog matched-row count, gating only the
 * ambiguous-only warn (never "was anything actually wrong" - that's
 * `failed`'s job) so a GM who unchecked every row in confirm mode is not told
 * "ambiguous" either: the unconditional re-plan that follows the dialog
 * restricts `live` to the approved entities, which comes back empty, and
 * `processBurst` returns before calling here. The per-page detail goes to the
 * console under the module prefix.
 */
function notifyRetroResult(entities, applied, rows, { failed, writable } = {}) {
  const single = entities.length === 1;
  const ambiguousRows = rows.filter((r) => r.ambiguous.length);
  const hiddenRows = rows.filter((r) => r.hidden.length);
  const detail = {
    linked: applied.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.matches.map((m) => `${m.entityName} (${m.count})`) })),
    ambiguous: ambiguousRows.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.ambiguous.map((m) => m.entityName) })),
    hidden: hiddenRows.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.hidden.map((m) => m.entityName) }))
  };
  if (applied.length) {
    const linkedCount = new Set(applied.flatMap((r) => r.matches.map((m) => m.entityUuid))).size;
    const message = single
      ? game.i18n.format(`${I18N}.retroLink.summary`, { name: entities[0].name, count: applied.length })
      : game.i18n.format(`${I18N}.retroLink.summaryMany`, { entities: linkedCount, count: applied.length });
    ui.notifications.info(message);
    console.info(`${MODULE_ID} | auto-link`, detail);
    return;
  }
  if (failed) {
    ui.notifications.error(game.i18n.format(`${I18N}.retroLink.writeFailed`, { count: failed }));
    console.error(`${MODULE_ID} | auto-link — ${failed} page write(s) failed`, detail);
    return;
  }
  if (!writable && ambiguousRows.length) {
    const name = ambiguousRows[0].ambiguous[0].entityName;
    ui.notifications.warn(game.i18n.format(`${I18N}.retroLink.ambiguousOnly`, { name }));
    console.info(`${MODULE_ID} | auto-link`, detail);
  } else if (!writable && hiddenRows.length) {
    // Nothing written, nothing failed, no twin in the way: the only reason
    // is that the page's readers cannot see the entity (spec 2026-09-06 §3).
    const first = hiddenRows[0].hidden[0];
    // Rows are per region (a session's recap and GM notes are two rows on
    // one page) - count distinct pages, and key on uuid so two same-named
    // hidden entities cannot be conflated.
    const count = new Set(hiddenRows
      .filter((r) => r.hidden.some((m) => m.entityUuid === first.entityUuid))
      .map((r) => r.pageUuid)).size;
    ui.notifications.warn(game.i18n.format(`${I18N}.retroLink.hiddenOnly`, { name: first.entityName, count }));
    console.info(`${MODULE_ID} | auto-link`, detail);
  }
}

// Hooks.callAll never awaits async handlers, so N rapid entity creations
// (e.g. a multi-section docx import, each stamped with the pending flag by
// preCreateJournalEntry above) fire N concurrent createJournalEntry handlers
// below. A pass plans against a snapshot of page text and later writes a
// whole new page.text.content, so two overlapping passes that both match one
// page would have the second write clobber the first's links, and
// confirm-mode dialogs would stack.
//
// Two mechanisms handle that, and they solve different halves (C7):
//
//   - Creations are COALESCED into a burst and planned together, so N
//     creations do one walk of the world, produce one write per page
//     carrying every entity that matched it, and ask the GM once. Within a
//     burst there is no clobbering to avoid because there is only one plan.
//   - Bursts are still SERIALIZED through the promise chain below, because a
//     second burst arriving while the first is mid-dialog would otherwise
//     plan against pages the first has not written yet.
//
// NOT logic/filing-queue.mjs's shared queue: a modal confirm dialog here must
// not block that queue's own (unrelated) timeline filings. Because planning
// happens inside the queued task itself, each burst re-reads current page
// content after any previous burst's writes have already landed.
let retroChain = Promise.resolve();

// The burst waiting to be planned, and the timer that closes it. Creations
// arrive as separate synchronous hook calls (a docx import fires one per
// section), so the burst is closed on a short idle gap rather than after a
// fixed count - an import of any size collapses into one pass, and a lone
// manual creation still runs promptly.
const pendingBurst = new Map();
let burstTimer = null;
const BURST_IDLE_MS = 200;

let burstsSuspended = 0;

/**
 * Hold the burst open across a long, known-multi-creation operation (the docx
 * importer). The idle gap alone cannot do this: the importer awaits a server
 * round trip per section - more when a section carries a timepoint - so on any
 * install slower than the gap EVERY section would close its own burst and the
 * round's headline improvement (one walk, one dialog) would silently revert to
 * the old behaviour. Callers must pair this with resumeRetroBursts in a
 * `finally`.
 */
export function suspendRetroBursts() {
  burstsSuspended++;
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
}

/** Release a suspend and, on the last one, plan whatever accumulated. */
export function resumeRetroBursts() {
  burstsSuspended = Math.max(0, burstsSuspended - 1);
  if (burstsSuspended) return retroChain;
  return flushBurst();
}

function armBurst() {
  if (burstsSuspended) return;
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = setTimeout(closeBurst, BURST_IDLE_MS);
}

/**
 * @param {boolean} clearNow  clear the pending flag immediately rather than
 *   when the burst is planned. True for live creations, false for the login
 *   sweep - see the call sites for why they differ.
 */
function enqueueRetro(entry, { clearNow = true } = {}) {
  pendingBurst.set(entry.uuid, { entry, needsClear: !clearNow });
  if (clearNow) {
    // A reload while the burst is still waiting (or mid-dialog) must not
    // replay the pass forever - the flag's original rationale, which
    // deferring the clear weakened by exactly the length of the idle gap.
    // And the clear is a document update that MEJ's own fixType normalization
    // rides on to coerce a new entry's in-memory `type` to its bare key;
    // holding it back left a freshly-created entry reading as
    // "mej-campaign-companion.session" instead of "session" for as long as
    // the burst waited, which 01-session's New Entry test caught.
    entry.unsetFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG).catch((err) =>
      console.error(`${MODULE_ID} | retro-link flag clear failed for "${entry?.name}"`, err));
  }
  armBurst();
  return retroChain;
}

function closeBurst() {
  burstTimer = null;
  const queued = [...pendingBurst.values()];
  pendingBurst.clear();
  if (!queued.length) return null;
  // Still serialized: a burst that lands while an earlier one is mid-dialog
  // must wait, or the second plan plans against pages the first has not
  // written yet and its write would clobber theirs.
  retroChain = retroChain.then(() => processBurst(queued)).catch((err) =>
    console.error(`${MODULE_ID} | retro-link queue failed`, err));
  return retroChain;
}

/** Drain whatever is queued right now, without waiting out the idle gap. */
function flushBurst() {
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
  return closeBurst() ?? retroChain;
}

/**
 * Plan and write a pass for EXISTING entries on demand (the Hub's "Link
 * mentions in this campaign", spec §4). Queued on the same chain as live
 * bursts so it can never interleave with one. `mode` overrides the world
 * setting for this pass only; callers decide policy (the Hub forces confirm).
 */
export function runRetroPass(entries, { mode = null } = {}) {
  const queued = entries.map((entry) => ({ entry, needsClear: false }));
  retroChain = retroChain
    .then(() => processBurst(queued, { modeOverride: mode }))
    .catch((err) => console.error(`${MODULE_ID} | retro-link pass failed`, err));
  return retroChain;
}

/** Still in the world - not deleted since the burst was queued. */
const stillExists = (e) => !!e?.name && !!game.journal.get(e.id);

async function processBurst(queued, { modeOverride = null } = {}) {
  try {
    const mode = modeOverride ?? game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING);
    // Sweep-queued entries keep their flag until here, so an interrupted
    // login leaves the backlog retryable (see the sweep's call site). Cleared
    // in ONE batched update, not one round trip each: a large backlog is
    // exactly the case this path exists for, and serial updates would
    // reintroduce the per-entry round trips this round set out to remove.
    const needClear = queued.filter((q) => q.needsClear).map((q) => q.entry);
    if (needClear.length) {
      try {
        await JournalEntry.implementation.updateDocuments(needClear.map((e) => ({
          _id: e.id, [`flags.${MODULE_ID}.-=${RETRO_LINK_PENDING_FLAG}`]: null
        })));
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link flag clear failed for the sweep backlog`, err);
      }
    }
    if (mode === "off") return;
    let live = queued.map((q) => q.entry).filter(stillExists);
    if (!live.length) return;
    let { rows } = planForBurst(live);
    live = live.filter((e) => isLinkableEntity(e, mejType));
    if (!rows.length) return;

    let chosen = rows.filter((r) => r.newHtml && r.matches.length);
    // The pre-dialog matched-row count - used below to tell "nothing written
    // because every match was ambiguous" apart from "the GM declined every
    // row in confirm mode", which also ends with an empty `applied`.
    const writableCount = chosen.length;
    if (mode === "confirm") {
      chosen = await confirmDialog(live, rows);
      if (!chosen) return;
      // The dialog waits on a human, so the content the GM approved can be
      // minutes stale by the time it returns - and recaps are now
      // collaboratively edited, so a stale write is not a corner case.
      // Re-planning against CURRENT content, restricted to what the GM
      // approved, means the write can neither clobber an edit made meanwhile
      // nor add a link the GM was never shown. This always runs, not just
      // when an entity was deleted while the dialog was open - see below for
      // why the entity deletion case in particular needs it too.
      //
      // Re-plan only over entities the GM actually APPROVED, never merely
      // the survivors. Deleting an entity can un-twin its same-named
      // partner, and a bare re-plan would then promote that partner from
      // "ambiguous - not written" (which is how the dialog described it) to
      // written, putting a link in the page the GM was told they would not
      // get. Restricting the entity set makes that impossible: nothing can
      // enter the plan that was not already in it.
      //
      // Rows are per REGION, not per page - a session's recap and its GM
      // notes are two separate rows sharing one pageUuid. Keying on pageUuid
      // alone would keep both regions of a page the GM only half-approved
      // (checked the recap, unchecked GM notes), writing the region the GM
      // declined. Key on the (page, region) pair instead.
      const rowKey = (r) => `${r.pageUuid} ${r.key}`;
      const keep = new Set(chosen.map(rowKey));
      const approved = new Set(chosen.flatMap((r) => r.matches.map((m) => m.entityUuid)));
      live = live.filter(stillExists).filter((e) => approved.has(e.uuid));
      if (!live.length) return;
      ({ rows } = planForBurst(live));
      chosen = rows.filter((r) => r.newHtml && r.matches.length && keep.has(rowKey(r)));
    }
    // One write per page carrying every region and every entity that matched
    // it - a session whose recap and GM notes both matched is one update.
    const byPage = new Map();
    for (const row of chosen) {
      const w = byPage.get(row.pageUuid) ?? { update: {}, rows: [] };
      w.update[row.key] = row.newHtml;
      w.rows.push(row);
      byPage.set(row.pageUuid, w);
    }
    const applied = [];
    let failed = 0;
    for (const [pageUuid, w] of byPage) {
      try {
        const pageDoc = await fromUuid(pageUuid);
        if (!pageDoc) { failed++; continue; }
        await pageDoc.update(w.update, { [MODULE_ID]: { retroLink: true } });
        applied.push(...w.rows);
      } catch (err) {
        failed++;
        console.error(`${MODULE_ID} | retro-link write failed for ${pageUuid}`, err);
      }
    }
    notifyRetroResult(live, applied, rows, { failed, writable: writableCount });
  } catch (err) {
    console.error(`${MODULE_ID} | retro-link burst failed`, err);
  } finally {
    // Anything that arrived while this burst was planning or waiting on the
    // dialog is a burst of its own - drain it rather than leaving it parked
    // until the next unrelated creation happens to re-arm the timer.
    if (pendingBurst.size && !burstsSuspended) armBurst();
  }
}

export function registerRetroLink() {
  Hooks.on("preCreateJournalEntry", (entry) => {
    try {
      if (game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING) === "off") return;
      if (!isMejCandidate(entry)) return;
      entry.updateSource({ [`flags.${MODULE_ID}.${RETRO_LINK_PENDING_FLAG}`]: true });
    } catch (err) {
      console.error(`${MODULE_ID} | retro-link stamp failed`, err);
    }
  });

  Hooks.on("createJournalEntry", (entry) => {
    if (game.users.activeGM !== game.user) return;
    if (!entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) return;
    // Fire-and-forget: enqueueRetro serializes this against every other
    // queued pass (see its own comment above) so overlapping hook- and
    // sweep-triggered passes can never interleave.
    enqueueRetro(entry);
  });

  // Catch-up sweep: entities created while no GM was connected still carry
  // the pending flag; process them once a GM logs in. Routed through the same
  // burst queue as the createJournalEntry handler above, so a sweep and a
  // concurrently hook-triggered creation can't interleave - and, since the
  // whole sweep is enqueued before it is flushed, a login that finds 40
  // pending entries plans them together and asks once rather than forty
  // times (C7).
  //
  // registerRetroLink() is called from registerCore(), which in api mode
  // runs long before "ready" fires but in native mode runs from inside the
  // ready hook dispatch itself (after an await, i.e. after Hooks.callAll
  // has already iterated its listener snapshot). Hooks.once("ready", ...)
  // registered at that point would never fire - "ready" only fires once per
  // boot. Run the sweep immediately if ready has already happened instead.
  if (game.ready) sweep();
  else Hooks.once("ready", sweep);

  async function sweep() {
    if (game.users.activeGM !== game.user) return;
    let queued = 0;
    for (const entry of game.journal.contents) {
      try {
        if (!entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) continue;
        // clearNow:false, unlike a live creation. A backlog can be large, and
        // clearing every flag up front would mean one interruption - a closed
        // tab, a reload - silently drops the WHOLE backlog with no flag left
        // to retry from. Deferring the clear into processBurst keeps them
        // pending until the pass actually starts, and avoids firing N
        // concurrent document updates in a performance round. (A reload
        // *during* the dialog still loses the burst; that is inherent to one
        // dialog covering many entries, and is the trade this round took.)
        enqueueRetro(entry, { clearNow: false });
        queued++;
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link sweep failed for "${entry?.name}"`, err);
      }
    }
    // Flush rather than wait out the idle gap: the whole backlog is already
    // known, so there is nothing more to coalesce.
    if (queued) await flushBurst();
  }
}
