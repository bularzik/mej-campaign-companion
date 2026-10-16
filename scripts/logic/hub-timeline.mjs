// Pure view-model logic for the Campaign Hub's Timeline pane. Kept out of
// CampaignHubPage.mjs for the same reason as hub-index.mjs (see there).
import { orderTimepoints } from "./timeline-sort.mjs";
import { campaignSortKey } from "./campaign-date.mjs";

export const ORDER_MODES = ["manual", "created", "campaign"];

/**
 * Ordered, display-ready timepoint rows: position (for reorder/insert),
 * canEdit, a date label, and resolved links. Date formatting and link
 * resolution are permission/calendar-dependent, so both are injected.
 *
 * @param {object[]} timepoints  raw timepoints (Task 6's getTimepoints() output)
 * @param {"manual"|"created"|"campaign"} order
 * In "campaign" order, dated `notes` are interleaved as `kind: "note"` rows (read-only); other orders ignore them.
 * @param {{canEdit: boolean, formatDate: (tp: object) => string, resolveRowLinks: (tp: object) => object[], notes?: object[], formatNoteDate?: (d: object) => string}} opts
 */
export function buildTimelineRows(timepoints, order, { canEdit, formatDate, resolveRowLinks, notes = [], formatNoteDate = () => "" }) {
  const ordered = orderTimepoints(timepoints ?? [], order);
  const rows = ordered.map((tp, i) => ({
    ...tp,
    position: i,
    canEdit,
    dateLabel: formatDate(tp),
    links: resolveRowLinks(tp)
  }));
  if (order !== "campaign" || !notes?.length) return rows;
  // Partial dates (missing month/day) make campaignSortKey NaN; treat as undated.
  const sortable = (k) => k != null && Number.isFinite(k);
  const noteRows = notes
    .map((n) => ({ n, key: campaignSortKey(n.worldDate) }))
    .filter(({ key }) => sortable(key))
    .sort((a, b) => a.key - b.key)
    .map(({ n, key }) => ({
      row: { kind: "note", id: n.id, label: n.text, dateLabel: formatNoteDate(n.worldDate), authorName: n.authorName || "", position: -1, canEdit: false, links: [] },
      key
    }));
  const merged = [];
  let ni = 0;
  for (const row of rows) {
    const key = campaignSortKey(row.campaignDate);
    // Undated timepoints float to the top (orderTimepoints), so notes never precede them.
    while (ni < noteRows.length && sortable(key) && noteRows[ni].key < key) merged.push(noteRows[ni++].row);
    merged.push(row);
  }
  while (ni < noteRows.length) merged.push(noteRows[ni++].row);
  return merged;
}

/**
 * Order-mode menu view model, mirroring buildSortMenu's shape.
 * @param {string} current
 * @param {(mode: string) => string} labelOf
 */
export function buildOrderOptions(current, labelOf) {
  return ORDER_MODES.map((value) => ({ value, label: labelOf(value), selected: value === current }));
}
