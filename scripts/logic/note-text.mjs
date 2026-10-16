// Pure: turn a note's raw text into stored note HTML (escaped text plus the
// @UUID shorthand that autoLinkAdded adds, and nothing else). Foundry-free.
//
// Every character that could start markup or an enricher in the user's text
// (& < > " @ [[) is swapped for a private-use sentinel BEFORE linking, so
// (1) a typed @UUID[..]{..}, [[/roll]] or @Embed can never survive as live
// shorthand or bypass audience containment, (2) auto-link cannot match a
// word inside an entity such as "&amp;", and (3) names containing an
// apostrophe still link (the apostrophe is harmless in a text node and stays
// raw). The sentinels become HTML entities after linking.
import { autoLinkAdded } from "./auto-link.mjs";

const SENTINELS = [
  ["&", "", "&amp;"],
  ["<", "", "&lt;"],
  [">", "", "&gt;"],
  ['"', "", "&quot;"],
  ["@", "", "&#64;"],
  ["[[", "", "&#91;&#91;"]
];
const STRAY = /[-]/g;

export function linkNoteHtml(text, candidates) {
  let masked = String(text ?? "").replace(STRAY, "");
  for (const [raw, sentinel] of SENTINELS) masked = masked.split(raw).join(sentinel);
  const linked = autoLinkAdded("", masked, candidates ?? []);
  let out = linked;
  for (const [, sentinel, entity] of SENTINELS) out = out.split(sentinel).join(entity);
  return out;
}
