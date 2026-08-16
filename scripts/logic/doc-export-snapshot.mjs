/**
 * Pure export-side logic for docx export: which entries are eligible, how
 * they're ordered by default, and how each one maps into a doc-export.mjs
 * (ported near-verbatim from campaign-record's scripts/logic/doc-export.mjs)
 * "record" snapshot ({ name, kind, hidden, system, html }).
 *
 * No Foundry globals - real JournalEntry/JournalEntryPage documents satisfy
 * the shapes read here (uuid, name, pages.contents[0], flags, system,
 * text.content, getFlag), but every function also accepts plain fixtures,
 * so this stays loadable directly by vitest.
 *
 * Field shapes are the same ones field-extractors.mjs documents and relies
 * on (see its header comment): session body lives at page.system.recap /
 * page.system.gmNotes (never text.content); every other MEJ-typed page's
 * body lives at page.text.content (every MEJ-typed page is a native
 * `type: "text"` page - see data/mej-entry.mjs); relationships live at
 * flags["monks-enhanced-journal"].relationships, an object keyed by
 * relationship id with `{ id, uuid, hidden }` per value (API.md's "Interop
 * flags MEJ owns" section).
 */

import { sessionData } from "../sheets/session-data.mjs";
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const COMPANION_FLAGS = "mej-campaign-companion";

/**
 * The record.kind emitted for every export record MUST be a bare
 * COMPANION_IMPORT_TYPES key (or "session") so a re-import's
 * RECORD_TYPE_MARKER_RE + normalizeType() resolve it straight back to the
 * same type (see doc-import.mjs). This module never emits campaign-record's
 * own kind vocabulary (npc/pc/checklist/item/media) - those only exist as
 * normalizeType() aliases for docx files imported from campaign-record
 * itself, not for anything this module writes.
 */
export const SESSION_KIND = "session";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Main body text, matching field-extractors.mjs's bodyText() exactly. */
function bodyText(page) {
  return page?.system?.recap ?? page?.text?.content ?? "";
}

/**
 * Whether a JournalEntry is eligible for export (default-selected too): its
 * single page is either MEJ-typed (getMEJType(entry) truthy) or this
 * module's own Session native subtype. `getMEJType` is injected
 * (game.MonksEnhancedJournal.getMEJType) so this stays Foundry-free. A real
 * Session page's `type` is the prefixed SESSION_DOCUMENT_TYPE
 * (`${MODULE_ID}.session` - see constants.mjs's doc comment); the bare
 * SESSION_TYPE is also accepted defensively, for any page shaped by a path
 * outside this module's control.
 * @returns {{uuid:string, name:string, kind:string, page:object}[]}
 */
export function eligibleEntries(entries, getMEJType) {
  const rows = [];
  for (const entry of entries ?? []) {
    const page = entry?.pages?.contents?.[0];
    if (!page) continue;
    const mejType = getMEJType(entry);
    const isSessionPage = page.type === SESSION_TYPE || page.type === SESSION_DOCUMENT_TYPE;
    const kind = mejType || (isSessionPage ? SESSION_KIND : null);
    if (!kind) continue;
    rows.push({ uuid: entry.uuid, name: entry.name, kind, page });
  }
  return rows;
}

/**
 * Default selection order: entries linked from timepoints, in timeline
 * order (the order `timepoints` is given in) and within a timepoint in
 * link order, deduped to each entry's first appearance; then every
 * remaining eligible entry, alphabetically by name. Non-mutating.
 * @param {{uuid:string, name:string}[]} entries
 * @param {{links?: {uuid?:string}[]}[]} timepoints  already in timeline order
 */
export function orderEligibleEntries(entries, timepoints) {
  const byUuid = new Map((entries ?? []).map((e) => [e.uuid, e]));
  const seen = new Set();
  const ordered = [];
  for (const tp of timepoints ?? []) {
    for (const link of tp.links ?? []) {
      if (!link.uuid || seen.has(link.uuid)) continue;
      const entry = byUuid.get(link.uuid);
      if (!entry) continue;
      seen.add(link.uuid);
      ordered.push(entry);
    }
  }
  const remaining = (entries ?? [])
    .filter((e) => !seen.has(e.uuid))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ordered, ...remaining];
}

/**
 * HTML for a resolved (name-decorated) relationships list, hidden entries
 * dropped unless includeGM. Empty string when nothing renders.
 * @param {{name:string, hidden?:boolean}[]} resolved  relationship targets
 *   already resolved to a display name by the caller (Foundry-side: reads
 *   flags["monks-enhanced-journal"].relationships and resolves each uuid)
 * @param {boolean} includeGM
 * @param {string} heading  localized "Relationships" label
 */
export function relationshipsHtml(resolved, includeGM, heading) {
  const visible = (resolved ?? []).filter((r) => r?.name && (includeGM || r.hidden !== true));
  if (!visible.length) return "";
  const items = visible.map((r) => `<li>${escapeHtml(r.name)}</li>`).join("");
  return `<p><strong>${escapeHtml(heading)}</strong></p><ul>${items}</ul>`;
}

/**
 * Body HTML for a "session" record: optional Session Number / Campaign Date
 * lines, then the recap. GM notes are NOT embedded here - they're passed
 * back separately as record.system.gmNotes, which doc-export.mjs's own
 * ported, unmodified snapshotToDocModel() already gates on opts.includeGM
 * (see its "if (opts.includeGM && record.system?.gmNotes)" branch), so this
 * module doesn't need to duplicate that gate.
 * @param {object} page  a JournalEntryPage-like object with .getFlag() and .system
 * @param {{sessionNumberLabel:string, campaignDateLabel:string, formatCampaignDate?: (cd:object) => string}} opts
 */
export function sessionBodyHtml(page, { sessionNumberLabel, campaignDateLabel, formatCampaignDate }) {
  const session = sessionData(page);
  const lines = [];
  if (session.sessionNumber != null) {
    lines.push(`<p><strong>${escapeHtml(sessionNumberLabel)}:</strong> ${escapeHtml(session.sessionNumber)}</p>`);
  }
  if (session.campaignDate && formatCampaignDate) {
    const label = formatCampaignDate(session.campaignDate);
    if (label) lines.push(`<p><strong>${escapeHtml(campaignDateLabel)}:</strong> ${escapeHtml(label)}</p>`);
  }
  return lines.join("") + (page.system?.recap ?? "");
}

/**
 * Build one doc-export.mjs record snapshot ({ name, kind, hidden, system,
 * html }) for a single eligible entry row (see eligibleEntries()).
 *
 * `system` is always a plain object, never null: doc-export.mjs's
 * FIELD_RENDERERS table is keyed by campaign-record's own kind vocabulary
 * (npc/place/quest/pc/item/encounter/checklist/shop/loot/media), and four of
 * this module's real kinds happen to share a literal key with it (place,
 * shop, loot, quest, encounter - see doc-export-snapshot.test.js's
 * "FIELD_RENDERERS collision" tests) - those renderers null-dereference
 * their `system` argument (e.g. quest's `s.objectives`) when given `null`,
 * so passing `{}` (which every renderer treats as "no structured fields")
 * is required to avoid a crash on export. MEJ's own field names never
 * collide with campaign-record's within those four renderers (verified
 * against sheets/*.js - see task report), so `{}` always renders as empty,
 * never garbled undefined text.
 *
 * @param {{uuid:string, name:string, kind:string, page:object}} row
 * @param {{
 *   includeGM: boolean,
 *   relationships?: {name:string, hidden?:boolean}[],
 *   labels: {relationships:string, sessionNumber:string, campaignDate:string},
 *   formatCampaignDate?: (cd:object) => string
 * }} opts
 */
export function recordSnapshot(row, opts) {
  const { includeGM, relationships, labels, formatCampaignDate } = opts;
  if (row.kind === SESSION_KIND) {
    const session = sessionData(row.page);
    return {
      name: row.name,
      kind: SESSION_KIND,
      hidden: false,
      system: { gmNotes: row.page.system?.gmNotes ?? "" },
      html: sessionBodyHtml(row.page, {
        sessionNumberLabel: labels.sessionNumber,
        campaignDateLabel: labels.campaignDate,
        formatCampaignDate
      })
    };
  }
  const html = bodyText(row.page) + relationshipsHtml(relationships, includeGM, labels.relationships);
  return { name: row.name, kind: row.kind, hidden: false, system: {}, html };
}

/**
 * Resolved relationship rows (see relationshipsHtml) for one page, from the
 * raw MEJ relationships flag. `resolveName(uuid)` is injected (Foundry-side:
 * fromUuidSync) so this stays pure; entries whose target can't be resolved
 * are dropped.
 * @param {object} page
 * @param {(uuid:string) => string|null} resolveName
 */
export function pageRelationships(page, resolveName) {
  const raw = page?.flags?.[MEJ_FLAGS]?.relationships ?? {};
  return Object.values(raw)
    .map((r) => ({ name: r?.uuid ? resolveName(r.uuid) : null, hidden: r?.hidden === true }))
    .filter((r) => r.name);
}

/**
 * Whether one timeline link belongs in a player-safe (includeGM: false)
 * export. Document links (`.uuid`) are gated by the injected `isVisible`
 * predicate (Foundry-side: default ownership >= LIMITED, mirroring
 * campaign-record's own isPlayerVisibleDoc); raw-image links (`.src`) are
 * gated by their own stored `showPlayers` flag (timepoints.mjs's
 * toggleLinkShowPlayers). A link with neither (shouldn't occur with real
 * MEJ data - see timepoints.mjs's addLink) passes through unfiltered.
 */
function linkVisible(link, includeGM, isVisible) {
  if (includeGM) return true;
  if (link.src) return link.showPlayers === true;
  if (link.uuid) return isVisible ? isVisible(link.uuid) === true : false;
  return true;
}

/**
 * Top-level snapshot for snapshotToDocModel(): { name, timeline, records }.
 * `timeline` items are raw stored link names (timepoints.mjs's addLink
 * stores `.name` on every link at write time). When `includeGM` is false,
 * a link is dropped unless linkVisible() (above) says it belongs in a
 * player-safe export - restoring the same player-visibility filtering
 * campaign-record's own export-dialog applies to its timeline summary.
 * @param {string} name  export document title
 * @param {{label:string, links?:{name:string, uuid?:string, src?:string, showPlayers?:boolean}[]}[]} timepoints
 * @param {{uuid:string, name:string, kind:string, page:object}[]} selectedRows  in export order
 * @param {(row:object) => object} buildRecord  per-row recordSnapshot(row, opts) closure
 * @param {{includeGM?: boolean, isVisible?: (uuid:string) => boolean}} [opts]
 *   isVisible is Foundry-side (fromUuidSync + default ownership check); only
 *   consulted for document links, and only when includeGM is false.
 */
export function buildGroupSnapshot(name, timepoints, selectedRows, buildRecord, { includeGM = false, isVisible } = {}) {
  return {
    name,
    timeline: (timepoints ?? []).map((tp) => ({
      label: tp.label,
      items: (tp.links ?? [])
        .filter((l) => linkVisible(l, includeGM, isVisible))
        .map((l) => l.name)
        .filter(Boolean)
    })),
    records: (selectedRows ?? []).map(buildRecord)
  };
}
