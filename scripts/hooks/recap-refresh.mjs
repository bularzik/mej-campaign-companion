// Re-render a Session view when its shared recap (or GM notes) changes on
// another client (spec 2026-09-04, Deviations). MEJ's own
// updateJournalEntryPage hook reloads the shell for text.content, ownership
// and its flag keys - never for system.*, so a viewer kept a stale recap
// until they reopened the page. Never touches a view with an editor open.
// Inert without MEJ (no shell; the popped-out branch only fires for a
// rendered MEJ sheet).
import { MODULE_ID } from "../constants.mjs";
import { recapChanged, shouldRefreshForRecap } from "../logic/recap-refresh.mjs";

function rootOf(app) {
  const el = app?.element;
  return el instanceof HTMLElement ? el : (el?.[0] instanceof HTMLElement ? el[0] : null);
}

function isEditing(root) {
  return !!root?.querySelector(".editor-parent.editing");
}

export function registerRecapRefresh() {
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    if (!recapChanged(changes)) return;
    try {
      const shell = game.MonksEnhancedJournal?.journal;
      if (shell?.rendered) {
        const activeEntityId = shell.tabs?.active?.()?.entityId ?? null;
        if (shouldRefreshForRecap({ changes, activeEntityId, pageId: page.id, editing: isEditing(rootOf(shell)) })) {
          shell.render({ tempOwnership: shell.tempOwnership, reload: true, focus: false });
          return;
        }
      }
      const sheet = page._sheet;
      if (sheet?.rendered && !sheet.enhancedjournal && !isEditing(rootOf(sheet))) {
        sheet.render(true, { reload: true });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recap refresh failed`, err);
    }
  });
}
