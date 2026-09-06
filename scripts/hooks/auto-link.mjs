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
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { linkableRegions, sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isTimelineJournal, isCampaignPortal } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

/**
 * Linkable candidates for one region of a page: every other MEJ-typed
 * JournalEntry in the page's campaign scope whose viewer set contains the
 * region's viewers. A gmOnly region (session GM notes) has no non-GM
 * viewers, so containment passes for every entity in scope.
 */
function buildCandidates(page, region) {
  const users = game.users.contents;
  const pageViewers = region.gmOnly ? [] : viewerIds(page.parent, users, isVisibleToUser);
  const pageCampaignId = campaignIdOf(page);
  const pages = game.journal
    .filter((entry) => mejType(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
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

      for (const region of linkableRegions(page)) {
        const next = foundry.utils.getProperty(changes, region.key);
        if (typeof next !== "string" || !next) continue;
        const candidates = buildCandidates(page, region);
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
