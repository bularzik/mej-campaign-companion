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

/**
 * Is this a native page subtype the companion declares (`<moduleId>.<key>`)?
 *
 * Wrap 1 puts the companion's keys into MEJ's registry, which makes MEJ's
 * fixType take its `object.type = type` branch and rewrite the page's
 * in-memory type to the bare MEJ key. That is harmless for MEJ's own types
 * (all native "text" pages carrying a flag) but destroys ours, whose real
 * Foundry subtype IS the prefixed one - Foundry's own DocumentSheetV2
 * constructor then throws out of getSheetClassesForSubType. Every companion
 * subtype needs putting back, not just the session one: a campaign portal
 * page is `mej-campaign-companion.campaign` and hit exactly the same crash
 * (live on 13.06, 2026-09-20).
 * @param {unknown} type a document's `type`
 * @param {string} moduleId the companion's module id
 */
export function isCompanionPageType(type, moduleId) {
  return typeof type === "string" && !!moduleId && type.startsWith(`${moduleId}.`);
}
