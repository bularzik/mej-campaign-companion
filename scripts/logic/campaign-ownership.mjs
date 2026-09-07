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
 * Never lowers a level already granted on the pending document: another
 * preCreateJournalEntry listener (playersWriteSessions in
 * campaign-companion.mjs) may already have called entry.updateSource() to
 * grant a higher default before this planner runs - Foundry runs
 * same-named hook listeners in registration order, and this module's own
 * hook has no control over where in that order it lands. Foundry's own
 * default is 0, so an untouched entry still gets the baseline; a higher
 * `currentDefault` wins either way, whichever hook registers first.
 *
 * @param {object} data           raw creation data (preCreateJournalEntry's 2nd arg)
 * @param {number|null|undefined} baseline  campaign baseline level, or null/undefined when
 *                                the target folder is not in a campaign
 * @param {{isGM:boolean, currentDefault?:number}} opts   GM seat only, like the
 *                                playersWriteSessions hook; currentDefault is the
 *                                pending document's own ownership.default so far
 * @returns {{default:number}|null}
 */
export function inheritedOwnership(data, baseline, { isGM, currentDefault = 0 }) {
  if (!isGM) return null;
  if (baseline === null || baseline === undefined) return null;
  if (data?.ownership !== undefined && data?.ownership !== null) return null;
  if (currentDefault > baseline) return null;
  return { default: baseline };
}
