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

/**
 * MEJ's own New Entry dialog creates the entry FIRST (with
 * flags["monks-enhanced-journal"].pagetype) and its _onCreate patch adds the
 * typed page afterward — so at preCreate time getMEJType(entry) can still be
 * false for a dialog-created entry. Check both the constructed document and
 * the raw entry-level MEJ flags.
 */
function isMejCandidate(entry) {
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
  const entities = entries.map((entry) => ({
    uuid: entry.uuid, name: entry.name, viewerIds: viewerIds(entry, users, isVisibleToUser)
  }));

  // Same-named twins, resolved for every entity in the burst in one pass over
  // the journal rather than one pass each. An entity in the burst can be
  // another's twin, so the burst is included in the search.
  const byName = new Map();
  for (const e of game.journal.contents) {
    if (!mejType(e)) continue;
    const norm = e.name.trim().toLowerCase();
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(e);
  }
  const otherSameNamed = {};
  for (const entity of entities) {
    const norm = entity.name.trim().toLowerCase();
    otherSameNamed[entity.uuid] = (byName.get(norm) ?? [])
      .filter((e) => e.uuid !== entity.uuid)
      .map((e) => ({ viewerIds: viewerIds(e, users, isVisibleToUser) }));
  }

  const pages = [];
  for (const e of game.journal.contents) {
    const entryViewers = viewerIds(e, users, isVisibleToUser);
    for (const p of e.pages.contents) {
      const content = p.text?.content;
      if (typeof content !== "string" || !content) continue;
      pages.push({
        uuid: p.uuid,
        name: e.name === p.name ? e.name : `${e.name}: ${p.name}`,
        content,
        viewerIds: entryViewers,
        noAutoLink: !!p.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG),
        entryUuid: e.uuid
      });
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

function ambiguousList(rows, single) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.filter((r) => r.ambiguous.length).map((r) => {
    const who = single ? "" : ` — ${r.ambiguous.map((m) => esc(m.entityName)).join(", ")}`;
    return `<li>${esc(r.pageName)}${who}</li>`;
  });
  if (!items.length) return "";
  return `<p>${game.i18n.localize(`${I18N}.retroLink.ambiguous`)}</p><ul>${items.join("")}</ul>`;
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
    + rowsHtml + ambiguousList(rows, single) + `</div>`;
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

async function whisperSummary(entities, applied, rows) {
  const esc = foundry.utils.escapeHTML;
  const single = entities.length === 1;
  const head = single
    ? game.i18n.format(`${I18N}.retroLink.summary`, { name: esc(entities[0].name), count: applied.length })
    : game.i18n.format(`${I18N}.retroLink.summaryMany`, { entities: entities.length, count: applied.length });
  const parts = [`<p>${head}</p>`];
  if (applied.length) {
    parts.push(`<ul>${applied.map((r) => `<li>${matchLabel(r, single)}</li>`).join("")}</ul>`);
  }
  const amb = ambiguousList(rows, single);
  if (amb) parts.push(amb);
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: parts.join("")
  });
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

function enqueueRetro(entry) {
  pendingBurst.set(entry.uuid, entry);
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = setTimeout(closeBurst, BURST_IDLE_MS);
  return retroChain;
}

function closeBurst() {
  burstTimer = null;
  const entries = [...pendingBurst.values()];
  pendingBurst.clear();
  if (!entries.length) return;
  // Still serialized: a burst that lands while an earlier one is mid-dialog
  // must wait, or the second plan plans against pages the first has not
  // written yet and its write would clobber theirs.
  retroChain = retroChain.then(() => processBurst(entries)).catch((err) =>
    console.error(`${MODULE_ID} | retro-link queue failed`, err));
  return retroChain;
}

/** Drain whatever is queued right now, without waiting out the idle gap. */
function flushBurst() {
  if (burstTimer) clearTimeout(burstTimer);
  return closeBurst() ?? retroChain;
}

async function processBurst(entries) {
  try {
    // Clear first: a reload mid-dialog must not replay the pass forever.
    for (const entry of entries) {
      try {
        await entry.unsetFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link flag clear failed for "${entry?.name}"`, err);
      }
    }
    const mode = game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING);
    if (mode === "off") return;
    const live = entries.filter((e) => e?.name);
    if (!live.length) return;
    const { rows } = planForBurst(live);
    if (!rows.length) return;

    let chosen = rows.filter((r) => r.newHtml && r.matches.length);
    if (mode === "confirm") {
      chosen = await confirmDialog(live, rows);
      if (!chosen) return;
    }
    // One write per page, carrying every entity that matched it - the reason
    // the burst can share a single plan without passes clobbering each other.
    const applied = [];
    for (const row of chosen) {
      try {
        const pageDoc = await fromUuid(row.pageUuid);
        if (!pageDoc) continue;
        await pageDoc.update({ "text.content": row.newHtml }, { [MODULE_ID]: { retroLink: true } });
        applied.push(row);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link write failed for ${row.pageUuid}`, err);
      }
    }
    if (mode === "silent") await whisperSummary(live, applied, rows);
  } catch (err) {
    console.error(`${MODULE_ID} | retro-link burst failed`, err);
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
        if (entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) { enqueueRetro(entry); queued++; }
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link sweep failed for "${entry?.name}"`, err);
      }
    }
    // Flush rather than wait out the idle gap: the whole backlog is already
    // known, so there is nothing more to coalesce.
    if (queued) await flushBurst();
  }
}
