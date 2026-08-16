import { campaignSortKey } from "./campaign-date.mjs";

/** Gap between appended sort keys (Foundry SORT_INTEGER_DENSITY convention). */
export const SORT_GAP = 100000;

// Repeated midpoint inserts at the same spot halve the gap each time; float
// precision exhausts after ~50 such inserts. Accepted for hand-edited
// timelines — no rebalancing pass.
/** A sort key strictly between two neighbors; null means open-ended. */
export function sortKeyBetween(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - SORT_GAP;
  if (after == null) return before + SORT_GAP;
  return (before + after) / 2;
}

/** Timepoints ordered by sort key, ties broken by label. Non-mutating. */
export function sortTimepoints(timepoints) {
  return [...timepoints].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

/**
 * Timepoints ordered for display. "manual" is the canonical sort-key order;
 * "created" sorts by createdAt (sort-key tiebreak); "campaign" floats undated
 * timepoints to the top (ordered by createdAt) then dated ascending. Non-mutating.
 */
export function orderTimepoints(timepoints, mode) {
  const byCreated = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0);
  if (mode === "created") {
    return [...timepoints].sort((a, b) => byCreated(a, b) || a.sort - b.sort);
  }
  if (mode === "campaign") {
    return [...timepoints].sort((a, b) => {
      const ka = campaignSortKey(a.campaignDate);
      const kb = campaignSortKey(b.campaignDate);
      if (ka == null && kb == null) return byCreated(a, b);
      if (ka == null) return -1;   // undated rises to the top
      if (kb == null) return 1;
      return ka - kb || byCreated(a, b);
    });
  }
  return sortTimepoints(timepoints);
}
