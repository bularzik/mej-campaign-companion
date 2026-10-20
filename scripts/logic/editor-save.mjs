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
