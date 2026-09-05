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
 *    back to build the child page). That flag's value is always the bare,
 *    unprefixed sheet-registration key ("session") - it's never the actual
 *    page `type` field, so `sessionType` (unprefixed) is the only form that
 *    can ever appear there.
 *  - The docx import wizard (apps/import-wizard.mjs #createPage) creates the
 *    session page directly in the same JournalEntry.create() call's `pages`
 *    array, with no pagetype flag involved at all - its `type` field is a
 *    real JournalEntryPage type, which for a module-declared subtype must be
 *    the prefixed `sessionDocumentType` (`${MODULE_ID}.session` -
 *    DocumentTypeField._validateType rejects the bare key at Document.create;
 *    see constants.mjs's SESSION_TYPE/SESSION_DOCUMENT_TYPE doc comment).
 *    The bare form is still accepted here too, defensively, for any
 *    page shaped by a path this module doesn't control (e.g. a
 *    hand-authored `pages` array, or a pre-fix document from before this
 *    predicate distinguished the two forms).
 * Checking both shapes here means a single preCreateJournalEntry hook
 * (campaign-companion.mjs) covers both creation paths without duplicating
 * the ownership-setting logic in the import wizard itself.
 */
export function shouldOwnSessionEntry(entryData, { sessionType, sessionDocumentType, playersWriteSessions }) {
  if (!playersWriteSessions) return false;
  const pagetype = entryData?.flags?.["monks-enhanced-journal"]?.pagetype;
  if (pagetype === sessionType) return true;
  return Array.isArray(entryData?.pages)
    && entryData.pages.some((p) => p?.type === sessionType || p?.type === sessionDocumentType);
}

/**
 * Existing JournalEntries the `playersWriteSessions` setting should offer
 * to open up when it is switched on (spec 2026-09-04 §B): any entry holding
 * a session page whose default ownership is below OWNER. Accepts a live
 * collection (`pages.contents`) or a plain array, and both the prefixed
 * document type and the bare key MEJ's fixType() leaves on mounted pages.
 */
export function sessionEntriesNeedingOwnership(entries, { sessionType, sessionDocumentType, ownerLevel }) {
  return (entries ?? []).filter((e) => {
    const level = e?.ownership?.default ?? 0;
    if (level >= ownerLevel) return false;
    const pages = Array.isArray(e?.pages) ? e.pages : (e?.pages?.contents ?? []);
    return pages.some((p) => p?.type === sessionDocumentType || p?.type === sessionType);
  });
}
