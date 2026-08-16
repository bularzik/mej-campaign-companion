/**
 * View model for the Index doctype filter. Every entry in `types` becomes a
 * checkbox item; a compact summary describes the active selection for the
 * collapsed trigger. Pure — the caller injects the type list plus label/icon
 * resolvers so this stays testable without Foundry's i18n. Ported from
 * campaign-record's scripts/logic/doctype-filter.mjs: that version pulled a
 * fixed RECORD_TYPES list + recordIcon() from its own constants.mjs; MEJ's
 * type set is assembled at runtime from getDocumentTypes()/getIcon(), so
 * both are passed in instead of imported.
 *
 * @param {string[]} types  all known short types, in display order
 * @param {Set<string>} selected  active short types
 * @param {(type: string) => string} labelOf  localized label for a short type
 * @param {(type: string) => string} iconOf  FontAwesome icon class for a short type
 * @param {string} allLabel  localized "all types" summary (no/every selection)
 * @returns {{items: object[], summary: string}}
 */
export function buildDoctypeFilter(types, selected, labelOf, iconOf, allLabel) {
  const items = types.map((t) => ({
    type: t,
    label: labelOf(t),
    icon: iconOf(t),
    checked: selected.has(t)
  }));
  const checked = items.filter((i) => i.checked);
  let summary;
  if (checked.length === 0 || checked.length === items.length) {
    summary = allLabel;
  } else if (checked.length === 1) {
    summary = checked[0].label;
  } else {
    summary = `${checked[0].label} +${checked.length - 1}`;
  }
  return { items, summary };
}
