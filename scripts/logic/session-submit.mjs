// Stale-field guard for the Session sheet's form (spec 2026-09-04,
// Deviations). MEJ's submitOnChange form resubmits EVERY field, so a submit
// raised by the session-number input carries whatever recap HTML this
// client rendered - possibly older than what another owner just saved.
// Only the editor that raised the submit may write its own field.
export const EDITOR_FIELDS = ["system.recap", "system.gmNotes"];

/** @param {string|null|undefined} targetName the `name` of the element that raised the submit */
export function fieldsToStrip(targetName) {
  return EDITOR_FIELDS.filter((field) => field !== targetName);
}
