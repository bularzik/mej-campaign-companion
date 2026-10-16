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

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Inverse of linkNoteHtml for the edit prompt: @UUID shorthand becomes its
 * label and entities become characters, in one pass (so "&amp;lt;" decodes to
 * "&lt;", never "<"). The caller escapes once for its textarea; saving goes
 * back through linkNoteHtml, so an unedited round trip never double-escapes.
 */
export function noteToPlainText(stored) {
  return String(stored ?? "")
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
      if (name) return NAMED[name.toLowerCase()] ?? m;
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });
}
