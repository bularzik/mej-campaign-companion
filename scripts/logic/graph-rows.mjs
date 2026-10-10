// Pure graph row collection, extracted from apps/graph-app.mjs's graphRows()
// so the Hub's graph tab can feed it SCOPED entries (the campaign picker's
// selection) instead of the whole world, and so it is vitest-loadable. Every
// Foundry touch is injected - same convention as campaigns.mjs. Row shape is
// exactly what logic/graph-data.mjs's buildGraph consumes.
import { visibleRelRows } from "./rel-reveals.mjs";
import { normalizeConnections, canSeeConnection } from "./player-connections.mjs";

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
 *        relRevealsOf(entry), relationshipsOf(page), imageOf?(page, type),
 *        playerConnectionsOf?(page), canSeeEntry?(uuid) }
 * Player connections are the row's OUTGOING ones (spec 2026-10-09 §6.1):
 * an edge needs both endpoints as nodes, and the from-entry's row is always
 * present when they are, so incoming ones would only duplicate the pair.
 * Only the author's main labels travel; notes and secrets never do.
 */
export function graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf, imageOf, playerConnectionsOf, canSeeEntry }) {
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
      const playerConnections = typeof playerConnectionsOf === "function"
        ? normalizeConnections(playerConnectionsOf(page), entry.uuid)
          .filter((row) => canSeeConnection(row, { userId, isGM, canSeeEntry: canSeeEntry ?? (() => false) }))
          .map((row) => ({
            id: row.id, to: row.to, authorName: row.authorName,
            fromLabel: row.sides.from.notes[row.authorId]?.label ?? "",
            toLabel: row.sides.to.notes[row.authorId]?.label ?? ""
          }))
        : [];
      const img = typeof imageOf === "function" ? imageOf(page, type) : null;
      rows.push({ uuid: entry.uuid, name: entry.name, type, img: typeof img === "string" && img.length ? img : null, relationships, playerConnections });
      break;
    }
  }
  return rows;
}
