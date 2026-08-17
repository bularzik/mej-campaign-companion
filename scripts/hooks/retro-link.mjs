// scripts/hooks/retro-link.mjs
// Retroactive auto-link pass (spec Part 2). The creating client stamps
// flags[MODULE_ID].retroLinkPending on every new MEJ-typed JournalEntry
// (preCreateJournalEntry fires locally only, and a creator always owns the
// document they just made — this is the "catch-up queue": no world-setting
// write, so players can enqueue too). The ACTIVE GM's client processes and
// clears the flag, either immediately (createJournalEntry broadcast) or at
// login (ready sweep) for entities created while no GM was connected.
import { buildRetroPlan } from "../logic/retro-link.mjs";
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

function planForEntity(entry) {
  const users = game.users.contents;
  const entityViewers = viewerIds(entry, users, isVisibleToUser);
  const norm = entry.name.trim().toLowerCase();
  const otherSameNamed = game.journal
    .filter((e) =>
      e.id !== entry.id &&
      mejType(e) &&
      e.name.trim().toLowerCase() === norm)
    .map((e) => ({ viewerIds: viewerIds(e, users, isVisibleToUser) }));
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
        isOwn: e.id === entry.id
      });
    }
  }
  return buildRetroPlan({
    entity: { uuid: entry.uuid, name: entry.name, viewerIds: entityViewers },
    pages,
    otherSameNamed
  });
}

/** Returns the writable rows the GM checked, or null on cancel/skip. */
async function confirmDialog(entry, writable, ambiguous) {
  const esc = foundry.utils.escapeHTML;
  const rowsHtml = writable.map((r, i) =>
    `<label class="mej-cc-retro-row"><input type="checkbox" name="row-${i}" checked> `
    + `${esc(r.pageName)} (${r.matchCount})</label>`
  ).join("");
  const ambHtml = ambiguous.length
    ? `<p>${game.i18n.localize(`${I18N}.retroLink.ambiguous`)}</p>`
      + `<ul>${ambiguous.map((r) => `<li>${esc(r.pageName)}</li>`).join("")}</ul>`
    : "";
  const content = `<div class="mej-cc-retro-link">`
    + `<p>${game.i18n.format(`${I18N}.retroLink.intro`, { name: esc(entry.name) })}</p>`
    + rowsHtml + ambHtml + `</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.retroLink.title`) },
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

async function whisperSummary(entry, applied, ambiguous) {
  const esc = foundry.utils.escapeHTML;
  const parts = [
    `<p>${game.i18n.format(`${I18N}.retroLink.summary`, { name: esc(entry.name), count: applied.length })}</p>`
  ];
  if (applied.length) {
    parts.push(`<ul>${applied.map((r) => `<li>${esc(r.pageName)} (${r.matchCount})</li>`).join("")}</ul>`);
  }
  if (ambiguous.length) {
    parts.push(`<p>${game.i18n.localize(`${I18N}.retroLink.ambiguous`)}</p>`
      + `<ul>${ambiguous.map((r) => `<li>${esc(r.pageName)}</li>`).join("")}</ul>`);
  }
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: parts.join("")
  });
}

// Hooks.callAll never awaits async handlers, so N rapid entity creations
// (e.g. a multi-section docx import, each stamped with the pending flag by
// preCreateJournalEntry above) fire N concurrent createJournalEntry handlers
// below. Each processPendingEntity pass plans against a snapshot of page
// text and later writes a whole new page.text.content - two overlapping
// passes that both match the same page would have the second write clobber
// the first's links, and confirm-mode dialogs would stack. Serialize every
// pass (hook-triggered and sweep-triggered alike) through this module-level
// promise chain instead. NOT logic/filing-queue.mjs's shared queue: a modal
// confirm dialog here must not block that queue's own (unrelated) timeline
// filings. Because planning happens inside the queued task itself, each
// pass re-reads current page content after any previous pass's writes have
// already landed.
let retroChain = Promise.resolve();
function enqueueRetro(entry) {
  retroChain = retroChain.then(() => processPendingEntity(entry)).catch((err) =>
    console.error(`${MODULE_ID} | retro-link queue failed`, err));
  return retroChain;
}

async function processPendingEntity(entry) {
  try {
    // Clear first: a reload mid-dialog must not replay the pass forever.
    await entry.unsetFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG);
    const mode = game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING);
    if (mode === "off") return;
    const { rows } = planForEntity(entry);
    if (!rows.length) return;
    const writable = rows.filter((r) => !r.ambiguous);
    const ambiguous = rows.filter((r) => r.ambiguous);
    let chosen = writable;
    if (mode === "confirm") {
      chosen = await confirmDialog(entry, writable, ambiguous);
      if (!chosen) return;
    }
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
    if (mode === "silent") await whisperSummary(entry, applied, ambiguous);
  } catch (err) {
    console.error(`${MODULE_ID} | retro-link failed for "${entry?.name}"`, err);
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
  // the pending flag; process them (sequentially — one dialog at a time in
  // confirm mode) once a GM logs in. Routed through the same enqueueRetro
  // chain as the createJournalEntry handler above, so a sweep pass and a
  // concurrently hook-triggered pass still can't interleave.
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
    for (const entry of game.journal.contents) {
      try {
        if (entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) await enqueueRetro(entry);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link sweep failed for "${entry?.name}"`, err);
      }
    }
  }
}
