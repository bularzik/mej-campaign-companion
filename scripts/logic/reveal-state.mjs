/**
 * The Phase C reveal engine (spec §3): the ONE place audience semantics
 * live. An audience record is {users, groups, all, revealedAt}; group
 * membership resolves LIVE against the caller-supplied groups list
 * ([{id, name, members}], from the playerGroups world setting) — joining a
 * group grants everything previously revealed to it, leaving revokes it.
 * Pure and Foundry-free (vitest-loadable); timestamps are passed in by
 * callers, never read from a clock here.
 */

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function normalizeAudience(raw) {
  return {
    users: strings(raw?.users),
    groups: strings(raw?.groups),
    all: raw?.all === true,
    revealedAt: typeof raw?.revealedAt === "number" ? raw.revealedAt : null
  };
}

export function isRevealed(audience) {
  const a = normalizeAudience(audience);
  return a.all || a.users.length > 0 || a.groups.length > 0;
}

export function canSee(audience, userId, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return true;
  if (a.users.includes(userId)) return true;
  const groupIds = new Set(a.groups);
  return (groups ?? []).some((g) => groupIds.has(g.id) && (g.members ?? []).includes(userId));
}

const toggled = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function toggleUser(audience, userId, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, users: toggled(a.users, userId), revealedAt: revealedAt ?? a.revealedAt };
}

export function toggleGroup(audience, groupId, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, groups: toggled(a.groups, groupId), revealedAt: revealedAt ?? a.revealedAt };
}

export function setAll(audience, all, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, all: all === true, revealedAt: revealedAt ?? a.revealedAt };
}

/**
 * Concrete userIds a reveal should whisper to. all=true returns [] — the
 * caller decides what "everyone" means in its context (typically every
 * non-GM user), because this module has no user directory.
 */
export function resolveRecipients(audience, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return [];
  const out = new Set(a.users);
  const groupIds = new Set(a.groups);
  for (const g of groups ?? []) {
    if (!groupIds.has(g.id)) continue;
    for (const m of g.members ?? []) out.add(m);
  }
  return [...out];
}

/** Drop reveal records whose key no longer exists (orphan cleanup, spec §5). */
export function pruneReveals(revealMap, liveIds) {
  const live = new Set(liveIds ?? []);
  const map = {};
  let changed = false;
  for (const [key, value] of Object.entries(revealMap ?? {})) {
    if (live.has(key)) map[key] = value;
    else changed = true;
  }
  return { map, changed };
}
