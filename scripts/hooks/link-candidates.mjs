// scripts/hooks/link-candidates.mjs
// Entities that may be linked into one region of a page, shared by the
// typing-path auto-link and Link to Entity (spec 2026-09-26 §4.1). Bounded by
// audience containment (auto-link spec Part 1): an entity qualifies only if
// every non-GM user who can view the page's entry can also view the entity.
// Returned BEFORE dropAmbiguousNames: auto-link drops same-name candidates
// itself ("never guess"); Link to Entity offers them in a picker.
import { selectCandidates } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { linkableRegions, sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isLinkableEntity } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { matchingEntities, normalizeEntityName } from "../logic/entity-from-selection.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

/**
 * Every other MEJ-typed JournalEntry in the page's campaign scope whose
 * viewer set contains the region's viewers. A gmOnly region (session GM
 * notes) has no non-GM viewers, so containment passes for every entity in
 * scope. `nameKey` (a normalizeEntityName result) drops other names before
 * any permission work; auto-link omits it.
 */
export function linkCandidates(page, region, { nameKey = null } = {}) {
  const users = game.users.contents;
  const pageViewers = region.gmOnly ? [] : viewerIds(page.parent, users, isVisibleToUser);
  const pageCampaignId = campaignIdOf(page);
  const pages = game.journal
    .filter((entry) => (nameKey === null || normalizeEntityName(entry.name) === nameKey)
      && isLinkableEntity(entry, mejType)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: audienceContains(pageViewers, viewerIds(entry, users, isVisibleToUser))
    }));
  return selectCandidates({ pages, selfId: page.parent?.id });
}

/** Link to Entity's matches for a selection in the field `fieldKey` ([] for an unknown field). */
export function matchesForField(page, fieldKey, text) {
  const region = linkableRegions(page).find((r) => r.key === fieldKey);
  const nameKey = normalizeEntityName(text);
  return region && nameKey ? matchingEntities(text, linkCandidates(page, region, { nameKey })) : [];
}
