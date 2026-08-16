// scripts/logic/auto-link-candidates.mjs

/**
 * Linkable candidates for a page's own campaign record. Pure: the caller
 * supplies indexable/visible booleans (computed from Foundry) so this stays
 * unit-testable. Sorted longest-name-first for longest-match-wins linking.
 */
export function selectCandidates({ pages, selfId, minLength = 3 }) {
  return pages
    .filter(
      (p) =>
        p.id !== selfId &&
        p.indexable &&
        p.visible &&
        (p.name?.trim().length ?? 0) >= minLength
    )
    .map((p) => ({ name: p.name, uuid: p.uuid }))
    .sort((a, b) => b.name.length - a.name.length);
}
