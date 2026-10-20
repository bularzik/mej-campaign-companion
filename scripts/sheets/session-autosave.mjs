// Always-editable Recap, GM Prep and My Notes on the Session sheet (spec
// 2026-10-19 §4.4). No pencil and no Save button: a click (or keyboard focus)
// on an editor's enriched display mounts a live <prose-mirror> from the
// block's inert <template> and MEJ's own `.editing` class swaps the two.
// Leaving it (blur), switching tabs, closing the sheet or window, hiding the
// browser tab and - for GM Prep and My Notes - a periodic tick save it; blur
// also unmounts it again. Pure rules live in logic/editor-save.mjs.
//
// Why the editor exists only while someone types: Foundry keeps a server-side
// ProseMirror authority for a collaborative field while ANY participant is
// joined, and that authority's periodic autosave writes its own copy over
// the field (core dist/components/prosemirror.mjs #u: updateSource + save).
// An editor mounted for every owner who merely has the page open would keep
// that authority alive for the whole session and revert any other write to
// the recap (Add to recap, an image drop, auto-linking) within a minute.
//
// Saves never go through MEJ's submit-on-change form: that form resubmits
// every field on the sheet (title, number, date, image) from whatever this
// client rendered, which a save every blur would turn into a steady source of
// stale overwrites, and it reports no completion for the indicator. Recap and
// GM Prep write their one field with document.update(); My Notes writes MEJ's
// per-user flag directly, through MEJ's saveUserData socket action, or keeps a
// local draft while no GM is connected. Core's own save() (Ctrl+S, the menu's
// save button, and the save every active editor runs when it leaves the DOM)
// is intercepted through its cancelable "save" event and routed here, which
// is also what saves typing caught by a full re-render.
//
// No MEJ import: this module is loaded by hooks that run before (and
// without) MEJ's sheet classes.
import { MODULE_ID, I18N } from "../constants.mjs";
import { saveTriggers, autosaveIntervalMs, myNotesSavePath, needsCommit, canRefreshIdleEditor, withBufferedText, saveStateKey, saveFailureNotice, keptTextDecision, myNotesLanding, appendKept, keptEntries, EDITOR_IDS } from "../logic/editor-save.mjs";
import { NOTE_DRAFTS, myNotesDraftKey } from "../logic/input-draft.mjs";
import { createDraftStore } from "../logic/draft-store.mjs";
import { hasVisibleText } from "../logic/session-state.mjs";

const MEJ_ID = "monks-enhanced-journal";
const DOC_FIELDS = { recap: "system.recap", gmNotes: "system.gmNotes" };
const myNotesPath = (userId = game.user.id) => `flags.${MEJ_ID}.${userId}.notes`;
const RELAY_RETRY_MS = 4000;
const RELAY_MAX_TRIES = 10;
const IDLE_BEFORE_INTERVAL_SAVE_MS = 2000;
const RESTORE_WINDOW_MS = 5000;
/** A collaborative join still not live after this long is given up; anything typed is kept. */
const JOIN_TIMEOUT_MS = 10000;

/** Live editor element -> { pageUuid, editorId, baseline, view, retiring }. */
const EDITORS = new WeakMap();
/** `${pageUuid}|${editorId}` -> the indicator state ("saving" | "saved" | "noGM" | "failed"). */
const SAVE_STATES = new Map();
/** `${pageUuid}|${editorId}` -> { value, base }: Recap / GM Prep text written but not yet confirmed (kept on failure). */
const UNSAVED = new Map();
/** `${pageUuid}|${editorId}` -> [{ value, at }] oldest first: kept text that conflicted with newer stored text (never written automatically). */
const KEPT = new Map();
/** pageUuid -> { editorId, from, to, at }: the editor a full re-render took from under the user. */
const RESTORE = new Map();
/** Sheets with bound editors, for the window-level triggers. */
const BOUND = new Set();
/** pageUuid -> pending relay retry timer. */
const RELAY_TIMERS = new Map();
/** pageUuid -> the My Notes values this client has written or relayed (recent first), for confirmMyNotes. */
const SENT_NOTES = new Map();
const SENT_NOTES_MAX = 20;

function rememberSent(pageUuid, value) {
  const list = (SENT_NOTES.get(pageUuid) ?? []).filter((v) => v !== value);
  list.unshift(value);
  SENT_NOTES.set(pageUuid, list.slice(0, SENT_NOTES_MAX));
}

const keyOf = (pageUuid, editorId) => `${pageUuid}|${editorId}`;

// --- Unsaved text --------------------------------------------------------------
// Unsaved Recap / GM Prep text (UNSAVED) and My Notes drafts (NOTE_DRAFTS) are
// held in memory and mirrored to this device's storage (logic/draft-store.mjs),
// so a reload, a crash or a closed tab cannot lose them. A successful save
// clears both copies. Each kept value carries its base: the stored text it was
// edited from (or the last text this client saved over it). An AUTOMATIC
// write of kept text - restored at load, retried on the interval or when a GM
// connects - happens only while the stored text still equals that base
// (logic/editor-save.mjs keptTextDecision). Otherwise the kept text conflicts
// with newer text from someone else: it moves to KEPT, is never written by
// itself, and the editor shows the stored text with "Unsaved text from earlier
// was kept" and Show / Discard. Live typing commits as before.

const KEPT_SUFFIX = ":kept";

let draftStore = null;
function deviceDrafts() {
  const userId = game.user?.id;
  if (!userId) return null;
  if (draftStore?.userId !== userId) {
    draftStore = Object.assign(createDraftStore(() => globalThis.localStorage, userId), { userId });
  }
  return draftStore;
}

const storedValue = (page, editorId) => foundry.utils.getProperty(page, editorId === "myNotes" ? myNotesPath() : DOC_FIELDS[editorId]);
const storedText = (page, editorId) => {
  const v = storedValue(page, editorId);
  return typeof v === "string" ? v : "";
};

/** The in-memory unsaved entry ({ value, base }) for an editor, if any. */
function pendingEntry(pageUuid, editorId) {
  const e = editorId === "myNotes" ? NOTE_DRAFTS.get(myNotesDraftKey(pageUuid)) : UNSAVED.get(keyOf(pageUuid, editorId));
  return typeof e?.value === "string" ? e : undefined;
}
const pendingOf = (pageUuid, editorId) => pendingEntry(pageUuid, editorId)?.value;

function setPendingMemory(pageUuid, editorId, entry) {
  if (editorId === "myNotes") NOTE_DRAFTS.set(myNotesDraftKey(pageUuid), entry);
  else UNSAVED.set(keyOf(pageUuid, editorId), entry);
}

function dropPending(pageUuid, editorId) {
  if (editorId === "myNotes") NOTE_DRAFTS.delete(myNotesDraftKey(pageUuid));
  else UNSAVED.delete(keyOf(pageUuid, editorId));
  deviceDrafts()?.clear(pageUuid, editorId);
}

/** Hold `value` as not yet saved (in memory and on this device), edited from `base` (default: the stored text now). */
function keepPending(page, editorId, value, base = storedText(page, editorId)) {
  setPendingMemory(page.uuid, editorId, { value, base });
  deviceDrafts()?.save(page.uuid, editorId, value, base);
}

/**
 * `value` was saved: drop the unsaved copies, unless newer text replaced them
 * meanwhile - that text is now edited from what this client just saved.
 */
function settlePending(pageUuid, editorId, value) {
  const entry = pendingEntry(pageUuid, editorId);
  if (!entry) return;
  if (entry.value === value) return dropPending(pageUuid, editorId);
  entry.base = value;
  deviceDrafts()?.save(pageUuid, editorId, entry.value, value);
}

/** Kept text that conflicted with newer stored text ([{ value, at }], oldest first): never written automatically. */
const keptOf = (pageUuid, editorId) => KEPT.get(keyOf(pageUuid, editorId));

function storeKept(pageUuid, editorId, entries) {
  if (!entries?.length) {
    KEPT.delete(keyOf(pageUuid, editorId));
    deviceDrafts()?.clear(pageUuid, `${editorId}${KEPT_SUFFIX}`);
    return;
  }
  KEPT.set(keyOf(pageUuid, editorId), entries);
  deviceDrafts()?.save(pageUuid, `${editorId}${KEPT_SUFFIX}`, JSON.stringify(entries), null);
}

function moveToKept(page, editorId, value) {
  dropPending(page.uuid, editorId);
  // A later conflict on the same field adds to what is already kept.
  storeKept(page.uuid, editorId, appendKept(keptOf(page.uuid, editorId) ?? [], { value, at: Date.now() }));
  // No "Couldn't save" for text that is safely kept: the line shows the kept notice instead.
  if (["failed", "noGM", "saving"].includes(saveStateOf(page.uuid, editorId))) SAVE_STATES.delete(keyOf(page.uuid, editorId));
  repaintIndicators(page.uuid, editorId);
  for (const parent of parentsFor(page.uuid, editorId)) {
    if (!parent.classList.contains("editing")) refreshDisplay(parent, page, editorId, storedText(page, editorId));
  }
}

/** Throw away kept text (the user chose Discard). */
export function discardKept(pageUuid, editorId) {
  storeKept(pageUuid, editorId, []);
  repaintIndicators(pageUuid, editorId);
}

/**
 * Apply keptTextDecision to an editor's unsaved text against the stored text
 * now: already stored -> cleared; edited from older text than is stored ->
 * kept as a conflict. Returns the decision, or null when nothing is pending.
 */
function reconcile(page, editorId) {
  // Kept text that has since been stored (by anyone) is nothing to keep.
  const kept = page ? keptOf(page.uuid, editorId) : undefined;
  if (kept?.some((e) => e.value === storedText(page, editorId))) {
    storeKept(page.uuid, editorId, kept.filter((e) => e.value !== storedText(page, editorId)));
    repaintIndicators(page.uuid, editorId);
  }
  const entry = page ? pendingEntry(page.uuid, editorId) : undefined;
  if (!entry) return null;
  const decision = keptTextDecision({ value: entry.value, base: entry.base, stored: storedValue(page, editorId) });
  if (decision === "clear") {
    dropPending(page.uuid, editorId);
    if (["failed", "noGM"].includes(saveStateOf(page.uuid, editorId))) setSaveState(page.uuid, editorId, "saved");
  } else if (decision === "conflict") {
    moveToKept(page, editorId, entry.value);
  }
  return decision;
}

/**
 * Bring what an earlier load left on this device back into memory: unsaved
 * text (with its indicator state, "Couldn't save" or "Can't save until a GM
 * connects", unless it is already stored or now conflicts) and kept text.
 */
function rehydrate(page, editorId) {
  if (!page) return;
  const kept = deviceDrafts()?.load(page.uuid, `${editorId}${KEPT_SUFFIX}`);
  if (kept && keptOf(page.uuid, editorId) === undefined) {
    const entries = keptEntries(kept.value, kept.at).reverse().filter((e) => e.value !== storedText(page, editorId));
    storeKept(page.uuid, editorId, entries);
  }
  if (pendingEntry(page.uuid, editorId)) return;
  const draft = deviceDrafts()?.load(page.uuid, editorId);
  if (!draft) return;
  setPendingMemory(page.uuid, editorId, { value: draft.value, base: draft.base });
  if (reconcile(page, editorId) !== "write") return;
  const key = keyOf(page.uuid, editorId);
  if (!SAVE_STATES.has(key)) {
    const noGM = editorId === "myNotes" && myNotesSavePath({ canEditPage: canEditPage(page), hasActiveGM: !!game.users.activeGM }) === "draft";
    SAVE_STATES.set(key, noGM ? "noGM" : "failed");
  }
}

/** An automatic write of an editor's unsaved text: only while the stored text is still its base. */
function retryPending(page, editorId) {
  if (reconcile(page, editorId) !== "write") return null;
  const entry = pendingEntry(page.uuid, editorId);
  return editorId === "myNotes" ? writeMyNotes(page, entry.value, entry.base) : writeDocField(page, editorId, entry.value, entry.base);
}

/** At load: offer what an earlier load left on this device, and retry unsaved text that can still be written. */
export function restoreDeviceDrafts() {
  for (const { pageUuid, field } of deviceDrafts()?.list() ?? []) {
    const editorId = field.endsWith(KEPT_SUFFIX) ? field.slice(0, -KEPT_SUFFIX.length) : field;
    if (!EDITOR_IDS.includes(editorId)) continue;
    const page = pageOf(pageUuid);
    // The page was deleted: nothing can show or save its draft any more.
    if (!page && !pageUuid.startsWith("Compendium.")) {
      deviceDrafts()?.clear(pageUuid, field);
      continue;
    }
    if (!page) continue;
    try {
      rehydrate(page, editorId);
      if (field === editorId) retryPending(page, editorId);
    } catch (err) {
      console.error(`${MODULE_ID} | restoring the ${editorId} draft failed`, err);
    }
  }
}

function pageOf(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/** The text an editor opens with, and its display shows: anything not yet saved wins over the stored value. */
export function editorValue(page, editorId) {
  if (!page) return "";
  rehydrate(page, editorId);
  reconcile(page, editorId);
  const pending = pendingOf(page.uuid, editorId);
  if (typeof pending === "string") return pending;
  return storedText(page, editorId);
}

/** The indicator state to render for an editor (survives re-renders). */
export function saveStateOf(pageUuid, editorId) {
  return SAVE_STATES.get(keyOf(pageUuid, editorId)) ?? null;
}

/** Set and paint an editor's indicator state; returns how many indicators show it. */
function setSaveState(pageUuid, editorId, state) {
  if (state) SAVE_STATES.set(keyOf(pageUuid, editorId), state);
  else SAVE_STATES.delete(keyOf(pageUuid, editorId));
  const key = saveStateKey(state);
  const text = key ? game.i18n.localize(`${I18N}.${key}`) : "";
  const sel = `.session-container[data-cc-page="${CSS.escape(pageUuid)}"] .editor-parent[data-editor-id="${editorId}"] .mej-cc-save-state`;
  const indicators = [...document.querySelectorAll(sel)].filter((el) => el.isConnected);
  const kept = keptOf(pageUuid, editorId) !== undefined;
  for (const el of indicators) paintState(el, state, text, kept);
  // Nobody can see "Couldn't save" (the sheet closed while the write was in flight): say so.
  const notice = saveFailureNotice({ state, indicators: indicators.length, editorId });
  if (notice) {
    const field = game.i18n.localize(`${I18N}.${notice.fieldKey}`);
    ui.notifications?.error(game.i18n.format(`${I18N}.${notice.key}`, { field }), { permanent: true });
  }
  return indicators.length;
}

function paintState(el, state, text, kept = false) {
  el.replaceChildren();
  if (text) el.append(text);
  el.dataset.state = state ?? "";
  el.dataset.kept = kept ? "1" : "";
  if (!kept) return;
  const L = (k) => game.i18n.localize(`${I18N}.session.${k}`);
  const line = document.createElement("span");
  line.className = "mej-cc-kept";
  line.append(L("keptNotice"));
  for (const [action, key] of [["show", "keptShow"], ["discard", "keptDiscard"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mej-cc-kept-${action}`;
    button.dataset.ccKept = action;
    button.textContent = L(key);
    line.append(" ", button);
  }
  if (text) el.append(" ");
  el.append(line);
}

function parentsFor(pageUuid, editorId) {
  return [...document.querySelectorAll(`.session-container[data-cc-page="${CSS.escape(pageUuid)}"] .editor-parent[data-editor-id="${editorId}"]`)];
}

function repaintIndicators(pageUuid, editorId) {
  const state = saveStateOf(pageUuid, editorId);
  const key = saveStateKey(state);
  const text = key ? game.i18n.localize(`${I18N}.${key}`) : "";
  const kept = keptOf(pageUuid, editorId) !== undefined;
  for (const parent of parentsFor(pageUuid, editorId)) {
    const el = parent.querySelector(":scope > .mej-cc-save-state");
    if (el) paintState(el, state, text, kept);
  }
}

/** Kept HTML as plain text, block by block, for the Show dialog. */
function keptPlainText(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr").forEach((b) => b.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

const FIELD_LABELS = { recap: "tabs.description", gmNotes: "session.gmNotes", myNotes: "tabs.notes" };

async function showKept(pageUuid, editorId) {
  const entries = [...(keptOf(pageUuid, editorId) ?? [])].sort((a, b) => b.at - a.at);
  if (!entries.length) return;
  const esc = foundry.utils.escapeHTML;
  const field = game.i18n.localize(`${I18N}.${FIELD_LABELS[editorId]}`);
  await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format(`${I18N}.session.keptTitle`, { field }) },
    classes: ["mej-cc-kept-dialog"],
    // Every kept text, newest first, as plain selectable text.
    content: `<p>${esc(game.i18n.localize(`${I18N}.session.keptHint`))}</p>
      <div style="max-height: 60vh; overflow: auto;">${entries.map((e) => `<section class="mej-cc-kept-entry">
        ${e.at ? `<p class="mej-cc-kept-time"><strong>${esc(new Date(e.at).toLocaleString())}</strong></p>` : ""}
        <div class="mej-cc-kept-text" style="white-space: pre-wrap; user-select: text;">${esc(keptPlainText(e.value))}</div>
      </section>`).join("")}</div>`,
    ok: { label: game.i18n.localize(`${I18N}.session.keptClose`) },
    rejectClose: false
  });
}

// --- Writing ------------------------------------------------------------------

async function writeDocField(page, editorId, value, base = storedText(page, editorId)) {
  const key = keyOf(page.uuid, editorId);
  const field = DOC_FIELDS[editorId];
  keepPending(page, editorId, value, base);
  // Already stored (core's collaborative autosave may have written it): nothing to send.
  if (foundry.utils.getProperty(page, field) === value) {
    settlePending(page.uuid, editorId, value);
    setSaveState(page.uuid, editorId, "saved");
    return true;
  }
  setSaveState(page.uuid, editorId, "saving");
  try {
    await page.update({ [field]: value });
    settlePending(page.uuid, editorId, value);
    if (!UNSAVED.has(key)) setSaveState(page.uuid, editorId, "saved");
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | ${editorId} could not be saved`, err);
    // With no indicator on screen, setSaveState announces the failure itself.
    const shown = setSaveState(page.uuid, editorId, "failed");
    if (shown && editorId === "gmNotes") ui.notifications.error(game.i18n.localize(`${I18N}.session.gmNotesSaveFailed`));
    return false;
  }
}

function canEditPage(page) {
  try {
    return !!page?.canUserModify?.(game.user, "update");
  } catch {
    return false;
  }
}

/** Save My Notes for `page` by whichever path is open now (logic/editor-save.mjs myNotesSavePath). */
export async function writeMyNotes(page, value, base = storedText(page, "myNotes")) {
  const draftKey = myNotesDraftKey(page.uuid);
  keepPending(page, "myNotes", value, base);
  const path = myNotesSavePath({ canEditPage: canEditPage(page), hasActiveGM: !!game.users.activeGM });
  if (path === "draft") {
    setSaveState(page.uuid, "myNotes", "noGM");
    return false;
  }
  if (foundry.utils.getProperty(page, myNotesPath()) === value) {
    settlePending(page.uuid, "myNotes", value);
    setSaveState(page.uuid, "myNotes", "saved");
    return true;
  }
  setSaveState(page.uuid, "myNotes", "saving");
  if (path === "relay") {
    relayMyNotes(page, 0);
    return true;
  }
  try {
    rememberSent(page.uuid, value);
    await page.update({ [myNotesPath()]: value });
    settlePending(page.uuid, "myNotes", value);
    if (!NOTE_DRAFTS.has(draftKey)) setSaveState(page.uuid, "myNotes", "saved");
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | My Notes could not be saved`, err);
    setSaveState(page.uuid, "myNotes", "failed");
    return false;
  }
}

// MEJ's saveUserData has no reply: the GM's write arrives here as an update
// (confirmMyNotes). A GM who has only just connected may not have MEJ's socket
// listener up yet, so the request is repeated until it lands.
function relayMyNotes(page, tries) {
  clearTimeout(RELAY_TIMERS.get(page.uuid));
  // A repeat is an automatic write: only while the stored notes are still the draft's base.
  if (tries > 0 && reconcile(page, "myNotes") !== "write") return;
  const draft = NOTE_DRAFTS.get(myNotesDraftKey(page.uuid));
  if (typeof draft?.value !== "string") return;
  if (!game.users.activeGM) {
    setSaveState(page.uuid, "myNotes", "noGM");
    return;
  }
  try {
    rememberSent(page.uuid, draft.value);
    game.MonksEnhancedJournal.emit("saveUserData", { documentId: page.uuid, userId: game.user.id, userdata: { notes: draft.value } });
  } catch (err) {
    console.error(`${MODULE_ID} | My Notes relay failed`, err);
    setSaveState(page.uuid, "myNotes", "failed");
    return;
  }
  setSaveState(page.uuid, "myNotes", "saving");
  RELAY_TIMERS.set(page.uuid, setTimeout(() => {
    RELAY_TIMERS.delete(page.uuid);
    if (!NOTE_DRAFTS.has(myNotesDraftKey(page.uuid))) return;
    if (tries + 1 >= RELAY_MAX_TRIES) return setSaveState(page.uuid, "myNotes", "failed");
    relayMyNotes(page, tries + 1);
  }, RELAY_RETRY_MS));
}

function confirmMyNotes(page, changes) {
  if (foundry.utils.getProperty(changes, myNotesPath()) === undefined) return;
  const draftKey = myNotesDraftKey(page.uuid);
  const draft = NOTE_DRAFTS.get(draftKey);
  const landed = storedText(page, "myNotes");
  // Only what this client sent counts: the same user's other browser saving
  // leaves the draft and its base alone, so the next automatic retry sees the conflict.
  const outcome = myNotesLanding({ landed, draftValue: draft?.value, sent: SENT_NOTES.get(page.uuid) ?? [] });
  if (outcome === "ignore") return;
  if (outcome === "rebase") {
    // Newer typing still pending: it is now edited from what this client just saved.
    draft.base = landed;
    deviceDrafts()?.save(page.uuid, "myNotes", draft.value, draft.base);
    return;
  }
  NOTE_DRAFTS.delete(draftKey);
  deviceDrafts()?.clear(page.uuid, "myNotes");
  clearTimeout(RELAY_TIMERS.get(page.uuid));
  RELAY_TIMERS.delete(page.uuid);
  setSaveState(page.uuid, "myNotes", "saved");
}

/** Retry every My Notes draft a GM can now save (a GM connected); conflicting ones are kept, never written. */
function retryMyNotesDrafts() {
  // Drafts an earlier load left on this device are retried too.
  for (const { pageUuid, field } of deviceDrafts()?.list() ?? []) {
    if (field === "myNotes") rehydrate(pageOf(pageUuid), "myNotes");
  }
  for (const key of [...NOTE_DRAFTS.keys()]) {
    if (!key.startsWith("mynotes:")) continue;
    const page = pageOf(key.slice("mynotes:".length));
    if (page) retryPending(page, "myNotes");
  }
}

// --- Editor lifecycle ------------------------------------------------------------

const partsOf = (parent) => ({
  display: parent.querySelector(":scope > .editor-display"),
  control: parent.querySelector(":scope > .editor-control"),
  template: parent.querySelector(":scope > .editor-control > template.mej-cc-editor-template"),
  editor: parent.querySelector(":scope > .editor-control > prose-mirror")
});

function parentsIn(root) {
  if (!root?.querySelectorAll) return [];
  return EDITOR_IDS.map((id) => root.querySelector(`.session-container .editor-parent[data-editor-id="${id}"]`)).filter(Boolean);
}

/**
 * Write an editor's content when it changed since it opened or last saved.
 * Synchronous up to the write call, so a caller about to tear the editor down
 * (close, re-render) has the request on its way before the DOM goes.
 */
function commitEditor(editor, trigger) {
  const st = EDITORS.get(editor);
  if (!st || st.retiring || !saveTriggers(trigger)) return null;
  // Leaving an editor whose join never went live: what was typed meanwhile is
  // saved like any other text, never dropped (spec 2026-10-19 §2 anti-goal).
  if (st.buffer && !st.view && (trigger === "blur" || trigger === "close")) return salvageBuffer(st);
  let live;
  try {
    live = editor.value;
  } catch (err) {
    console.error(`${MODULE_ID} | reading the ${st.editorId} editor failed`, err);
    return null;
  }
  if (!needsCommit({ live, baseline: st.baseline })) return null;
  const page = pageOf(st.pageUuid);
  if (!page) return null;
  st.baseline = live;
  return st.editorId === "myNotes" ? writeMyNotes(page, live) : writeDocField(page, st.editorId, live);
}

/**
 * Merge characters typed before the editor went live into the editor's text
 * and write it through the normal single-field path (which keeps it as
 * unsaved text, shown and retried, if the write fails).
 */
function salvageBuffer(st, { failed = false } = {}) {
  const page = pageOf(st.pageUuid);
  if (!page || !st.buffer) return null;
  const value = withBufferedText(editorValue(page, st.editorId), st.buffer);
  st.buffer = "";
  st.salvaged = value;
  if (failed) {
    keepPending(page, st.editorId, value);
    setSaveState(page.uuid, st.editorId, "failed");
    return null;
  }
  return st.editorId === "myNotes" ? writeMyNotes(page, value) : writeDocField(page, st.editorId, value);
}

function rememberCaret(editor) {
  const st = EDITORS.get(editor);
  const sel = st?.view?.state?.selection;
  if (!st || !sel) return;
  RESTORE.set(st.pageUuid, { editorId: st.editorId, from: sel.from, to: sel.to, at: Date.now() });
}

async function refreshDisplay(parent, page, editorId, html) {
  const { display } = partsOf(parent);
  if (!display || !page) return;
  let content;
  if (editorId === "recap" && !hasVisibleText(html)) {
    content = `<p class="instruction mej-cc-no-recap">${game.i18n.localize(`${I18N}.session.noRecap`)}</p>`;
  } else {
    content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", {
      relativeTo: page, secrets: editorId === "myNotes" ? true : page.isOwner, async: true
    });
  }
  if (!parent.classList.contains("editing")) display.innerHTML = content;
}

/** Mount the live editor for `parent` and put the caret where the user clicked (or at the end). */
export function enterEditing(parent, { coords = null, selection = null } = {}) {
  if (!parent?.isConnected || parent.classList.contains("editing")) return;
  const { template, control, display } = partsOf(parent);
  const root = parent.closest(".session-container");
  const page = pageOf(root?.dataset.ccPage);
  if (!template || !control || !page) return;
  const editorId = parent.dataset.editorId;
  const editor = template.content.firstElementChild.cloneNode(true);
  editor.setAttribute("value", editorValue(page, editorId));
  const st = { pageUuid: page.uuid, editorId, baseline: undefined, view: null, retiring: false, buffer: "" };
  EDITORS.set(editor, st);
  if (editor.hasAttribute("collaborate")) st.instance = `${page.uuid}#${editor.getAttribute("name")}`;

  // Capture the view through core's documented plugin hook (prosemirror-editor.mjs
  // _configurePlugins dispatches "plugins" with the plugin record it will use).
  editor.addEventListener("plugins", (event) => {
    // Core emits pm.editDocument right after this event, in the same task.
    if (st.instance) trackJoin(editor, st);
    // Core's menu renders by looking itself up with document.getElementById,
    // which throws (an uncaught error) when the join lands on an editor that
    // already left the page. Such an editor gets no menu, so its activation
    // completes and "open" below retires it at once (synchronously after core
    // registers it, so no pm.usersEditing broadcast can reach the menu-less
    // editor in between). Not while another live editor of this field is in
    // this client: a completed activation would replace that editor in core's
    // per-instance editor map, so the abandoned one is left to fail instead.
    const menuView = event.plugins.menu?.spec?.view;
    if (typeof menuView === "function") {
      event.plugins.menu.spec.view = (view) => (editor.isConnected || liveSiblingOf(editor, st) ? menuView(view) : {});
    }
    event.plugins.mejCcSessionEditor = new ProseMirror.Plugin({
      view: (view) => {
        st.view = view;
        return { destroy: () => { if (st.view === view) st.view = null; } };
      }
    });
  });
  // Core dispatches "open" without bubbling once the editor is live.
  editor.addEventListener("open", () => {
    st.baseline = editor.value;
    // A collaborative join can finish after the user has already clicked away
    // (or a re-render, a tab switch, a close or the join timeout removed the
    // editor): end it, so no server authority outlives it.
    untrackJoin(st);
    if (!editor.isConnected || st.retiring) return retireAbandonedEditor(editor, st);
    if (parent.classList.contains("editing")) placeCaret(st, { coords, selection });
  });
  // Every core save (Ctrl+S, the menu's save, leaving the DOM) comes here instead.
  editor.addEventListener("save", (event) => {
    event.preventDefault();
    if (st.retiring) return;
    if (!editor.isConnected && parent.classList.contains("editing")) rememberCaret(editor);
    commitEditor(editor, "close");
  });

  // A join that never goes live (core's activation rejected, or the server
  // never answered): give the editor up, keep what was typed as unsaved text
  // with "Couldn't save" (the interval retries it), and show the display.
  setTimeout(() => {
    if (!editor.isConnected || st.retiring || st.baseline !== undefined) return;
    console.warn(`${MODULE_ID} | the ${editorId} editor did not become live within ${JOIN_TIMEOUT_MS}ms`);
    salvageBuffer(st, { failed: true });
    const html = st.salvaged;
    st.retiring = true;
    parent.classList.remove("editing");
    editor.remove();
    endAbandonedJoin(editor, st);
    if (display && display.hasAttribute("tabindex")) display.tabIndex = 0;
    if (typeof html === "string") refreshDisplay(parent, page, editorId, html);
  }, JOIN_TIMEOUT_MS);

  // Until the editor is live, keep focus inside the block and hold typed characters.
  control.tabIndex = -1;
  parent.classList.add("editing");
  control.append(editor);
  if (!editor.classList.contains("active")) control.focus({ preventScroll: true });
  if (display) display.tabIndex = -1;
}

// --- Abandoned collaborative joins ------------------------------------------------
// The server adds this user to a field's editing session (its ProseMirror
// authority) as soon as pm.editDocument arrives, before the client has a view.
// If the <prose-mirror> leaves the page while that join is in flight (a
// click-away within the join's latency, a sheet re-render, a close, the join
// timeout), core's disconnectedCallback skips destroy() (the editor was not
// active yet) and, unaided, its activation then throws on the detached element
// (its menu looks itself up with document.getElementById): no editor instance,
// no destroy(), and pm.endSession is never sent. The authority would stay
// alive and its periodic autosave would write its stale copy over every later
// write to the field (Add to recap, an image drop, salvaged keystrokes).
// Two guards, each enough on its own: the server confirms a join with a
// pm.usersEditing broadcast to everyone in the session, this user included,
// and an abandoned join is ended from there (or at once, if that broadcast
// already came); and the menu is skipped on a detached editor, so the
// activation completes and "open" retires it through core's own destroy().

/** instance ("<pageUuid>#system.recap") -> Set of { editor, st } joins still in flight. */
const JOINS = new Map();

function trackJoin(editor, st) {
  if (!JOINS.has(st.instance)) JOINS.set(st.instance, new Set());
  st.join = { editor, st };
  JOINS.get(st.instance).add(st.join);
}

function untrackJoin(st) {
  if (!st.join) return;
  JOINS.get(st.instance)?.delete(st.join);
  if (!JOINS.get(st.instance)?.size) JOINS.delete(st.instance);
  st.join = null;
}

/** The editor left the page before its join went live: end the server session once the server has it. */
function endAbandonedJoin(editor, st) {
  if (!st.instance || !st.join || st.baseline !== undefined) return;
  if (!st.registered) return; // onUsersEditing ends it when the server's confirmation arrives
  untrackJoin(st);
  // Another editor of this field in this client holds the same per-user session.
  if (liveSiblingOf(editor, st)) return;
  try {
    game.socket.emit("pm.endSession", st.instance);
  } catch (err) {
    console.error(`${MODULE_ID} | ending the abandoned ${st.editorId} editing session failed`, err);
  }
}

function onUsersEditing(instance, users) {
  const joins = JOINS.get(instance);
  if (!joins || !users?.includes?.(game.user.id)) return;
  for (const { editor, st } of [...joins]) {
    st.registered = true;
    if (!editor.isConnected || st.retiring) endAbandonedJoin(editor, st);
  }
}

/**
 * A collaborative join that went live on an editor already taken out of the
 * page (its menu skipped, see the "plugins" listener). Putting the element
 * back for a moment and taking it out again runs core's own disconnect with
 * the editor active: its save is intercepted (a no-op while retiring) and
 * destroy() sends pm.endSession (Foundry 13 and 14 alike). A second
 * pm.endSession after onUsersEditing's is harmless: the server ignores a user
 * who is no longer in the session. Anything still in the join buffer is
 * saved first.
 */
function retireAbandonedEditor(editor, st) {
  if (st.buffer) salvageBuffer(st);
  st.retiring = true;
  // Another editor of this field in this client (a click back in while this
  // join was in flight) holds the same per-user server session; its own
  // teardown ends it, and ending it now would cut that editor off.
  if (liveSiblingOf(editor, st)) return;
  const doc = editor.ownerDocument ?? document;
  const holder = doc.createElement("div");
  holder.hidden = true;
  holder.className = "mej-cc-retired-editor";
  try {
    doc.body.append(holder);
    holder.append(editor);
  } catch (err) {
    console.error(`${MODULE_ID} | ending the abandoned ${st.editorId} editing session failed`, err);
  } finally {
    holder.remove();
  }
}

function liveSiblingOf(editor, st) {
  const sel = `.session-container[data-cc-page="${CSS.escape(st.pageUuid)}"] .editor-parent[data-editor-id="${st.editorId}"] > .editor-control > prose-mirror`;
  for (const other of document.querySelectorAll(sel)) {
    const o = other !== editor ? EDITORS.get(other) : null;
    if (o && !o.retiring) return true;
  }
  return false;
}

function placeCaret(st, { coords, selection }) {
  const view = st.view;
  if (!view) return;
  try {
    const doc = view.state.doc;
    let sel = null;
    if (selection) {
      const max = doc.content.size;
      sel = ProseMirror.TextSelection.create(doc, Math.min(selection.from, max), Math.min(selection.to, max));
    } else if (coords) {
      // The click landed on the display; the editor now in its place starts
      // lower (its toolbar), so carry the point over by the two tops. A
      // point outside the text (below the last line) means "at the end".
      const top = view.dom.getBoundingClientRect().top;
      const hit = view.posAtCoords({ left: coords.x, top: coords.y - coords.top + top });
      if (hit && hit.inside >= 0) sel = ProseMirror.TextSelection.create(doc, hit.pos);
    }
    sel ??= ProseMirror.TextSelection.atEnd(doc);
    let tr = view.state.tr.setSelection(sel);
    if (st.buffer) tr = tr.insertText(st.buffer);
    st.buffer = "";
    view.dispatch(tr.scrollIntoView());
    view.focus();
  } catch (err) {
    console.error(`${MODULE_ID} | placing the caret failed`, err);
    view.focus();
  }
}

/** Save and unmount the live editor of `parent`; the display shows what was just written. */
export function exitEditing(parent, trigger = "blur") {
  if (!parent?.classList.contains("editing")) return;
  const { editor, display } = partsOf(parent);
  const st = editor ? EDITORS.get(editor) : null;
  let html = null;
  if (editor && st) {
    const wrote = commitEditor(editor, trigger);
    try {
      // Nothing written: show what the field holds now (the stored text, if the
      // editor's earlier unsaved text has just been kept aside as a conflict).
      html = wrote ? (st.salvaged ?? editor.value) : editorValue(pageOf(st.pageUuid), st.editorId);
    } catch {
      html = null;
    }
    st.retiring = true;
  }
  parent.classList.remove("editing");
  editor?.remove();
  if (editor && st) endAbandonedJoin(editor, st);
  if (display && display.hasAttribute("tabindex")) display.tabIndex = 0;
  if (st && typeof html === "string") refreshDisplay(parent, pageOf(st.pageUuid), st.editorId, html);
}

/** Commit every live editor of a sheet without unmounting (close, re-render, tab change, hidden tab). */
export function flushSessionEditors(sheet, trigger) {
  const root = sheet?.trueElement;
  for (const parent of parentsIn(root)) {
    const { editor } = partsOf(parent);
    if (!editor) continue;
    if (trigger === "close" && parent.classList.contains("editing") && editor.contains(document.activeElement)) rememberCaret(editor);
    commitEditor(editor, trigger);
  }
}

/** Switch to the editor's tab and start typing in it (the toolbar's edit control, the prep board's link). */
export function focusSessionEditor(sheet, editorId, event) {
  const root = sheet?.trueElement;
  const parent = root?.querySelector?.(`.session-container .editor-parent[data-editor-id="${editorId}"]`);
  if (!parent || !partsOf(parent).template) return;
  const tab = parent.closest(".tab[data-tab]")?.dataset.tab;
  if (tab && sheet.tabGroups?.primary !== tab) {
    const navElement = root.querySelector(".sheet-tabs.tabs");
    try {
      sheet.changeTab.call(sheet.enhancedjournal || sheet, tab, "primary", { event, navElement });
    } catch (err) {
      console.error(`${MODULE_ID} | switching to the ${tab} tab failed`, err);
    }
  }
  if (parent.classList.contains("editing")) {
    const st = EDITORS.get(partsOf(parent).editor);
    st?.view?.focus();
  } else {
    enterEditing(parent);
  }
}

/** Whether the user is typing in (or has unsaved text in) an editor - remote changes must leave it alone. */
export function isEditorBusy(parent) {
  if (!parent) return false;
  const pageUuid = parent.closest(".session-container")?.dataset.ccPage;
  const editorId = parent.dataset.editorId;
  const { editor } = partsOf(parent);
  const st = editor ? EDITORS.get(editor) : null;
  let dirty = false;
  try {
    dirty = !!st && (!!st.buffer || needsCommit({ live: editor.value, baseline: st.baseline }));
  } catch {
    dirty = true;
  }
  // Unsaved text that newer stored text has overtaken is kept aside, not shown.
  if (!parent.classList.contains("editing")) reconcile(pageOf(pageUuid), editorId);
  const pending = pendingOf(pageUuid, editorId) !== undefined;
  return !canRefreshIdleEditor({ editing: parent.classList.contains("editing"), dirty, pending });
}

/** Repaint idle displays from the stored values (a remote save, or our own landing). */
export function refreshIdleDisplays(root, page, editorIds = ["recap", "gmNotes"]) {
  for (const parent of parentsIn(root)) {
    const id = parent.dataset.editorId;
    if (!editorIds.includes(id) || isEditorBusy(parent)) continue;
    refreshDisplay(parent, page, id, editorValue(page, id));
  }
}

// --- Binding ---------------------------------------------------------------------

function isInteractive(target) {
  return !!target?.closest?.("a[href], a.content-link, a.inline-roll, button, input, select, textarea, secret-block button, .reveal");
}

function bindParent(sheet, parent) {
  const { display, template } = partsOf(parent);
  if (!display || !template || parent.dataset.ccBound) return;
  parent.dataset.ccBound = "1";
  const editorId = parent.dataset.editorId;

  // Click into the text to type; links, buttons and a fresh text selection
  // (the entity-from-selection menu reads one) keep their own meaning.
  display.addEventListener("click", (event) => {
    if (event.button !== 0 || isInteractive(event.target)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && display.contains(sel.anchorNode)) return;
    const top = display.getBoundingClientRect().top - display.scrollTop;
    enterEditing(parent, { coords: { x: event.clientX, y: event.clientY, top } });
  });
  display.addEventListener("keydown", (event) => {
    if (event.target !== display || !["Enter", "F2"].includes(event.key)) return;
    event.preventDefault();
    enterEditing(parent);
  });
  // Keyboard focus (Tab) on the display opens it; a mouse focus waits for the click.
  display.addEventListener("focus", () => {
    if (parent.dataset.ccNoReopen) return void delete parent.dataset.ccNoReopen;
    if (display.matches(":focus-visible")) enterEditing(parent);
  });

  // Characters typed while a collaborative editor is still joining.
  parent.addEventListener("keydown", (event) => {
    const editor = partsOf(parent).editor;
    const st = editor ? EDITORS.get(editor) : null;
    if (st && !st.view && parent.classList.contains("editing") && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      st.buffer += event.key;
      event.preventDefault();
    }
    if (event.key === "Escape" && parent.classList.contains("editing")) {
      event.preventDefault();
      event.stopPropagation();
      exitEditing(parent, "blur");
      parent.dataset.ccNoReopen = "1";
      partsOf(parent).display?.focus({ preventScroll: true });
    }
  }, true);
  parent.addEventListener("input", () => {
    const st = EDITORS.get(partsOf(parent).editor);
    if (st) st.lastInput = Date.now();
  });

  // Blur. A press on the editor's own menu can move focus out for a moment
  // (Safari and Firefox do not focus buttons), so a pointer gesture that
  // started inside is settled on pointerup instead.
  let pointerInside = false;
  parent.addEventListener("pointerdown", () => {
    pointerInside = true;
    document.addEventListener("pointerup", () => {
      setTimeout(() => {
        pointerInside = false;
        if (parent.isConnected && !parent.contains(document.activeElement)) exitEditing(parent, "blur");
      }, 0);
    }, { once: true, capture: true });
  });
  parent.addEventListener("focusout", (event) => {
    if (pointerInside || (event.relatedTarget && parent.contains(event.relatedTarget))) return;
    setTimeout(() => {
      if (pointerInside || !parent.isConnected) return;
      if (!parent.contains(document.activeElement)) exitEditing(parent, "blur");
    }, 0);
  });

  const indicator = parent.querySelector(":scope > .mej-cc-save-state");
  const pageUuid = parent.closest(".session-container")?.dataset.ccPage;
  if (indicator && pageUuid) {
    const state = saveStateOf(pageUuid, editorId);
    const key = saveStateKey(state);
    paintState(indicator, state, key ? game.i18n.localize(`${I18N}.${key}`) : "", keptOf(pageUuid, editorId) !== undefined);
    // Show / Discard on the kept-text line (repainted in place, so delegated here).
    indicator.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-cc-kept]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.ccKept === "discard") discardKept(pageUuid, editorId);
      else showKept(pageUuid, editorId).catch((err) => console.error(`${MODULE_ID} | showing kept text failed`, err));
    });
  }
}

/**
 * Wire the Session sheet's editors after a render (called from
 * SessionSheet.activateListeners: MEJ's shell never calls _onRender for a
 * subsheet). Also restores the editor a full re-render took from the user.
 */
export function bindAutosave(sheet, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const parents = parentsIn(root);
  if (!parents.length) return;
  for (const parent of parents) bindParent(sheet, parent);
  BOUND.add(sheet);

  // Sheet tab change: save before the other tab shows.
  root.querySelector(".session-container nav.sheet-tabs")?.addEventListener("click", () => flushSessionEditors(sheet, "tabchange"), true);

  // Periodic save for the non-collaborative editors while they hold unsaved
  // text, deferred while the user is mid-word; also retries a failed save.
  clearInterval(sheet._ccAutosaveTimer);
  const interval = autosaveIntervalMs(game.settings.get("core", "editorAutosaveSecs"));
  const timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      BOUND.delete(sheet);
      return;
    }
    for (const parent of parentsIn(root)) {
      const id = parent.dataset.editorId;
      const { editor } = partsOf(parent);
      if (editor && id !== "recap") {
        const st = EDITORS.get(editor);
        const wait = (st?.lastInput ?? 0) + IDLE_BEFORE_INTERVAL_SAVE_MS - Date.now();
        if (wait > 0) setTimeout(() => editor.isConnected && commitEditor(editor, "interval"), wait);
        else commitEditor(editor, "interval");
      } else if (!editor) {
        // Retry a failed save (a draft waiting for a GM retries when one connects).
        // Only while the stored text is still what it was edited from (retryPending).
        const page = pageOf(root.querySelector(".session-container")?.dataset.ccPage);
        if (!page || saveStateOf(page.uuid, id) !== "failed") continue;
        retryPending(page, id);
      }
    }
  }, interval);
  sheet._ccAutosaveTimer = timer;

  // A full re-render (rare now: MEJ's own reloads) took an open editor away.
  const pageUuid = root.querySelector(".session-container")?.dataset.ccPage;
  const restore = pageUuid ? RESTORE.get(pageUuid) : null;
  if (restore) {
    RESTORE.delete(pageUuid);
    if (Date.now() - restore.at < RESTORE_WINDOW_MS) {
      const parent = parents.find((p) => p.dataset.editorId === restore.editorId);
      if (parent && parent.closest(".tab")?.classList.contains("active")) enterEditing(parent, { selection: restore });
    }
  }
}

/** The sheet is closing: stop its periodic save and window-level triggers (after its last commit). */
export function unbindAutosave(sheet) {
  clearInterval(sheet?._ccAutosaveTimer);
  if (sheet) sheet._ccAutosaveTimer = null;
  BOUND.delete(sheet);
}

let registered = false;

/** Window-level triggers and the My Notes relay confirmations. Safe at init (no MEJ import). */
export function registerSessionAutosave() {
  if (registered) return;
  registered = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const sheet of BOUND) {
      if (!sheet.trueElement?.isConnected) BOUND.delete(sheet);
      else flushSessionEditors(sheet, "visibilityhidden");
    }
  });
  // Drafts left on this device by an earlier load: offered and retried. MEJ's
  // socket (the My Notes relay) is set up during its own ready.
  Hooks.once("ready", () => setTimeout(() => {
    try {
      restoreDeviceDrafts();
    } catch (err) {
      console.error(`${MODULE_ID} | restoring unsaved Session text failed`, err);
    }
  }, 1000));
  Hooks.once("ready", () => {
    try {
      game.socket.on("pm.usersEditing", onUsersEditing);
    } catch (err) {
      console.error(`${MODULE_ID} | watching collaborative joins failed`, err);
    }
  });
  Hooks.on("userConnected", (user, connected) => {
    if (!connected || !user?.isGM) return;
    // The GM's client is still loading when its socket connects; relayMyNotes repeats until it lands.
    setTimeout(retryMyNotesDrafts, 500);
  });
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    try {
      confirmMyNotes(page, changes);
    } catch (err) {
      console.error(`${MODULE_ID} | My Notes confirmation failed`, err);
    }
  });
}
