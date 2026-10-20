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
