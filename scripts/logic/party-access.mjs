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
