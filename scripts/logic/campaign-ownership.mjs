// scripts/logic/campaign-ownership.mjs
// Pure planner for spec 2026-09-06 §2: an entry created inside a campaign
// folder starts at the campaign's ownership baseline. No Foundry imports.

/**
 * Ownership record a new entry filed in a campaign should be created with,
 * or null to leave the creation data alone.
 *
 * Explicit wins: any `ownership` key in the creation data (the Hub's session
 * path, createMejEntry with an ownership argument, the portal and timeline
 * creators, MEJ's "Extract" which copies the source entry's ownership, a
 * macro) is never overridden. `ownership: null` counts as absent - that is
 * what `...(ownership ? { ownership } : {})` callers produce.
 *
 * @param {object} data           raw creation data (preCreateJournalEntry's 2nd arg)
 * @param {number|null|undefined} baseline  campaign baseline level, or null/undefined when
 *                                the target folder is not in a campaign
 * @param {{isGM:boolean}} opts   GM seat only, like the playersWriteSessions hook
 * @returns {{default:number}|null}
 */
export function inheritedOwnership(data, baseline, { isGM }) {
  if (!isGM) return null;
  if (baseline === null || baseline === undefined) return null;
  if (data?.ownership !== undefined && data?.ownership !== null) return null;
  return { default: baseline };
}
