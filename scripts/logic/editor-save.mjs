// Autosave and live-update rules for the Session sheet's always-editable text. Pure.

const SAVE_TRIGGERS = new Set(["blur", "tabchange", "close", "interval", "visibilityhidden"]);

/** True for the events that commit an editor's content. Typing alone ("input") does not. */
export function saveTriggers(event) {
  return SAVE_TRIGGERS.has(event);
}

/**
 * Session editors are always live, so a Session sheet is patched region by
 * region instead of re-rendered (a re-render would drop the user's typing).
 */
export function shouldPatchRegions({ isSessionSheet }) {
  return isSessionSheet === true;
}

/** The Session sheet's always-editable editors, by their `data-editor-id`. */
export const EDITOR_IDS = ["recap", "gmNotes", "myNotes"];

/**
 * Periodic save interval for the non-collaborative editors: core's own
 * `editorAutosaveSecs` (the server's collaborative autosave uses the same
 * setting), clamped to the 30-300 range core allows, 60 when unreadable.
 */
export function autosaveIntervalMs(secs) {
  const n = Number(secs);
  const s = Number.isFinite(n) && secs !== null && secs !== "" ? Math.min(300, Math.max(30, n)) : 60;
  return s * 1000;
}

/**
 * How a My Notes save reaches MEJ's per-user notes flag: written directly by
 * a user who can edit the page, relayed through MEJ's GM-side saveUserData
 * socket action otherwise, and kept as a local draft while no GM is connected.
 * @returns {"direct"|"relay"|"draft"}
 */
export function myNotesSavePath({ canEditPage, hasActiveGM }) {
  if (canEditPage) return "direct";
  return hasActiveGM ? "relay" : "draft";
}

/**
 * Whether an editor's live content must be written. `baseline` is the value
 * the editor held when it activated or was last saved (ProseMirror's own
 * serialization, so an untouched editor compares equal); an editor that
 * never activated has none and holds nothing typed.
 */
export function needsCommit({ live, baseline }) {
  if (typeof live !== "string" || typeof baseline !== "string") return false;
  return live !== baseline;
}

/** A remote change may replace an editor's content only when nobody is typing in it and nothing is unsaved. */
export function canRefreshIdleEditor({ editing, dirty, pending }) {
  return !editing && !dirty && !pending;
}

const SAVE_STATE_KEYS = { saving: "session.saving", saved: "session.saved", noGM: "session.saveNoGM", failed: "session.saveFailed" };

/** The i18n key (under the module prefix) for a save indicator state; null shows nothing. */
export function saveStateKey(state) {
  return SAVE_STATE_KEYS[state] ?? null;
}

const FIELD_LABEL_KEYS = { recap: "tabs.description", gmNotes: "session.gmNotes", myNotes: "tabs.notes" };

/**
 * A save that failed where no indicator can show it (the sheet was closed or
 * torn down while the write was in flight, or a draft from an earlier load
 * failed again) is announced instead, naming the field. i18n keys under the
 * module prefix; null when the indicator covers it or it is not a failure.
 */
export function saveFailureNotice({ state, indicators, editorId }) {
  if (state !== "failed" || indicators > 0) return null;
  return { key: "session.saveFailedField", fieldKey: FIELD_LABEL_KEYS[editorId] ?? "tabs.description" };
}

/**
 * What an AUTOMATIC write of kept text (restored at load, retried on a timer
 * or when a GM connects) may do (spec 2026-10-19 §2: no path where typed text
 * is lost silently - neither the user's nor someone else's). `base` is the
 * stored text the kept value was edited from (null when unknown); a missing
 * stored value counts as empty.
 * @returns {"write"|"conflict"|"clear"}
 */
export function keptTextDecision({ value, base, stored }) {
  const current = typeof stored === "string" ? stored : "";
  if (value === current) return "clear";
  const from = typeof base === "string" ? base : null;
  if (from === null) return current === "" ? "write" : "conflict";
  return from === current ? "write" : "conflict";
}

/**
 * A My Notes value landed for this user (any browser of theirs, or the GM's
 * relay write). Only a value this client itself sent may confirm its draft
 * ("confirm") or become the base of newer typing ("rebase"); anything else -
 * the same user saving from another browser - leaves the draft and its base
 * alone ("ignore"), so the next automatic retry sees the conflict.
 * @returns {"confirm"|"rebase"|"ignore"}
 */
export function myNotesLanding({ landed, draftValue, sent }) {
  if (!Array.isArray(sent) || !sent.includes(landed)) return "ignore";
  return draftValue === undefined || draftValue === landed ? "confirm" : "rebase";
}

/** Kept text accumulates: a second conflict on the same field adds to the first (same text kept once). */
export function appendKept(entries, entry) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.some((e) => e.value === entry.value)) return list;
  return [...list, entry];
}

/**
 * The kept entries from their stored form (a JSON list of { value, at }, or
 * the single kept text an earlier version stored), newest first.
 */
export function keptEntries(stored, at = 0) {
  if (typeof stored !== "string" || !stored) return [];
  let list = null;
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) list = parsed.filter((e) => typeof e?.value === "string").map((e) => ({ value: e.value, at: Number(e.at) || 0 }));
  } catch {
    list = null;
  }
  list ??= [{ value: stored, at }];
  return list.sort((a, b) => b.at - a.at);
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Characters typed while a collaborative editor was still joining, merged
 * into the editor's HTML so they can be saved (or kept) instead of dropped:
 * appended to the last paragraph, or as a new one.
 */
export function withBufferedText(html, buffer) {
  const value = typeof html === "string" ? html : "";
  if (!buffer) return value;
  const text = escapeText(String(buffer));
  if (/<\/p>\s*$/i.test(value)) return value.replace(/<\/p>(\s*)$/i, `${text}</p>$1`);
  return `${value}<p>${text}</p>`;
}
