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
