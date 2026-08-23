// Pure decision logic for the New Entry dialog's default folder. No Foundry
// imports so vitest can load it directly - same convention as campaigns.mjs.
// The Foundry glue (the JournalEntry.createDialog wrap) lives in
// hooks/create-dialog-default.mjs.

/**
 * The folder id the create dialog should default to, or null for "leave the
 * dialog alone". Null when the caller already chose a folder (per-folder
 * sidebar create buttons pass data.folder), when nothing relevant is open in
 * the MEJ shell, or when the open document (a page resolves to its parent
 * entry) isn't a real JournalEntry - the shell fronts BlankJournal
 * pseudo-documents for its blank tab, which must never contribute a folder.
 * `isPage`/`isEntry` are injected instanceof predicates (JournalEntryPage /
 * JournalEntry) so this stays loadable without Foundry globals.
 */
export function defaultCreateFolderId(data, openDoc, { isPage, isEntry }) {
  if (data?.folder) return null;
  const entry = isPage(openDoc) ? openDoc.parent : openDoc;
  if (!isEntry(entry)) return null;
  return entry.folder?.id ?? null;
}
