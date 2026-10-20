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
import { saveTriggers, autosaveIntervalMs, myNotesSavePath, needsCommit, saveStateKey, EDITOR_IDS } from "../logic/editor-save.mjs";
import { NOTE_DRAFTS, myNotesDraftKey } from "../logic/input-draft.mjs";
import { hasVisibleText } from "../logic/session-state.mjs";

const MEJ_ID = "monks-enhanced-journal";
const DOC_FIELDS = { recap: "system.recap", gmNotes: "system.gmNotes" };
const myNotesPath = (userId = game.user.id) => `flags.${MEJ_ID}.${userId}.notes`;
const RELAY_RETRY_MS = 4000;
const RELAY_MAX_TRIES = 10;
const IDLE_BEFORE_INTERVAL_SAVE_MS = 2000;
const RESTORE_WINDOW_MS = 5000;

/** Live editor element -> { pageUuid, editorId, baseline, view, retiring }. */
const EDITORS = new WeakMap();
/** `${pageUuid}|${editorId}` -> the indicator state ("saving" | "saved" | "noGM" | "failed"). */
const SAVE_STATES = new Map();
/** `${pageUuid}|${editorId}` -> Recap / GM Prep text written but not yet confirmed (kept on failure). */
const UNSAVED = new Map();
/** pageUuid -> { editorId, from, to, at }: the editor a full re-render took from under the user. */
const RESTORE = new Map();
/** Sheets with bound editors, for the window-level triggers. */
const BOUND = new Set();
/** pageUuid -> pending relay retry timer. */
const RELAY_TIMERS = new Map();

const keyOf = (pageUuid, editorId) => `${pageUuid}|${editorId}`;

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
  if (editorId === "myNotes") {
    const draft = NOTE_DRAFTS.get(myNotesDraftKey(page.uuid));
    if (typeof draft?.value === "string") return draft.value;
    return foundry.utils.getProperty(page, myNotesPath()) ?? "";
  }
  const unsaved = UNSAVED.get(keyOf(page.uuid, editorId));
  if (typeof unsaved === "string") return unsaved;
  return foundry.utils.getProperty(page, DOC_FIELDS[editorId]) ?? "";
}

/** The indicator state to render for an editor (survives re-renders). */
export function saveStateOf(pageUuid, editorId) {
  return SAVE_STATES.get(keyOf(pageUuid, editorId)) ?? null;
}

function setSaveState(pageUuid, editorId, state) {
  if (state) SAVE_STATES.set(keyOf(pageUuid, editorId), state);
  else SAVE_STATES.delete(keyOf(pageUuid, editorId));
  const key = saveStateKey(state);
  const text = key ? game.i18n.localize(`${I18N}.${key}`) : "";
  const sel = `.session-container[data-cc-page="${CSS.escape(pageUuid)}"] .editor-parent[data-editor-id="${editorId}"] .mej-cc-save-state`;
  for (const el of document.querySelectorAll(sel)) paintState(el, state, text);
}

function paintState(el, state, text) {
  el.textContent = text;
  el.dataset.state = state ?? "";
}

// --- Writing ------------------------------------------------------------------

async function writeDocField(page, editorId, value) {
  const key = keyOf(page.uuid, editorId);
  const field = DOC_FIELDS[editorId];
  UNSAVED.set(key, value);
  // Already stored (core's collaborative autosave may have written it): nothing to send.
  if (foundry.utils.getProperty(page, field) === value) {
    if (UNSAVED.get(key) === value) UNSAVED.delete(key);
    setSaveState(page.uuid, editorId, "saved");
    return true;
  }
  setSaveState(page.uuid, editorId, "saving");
  try {
    await page.update({ [field]: value });
    if (UNSAVED.get(key) === value) UNSAVED.delete(key);
    if (!UNSAVED.has(key)) setSaveState(page.uuid, editorId, "saved");
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | ${editorId} could not be saved`, err);
    setSaveState(page.uuid, editorId, "failed");
    if (editorId === "gmNotes") ui.notifications.error(game.i18n.localize(`${I18N}.session.gmNotesSaveFailed`));
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
export async function writeMyNotes(page, value) {
  const draftKey = myNotesDraftKey(page.uuid);
  NOTE_DRAFTS.set(draftKey, { value });
  const path = myNotesSavePath({ canEditPage: canEditPage(page), hasActiveGM: !!game.users.activeGM });
  if (path === "draft") {
    setSaveState(page.uuid, "myNotes", "noGM");
    return false;
  }
  if (foundry.utils.getProperty(page, myNotesPath()) === value) {
    if (NOTE_DRAFTS.get(draftKey)?.value === value) NOTE_DRAFTS.delete(draftKey);
    setSaveState(page.uuid, "myNotes", "saved");
    return true;
  }
  setSaveState(page.uuid, "myNotes", "saving");
  if (path === "relay") {
    relayMyNotes(page, 0);
    return true;
  }
  try {
    await page.update({ [myNotesPath()]: value });
    if (NOTE_DRAFTS.get(draftKey)?.value === value) NOTE_DRAFTS.delete(draftKey);
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
  const draft = NOTE_DRAFTS.get(myNotesDraftKey(page.uuid));
  if (typeof draft?.value !== "string") return;
  if (!game.users.activeGM) {
    setSaveState(page.uuid, "myNotes", "noGM");
    return;
  }
  try {
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
  if (draft && draft.value !== foundry.utils.getProperty(page, myNotesPath())) return; // newer typing still pending
  NOTE_DRAFTS.delete(draftKey);
  clearTimeout(RELAY_TIMERS.get(page.uuid));
  RELAY_TIMERS.delete(page.uuid);
  setSaveState(page.uuid, "myNotes", "saved");
}

/** Retry every My Notes draft a GM can now save (a GM connected). */
function retryMyNotesDrafts() {
  for (const key of NOTE_DRAFTS.keys()) {
    if (!key.startsWith("mynotes:")) continue;
    const page = pageOf(key.slice("mynotes:".length));
    if (page) writeMyNotes(page, NOTE_DRAFTS.get(key).value);
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

  // Capture the view through core's documented plugin hook (prosemirror-editor.mjs
  // _configurePlugins dispatches "plugins" with the plugin record it will use).
  editor.addEventListener("plugins", (event) => {
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
    // A collaborative join can finish after the user has already clicked away.
    if (editor.isConnected && parent.classList.contains("editing")) placeCaret(st, { coords, selection });
  });
  // Every core save (Ctrl+S, the menu's save, leaving the DOM) comes here instead.
  editor.addEventListener("save", (event) => {
    event.preventDefault();
    if (!editor.isConnected && parent.classList.contains("editing")) rememberCaret(editor);
    commitEditor(editor, "close");
  });

  // Until the editor is live, keep focus inside the block and hold typed characters.
  control.tabIndex = -1;
  parent.classList.add("editing");
  control.append(editor);
  if (!editor.classList.contains("active")) control.focus({ preventScroll: true });
  if (display) display.tabIndex = -1;
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
    commitEditor(editor, trigger);
    try {
      html = editor.value;
    } catch {
      html = null;
    }
    st.retiring = true;
  }
  parent.classList.remove("editing");
  editor?.remove();
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
  if (parent.classList.contains("editing")) return true;
  const root = parent.closest(".session-container");
  return UNSAVED.has(keyOf(root?.dataset.ccPage, parent.dataset.editorId));
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
    paintState(indicator, state, key ? game.i18n.localize(`${I18N}.${key}`) : "");
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
      } else if (!editor && id !== "myNotes") {
        const page = pageOf(root.querySelector(".session-container")?.dataset.ccPage);
        const unsaved = page ? UNSAVED.get(keyOf(page.uuid, id)) : undefined;
        if (typeof unsaved === "string" && saveStateOf(page.uuid, id) === "failed") writeDocField(page, id, unsaved);
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
