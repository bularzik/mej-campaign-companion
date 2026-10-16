// scripts/logic/hub-open-scope.mjs
// Spec 2026-10-15 item 4: the shell's Campaign Hub control opens the Hub on
// the campaign of whatever entry the shell is showing. Pure: the hook passes
// the shell's current document and two predicates.

/**
 * @param {object|null} doc   the shell's current document (page or entry), or null
 * @param {{campaignIdOf:(doc:object)=>string|null, isHubPlaceholder:(doc:object)=>boolean}} deps
 * @returns {string} campaign folder id, or "" for All campaigns
 */
export function hubScopeForOpenDocument(doc, { campaignIdOf, isHubPlaceholder }) {
  if (!doc || isHubPlaceholder(doc)) return "";
  return campaignIdOf(doc) ?? "";
}
