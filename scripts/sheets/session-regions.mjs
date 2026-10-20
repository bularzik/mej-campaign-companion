// In-place region updates for the Session sheet (spec 2026-10-19 §4.4). Its
// editors are always available, so a live change - a Table talk note, an
// attendee, a start or end - must never re-render the sheet under someone's
// typing. Instead the regions that show live state, the header
// (session-header.hbs, data-cc-region="header"), Table talk (table-talk.hbs,
// data-cc-region="table-talk") and the Details tab's Secrets & clues
// (session.hbs, data-cc-region="secrets": a reveal shows to viewers), are
// rendered again from a fresh body context and swapped in; the editors, the
// tabs and everything else stay as they are. Never touches `.editor-parent`.
//
// No MEJ import (hooks load this before MEJ's sheet classes): a Session sheet
// is recognised by its type.
import { MODULE_ID } from "../constants.mjs";
import { shouldPatchRegions } from "../logic/editor-save.mjs";
import { sessionData } from "./session-data.mjs";
import { refreshIdleDisplays } from "./session-autosave.mjs";

const REGIONS = {
  header: `modules/${MODULE_ID}/templates/session-header.hbs`,
  "table-talk": `modules/${MODULE_ID}/templates/table-talk.hbs`,
  // Inline in the sheet's own template: rendered whole, the region picked out.
  secrets: `modules/${MODULE_ID}/templates/session.hbs`
};

/** A Session sheet (shell-hosted subsheet or popped out). */
export const isSessionSheet = (app) => app?.constructor?.type === "session";

/** Whether `app` takes region patches instead of re-renders (logic/editor-save.mjs). */
export const patchesRegions = (app) => shouldPatchRegions({ isSessionSheet: isSessionSheet(app) });

/** Every Session sheet currently showing a page: the shell's subsheet and popped-out windows. */
export function sessionViews(matches = null) {
  const out = new Set();
  const sub = game.MonksEnhancedJournal?.journal?.subsheet;
  if (isSessionSheet(sub) && game.MonksEnhancedJournal.journal.rendered) out.add(sub);
  for (const app of foundry.applications?.instances?.values?.() ?? []) {
    if (isSessionSheet(app) && app.rendered) out.add(app);
  }
  return [...out].filter((s) => s.trueElement?.isConnected && (!matches || matches(s.document)));
}

const QUEUES = new WeakMap();

/**
 * Re-render the header and Table talk regions of `sheet` in place. Calls on
 * one sheet run one at a time; calls that arrive while one is waiting share it.
 */
export function patchSessionRegions(sheet) {
  let q = QUEUES.get(sheet);
  if (!q) QUEUES.set(sheet, (q = { tail: Promise.resolve(), pending: null }));
  if (q.pending) return q.pending;
  const run = q.tail.then(() => {
    q.pending = null;
    return patch(sheet);
  }).catch((err) => console.error(`${MODULE_ID} | session region update failed`, err));
  q.pending = run;
  q.tail = run;
  return run;
}

/** Patch every open Session view whose page satisfies `matches` (a page document). */
export function patchSessionViews(matches) {
  return Promise.all(sessionViews(matches).map((s) => patchSessionRegions(s)));
}

async function patch(sheet) {
  const root = sheet.trueElement;
  const container = root?.querySelector?.(".session-container");
  if (!container?.isConnected || container.dataset.ccPage !== sheet.document?.uuid) return;

  // The same context a render builds (MEJ's shell: _prepareContext, then the
  // part context that runs _prepareBodyContext). `ccPatch` tells the sheet
  // this is not a re-render, so its editors are left alone.
  const options = { ccPatch: true, parts: ["main"] };
  const context = await sheet._prepareContext(options);
  await sheet._preparePartContext("main", context, options);
  const rendered = {};
  for (const [region, path] of Object.entries(REGIONS)) {
    const html = await foundry.applications.handlebars.renderTemplate(path, context);
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    rendered[region] = tpl.content.querySelector(`[data-cc-region="${region}"]`);
  }
  if (!container.isConnected) return;

  for (const [region, fresh] of Object.entries(rendered)) {
    const old = container.querySelector(`[data-cc-region="${region}"]`);
    if (!old || !fresh) continue;
    // A GM typing a secret's text: its change (on blur) saves it, and the
    // list catches up with the next patch or render.
    const active = old.ownerDocument.activeElement;
    if (region === "secrets" && old.contains(active) && active.matches("input, textarea, select")) continue;
    const keep = carryOver(old, fresh);
    old.replaceWith(fresh);
    keep();
  }
  sheet._bindRegions?.(container);
  syncDetailsFields(container, sheet.document);
  refreshIdleDisplays(root, sheet.document);
}

/**
 * What the user had in hand inside the old region: a focused field's text,
 * caret and focus (the title, the capture box), and the notes list's scroll.
 * Returns the step that puts it back once the new region is in.
 */
function carryOver(old, fresh) {
  const active = old.ownerDocument.activeElement;
  let focused = null;
  if (active && old.contains(active) && active.name && "value" in active) {
    const twin = fresh.querySelector(`[name="${CSS.escape(active.name)}"]`);
    if (twin) {
      twin.value = active.value;
      focused = { twin, start: active.selectionStart, end: active.selectionEnd };
    }
  } else if (active && old.contains(active) && active.matches("summary")) {
    // A section's summary (the user just folded it): its counterpart by position.
    const twin = fresh.querySelectorAll("summary")[[...old.querySelectorAll("summary")].indexOf(active)];
    if (twin) focused = { twin, start: null, end: null };
  }
  const LISTS = [".mej-cc-notes-list", ".secrets-list"];
  const scrolls = LISTS.map((sel) => old.querySelector(sel)?.scrollTop ?? 0);
  // A folded section stays folded (Secrets & clues is a <details>).
  const folds = [...old.querySelectorAll("details")].map((d) => d.open);
  return () => {
    LISTS.forEach((sel, i) => {
      const newList = fresh.querySelector(sel);
      if (newList && scrolls[i]) newList.scrollTop = scrolls[i];
    });
    const freshDetails = [...fresh.querySelectorAll("details")];
    if (freshDetails.length === folds.length) freshDetails.forEach((d, i) => { d.open = folds[i]; });
    if (!focused) return;
    focused.twin.focus({ preventScroll: true });
    if (focused.start === null) return;
    try {
      focused.twin.setSelectionRange?.(focused.start, focused.end);
    } catch {
      // number inputs have no selection
    }
  };
}

const DETAIL_FIELDS = ["sessionNumber", "campaignDate.year", "campaignDate.month", "campaignDate.day", "campaignDate.hour", "campaignDate.minute"];

// The Details tab's number and date fields are part of MEJ's submit-on-change
// form, which resubmits every field: a start that just filled the in-game
// date must not be written back as blanks by the next unrelated submit. Kept
// in step with the page unless the user is in that field.
function syncDetailsFields(container, page) {
  const data = sessionData(page);
  const active = container.ownerDocument.activeElement;
  for (const path of DETAIL_FIELDS) {
    const el = container.querySelector(`[name="flags.${MODULE_ID}.session.${path}"]`);
    if (!el || el === active) continue;
    const value = foundry.utils.getProperty(data, path);
    const text = value === null || value === undefined ? "" : String(value);
    if (el.value !== text) el.value = text;
  }
}
