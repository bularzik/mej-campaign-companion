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

/**
 * Spec "never guess" rule: a name carried by 2+ candidates that all survived
 * the containment filter is dropped entirely (first occurrence's original
 * name is reported once). Input is selectCandidates() output; order kept.
 * @param {{name:string, uuid:string}[]} candidates
 * @returns {{kept: {name:string, uuid:string}[], ambiguousNames: string[]}}
 */
export function dropAmbiguousNames(candidates) {
  const counts = new Map();
  for (const c of candidates ?? []) {
    const key = c.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kept = [];
  const ambiguousNames = [];
  const reported = new Set();
  for (const c of candidates ?? []) {
    const key = c.name.trim().toLowerCase();
    if (counts.get(key) > 1) {
      if (!reported.has(key)) {
        reported.add(key);
        ambiguousNames.push(c.name.trim());
      }
      continue;
    }
    kept.push(c);
  }
  return { kept, ambiguousNames };
}
