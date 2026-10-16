// The link prefix "Note about this" puts on a note. Built by code, never typed
// by the user, so the entry name (user-controlled) must not be able to break
// out of the `{label}` or inject shorthand/enrichers of its own. Pure.
const LABEL_ESCAPES = [
  ["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"],
  ["]", "&#93;"], ["}", "&#125;"], ["@", "&#64;"], ["[", "&#91;"]
];

export function noteAboutPrefix(entryUuid, entryName) {
  // A Foundry uuid is dotted alphanumerics; anything else is dropped.
  const uuid = String(entryUuid ?? "").replace(/[^A-Za-z0-9._-]/g, "");
  let label = String(entryName ?? "");
  for (const [raw, entity] of LABEL_ESCAPES) label = label.split(raw).join(entity);
  return `@UUID[${uuid}]{${label}}`;
}
