// scripts/hooks/auto-link.mjs
// Typing-path auto-link. Candidates are bounded by AUDIENCE CONTAINMENT
// (spec Part 1): an entity may link into this page only if every non-GM user
// who can view the page's parent entry can also view the entity. This is
// deliberately stricter than the previous acting-user-visibility rule for
// GMs: typing a GM-only entity's name into a player-visible page no longer
// produces a link players can see but not open. Same-name candidates that
// both pass containment are dropped (never guess) — the typing path has no
// report channel, so the drop is silent here. Regions come from
// logic/link-targets.mjs so session recaps and GM notes are covered;
// candidates are limited to the page's campaign scope.
// Candidate building lives in hooks/link-candidates.mjs (shared with Link to Entity).
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";
import { linkCandidates } from "./link-candidates.mjs";

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

      for (const region of linkableRegions(page)) {
        const next = foundry.utils.getProperty(changes, region.key);
        if (typeof next !== "string" || !next) continue;
        const candidates = dropAmbiguousNames(linkCandidates(page, region)).kept;
        if (!candidates.length) continue;
        // Baseline = the field as of the last save that ran this hook (see
        // the baseline note above): only words added since then are linked.
        const linked = autoLinkAdded(region.content, next, candidates);
        if (linked !== next) foundry.utils.setProperty(changes, region.key, linked);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | auto-link failed`, err);
    }
  });
}
