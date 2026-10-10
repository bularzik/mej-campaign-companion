// Party relationships inside MEJ's own Relationships list (spec 2026-10-10
// §3). After MEJ renders, lines go under matching GM rows, party-only pairs
// become MEJ-styled rows, writers get an Add button and (when MEJ would
// refuse them) a drop target. Writes go straight to the campaign's
// notebook - no relay, no GM needed. Idempotent per render; a live edit is
// carried across the re-render its own save causes (inline-edit.mjs).
import { MODULE_ID, I18N, PARTY_ROWS_FLAG } from "../constants.mjs";
import {
  linesForEntry, findPair, sideOf, createRowUpdate, labelUpdate, deleteUpdate, targetProblem, eligibleTargets, normalizeRows
} from "../logic/party-rows.mjs";
import { readableNotebooks, writeNotebookFor } from "../data/party-notebook.mjs";
import { canAddParty, playerConnectionsEnabled } from "./rel-tab-wrap.mjs";
import {
  buildPartyLine, buildPartyRow, buildAddButton, placeLines, dropMode, isolatePartyEdits, carryList,
  lineFilter, groupTypeOf, oneShotCreate
} from "../apps/party-lines.mjs";
import { trackEditing, shouldKeepBlock } from "../apps/inline-edit.mjs";
import { pickPartyTarget } from "../apps/party-target-picker.mjs";
import { imageFor } from "../logic/default-image.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

const FALLBACK_IMG = "icons/svg/book.svg";
const MARK = "mej-cc-party-injected";
const L = (key) => game.i18n.localize(`${I18N}.party.${key}`);
const F = (key, data) => game.i18n.format(`${I18N}.party.${key}`, data);

const asElement = (html) => (html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null);
const typedPageOf = (entry) => entry?.pages?.contents?.find((p) => mejType(p)) ?? null;
const entryType = (entry) => (typedPageOf(entry) ? mejType(typedPageOf(entry)) || null : null);
const resolve = (uuid) => {
  try {
    return typeof uuid === "string" ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
};
const exists = (uuid) => resolve(uuid) instanceof JournalEntry;
const canLimitedUuid = (uuid) => {
  const doc = resolve(uuid);
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
};

function labels() {
  return {
    party: L("party"), addLabel: L("addLabel"), edited: (name) => F("edited", { name }),
    remove: L("remove"), add: L("add"), fallbackImg: FALLBACK_IMG
  };
}

function targetInfo(uuid) {
  const entry = fromUuidSync(uuid);
  if (!(entry instanceof JournalEntry)) return null;
  const type = entryType(entry) ?? "";
  return { uuid, name: entry.name, img: imageFor(typedPageOf(entry)?.src, type) ?? FALLBACK_IMG, type };
}

function typeLabel(type) {
  if (!type || type === "defunct") return game.i18n.localize("MonksEnhancedJournal.Unknown");
  const known = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  return game.i18n.localize(known[type] ?? type);
}

/** Can this viewer edit rows in this notebook (spec §2.5)? */
function canWriteIn(notebookUuid) {
  if (!playerConnectionsEnabled() && !game.user.isGM) return false;
  const nb = fromUuidSync(notebookUuid);
  return !!nb && (game.user.isGM || nb.isOwner === true);
}

async function write(notebookUuid, update) {
  const nb = fromUuidSync(notebookUuid);
  try {
    await nb.update(update);
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | party relationship write failed`, err);
    ui.notifications.error(L("writeFailed"));
    return false;
  }
}

const stamp = () => ({ user: { id: game.user.id, name: game.user.name }, now: Date.now() });

/** Write a label on a line's side of its current row (no-op when the row is gone). */
async function saveLabel(line, value) {
  const nb = resolve(line.notebookUuid);
  const row = normalizeRows(nb?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]).find((r) => r.key === line.key);
  const update = row ? labelUpdate(row, line.side, value, stamp()) : null;
  if (update) await write(line.notebookUuid, update);
}

/**
 * The line to focus after the next render, per window (the window key from
 * windowOf): set by the picker and drop paths only, cleared on a failed write.
 */
const pendingFocus = new WeakMap();

/**
 * Add a party row from `entry` to `targetUuid`. `win` is the window (key)
 * to focus the line in - picker and drop only. `label` (placeholder line)
 * goes into the same write as the create; on an existing pair it is saved
 * on this entry's side. Resolves the line { notebookUuid, key, side }, or null.
 */
async function addTarget(sheet, entry, targetUuid, { win = null, label = undefined } = {}) {
  const nb = writeNotebookFor(entry);
  if (!nb) {
    ui.notifications.warn(L("noNotebook"));
    return null;
  }
  const ctx = { sourceUuid: entry.uuid, allowed: [...(sheet.allowedRelationships ?? [])], typeOf: entryType,
    canLimited: (doc) => doc.testUserPermission(game.user, "LIMITED") === true };
  const target = resolve(targetUuid);
  const problem = targetProblem(target instanceof JournalEntry ? target : null, ctx);
  if (problem) {
    ui.notifications.warn(L(`drop.${problem}`));
    return null;
  }
  const rows = normalizeRows(nb.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]);
  const existing = findPair(rows, entry.uuid, targetUuid);
  if (existing) {                                                          // spec §3.4
    const line = { notebookUuid: nb.uuid, key: existing.key, side: sideOf(existing, entry.uuid) };
    if (win) focusLine(win, line.notebookUuid, line.key);
    if (label !== undefined) await saveLabel(line, label);
    return line;
  }
  const { key, update } = createRowUpdate({ sourceUuid: entry.uuid, targetUuid, label: label ?? "", ...stamp() });
  const focus = { notebookUuid: nb.uuid, key };
  if (win) pendingFocus.set(win, focus);
  const ok = await write(nb.uuid, update);
  if (!ok) {
    if (win && pendingFocus.get(win) === focus) pendingFocus.delete(win);
    return null;
  }
  return { notebookUuid: nb.uuid, key, side: "a" };
}

/** Focus a party line inside this window only - never elsewhere in the document. */
function focusLine(win, notebookUuid, key) {
  const root = win instanceof HTMLElement ? win : win?.element instanceof HTMLElement ? win.element : null;
  if (!root) return;
  const line = root.querySelector(`.mej-cc-party-line[data-notebook-uuid="${CSS.escape(notebookUuid)}"][data-key="${CSS.escape(key)}"]`);
  line?.scrollIntoView({ block: "nearest" });
  line?.querySelector("input")?.focus();
}

async function openPicker(sheet, entry, win) {
  const ctx = { sourceUuid: entry.uuid, allowed: [...(sheet.allowedRelationships ?? [])], typeOf: entryType,
    canLimited: (doc) => doc.testUserPermission(game.user, "LIMITED") === true };
  const rows = eligibleTargets(game.journal.contents, ctx).map((r) => ({
    uuid: r.uuid, name: r.name, img: targetInfo(r.uuid)?.img ?? FALLBACK_IMG, typeLabel: typeLabel(r.type)
  }));
  if (!rows.length) return void ui.notifications.info(L("noTargets"));
  const uuid = await pickPartyTarget({ sourceName: entry.name, rows });
  if (uuid) await addTarget(sheet, entry, uuid, { win });
}

async function onDrop(event, sheet, entry, win) {
  event.preventDefault();
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  let uuid = null;
  if (data?.type === "JournalEntry") uuid = data.uuid;
  else if (data?.type === "JournalEntryPage") uuid = (await fromUuid(data.uuid))?.parent?.uuid ?? null;
  if (!uuid) return void ui.notifications.warn(L("drop.not-journal"));
  await addTarget(sheet, entry, uuid, { win });
}

function ensureList(host) {
  let list = host.querySelector(".relationships .items-list ol.item-list");
  if (list) return list;
  const container = host.querySelector(".relationships .items-list");
  if (!container) return null;
  container.querySelector(".instruction")?.remove();
  list = document.createElement("ol");
  list.className = "item-list";
  list.dataset.container = "relationships";
  container.append(list);
  return list;
}

function groupHeaderIn(list) {
  return (type) => {
    const name = typeLabel(type);
    const found = [...list.querySelectorAll(":scope > li > header .name")].find((n) => n.textContent === name);
    if (found) return found.closest("li");
    const li = document.createElement("li");
    const header = document.createElement("header");
    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = name;
    const relEl = document.createElement("div");
    relEl.className = "relationship";
    relEl.textContent = game.i18n.localize("MonksEnhancedJournal.Relationship");
    header.append(nameEl, relEl);
    li.append(header);
    list.append(li);
    return li;
  };
}

/**
 * The live list per window: { list, pageUuid, tracker, stale }. Keyed by the
 * window element, not the sheet: inside MEJ's shell the same host is
 * injected twice per render (renderJournalPageSheet for the subsheet, then
 * renderEnhancedJournalSheet for the shell), and both must find the same
 * state. ApplicationV2 keeps its window element across re-renders.
 */
const live = new WeakMap();
const windowOf = (sheet, host) => host.closest(".application") ?? sheet;

/** Party lines and empty "add a label" lines into MEJ's freshly rendered list. */
function decorateList(sheet, entry, list, lines, canAdd, lbl) {
  const handlers = {
    open: (uuid) => { const doc = resolve(uuid); if (doc) game.MonksEnhancedJournal.openJournalEntry(doc); },
    save: (line, value) => saveLabel(line, value)
      .catch((err) => console.error(`${MODULE_ID} | party relationship save failed`, err)),
    remove: (line) => write(line.notebookUuid, deleteUpdate(line.key))
      .catch((err) => console.error(`${MODULE_ID} | party relationship delete failed`, err))
  };
  const seen = new Set(lines.map((l) => l.other));
  placeLines(list, lines, {
    gmRowFor: (uuid) => list.querySelector(`li.item:not(.mej-cc-party-only)[data-uuid="${CSS.escape(uuid)}"]`),
    typeOf: (uuid) => groupTypeOf(uuid, { exists, typeOf: (u) => entryType(resolve(u)) }),
    groupHeader: groupHeaderIn(list),
    buildLine: (line) => buildPartyLine(document, { line, editable: canWriteIn(line.notebookUuid), labels: lbl }, handlers),
    buildRow: (line) => buildPartyRow(document, {
      line, target: targetInfo(line.other)
        ?? { uuid: line.other, name: L("unresolved"), img: FALLBACK_IMG, type: "", unresolved: true },
      editable: canWriteIn(line.notebookUuid), labels: lbl
    }, handlers)
  });
  if (!canAdd) return;
  // Empty "Party: add a label" lines under GM rows with no party row yet.
  for (const gmRow of list.querySelectorAll("li.item:not(.mej-cc-party-only)[data-uuid]")) {
    const uuid = gmRow.dataset.uuid;
    if (seen.has(uuid) || !canLimitedUuid(uuid)) continue;
    const cell = gmRow.querySelector(".item-relationship:last-of-type") ?? gmRow;
    // One-shot: the first value creates the row with its label in one write;
    // later input on this same field labels that row. No focus steal.
    const create = oneShotCreate({
      create: (value) => addTarget(sheet, entry, uuid, { label: value }),
      save: saveLabel
    });
    cell.append(buildPartyLine(document, { line: null, editable: true, labels: lbl }, { create }));
  }
}

/** The Add button and (when MEJ would refuse this user) a party drop zone, on the fresh tab. */
function decorateTab(sheet, entry, tab, canAdd, lbl, win) {
  if (canAdd) {
    tab.querySelector(".relationships")?.append(buildAddButton(document, { labels: lbl }, () =>
      openPicker(sheet, entry, win).catch((err) => console.error(`${MODULE_ID} | party add failed`, err))));
  }
  const mode = dropMode({ isGM: game.user.isGM, isOwner: entry.isOwner === true, canAdd });
  if (mode === "party") {
    const zone = tab.querySelector(".relationships .items-list");
    zone?.addEventListener("dragover", (event) => event.preventDefault());
    zone?.addEventListener("drop", (event) => onDrop(event, sheet, entry, win)
      .catch((err) => console.error(`${MODULE_ID} | party drop failed`, err)));
  }
}

function inject(sheet, html) {
  const element = asElement(html);
  const page = sheet?.document;
  if (!element || !(page instanceof JournalEntryPage) || !mejType(page)) return;
  const entry = page.parent;
  const tab = element.querySelector('.tab[data-tab="relationships"]');
  if (!entry || !tab || tab.classList.contains(MARK)) return;
  tab.classList.add(MARK);

  const key = windowOf(sheet, tab);
  const win = key instanceof HTMLElement ? key : element;
  const prev = live.get(key);
  const canAdd = canAddParty(sheet, entry);
  const lbl = labels();

  // Mid-edit re-render of the same page (Review Focus 2): keep the live list.
  if (prev && shouldKeepBlock({ prevPageUuid: prev.pageUuid, pageUuid: page.uuid, editing: prev.tracker.editing() })
    && carryList(tab, prev)) {
    prev.stale = true;
    decorateTab(sheet, entry, tab, canAdd, lbl, key);
    return;
  }
  live.delete(key);

  const lines = linesForEntry(entry.uuid, readableNotebooks(), {
    canLimited: lineFilter({ isGM: game.user.isGM, exists, canLimited: canLimitedUuid })
  });
  if (!lines.length && !canAdd) return;
  const list = ensureList(tab);
  if (!list) return;
  decorateList(sheet, entry, list, lines, canAdd, lbl);
  isolatePartyEdits(list);
  const state = { list, pageUuid: page.uuid, stale: false };
  // Only party fields count as editing: MEJ's own inputs re-render as MEJ intends.
  state.tracker = trackEditing(list, () => {
    // Renders were skipped while typing: re-render once the edit settles.
    if (!state.stale || live.get(key) !== state) return;
    state.stale = false;
    sheet.render();
  }, { fieldSelector: ".mej-cc-party-line" });
  live.set(key, state);
  decorateTab(sheet, entry, tab, canAdd, lbl, key);

  const focus = pendingFocus.get(key);
  if (focus) {
    pendingFocus.delete(key);
    focusLine(win, focus.notebookUuid, focus.key);
  }
}

export function registerPartyRelationshipsUi() {
  const safe = (sheet, html) => {
    try {
      inject(sheet, html);
    } catch (err) {
      console.error(`${MODULE_ID} | party relationships render failed`, err);
    }
  };
  Hooks.on("renderJournalPageSheet", safe);
  Hooks.on("renderEnhancedJournalSheet", safe);
}
