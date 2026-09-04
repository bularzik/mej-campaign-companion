/**
 * Pure import logic: docx-derived HTML -> section tree -> creation plan.
 * No Foundry globals; DOM nodes are supplied by the caller.
 *
 * Ported near-verbatim from campaign-record's scripts/logic/doc-import.mjs.
 * The only behavioral change is in suggestType()'s legacy-type normalization
 * below - campaign-record's own type list (RECORD_TYPES: npc, place, quest,
 * pc, item, encounter, checklist, shop, loot, media) doesn't match the
 * companion's COMPANION_IMPORT_TYPES (constants.mjs), which are MEJ types
 * plus "session". TYPE_KEYWORDS itself (the regex table) is untouched -
 * only its *output values* are remapped via LEGACY_TYPE_ALIASES so a
 * section titled "Character List" still gets a sensible suggestion, and a
 * round-trip marker from a campaign-record-exported docx ("Campaign Record
 * type: item") still resolves to a companion type instead of being ignored.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

/** Trim a section title and strip bold markers Word/Docs leave fused to it. */
export function cleanTitle(text) {
  return (text ?? "").replace(/\*+/g, "").replace(/\s+/g, " ").trim().replace(/:$/, "");
}

/**
 * Session-header heuristic for short plain/bold lines that aren't headings:
 * "Arc N Session M <date>", "Session Zero <date>", "IN PERSON SESSION N",
 * "Out of Arc - ...". Long prose lines never match (word-count guard), and a
 * pattern match must also carry a parseable date or be a very short line
 * (<= 5 words) so prose sentences that open with a session phrase are rejected.
 */
export function detectSessionHeader(text) {
  const t = cleanTitle(text);
  if (!t || t.split(/\s+/).length > 12) return false;
  const matchesPattern = /^(?:arc\s*\d+\s*,?\s*)?session\s+(?:zero|\d+)\b/i.test(t)
    || /^in person session\s+\d+/i.test(t)
    || /^out of arc\b/i.test(t);
  if (!matchesPattern) return false;
  return parseSectionDate(t) !== null || t.split(/\s+/).length <= 5;
}

/** Extract an ISO date from a heading line; null when absent or invalid. */
export function parseSectionDate(text) {
  const t = text ?? "";
  const numeric = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/);
  if (numeric) {
    const [, m, d, yRaw] = numeric.map(Number);
    if (String(numeric[3]).length === 3) return null;
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return toIsoDate(y, m, d);
  }
  const spelled = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (spelled) {
    return toIsoDate(Number(spelled[3]), MONTHS.indexOf(spelled[1].toLowerCase()) + 1, Number(spelled[2]));
  }
  return null;
}

function toIsoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!valid) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3 };

function isWhitespaceOnly(el) {
  return !(el.textContent ?? "").replace(/[\s ]/g, "").length;
}

/** Elements that carry content even with no text: tables, and anything holding inline media (mammoth emits each standalone picture as <p><img></p>). */
const MEDIA_SELECTOR = "img, video, audio";
function keepsMedia(el) {
  return el.tagName === "TABLE" || !!el.querySelector(MEDIA_SELECTOR);
}

/** True when all of a paragraph's text sits inside <strong>/<b>. */
function isFullyBold(el) {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  const clone = el.cloneNode(true);
  for (const b of clone.querySelectorAll("strong, b")) b.remove();
  return !(clone.textContent ?? "").trim();
}

function sectionBoundary(el) {
  const level = HEADING_LEVELS[el.tagName];
  if (level) return { level };
  if (el.tagName === "P" && (isFullyBold(el) || !el.querySelector("*"))
      && detectSessionHeader(el.textContent)) {
    return { level: 0 };
  }
  return null;
}

function measureBlocks(blocks) {
  const html = blocks.join("\n");
  const text = blocks.join(" ").replace(/<[^>]+>/g, " ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { html, wordCount, empty: blocks.length === 0 };
}

/** Merge sections[index] into sections[index-1] (blocks concatenated). */
export function mergeSections(sections, index) {
  if (index <= 0 || index >= sections.length) return sections.slice();
  const prev = sections[index - 1];
  const cur = sections[index];
  const blocks = [...prev.blocks, ...cur.blocks];
  const merged = {
    title: prev.title, level: prev.level, isSession: prev.isSession, date: prev.date,
    blocks, ...measureBlocks(blocks)
  };
  return [...sections.slice(0, index - 1), merged, ...sections.slice(index + 1)];
}

function firstBlockTitle(blocks) {
  const text = (blocks[0] ?? "").replace(/<[^>]+>/g, " ");
  return cleanTitle(text).slice(0, 80) || "Untitled";
}

// First run after a split keeps the original section's title/metadata.
function keepRun(blocks, orig) {
  return {
    title: orig.title, level: orig.level, isSession: orig.isSession, date: orig.date,
    blocks, ...measureBlocks(blocks)
  };
}

// Later runs derive title + detection from their own first block.
function newRun(blocks) {
  const title = firstBlockTitle(blocks);
  return {
    title, level: 1, isSession: detectSessionHeader(title), date: parseSectionDate(title),
    blocks, ...measureBlocks(blocks)
  };
}

/** Split sections[index] into contiguous runs at the given block cut indices. */
export function splitSectionAt(sections, index, cutIndices) {
  const section = sections[index];
  if (!section) return sections.slice();
  const n = section.blocks.length;
  const cuts = [...new Set(cutIndices)]
    .filter((i) => Number.isInteger(i) && i > 0 && i < n)
    .sort((a, b) => a - b);
  if (!cuts.length) return sections.slice();
  const bounds = [0, ...cuts, n];
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i++) runs.push(section.blocks.slice(bounds[i], bounds[i + 1]));
  const rebuilt = runs.map((run, i) => (i === 0 ? keepRun(run, section) : newRun(run)));
  return [...sections.slice(0, index), ...rebuilt, ...sections.slice(index + 1)];
}

/**
 * Split a docx-derived HTML body into sections at headings (h1-h3) and
 * session-header paragraphs. Returns the document title (leading h1, if any)
 * and sections with cleaned titles, dates, html, and word counts.
 */
export function splitSections(root) {
  const nodes = [...root.children].filter((el) => !isWhitespaceOnly(el) || keepsMedia(el));
  let title = null;
  if (nodes[0]?.tagName === "H1") title = cleanTitle(nodes.shift().textContent);

  const sections = [];
  let current = null;
  const open = (heading, level) => {
    current = { title: cleanTitle(heading), level, htmlParts: [] };
    current.isSession = detectSessionHeader(heading);
    current.date = parseSectionDate(heading);
    sections.push(current);
  };

  for (const el of nodes) {
    const boundary = sectionBoundary(el);
    if (boundary) {
      open(el.textContent, boundary.level);
      continue;
    }
    if (!current) open("Introduction", 1), current.isSession = false, current.date = null;
    current.htmlParts.push(el.outerHTML);
  }

  return {
    title,
    sections: sections.map(({ htmlParts, ...s }) => ({
      ...s,
      blocks: htmlParts,
      ...measureBlocks(htmlParts)
    }))
  };
}

export const RECORD_TYPE_MARKER_RE = /^Campaign Record type:\s*([a-z]+)$/i;

const TYPE_KEYWORDS = [
  [/loot|inventory|treasure/i, "loot"],
  [/character|party member/i, "pc"],
  [/shop|store|merchant/i, "shop"],
  [/bastion|location|place/i, "place"],
  [/npc/i, "npc"],
  [/quest/i, "quest"],
  [/encounter/i, "encounter"],
  [/check\s?list|to.?do/i, "checklist"]
];

// campaign-record type names that don't exist in COMPANION_IMPORT_TYPES,
// mapped to the closest companion equivalent. Applied to both a keyword
// match's output (npc/pc -> person, checklist -> list) and a round-trip
// exporter marker's value (also covers item/media, which no keyword here
// ever produces, but a campaign-record-exported docx's marker paragraph
// might carry).
const LEGACY_TYPE_ALIASES = {
  npc: "person",
  pc: "person",
  checklist: "list",
  item: "journalentry",
  media: "journalentry",
  // campaign-record's "text" pseudo-type (and this module's own, retired
  // 2026-08-23): a plain-prose page, whose companion equivalent is the MEJ
  // "Text and Image" (journalentry) entry — 0.7.0 already made the two
  // create identical documents, which is what makes the alias lossless.
  text: "journalentry"
};

function normalizeType(type) {
  return LEGACY_TYPE_ALIASES[type] ?? type;
}

function markerType(html) {
  const m = (html ?? "").match(/^\s*<p>([^<]*)<\/p>/);
  const marker = m && m[1].trim().match(RECORD_TYPE_MARKER_RE);
  return marker ? marker[1].toLowerCase() : null;
}

/** Suggest a wizard type for a section: exporter marker > session shape > title keywords > journalentry. */
export function suggestType(section, recordTypes) {
  const rawMarker = markerType(section.html);
  const fromMarker = rawMarker ? normalizeType(rawMarker) : null;
  if (fromMarker && recordTypes.includes(fromMarker)) return { type: fromMarker, fromMarker: true };
  // Session-shaped sections (detectSessionHeader) suggest the session type
  // itself, not just a pre-checked timepoint — before 2026-08-23 the shape
  // only skipped the keyword table and fell through to the prose fallback,
  // so every real session log imported as prose unless retyped by hand.
  if (section.isSession && recordTypes.includes("session")) return { type: "session", fromMarker: false };
  if (!section.isSession) {
    for (const [re, rawType] of TYPE_KEYWORDS) {
      const type = normalizeType(rawType);
      if (re.test(section.title) && recordTypes.includes(type)) return { type, fromMarker: false };
    }
  }
  return { type: "journalentry", fromMarker: false };
}

/** Remove a leading round-trip marker paragraph from section html. */
export function stripTypeMarker(html) {
  const type = markerType(html);
  if (!type) return html;
  return html.replace(/^\s*<p>[^<]*<\/p>\s*/, "");
}

/**
 * Turn wizard rows into a creation plan. rows[i] corresponds to sections[i].
 * type: record kind | "skip" | "merge" (legacy "text" normalizes to "journalentry").
 */
export function buildImportPlan(sections, rows, recordTypes) {
  const pages = [];
  const warnings = [];
  rows.forEach((row, i) => {
    const section = sections[i];
    const name = cleanTitle(row.title) || section.title;
    const html = stripTypeMarker(section.html);
    if (row.type === "skip") {
      if (!section.empty) warnings.push(`Skipped non-empty section "${name}"`);
      return;
    }
    if (row.type === "merge") {
      const previous = pages[pages.length - 1];
      if (!previous) {
        warnings.push(`Section "${name}" had nothing to merge into and was skipped`);
        return;
      }
      previous.html = [previous.html, html].filter(Boolean).join("\n");
      return;
    }
    // Normalize before validating: a stale form still posting the retired
    // "text" pseudo-type (mid-upgrade client) plans as journalentry.
    const type = normalizeType(row.type);
    if (!recordTypes.includes(type)) {
      throw new Error(`unknown import type "${row.type}"`);
    }
    pages.push({ name, type, html, timepoint: row.timepoint ? name : null });
  });
  return { pages, warnings };
}

/**
 * Foundry's i18n does plain {token} substitution with no plural selection, so a
 * single detected section rendered "1 sections detected as sessions". Pick the
 * string in the context instead of in the template's format call.
 */
export function sessionsDetectedHint(count) {
  return { sessionsDetected: count, sessionsDetectedOne: count === 1 };
}
