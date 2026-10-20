// Gate for hooks/recap-refresh.mjs (spec 2026-09-04, Deviations): MEJ only
// re-renders its shell for text.content, ownership and its own flag keys,
// never for system.*, so a viewer would keep a stale shared recap until
// they reopened the page.

export function recapChanged(changes) {
  return changes?.system?.recap !== undefined || changes?.system?.gmNotes !== undefined;
}

/**
 * @param {object} args
 * @param {object} args.changes the updateJournalEntryPage diff
 * @param {string|null} args.activeEntityId uuid shown in the shell's active tab (MEJ: journal.tabs.active().entityId)
 * @param {string} args.pageId the updated page's id
 * @param {boolean} args.editing whether any `.editor-parent.editing` exists in that view
 * @param {boolean} [args.isSessionView] the view is a Session sheet, whose editors are always
 *   live: it is patched region by region instead (sheets/session-regions.mjs), never re-rendered
 */
export function shouldRefreshForRecap({ changes, activeEntityId, pageId, editing, isSessionView = false }) {
  if (!recapChanged(changes)) return false;
  if (editing || isSessionView) return false;
  if (!activeEntityId || !pageId) return false;
  return activeEntityId.endsWith(`.${pageId}`);
}
