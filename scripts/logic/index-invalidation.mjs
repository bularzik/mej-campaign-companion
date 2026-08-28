/**
 * When does a settings change make the live search index wrong?
 *
 * search/live-index.mjs's recordFor() routes a person's playerHidden
 * attributes out of the public `record.fields` and into `record.gmFields`
 * (indexed under a separate "gm:"-prefixed token set that search({gm:false})
 * never matches). Which keys count as hidden comes from
 * personAttributeHiddenKeys(), which reads MEJ's own "sheet-settings" WORLD
 * SETTING - not page data.
 *
 * That means the public/GM split is frozen at index time. Page edits already
 * re-index (updateJournalEntryPage), and the page-level override lives in
 * page flags so it rides along with them - but a change to the world setting
 * itself touched nothing, so an attribute a GM newly marked playerHidden kept
 * sitting in the PUBLIC token set, findable by any player's search, until the
 * next world reload. The GM believes it is hidden; it is not.
 *
 * Foundry fires the global "updateSetting" hook for any setting write,
 * carrying the Setting document whose `key` is the namespaced "<scope>.<key>"
 * form - so this can be watched without touching MEJ's own registration.
 * Pure and Foundry-free so the decision is unit-testable on its own.
 */

/** MEJ's per-attribute sheet-settings, in the namespaced form Setting#key carries. */
export const MEJ_SHEET_SETTINGS_KEY = "monks-enhanced-journal.sheet-settings";

/**
 * Does a write to this setting key invalidate the built search index?
 * @param {string} settingKey a Setting document's `key` ("<scope>.<key>")
 */
export function invalidatesSearchIndex(settingKey) {
  return settingKey === MEJ_SHEET_SETTINGS_KEY;
}
