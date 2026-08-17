// scripts/logic/link-audience.mjs
// Pure audience math for auto-link scoping (spec Part 1). The containment
// rule: a mention in page P may link to entity E only if every non-GM user
// who can view P can also view E. "Can view" is injected (isVisibleToUser
// from hub-index.mjs at the call sites) so this stays unit-testable.

/**
 * Non-GM user ids the predicate accepts for this entry.
 * @param {object} entry  a JournalEntry (opaque to this module)
 * @param {{id:string,isGM:boolean}[]} users
 * @param {(entry: object, user: object) => boolean} isVisible
 * @returns {string[]}
 */
export function viewerIds(entry, users, isVisible) {
  return (users ?? []).filter((u) => !u.isGM && isVisible(entry, u)).map((u) => u.id);
}

/** True iff every page viewer can also see the target (empty page audience → true). */
export function audienceContains(pageViewerIds, targetViewerIds) {
  const target = new Set(targetViewerIds ?? []);
  return (pageViewerIds ?? []).every((id) => target.has(id));
}

/** The viewer set an import audience choice implies: "players" → all non-GM ids, else none. */
export function audienceViewerIdsForImport(audience, users) {
  if (audience !== "players") return [];
  return (users ?? []).filter((u) => !u.isGM).map((u) => u.id);
}

/** Candidates ({name, uuid, viewerIds}) whose viewers contain the given audience. */
export function filterCandidatesForAudience(candidates, audienceViewerIds) {
  return (candidates ?? []).filter((c) => audienceContains(audienceViewerIds, c.viewerIds));
}
