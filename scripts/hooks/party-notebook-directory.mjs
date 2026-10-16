// Party notebooks never show in the journal sidebar (spec 2026-10-10 §4.4).
// Registered at init, like timeline-directory.mjs / campaign-directory.mjs:
// the sidebar's first render happens before setup/ready, so hooks added from
// registerCore() missed it and the notebook stayed listed until the next
// re-render. Pure-logic import only, so it is safe that early.
import { isPartyNotebook, isNotesEntry } from "../logic/campaigns.mjs";

const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);

/** Remove every party notebook row under `root`. Exported for tests; idempotent. */
export function hidePartyNotebookRows(root) {
  if (!root?.querySelectorAll || !globalThis.game?.journal) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    const entry = game.journal.get(li.dataset.entryId);
    if (isPartyNotebook(entry) || isNotesEntry(entry)) li.remove();
  }
}

/** One pass over the sidebar and MEJ's shell when they are already rendered. */
export function hideRenderedPartyNotebookRows() {
  const sidebar = globalThis.ui?.journal;
  if (sidebar?.rendered) hidePartyNotebookRows(rootOf(sidebar.element));
  const shell = globalThis.game?.MonksEnhancedJournal?.journal;
  if (shell?.rendered) hidePartyNotebookRows(rootOf(shell.element));
}

export function registerPartyNotebookDirectory() {
  Hooks.on("renderJournalDirectory", (app, html) => hidePartyNotebookRows(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => hidePartyNotebookRows(rootOf(app?.element)));
  hideRenderedPartyNotebookRows();
}
