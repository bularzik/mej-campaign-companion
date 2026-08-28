/**
 * Pure graph assembly for the relationship graph app (spec §5). The caller
 * (apps/graph-app.mjs) supplies permission-filtered rows - every row here
 * is already visible to the viewing user, so edge visibility reduces to
 * "both endpoints present" (spec §2) plus a hidden-relationship gate: GM-only,
 * except a row a caller marks `revealedToViewer: true` (a hidden row
 * individually row-revealed to this non-GM viewer, spec §6) still gets an
 * edge, kept dashed via `hidden: true`.
 */

export function normalizeRelationships(flagValue) {
  let entries;
  if (Array.isArray(flagValue)) entries = flagValue.map((rel) => [rel?.id ?? "", rel]);
  else if (flagValue && typeof flagValue === "object") entries = Object.entries(flagValue);
  else return [];
  return entries
    .filter(([, rel]) => rel && typeof rel.uuid === "string" && rel.uuid.length)
    .map(([id, rel]) => ({
      id: String(rel.id ?? id),
      uuid: rel.uuid,
      hidden: rel.hidden === true,
      label: typeof rel.relationship === "string" ? rel.relationship : ""
    }));
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildGraph(rows, backlinkPairs, { mode = "all", centerUuid = null, includeBacklinks = false, isGM = false, maxNodes = 200 } = {}) {
  const byUuid = new Map(rows.map((r) => [r.uuid, r]));

  // Relationship edges (undirected, deduped), hidden ones GM-only unless the
  // caller pre-marked this row as individually revealed to the viewer.
  const edges = [];
  const seenPairs = new Set();
  for (const row of rows) {
    for (const rel of row.relationships ?? []) {
      if (rel.hidden && !isGM && rel.revealedToViewer !== true) continue;
      if (!byUuid.has(rel.uuid)) continue;
      const key = pairKey(row.uuid, rel.uuid);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      edges.push({ source: row.uuid, target: rel.uuid, kind: "relationship", label: rel.label ?? "", hidden: rel.hidden === true });
    }
  }
  if (includeBacklinks) {
    for (const { source, target } of backlinkPairs ?? []) {
      if (!byUuid.has(source) || !byUuid.has(target)) continue;
      const key = pairKey(source, target);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      edges.push({ source, target, kind: "backlink" });
    }
  }

  let nodes = rows.map(({ uuid, name, type, img }) => ({ uuid, name, type, img: img ?? null }));

  if (mode === "ego" && centerUuid) {
    const keep = new Set([centerUuid]);
    for (const e of edges) {
      if (e.source === centerUuid) keep.add(e.target);
      if (e.target === centerUuid) keep.add(e.source);
    }
    nodes = nodes.filter((n) => keep.has(n.uuid));
  }

  let truncated = false;
  if (nodes.length > maxNodes) {
    truncated = true;
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    nodes = [...nodes]
      .sort((a, b) => (degree.get(b.uuid) ?? 0) - (degree.get(a.uuid) ?? 0) || a.name.localeCompare(b.name))
      .slice(0, maxNodes);
  }

  const present = new Set(nodes.map((n) => n.uuid));
  return { nodes, edges: edges.filter((e) => present.has(e.source) && present.has(e.target)), truncated };
}
