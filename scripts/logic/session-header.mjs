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
 * worth ~250px of a 900px window, hence showHeader.
 */
export function sessionHeaderContext({ src = null, fields = null } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  return { fields: list, showHeader: !!src || list.some((f) => f?.value) };
}
