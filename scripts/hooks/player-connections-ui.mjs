// Player connections block in the Relationships tab (spec 2026-10-09 §4.5),
// registered beside relationships-ui.mjs on the same two render hooks. Rows
// come from this entry's own flag ("from" side) and the reverse index
// ("to" side), filtered by canSeeConnection; every write goes through the
// relay (a GM writes directly). Idempotent: a re-render replaces the block -
// except while someone is typing in it (trackEditing): then the live block
// is carried into the new render and rebuilt once the edit settles.
import { MODULE_ID, I18N, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { normalizeConnections, canSeeConnection, sideView, countOtherNotes } from "../logic/player-connections.mjs";
import { buildConnectionsBlock, groupSideViews } from "../apps/player-connections-block.mjs";
import { incomingConnections, typedPageOf } from "./player-connections-index.mjs";
import { playerConnectionsEnabled } from "./rel-tab-wrap.mjs";
import { requestConnectionOp, showConnectionOutcome } from "./player-connections-relay.mjs";
import { imageFor } from "../logic/default-image.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

const FALLBACK_IMG = "icons/svg/book.svg";
const BLOCK_SELECTOR = ":scope > .mej-cc-player-connections";
const HAS_BLOCK = "mej-cc-has-player-connections";
const L = (key) => game.i18n.localize(`${I18N}.playerConnections.${key}`);
const F = (key, data) => game.i18n.format(`${I18N}.playerConnections.${key}`, data);

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function labels() {
  return {
    heading: L("heading"), relationship: game.i18n.localize("MonksEnhancedJournal.Relationship"),
    add: L("add"), addNote: L("addNote"), empty: L("empty"), by: (name) => F("by", { name }),
    you: game.user.name, shared: L("shared"), private: L("private"), reveal: L("reveal"), hide: L("hide"),
    revealTooltip: L("revealTooltip"), deleteConnection: L("deleteConnection"), deleteNote: L("deleteNote"),
    unresolved: L("unresolved"), labelPlaceholder: L("labelPlaceholder"), secretPlaceholder: L("secretPlaceholder"),
    fallbackImg: FALLBACK_IMG, unknownWriter: L("unknownWriter")
  };
}

const permitted = (level) => (uuid) => {
  const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, level) === true;
};
const canLimited = permitted("LIMITED");
export const canObserve = permitted("OBSERVER");

/**
 * An entry's MEJ type: that of its first MEJ-typed page (the page that holds
 * the connections flag), so a multi-page entry still has a type. One helper
 * for the block and the add-connection dialog.
 * @param {JournalEntry|string|null} entryOrUuid
 * @returns {string|null}
 */
export function entryType(entryOrUuid, resolve = (uuid) => fromUuidSync(uuid)) {
  const entry = typeof entryOrUuid === "string" ? resolve(entryOrUuid) : entryOrUuid;
  const page = typedPageOf(entry);
  return page ? (mejType(page) || null) : null;
}

export function targetInfo(uuid) {
  const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  if (!(entry instanceof JournalEntry)) return null;
  const type = entryType(entry) ?? "";
  return { uuid, name: entry.name, img: imageFor(typedPageOf(entry)?.src, type) ?? FALLBACK_IMG, type };
}

export function typeLabel(type) {
  if (type === "defunct") return game.i18n.localize("MonksEnhancedJournal.Unknown");
  const known = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  return game.i18n.localize(known[type] ?? type);
}

function foundryLookups() {
  return {
    userId: game.user.id,
    isGM: game.user.isGM === true,
    enabled: playerConnectionsEnabled(),
    knownUserIds: new Set(game.users.map((u) => u.id)),
    canObserve,
    canLimited,
    incoming: incomingConnections,
    targetInfo
  };
}

/** Visible connections on this entry, from both ends, as { row, view, target }. */
export function connectionEntries(entry, page, deps = foundryLookups()) {
  const { userId, isGM } = deps;
  const viewer = {
    userId, isGM, enabled: deps.enabled, knownUserIds: deps.knownUserIds,
    canObserveSide: isGM || deps.canObserve(entry.uuid)
  };
  const see = (row) => canSeeConnection(row, { userId, isGM, canSeeEntry: deps.canLimited });
  const outgoing = normalizeConnections(page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], entry.uuid)
    .filter(see)
    .map((row) => ({ row, view: sideView(row, "from", viewer), target: deps.targetInfo(row.to) }));
  const incoming = deps.incoming(entry.uuid)
    .map(({ row }) => row)
    .filter(see)
    .map((row) => ({ row, view: sideView(row, "to", viewer), target: deps.targetInfo(row.from) }));
  return [...outgoing, ...incoming];
}

/**
 * Is someone mid-edit in `block`? A saved write re-renders the sheet, which
 * would rebuild the block and drop text being typed in another field or an
 * open add-note draft. Editing = focus in a text field of the block, or a
 * draft holding text its change event has not sent yet. Focus on a button
 * is not editing (a Reveal/Share click should show its result at once).
 * Removal by a re-render is not "leaving": the check after focusout ignores
 * a disconnected block. `onSettled` runs when an edit ends.
 */
export function trackEditing(block, onSettled) {
  let field = null;
  let caret = null;
  const draftOf = (target) => target?.closest?.(".mej-cc-pc-note.new");
  const settle = () => setTimeout(() => {
    if (!block.isConnected) return;
    const active = block.ownerDocument.activeElement;
    field = active instanceof HTMLInputElement && block.contains(active) ? active : null;
    if (!tracker.editing()) onSettled();
  }, 0);
  block.addEventListener("focusin", (event) => {
    field = event.target instanceof HTMLInputElement ? event.target : null;
  });
  block.addEventListener("focusout", settle);
  block.addEventListener("input", (event) => {
    // Track the draft's contents, not just "was typed in": text typed and
    // deleted again fires no change event, so a sticky flag would latch.
    const draft = draftOf(event.target);
    if (!draft) return;
    if ([...draft.querySelectorAll("input")].some((i) => i.value.trim() !== "")) draft.dataset.unsent = "";
    else delete draft.dataset.unsent;
  });
  block.addEventListener("change", (event) => {
    delete draftOf(event.target)?.dataset.unsent;
    settle();
  });
  const tracker = {
    editing: () => field !== null || block.querySelector(".mej-cc-pc-note.new[data-unsent]") !== null,
    /** After the block is carried into a new render: focus and caret back where they were. */
    restoreFocus() {
      if (!field || !block.contains(field) || block.ownerDocument.activeElement === field) return;
      caret ??= [field.selectionStart, field.selectionEnd];
      field.focus();
      try {
        field.setSelectionRange(...caret);
      } catch {
        // not a selectable input type
      }
      caret = null;
    },
    /** Remember the caret before the field leaves the document. */
    noteCaret() {
      if (field) caret = [field.selectionStart, field.selectionEnd];
    }
  };
  return tracker;
}

/** Carry the live block into a new render only for the same page, mid-edit. */
export function shouldKeepBlock({ prevPageUuid, pageUuid, editing }) {
  return editing === true && typeof prevPageUuid === "string" && prevPageUuid === pageUuid;
}

function confirm(title, body) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${foundry.utils.escapeHTML(body)}</p>`,
    rejectClose: false,
    modal: true
  });
}

async function run(request) {
  const outcome = await requestConnectionOp(request);
  showConnectionOutcome(outcome);
  return outcome;
}

const target = (view) => ({ fromUuid: view.from, connectionId: view.id, side: view.side });

function handlersFor(sheet, entry, page, rowsById) {
  return {
    open: (uuid) => {
      const doc = fromUuidSync(uuid);
      if (doc) game.MonksEnhancedJournal.openJournalEntry(doc);
    },
    saveNote: (view, { label, secret }) => run({ op: "setNote", ...target(view), payload: { label, secret } }),
    toggleReveal: (view, note) => run({ op: "setRevealed", ...target(view), payload: { revealed: !note.revealed } }),
    deleteNote: (view, note) => run({ op: "deleteNote", ...target(view), payload: { noteUserId: note.writerId } }),
    toggleShare: async (view) => {
      const others = countOtherNotes(rowsById.get(view.id));
      if (view.shared && others > 0 && !(await confirm(L("privateTitle"), F("privateBody", { count: others })))) return;
      return run({ op: "setShared", ...target(view), payload: { shared: !view.shared } });
    },
    deleteConnection: async (view) => {
      const others = countOtherNotes(rowsById.get(view.id));
      const body = others > 0 ? F("deleteBodyNotes", { count: others }) : L("deleteBody");
      if (!(await confirm(L("deleteTitle"), body))) return;
      return run({ op: "delete", ...target(view) });
    }
  };
}

/**
 * The live block per window: { block, pageUuid, tracker, stale }. Keyed by
 * the window element, not the sheet: inside MEJ's shell the same host is
 * injected twice per render (renderJournalPageSheet for the subsheet, then
 * renderEnhancedJournalSheet for the shell), and both must find the same
 * block. ApplicationV2 keeps its window element across re-renders.
 */
const live = new WeakMap();
const windowOf = (sheet, host) => host.closest(".application") ?? sheet;

/** A fresh block for this page, or null when there is nothing to show. */
function buildFor(key, sheet, entry, page) {
  const entries = connectionEntries(entry, page);
  const canAdd = !game.user.isGM && playerConnectionsEnabled() && canObserve(entry.uuid)
    && (sheet.allowedRelationships?.length ?? 0) > 0;
  if (!entries.length && !canAdd) return null;
  const rowsById = new Map(entries.map((e) => [e.view.id, e.row]));
  const block = buildConnectionsBlock(document, {
    groups: groupSideViews(entries, { typeLabel }), canAdd, labels: labels()
  }, handlersFor(sheet, entry, page, rowsById));
  const state = { block, pageUuid: page.uuid, stale: false };
  state.tracker = trackEditing(block, () => {
    if (state.stale && live.get(key) === state) rebuild(key, sheet, entry, page, state);
  });
  live.set(key, state);
  return block;
}

/** The edit settled after renders were skipped: swap in an up-to-date block. */
function rebuild(key, sheet, entry, page, state) {
  const host = state.block.parentElement;
  if (!host) return;
  try {
    const fresh = buildFor(key, sheet, entry, page);
    if (fresh) state.block.replaceWith(fresh);
    else {
      state.block.remove();
      host.classList.remove(HAS_BLOCK);
      live.delete(key);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | player connections block failed`, err);
  }
}

function inject(sheet, html) {
  const element = asElement(html);
  const page = sheet?.document;
  if (!element || !(page instanceof JournalEntryPage) || !mejType(page)) return;
  const entry = page.parent;
  if (!entry) return;
  const host = element.querySelector('.tab[data-tab="relationships"] .tab-inner');
  if (!host) return;
  const key = windowOf(sheet, host);
  const prev = live.get(key);
  if (prev && shouldKeepBlock({ prevPageUuid: prev.pageUuid, pageUuid: page.uuid, editing: prev.tracker.editing() })) {
    prev.stale = true;
    if (prev.block.parentElement !== host) {
      prev.tracker.noteCaret();
      host.querySelector(BLOCK_SELECTOR)?.remove();
      host.append(prev.block);
    }
    host.classList.add(HAS_BLOCK);
    prev.tracker.restoreFocus();
    return;
  }
  host.querySelector(BLOCK_SELECTOR)?.remove();
  host.classList.remove(HAS_BLOCK);
  live.delete(key);
  const block = buildFor(key, sheet, entry, page);
  if (!block) return;
  host.classList.add(HAS_BLOCK);
  host.append(block);
}

export function registerPlayerConnectionsUi() {
  const safe = (sheet, html) => {
    try {
      inject(sheet, html);
    } catch (err) {
      console.error(`${MODULE_ID} | player connections block failed`, err);
    }
  };
  Hooks.on("renderJournalPageSheet", safe);
  Hooks.on("renderEnhancedJournalSheet", safe);
}
