/**
 * Pure backlink ("mentioned in") index derived from search-index records.
 * A mention is an @UUID[...] reference inside any indexed field's raw value
 * (auto-link converts plain-prose names into @UUID links, so prose mentions
 * arrive here transitively - spec §2). Never persisted; rebuilt/maintained
 * alongside the search index by scripts/search/live-index.mjs.
 *
 * Structure:
 *   outbound: Map<sourceUuid, {refs: Map<target,count>, gmRefs: Map<target,count>}>
 *   inbound:  Map<targetUuid, Map<sourceUuid, {count, gmOnly}>>
 */

const UUID_RE = /@UUID\[([^\]#]+)(?:#[^\]]*)?\](?:\{[^}]*\})?/g;
const PAGE_RE = /^(JournalEntry\.[^.]+)\.JournalEntryPage\.[^.]+$/;

export function normalizeTargetUuid(uuid) {
  const match = PAGE_RE.exec(uuid);
  return match ? match[1] : uuid;
}

function countRefs(values, sourceUuid) {
  const counts = new Map();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    for (const match of raw.matchAll(UUID_RE)) {
      const target = normalizeTargetUuid(match[1]);
      if (target === sourceUuid) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

/** Parse a search-index record's raw field values into public/GM ref maps. */
export function extractRefs(record) {
  const refs = countRefs(Object.values(record.fields ?? {}), record.uuid);
  const gmRefs = countRefs(Object.values(record.gmFields ?? {}), record.uuid);
  for (const target of refs.keys()) gmRefs.delete(target); // public wins
  return { refs, gmRefs };
}

export function createBacklinkIndex() {
  return { outbound: new Map(), inbound: new Map() };
}

export function removeSourceRefs(bidx, sourceUuid) {
  const prev = bidx.outbound.get(sourceUuid);
  if (!prev) return;
  bidx.outbound.delete(sourceUuid);
  for (const target of [...prev.refs.keys(), ...prev.gmRefs.keys()]) {
    const bySource = bidx.inbound.get(target);
    if (!bySource) continue;
    bySource.delete(sourceUuid);
    if (!bySource.size) bidx.inbound.delete(target);
  }
}

export function setSourceRefs(bidx, sourceUuid, { refs, gmRefs }) {
  removeSourceRefs(bidx, sourceUuid);
  if (!refs.size && !gmRefs.size) return;
  bidx.outbound.set(sourceUuid, { refs, gmRefs });
  const add = (map, gmOnly) => {
    for (const [target, count] of map) {
      let bySource = bidx.inbound.get(target);
      if (!bySource) bidx.inbound.set(target, (bySource = new Map()));
      bySource.set(sourceUuid, { count, gmOnly });
    }
  };
  add(refs, false);
  add(gmRefs, true);
}

export function backlinksFor(bidx, targetUuid, { gm = false } = {}) {
  const bySource = bidx.inbound.get(targetUuid);
  if (!bySource) return [];
  const rows = [];
  for (const [uuid, { count, gmOnly }] of bySource) {
    if (gmOnly && !gm) continue;
    rows.push({ uuid, count, gmOnly });
  }
  return rows.sort((a, b) => b.count - a.count || a.uuid.localeCompare(b.uuid));
}

export function visibleMentionCounts(bidx, { gm = false, canSee = () => true } = {}) {
  const counts = new Map();
  for (const [target, bySource] of bidx.inbound) {
    let n = 0;
    for (const [source, { count, gmOnly }] of bySource) {
      if (gmOnly && !gm) continue;
      if (!canSee(source)) continue;
      n += count;
    }
    if (n) counts.set(target, n);
  }
  return counts;
}
