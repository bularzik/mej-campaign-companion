// Pure helpers for the native-mode shell shim (spec 2026-09-19 §4). No
// Foundry globals.

/** The synthetic entity id MEJ's shell stores in a tab for the Hub. */
export function shellPageId(hubPageId) {
  return `shellpage:${hubPageId}`;
}

/** Is this tab entity id the Hub's shell page? */
export function isShellPageId(entityId, hubPageId) {
  return typeof entityId === "string" && entityId === shellPageId(hubPageId);
}

/**
 * MEJ's getDocumentTypes() map plus the companion's types. Returns a new
 * object; MEJ's own map is never mutated.
 * @param {object|undefined} types  MEJ's map (type key -> sheet class)
 * @param {object} additions        companion additions (type key -> sheet class)
 */
export function withCompanionTypes(types, additions) {
  return { ...(types ?? {}), ...additions };
}
