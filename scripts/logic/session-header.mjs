/**
 * Context for MEJ's shared detailed-header partial on a Session sheet. Pure
 * (vitest-loadable); SessionSheet supplies the values.
 *
 * DocumentSheetV2._prepareContext puts `document.schema.fields` - an object of
 * DataField instances - on context.fields. MEJ's partial iterates it expecting
 * fieldlist()'s {id, name, value, ...} shape, so a sheet that does not shadow
 * the key renders "Page Name / Type / File Path / Page Category / Sort Order"
 * over empty divs. Every MEJ sheet shadows it (PlaceSheet.js:168,
 * PersonSheet.js:125, ...); the companion's SessionSheet did not.
 *
 * A Session's real header data (number, campaign date, attendees) lives on the
 * Session tab, so the list is empty - and an empty header with no image is not
 * worth ~250px of a 900px window.
 *
 * But that partial is also the sheet's ONLY rename input and its only
 * "add image" control (`data-action="addImage"`), so suppressing it outright
 * would strand an image-less Session with no way to ever gain an image from its
 * own sheet. Hence three modes rather than a boolean (spec amendment, review of
 * Task 3):
 *
 *   "full"    - the page has an image (or a populated field): MEJ's header.
 *   "compact" - nothing to show, but this viewer can edit: a one-line companion
 *               row carrying the `name` input and an add-image control.
 *   "none"    - nothing to show and nothing to edit: no header at all.
 */
export function headerMode({ src = null, fields = null, editable = false } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  if (src || list.some((f) => f?.value)) return "full";
  return editable ? "compact" : "none";
}

/**
 * @returns {{fields: Array, headerMode: string, showHeader: boolean, showCompactHeader: boolean}}
 *   `fields` is the fieldlist()-shaped list the partial may iterate (empty for
 *   Sessions - see above); the two booleans are the template's switches.
 */
export function sessionHeaderContext({ src = null, fields = null, editable = false } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  const mode = headerMode({ src, fields: list, editable });
  return {
    fields: list,
    headerMode: mode,
    showHeader: mode === "full",
    showCompactHeader: mode === "compact"
  };
}
