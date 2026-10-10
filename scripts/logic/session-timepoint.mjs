// Pure rules for the session -> timepoint link (spec 2026-10-09
// session-timepoint-encounter-start §2). Foundry-side wiring lives in
// hooks/session-timepoint.mjs.
import { SESSION_DOCUMENT_TYPE } from "../constants.mjs";

const DATE_KEYS = ["year", "month", "day", "hour", "minute"];

function sameDate(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return DATE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * Whether a newly created page should get an auto timepoint: a Session page
 * not yet linked to one and not created by a path (the docx import) that
 * manages its own timepoints.
 * @param {{type?: string, flags?: object}|null} source page `_source`/data
 * @param {string} moduleId
 */
export function wantsSessionTimepoint(source, moduleId) {
  if (!source || source.type !== SESSION_DOCUMENT_TYPE) return false;
  const session = source.flags?.[moduleId]?.session ?? {};
  if (session.timepointId) return false;
  return session.autoTimepoint !== false;
}

/**
 * The timepoint to create for a session. A session with no campaign date is
 * stamped with the current world date, and that date is written back to the
 * session (`stampSession`) so the two always match.
 * @returns {{label: string, campaignDate: object|null, stampSession: boolean}}
 */
export function sessionTimepointDraft({ name, campaignDate }, worldDate) {
  const own = campaignDate ?? null;
  return {
    label: name,
    campaignDate: own ?? worldDate ?? null,
    stampSession: own === null && worldDate != null
  };
}

/**
 * Edit to apply to a session's timepoint after the session changed, or null
 * when they already agree. A session whose date was cleared leaves the
 * timepoint's date alone.
 */
export function timepointSyncPatch({ name, campaignDate }, timepoint) {
  const patch = {};
  if (name !== timepoint.label) patch.label = name;
  if (campaignDate && !sameDate(campaignDate, timepoint.campaignDate ?? null)) patch.campaignDate = campaignDate;
  return Object.keys(patch).length ? patch : null;
}
