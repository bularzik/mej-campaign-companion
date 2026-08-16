/**
 * Pure decision for whether a about-to-be-created JournalEntry should get
 * player-writable default ownership, per the `playersWriteSessions` world
 * setting. No Foundry imports - callers pass in the entry's raw creation
 * data and the setting's current value. Covers BOTH of the companion's
 * session-creation paths with one predicate:
 *  - MEJ's own "New Entry" UI sets `flags.monks-enhanced-journal.pagetype`
 *    on the JournalEntry itself before create() (see
 *    monks-enhanced-journal.js's renderDialogV2 listener, which injects a
 *    type <select> wired to that flag, and the paired
 *    `JournalEntry.prototype._onCreate` patch (~line 1032) that reads it
 *    back to build the child page).
 *  - The docx import wizard (apps/import-wizard.mjs #createPage) creates the
 *    session page directly in the same JournalEntry.create() call's `pages`
 *    array, with no pagetype flag involved at all.
 * Checking both shapes here means a single preCreateJournalEntry hook
 * (campaign-companion.mjs) covers both creation paths without duplicating
 * the ownership-setting logic in the import wizard itself.
 */
export function shouldOwnSessionEntry(entryData, { sessionType, playersWriteSessions }) {
  if (!playersWriteSessions) return false;
  const pagetype = entryData?.flags?.["monks-enhanced-journal"]?.pagetype;
  if (pagetype === sessionType) return true;
  return Array.isArray(entryData?.pages) && entryData.pages.some((p) => p?.type === sessionType);
}
