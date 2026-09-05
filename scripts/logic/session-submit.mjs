// Stale-field guard for the Session sheet's form (spec 2026-09-04,
// Deviations). MEJ's submitOnChange form resubmits EVERY field, so a submit
// raised by the session-number input carries whatever recap HTML this
// client rendered - possibly older than what another owner just saved. Only
// the editor that raised the submit, or an editor that is currently open
// (Foundry's own <prose-mirror> reports its live editor content as its form
// value while active - see SessionSheet._prepareSubmitData), may write its
// own field.
export const EDITOR_FIELDS = ["system.recap", "system.gmNotes"];

/**
 * @param {string|null|undefined} targetName the `name` of the element that raised the submit
 * @param {string[]} [activeFields] names of editor fields that are currently open/active,
 *   and so carry fresh (not stale) local state regardless of what raised this submit
 */
export function fieldsToStrip(targetName, activeFields = []) {
  return EDITOR_FIELDS.filter((field) => field !== targetName && !activeFields.includes(field));
}
