// Ported from campaign-record's scripts/logic/sort-menu.mjs — no
// module-specific imports needed, but SORT_KEYS drops "updated": campaign-record
// tracked a per-record update timestamp its sort could key off; MEJ entries carry
// no equivalent, en.json never gained a hub.sort.updated label, and
// filterIndexRows (hub-index.mjs) never implemented it. Dropped rather than
// wired up - YAGNI, and campaign-record's "updated" semantics don't map
// cleanly onto MEJ journal entries.

/** Index sort options, mirroring the doctype-filter view-model pattern. */
export const SORT_KEYS = ["name", "type"];

/**
 * Build the sort popup view model.
 * @param {string} current  active sort key
 * @param {(key: string) => string} labelOf  localized label for a sort key
 * @returns {{items: {value: string, label: string, selected: boolean}[]}}
 */
export function buildSortMenu(current, labelOf) {
  return {
    items: SORT_KEYS.map((value) => ({ value, label: labelOf(value), selected: value === current }))
  };
}
