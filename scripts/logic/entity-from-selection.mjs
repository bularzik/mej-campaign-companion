// Pure rules for "Create Entity from Selection" (spec 2026-09-22). No
// Foundry globals: the selection gate, the source-HTML linker, and the
// relay request validator (added in Task 3) are unit-tested directly.
import { tokenizeHtml } from "./auto-link.mjs";

export const ENTITY_TYPES = [
  "journalentry", "person", "place", "organization", "quest",
  "encounter", "event", "poi", "shop", "loot", "list"
];
export const MAX_SELECTION_LENGTH = 80;
export const MAX_NAME_LENGTH = 120;

// Line breaks mean the selection crossed a block; brackets, braces and @
// would break the @UUID[...]{label} enricher the selection becomes.
const FORBIDDEN = /[\r\n\[\]{}@]/;

/** Trimmed selection when it may become an entity name + link label, else null. */
export function qualifySelection(text) {
  if (typeof text !== "string") return null;
  if (FORBIDDEN.test(text)) return null;
  const t = text.trim();
  if (!t.length || t.length > MAX_SELECTION_LENGTH) return null;
  return t;
}

/** Non-overlapping, case-sensitive occurrence count. */
export function countOccurrences(haystack, needle) {
  if (!needle || typeof haystack !== "string") return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00A0" };
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/iy;

/** Decode a raw text segment; map[i] is the raw index of decoded char i (map[len] = raw.length). */
function decodeWithMap(raw) {
  let decoded = "";
  const map = [];
  let i = 0;
  while (i < raw.length) {
    ENTITY_RE.lastIndex = i;
    const m = raw[i] === "&" ? ENTITY_RE.exec(raw) : null;
    let ch = null;
    if (m) {
      const body = m[1];
      if (body[0] === "#") {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (Number.isFinite(code)) ch = String.fromCodePoint(code);
      } else if (NAMED[body.toLowerCase()] !== undefined) {
        ch = NAMED[body.toLowerCase()];
      }
    }
    if (ch !== null) {
      for (let k = 0; k < ch.length; k++) { map.push(i); decoded += ch[k]; }
      i += m[0].length;
    } else {
      map.push(i);
      decoded += raw[i];
      i++;
    }
  }
  map.push(raw.length);
  return { decoded, map };
}

// Enricher syntax that renders as something other than its source text:
// inline rolls and any @Type[...]{...} (tokenizeHtml only makes @UUID opaque).
const ENRICHER_RE = /\[\[[\s\S]*?\]\]|@[A-Za-z]+\[[^\]]*\](?:\{[^}]*\})?/g;

function maskedRanges(decoded) {
  const ranges = [];
  ENRICHER_RE.lastIndex = 0;
  let m;
  while ((m = ENRICHER_RE.exec(decoded))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/**
 * Wrap the `occurrence`-th eligible match of `text` in the stored HTML as
 * @UUID[uuid]{<raw source substring>}. Eligible = inside a tokenizeHtml
 * "text" segment and outside enricher syntax. Returns null when the source's
 * eligible count differs from the rendered `total` the capture saw, or the
 * occurrence does not exist - the caller then reports "could not link".
 */
export function linkSelectionInSource(sourceHtml, { text, occurrence, total, uuid }) {
  if (typeof sourceHtml !== "string" || !sourceHtml || !text) return null;
  const segs = tokenizeHtml(sourceHtml);
  const hits = [];
  segs.forEach((seg, segIndex) => {
    if (seg.type !== "text") return;
    const { decoded, map } = decodeWithMap(seg.raw);
    const masked = maskedRanges(decoded);
    for (let i = decoded.indexOf(text); i !== -1; i = decoded.indexOf(text, i + text.length)) {
      const end = i + text.length;
      if (masked.some(([a, b]) => i < b && end > a)) continue;
      hits.push({ segIndex, rawStart: map[i], rawEnd: map[end] });
    }
  });
  if (hits.length !== total) return null;
  const hit = hits[occurrence];
  if (!hit) return null;
  return segs.map((seg, i) => {
    if (i !== hit.segIndex) return seg.raw;
    const label = seg.raw.slice(hit.rawStart, hit.rawEnd);
    return `${seg.raw.slice(0, hit.rawStart)}@UUID[${uuid}]{${label}}${seg.raw.slice(hit.rawEnd)}`;
  }).join("");
}

const isIndex = (n) => Number.isInteger(n) && n >= 0;

/**
 * GM-side check of a contributor's relayed request (spec §4.5). Never
 * trusts the payload: `ctx` is computed by the GM from the socket-supplied
 * sender and the live page.
 */
export function validateSelectionRequest(request, ctx) {
  const r = request ?? {};
  if (typeof r.requestId !== "string" || !r.requestId || typeof r.pageUuid !== "string" ||
      typeof r.fieldKey !== "string" || !isIndex(r.occurrence) || !isIndex(r.total) ||
      r.occurrence >= r.total || typeof r.linkOthers !== "boolean") {
    return { ok: false, reason: "bad-payload" };
  }
  if (!ctx?.sender || ctx.sender.isGM) return { ok: false, reason: "bad-sender" };
  if (!ctx.isContributor) return { ok: false, reason: "not-contributor" };
  if (!ctx.canObserve) return { ok: false, reason: "not-visible" };
  if (!ctx.regionKeys?.includes(r.fieldKey)) return { ok: false, reason: "bad-field" };
  if (qualifySelection(r.text) !== r.text) return { ok: false, reason: "bad-selection" };
  if (!ENTITY_TYPES.includes(r.type)) return { ok: false, reason: "bad-type" };
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, reason: "bad-name" };
  return { ok: true };
}
