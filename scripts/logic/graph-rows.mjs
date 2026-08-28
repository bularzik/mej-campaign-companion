// Pure graph row collection, extracted from apps/graph-app.mjs's graphRows()
// so the Hub's graph tab can feed it SCOPED entries (the campaign picker's
// selection) instead of the whole world, and so it is vitest-loadable. Every
// Foundry touch is injected - same convention as campaigns.mjs. Row shape is
// exactly what logic/graph-data.mjs's buildGraph consumes.
import { visibleRelRows } from "./rel-reveals.mjs";

/** Image for a graph node: the page's own src, else MEJ's per-type placeholder when one exists, else null. */
export function nodeImage(src, type, assetTypes, assetPath) {
  if (typeof src === "string" && src.length) return src;
  return assetTypes.has(type) ? `${assetPath}/${type}.png` : null;
}

/**
 * Edge label text: the free-text relationship label plus the secret label
 * when one is visible to the current viewer. `secretText` is null when
 * visibleRelRows withheld it (unrevealed, non-GM viewer) - combineLabel
 * naturally drops it in that case, covering both the GM and player rules.
 */
export function combineLabel(label, secretText) {
  return [label, secretText].filter((s) => typeof s === "string" && s.length).join(" / ");
}

/**
 * One row per MEJ-typed entry in `entries` (single-page convention: the
 * first typed page wins). Scope IS the entries argument - callers decide
 * membership (the Hub passes its #scopedEntries()).
 * ctx: { isGM, userId, groups, getType(page), canObserve(entry),
 *        relRevealsOf(entry), relationshipsOf(page), imageOf?(page, type) }
 */
export function graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf, imageOf }) {
  const rows = [];
  for (const entry of entries ?? []) {
    if (!isGM && !canObserve(entry)) continue;
    for (const page of entry.pages?.contents ?? []) {
      const type = getType(page);
      if (!type) continue;
      const relationships = visibleRelRows(
        relationshipsOf(page),
        relRevealsOf(entry) ?? {},
        { userId, groups, isGM }
      ).map((r) => ({ id: r.id, uuid: r.uuid, hidden: r.hidden, revealedToViewer: r.rowRevealedToUser, label: combineLabel(r.label, r.secretText) }));
      const img = typeof imageOf === "function" ? imageOf(page, type) : null;
      rows.push({ uuid: entry.uuid, name: entry.name, type, img: typeof img === "string" && img.length ? img : null, relationships });
      break;
    }
  }
  return rows;
}
