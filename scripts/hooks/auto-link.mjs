// scripts/hooks/auto-link.mjs
// Typing-path auto-link. Candidates are bounded by AUDIENCE CONTAINMENT
// (spec Part 1): an entity may link into this page only if every non-GM user
// who can view the page's parent entry can also view the entity. This is
// deliberately stricter than the previous acting-user-visibility rule for
// GMs: typing a GM-only entity's name into a player-visible page no longer
// produces a link players can see but not open. Same-name candidates that
// both pass containment are dropped (never guess) — the typing path has no
// report channel, so the drop is silent here.
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";

/**
 * Linkable candidates for a page: every other MEJ-typed JournalEntry whose
 * viewer set contains the page's parent-entry viewer set. Each candidate's
 * `uuid` is the entry's own Foundry uuid ("JournalEntry.<id>"), which is
 * exactly the @UUID target auto-link.mjs emits.
 */
function buildCandidates(page) {
  const users = game.users.contents;
  const pageViewers = viewerIds(page.parent, users, isVisibleToUser);
  const pages = game.journal
    .filter((entry) => game.MonksEnhancedJournal.getMEJType(entry))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: audienceContains(pageViewers, viewerIds(entry, users, isVisibleToUser))
    }));
  return dropAmbiguousNames(selectCandidates({ pages, selfId: page.parent?.id })).kept;
}

/**
 * On a committed page save, wrap newly-added MEJ entry-name mentions in
 * text.content as @UUID content links.
 *
 * Baseline note: campaign-record anchors its diff baseline to the last full
 * sheet render (tracked separately, set from BaseRecordSheet#_onRender)
 * because its inline-edit fields autosave quietly (`{ render: false }`)
 * between renders, and preUpdateJournalEntryPage skips those quiet saves -
 * so the document's live field value can silently drift past the
 * last-processed state. MEJ's page text.content has no such quiet
 * autosave path: it's only written by an explicit editor "save" commit, which
 * always reaches this hook. So the pre-update `page.text.content` (the
 * content as of the last save that *did* run this hook) is already the
 * correct baseline - no separate baseline tracking is needed here.
 */
export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    try {
      // Retroactive-pass writes are already fully linked (hooks/retro-link.mjs
      // stamps this option) - re-running the diff here would be wasted work.
      if (options?.[MODULE_ID]?.retroLink) return;
      if (!game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) return;
      if (page.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG)) return;
      const next = changes?.text?.content;
      if (next === undefined || typeof next !== "string" || !next) return;

      const candidates = buildCandidates(page);
      if (!candidates.length) return;

      const baseline = page.text?.content ?? "";
      const linked = autoLinkAdded(baseline, next, candidates);
      if (linked !== next) foundry.utils.setProperty(changes, "text.content", linked);
    } catch (err) {
      console.error(`${MODULE_ID} | auto-link failed`, err);
    }
  });
}
