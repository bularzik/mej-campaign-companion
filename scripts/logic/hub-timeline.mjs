// Pure view-model logic for the Campaign Hub's Timeline pane. Kept out of
// CampaignHubPage.mjs for the same reason as hub-index.mjs (see there).
import { orderTimepoints } from "./timeline-sort.mjs";

export const ORDER_MODES = ["manual", "created", "campaign"];

/**
 * Ordered, display-ready timepoint rows: position (for reorder/insert),
 * canEdit, a date label, and resolved links. Date formatting and link
 * resolution are permission/calendar-dependent, so both are injected.
 *
 * @param {object[]} timepoints  raw timepoints (Task 6's getTimepoints() output)
 * @param {"manual"|"created"|"campaign"} order
 * @param {{canEdit: boolean, formatDate: (tp: object) => string, resolveRowLinks: (tp: object) => object[]}} opts
 */
export function buildTimelineRows(timepoints, order, { canEdit, formatDate, resolveRowLinks }) {
  const ordered = orderTimepoints(timepoints ?? [], order);
  return ordered.map((tp, i) => ({
    ...tp,
    position: i,
    canEdit,
    dateLabel: formatDate(tp),
    links: resolveRowLinks(tp)
  }));
}

/**
 * Order-mode menu view model, mirroring buildSortMenu's shape.
 * @param {string} current
 * @param {(mode: string) => string} labelOf
 */
export function buildOrderOptions(current, labelOf) {
  return ORDER_MODES.map((value) => ({ value, label: labelOf(value), selected: value === current }));
}
