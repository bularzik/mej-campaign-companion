// The one seam for who writes and who reads party relationships (spec
// 2026-10-10 §2.2). Today: writers are the campaign's Contributors, readers
// get the campaign baseline. The future campaign-membership feature changes
// these two functions and nothing else.
import { campaignFlagOf, isContributor, ownershipLevelFor } from "./campaigns.mjs";

export function partyWriters(campaign, users, groups) {
  const flag = campaignFlagOf(campaign);
  return [...new Set((users ?? []).filter((u) => !u.isGM && isContributor(u, flag, groups)).map((u) => u.id))];
}

export function partyReaders(campaign, levels) {
  return ownershipLevelFor(campaignFlagOf(campaign)?.ownershipDefault, levels);
}

/**
 * The notebook's full ownership record, or null when `current` already
 * matches. Users not in `writerIds` lose their explicit entry (they fall back
 * to the default); `gmIds` entries are left alone.
 */
export function notebookOwnership(current, { defaultLevel, writerIds, ownerLevel, gmIds = [] }) {
  const next = { default: defaultLevel };
  for (const id of gmIds) if (current?.[id] !== undefined) next[id] = current[id];
  for (const id of writerIds) next[id] = ownerLevel;
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(next)]);
  const same = [...keys].every((k) => current?.[k] === next[k]);
  return same ? null : next;
}

/**
 * Convert a current -> next ownership pair into an explicit document update
 * (removed keys via "ownership.-=<id>", set keys via "ownership.<key>"), so
 * removal never depends on Foundry's merge semantics. Null when nothing changes.
 * `replace` (Foundry 14's global _replace) is used instead when a key is removed.
 */
export function ownershipUpdate(current, next, { replace = null } = {}) {
  if (!next) return null;
  // Foundry 14 ignores "-=" keys (and _del) inside a document's ownership:
  // a removal there needs the whole record replaced (_replace, v14 only).
  // Foundry 13 has no _replace and honours "-=". Both verified live.
  if (typeof replace === "function" && Object.keys(current ?? {}).some((key) => !(key in next))) {
    return { ownership: replace({ ...next }) };
  }
  const update = {};
  for (const key of Object.keys(current ?? {})) {
    if (!(key in next)) update[`ownership.-=${key}`] = null;
  }
  for (const [key, value] of Object.entries(next)) {
    if (current?.[key] !== value) update[`ownership.${key}`] = value;
  }
  return Object.keys(update).length ? update : null;
}
