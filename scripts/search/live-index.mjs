// Foundry-glue singleton over search-index.mjs/field-extractors.mjs. Lazily
// builds an in-memory inverted index from every MEJ-typed journal page (plus
// this module's own session pages) and keeps it current via the standard
// JournalEntryPage/JournalEntry CRUD hooks. Nothing here is unit-testable
// (it touches `game`), so it stays out of scripts/logic/ - see
// field-extractors.mjs and search-index.mjs for the pure, vitest-covered
// pieces this wraps.
//
// Indexing key: records are keyed by the parent JournalEntry's uuid, not the
// page's own uuid. MEJ entries are single-page journals, and every other
// Hub pane (see hub-index.mjs) already works in entry uuids - resolving via
// fromUuidSync and opening via game.MonksEnhancedJournal.openJournalEntry
// both expect an entry, not a page. extractRecord() itself stays agnostic
// (it just echoes back whatever `page.uuid`/`page.name` it's given, so
// field-extractors.test.js can use synthetic fixtures freely) - this module
// is the one place that overrides the record's uuid/name to the parent
// entry's before handing it to indexRecord/removeRecord.
import { createIndex, indexRecord, removeRecord, search } from "../logic/search-index.mjs";
import { extractRecord, splitHiddenAttributes } from "../logic/field-extractors.mjs";

const MEJ_MODULE = "monks-enhanced-journal";

let index = null;
let hooksRegistered = false;

/** True for any JournalEntryPage MEJ recognizes, including this module's own "session" type. */
function mejType(page) {
  return game.MonksEnhancedJournal.getMEJType(page);
}

/**
 * Person attribute keys MEJ's per-attribute "playerHidden" sheet-settings
 * marks hidden. This mirrors the merge chain EnhancedJournalSheet's own
 * static/instance `sheetSettings()` use - registered default -> world
 * setting -> page-level override - just without an EnhancedJournalSheet
 * instance to call it on:
 *   - registered default: game.settings.settings.get("monks-enhanced-
 *     journal.sheet-settings")?.default (sheets/EnhancedJournalSheet.js:165)
 *   - world setting: game.settings.get("monks-enhanced-journal",
 *     "sheet-settings") (settings.js's "sheet-settings" registration)
 *   - page-level override: flags["monks-enhanced-journal"]["sheet-
 *     settings"].attributes (sheets/EnhancedJournalSheet.js:172, the
 *     instance sheetSettings() method)
 * `playerHidden` itself is the exact marker fieldlist() filters on
 * (sheets/EnhancedJournalSheet.js:370: `f.shown && (game.user.isGM ||
 * !f.playerHidden)`).
 */
function personAttributeHiddenKeys(page) {
  const registered = game.settings.settings.get(`${MEJ_MODULE}.sheet-settings`);
  const worldDefault = registered?.default?.person?.attributes ?? {};
  const worldSetting = (game.settings.get(MEJ_MODULE, "sheet-settings") ?? {}).person?.attributes ?? {};
  const pageOverride = page?.flags?.[MEJ_MODULE]?.["sheet-settings"]?.attributes ?? {};
  const merged = foundry.utils.mergeObject(
    foundry.utils.mergeObject(foundry.utils.duplicate(worldDefault), foundry.utils.duplicate(worldSetting)),
    foundry.utils.duplicate(pageOverride)
  );
  return Object.entries(merged)
    .filter(([, def]) => def?.playerHidden)
    .map(([key]) => key);
}

/** Build (or replace) an index-record for `page`, keyed by its parent entry's uuid/name. */
function recordFor(page, type) {
  const record = extractRecord(page, type);
  record.uuid = page.parent?.uuid ?? page.uuid;
  // Source name from the parent entry, not the page: MEJ never syncs
  // page.name on a JournalEntry rename (the Hub's Index pane - see
  // hub-index.mjs - already reads entry.name, not page.name), so indexing
  // page.name here would go stale the instant a GM renames an entry
  // without separately renaming its single page. See also the
  // updateJournalEntry hook below, which re-indexes on rename.
  record.name = page.parent?.name ?? page.name;

  // Route playerHidden person attributes out of the public field and into
  // gmFields, the same way search-index.mjs already isolates any other
  // gm-only field (indexed under a separate "gm:"-prefixed token set, only
  // visible to search({gm: true})). field-extractors.mjs can't do this
  // itself - playerHidden lives in a world SETTING, not page data, and
  // that module is deliberately Foundry-free.
  if (type === "person") {
    const hiddenKeys = personAttributeHiddenKeys(page);
    if (hiddenKeys.length) {
      const attributes = page?.flags?.[MEJ_MODULE]?.attributes ?? {};
      const { visible, hidden } = splitHiddenAttributes(attributes, hiddenKeys);
      record.fields.attributes = visible;
      record.gmFields.attributes = hidden;
    }
  }

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

/** Re-index every MEJ-typed page belonging to `entry` (used on entry rename). */
function reindexEntry(entry) {
  for (const page of entry.pages?.contents ?? []) {
    indexPage(page);
  }
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

  // A renamed JournalEntry doesn't touch its page at all, so
  // updateJournalEntryPage never fires for it - without this, an indexed
  // record's `name` (sourced from the entry, see recordFor()) would go
  // stale until the next rebuildIndex()/world reload.
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!index) return;
    if (changes?.name === undefined) return;
    reindexEntry(entry);
  });
}
