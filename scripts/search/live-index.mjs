// Foundry-glue singleton over search-index.mjs/field-extractors.mjs. Lazily
// builds an in-memory inverted index from every MEJ-typed journal page (plus
// this module's own session pages) and keeps it current via the standard
// JournalEntryPage CRUD hooks. Nothing here is unit-testable (it touches
// `game`), so it stays out of scripts/logic/ - see field-extractors.mjs and
// search-index.mjs for the pure, vitest-covered pieces this wraps.
//
// Indexing key: records are keyed by the parent JournalEntry's uuid, not the
// page's own uuid. MEJ entries are single-page journals, and every other
// Hub pane (see hub-index.mjs) already works in entry uuids - resolving via
// fromUuidSync and opening via game.MonksEnhancedJournal.openJournalEntry
// both expect an entry, not a page. extractRecord() itself stays agnostic
// (it just echoes back whatever `page.uuid` it's given, so
// field-extractors.test.js can use synthetic uuids freely) - this module is
// the one place that overrides the record's uuid to page.parent.uuid before
// handing it to indexRecord/removeRecord.
import { createIndex, indexRecord, removeRecord, search } from "../logic/search-index.mjs";
import { extractRecord } from "../logic/field-extractors.mjs";

let index = null;
let hooksRegistered = false;

/** True for any JournalEntryPage MEJ recognizes, including this module's own "session" type. */
function mejType(page) {
  return game.MonksEnhancedJournal.getMEJType(page);
}

/** Build (or replace) an index-record for `page`, keyed by its parent entry's uuid. */
function recordFor(page, type) {
  const record = extractRecord(page, type);
  record.uuid = page.parent?.uuid ?? page.uuid;
  return record;
}

function indexPage(page) {
  const type = mejType(page);
  if (!type) return;
  indexRecord(index, recordFor(page, type));
}

function unindexPage(page) {
  const uuid = page.parent?.uuid ?? page.uuid;
  removeRecord(index, uuid);
}

/** Build the index from every journal entry's pages, GM and player alike -
 * player-hidden fields are handled at search time (search()'s `gm` option
 * and this module's own permission filter), not by excluding pages here. */
function buildIndex() {
  const idx = createIndex();
  for (const entry of game.journal?.contents ?? []) {
    for (const page of entry.pages?.contents ?? []) {
      const type = mejType(page);
      if (!type) continue;
      indexRecord(idx, recordFor(page, type));
    }
  }
  return idx;
}

/** Lazily build the index on first use. */
export function ensureIndex() {
  if (!index) index = buildIndex();
  return index;
}

/** Force a full rebuild, discarding any incremental drift. */
export function rebuildIndex() {
  index = buildIndex();
  return index;
}

/**
 * Search the live index and drop any hit the calling user can't see
 * (LIMITED permission on the resolved entry; unresolvable uuids are
 * dropped too - a stale/renamed-world edge case, not a real result).
 * @param {string} query
 * @returns {{uuid:string, name:string, type:string, matches:{field:string,snippet:string}[]}[]}
 */
export function searchAll(query) {
  const hits = search(ensureIndex(), query, { gm: game.user.isGM });
  return hits.filter((hit) => {
    const entry = fromUuidSync(hit.uuid);
    if (!entry) return false;
    return game.user.isGM || entry.testUserPermission(game.user, "LIMITED") === true;
  });
}

/** Register the incremental-update hooks. Call once (from campaign-companion.mjs's init/ready). */
export function initSearchHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("createJournalEntryPage", (page) => {
    if (!index) return; // not built yet - buildIndex() will pick this page up
    indexPage(page);
  });

  Hooks.on("updateJournalEntryPage", (page) => {
    if (!index) return;
    // Re-extract unconditionally: cheap, and correct even if the page's MEJ
    // type itself changed underneath us (removeRecord is a no-op if the
    // uuid was never indexed, e.g. a non-MEJ page just gaining MEJ flags).
    unindexPage(page);
    indexPage(page);
  });

  Hooks.on("deleteJournalEntryPage", (page) => {
    if (!index) return;
    unindexPage(page);
  });
}
