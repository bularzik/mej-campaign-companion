// Timeline journals get a timeline icon in the journal sidebar (spec
// 2026-09-03 §D). MEJ's updateDirectory (monks-enhanced-journal.js ~3383)
// gives every page-less entry `.journal-type fas fa-fw fa-book`; it runs
// from MEJ's module-level renderJournalDirectory hook for the core sidebar
// and from EnhancedJournal#_onRender for the shell's own sidebar copy. Both
// of ours run after those: module scripts evaluate before any init hook,
// and AppV2 fires renderEnhancedJournal after _onRender.
import { isTimelineJournal } from "../logic/campaigns.mjs";

const ICON_CLASS = "journal-type fas fa-fw fa-timeline";

/** Swap the row icon for every timeline journal row under `root`. Exported for tests; idempotent. */
export function decorateTimelineRows(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    const entry = game.journal.get(li.dataset.entryId);
    if (!entry || !isTimelineJournal(entry)) continue;
    const icon = li.querySelector(".entry-name .journal-type") ?? li.querySelector(".entry-name i");
    if (icon) icon.className = ICON_CLASS;
  }
}

function rootOf(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}

export function registerTimelineDirectory() {
  Hooks.on("renderJournalDirectory", (app, html) => decorateTimelineRows(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => decorateTimelineRows(app?.element ?? null));
}
