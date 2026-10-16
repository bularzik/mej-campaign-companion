/**
 * Named player groups (spec §3): the playerGroups world setting's value,
 * [{id, name, members: [userId]}], GM-managed from the Hub Secrets tab.
 * Pure normalization/CRUD only — reveal semantics live in reveal-state.mjs.
 */
export function normalizeGroups(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((g) => g && typeof g.id === "string" && g.id.length && typeof g.name === "string" && g.name.length)
    .map((g) => ({
      id: g.id,
      name: g.name,
      members: (Array.isArray(g.members) ? g.members : []).filter((m) => typeof m === "string")
    }));
}

export function upsertGroup(groups, { id, name, members }) {
  const next = { id, name, members: [...(members ?? [])] };
  const list = normalizeGroups(groups);
  const at = list.findIndex((g) => g.id === id);
  if (at === -1) return [...list, next];
  return list.map((g, i) => (i === at ? next : g));
}

export function deleteGroup(groups, id) {
  return normalizeGroups(groups).filter((g) => g.id !== id);
}

/** Display rows for a groups list: name-sorted, members resolved to names (unknown ids dropped). */
export function groupsSummary(groups, users) {
  const nameOf = new Map((users ?? []).map((u) => [u.id, u.name]));
  return normalizeGroups(groups)
    .map((g) => ({ id: g.id, name: g.name, memberNames: g.members.map((id) => nameOf.get(id)).filter(Boolean).join(", ") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Re-merge contributor group checkboxes after the groups manager closes.
 * Groups that were rendered before keep exactly what the GM had ticked
 * (never re-ticked from the saved flag); groups created meanwhile use their
 * saved state; deleted groups are absent from `freshChoices`.
 */
export function mergeGroupTicks(freshChoices, renderedIds, tickedIds) {
  const rendered = new Set(renderedIds ?? []);
  const ticked = new Set(tickedIds ?? []);
  return (freshChoices ?? []).map((c) => ({ ...c, checked: rendered.has(c.id) ? ticked.has(c.id) : !!c.checked }));
}
