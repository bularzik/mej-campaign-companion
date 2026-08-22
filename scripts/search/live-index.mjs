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
import { runQuery } from "../logic/query-grammar.mjs";
import { extractRecord, splitHiddenAttributes, bodyText } from "../logic/field-extractors.mjs";
import { getTags, getAttributes, splitAttributeText } from "../logic/knowledge-flags.mjs";
import { createBacklinkIndex, extractRefs, setSourceRefs, removeSourceRefs, backlinksFor, visibleMentionCounts } from "../logic/backlink-index.mjs";
import { extractSecretBlocks } from "../logic/secret-blocks.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { campaignIdOf } from "../logic/campaigns.mjs";

const MEJ_MODULE = "monks-enhanced-journal";

let index = null;
let backlinks = null;
let hooksRegistered = false;

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

  // Phase B knowledge flags: tags feed the already-supported record.tags
  // field (search-index.mjs joins them into fields.tags), companion
  // attributes get their own public/GM field pair, and both land in
  // record.meta for the query grammar's structured type:/tag:/attr: filters.
  record.tags = getTags(page);
  const ccAttrs = getAttributes(page);
  const { visible, hidden } = splitAttributeText(ccAttrs);
  if (visible) record.fields.companionAttributes = visible;
  if (hidden) record.gmFields.companionAttributes = hidden;
  record.meta = { tags: record.tags, attrs: ccAttrs };

  // Phase C (spec §9): secret blocks in the prose body, for the GM-only
  // Secrets tracker and prep board. GM-gated at the accessors below —
  // meta.secrets never reaches non-GM consumers (search()/runQuery() read
  // fields/gmFields/meta.tags/meta.attrs, never meta.secrets).
  record.meta.secrets = extractSecretBlocks(bodyText(page));

  return record;
}

function indexPage(page) {
  const type = mejType(page);
  if (!type) return;
  const record = recordFor(page, type);
  indexRecord(index, record);
  setSourceRefs(backlinks, record.uuid, extractRefs(record));
}

function unindexPage(page) {
  const uuid = page.parent?.uuid ?? page.uuid;
  removeRecord(index, uuid);
  removeSourceRefs(backlinks, uuid);
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
  const blx = createBacklinkIndex();
  for (const entry of game.journal?.contents ?? []) {
    for (const page of entry.pages?.contents ?? []) {
      const type = mejType(page);
      if (!type) continue;
      const record = recordFor(page, type);
      indexRecord(idx, record);
      setSourceRefs(blx, record.uuid, extractRefs(record));
    }
  }
  return { idx, blx };
}

/** Lazily build the index on first use. */
export function ensureIndex() {
  if (!index) {
    const built = buildIndex();
    index = built.idx;
    backlinks = built.blx;
  }
  return index;
}

/** Force a full rebuild, discarding any incremental drift. */
export function rebuildIndex() {
  const built = buildIndex();
  index = built.idx;
  backlinks = built.blx;
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
    return game.user.isGM || entry.testUserPermission(game.user, "OBSERVER") === true;
  });
}

/**
 * Spec §2: scope-filtered search with a spillover count for the
 * "N more matches in other campaigns" affordance. scopeId: ""/null = no
 * filter (All), "unfiled" = entries in no campaign, else a campaign
 * Folder id. Permission filtering is searchAll's, unchanged.
 */
export function searchScoped(query, scopeId) {
  const hits = searchAll(query);
  if (!scopeId) return { hits, spillover: 0 };
  const inScope = hits.filter((hit) => {
    const entry = fromUuidSync(hit.uuid);
    const cid = campaignIdOf(entry);
    return scopeId === "unfiled" ? cid === null : cid === scopeId;
  });
  return { hits: inScope, spillover: hits.length - inScope.length };
}

/**
 * Run a grammar query (logic/query-grammar.mjs) against the live index and
 * drop hits the current user can't observe - same gate as searchAll().
 * Throws Error("empty-query") for blank queries (callers surface it).
 */
export function runQueryAll(queryString) {
  const hits = runQuery(ensureIndex(), queryString, { gm: game.user.isGM });
  return hits.filter((hit) => userCanSee(hit.uuid));
}

/** Can the current user see this entry uuid at all (spec §2's OBSERVER gate)? */
function userCanSee(uuid) {
  const entry = fromUuidSync(uuid);
  if (!entry) return false;
  return game.user.isGM || entry.testUserPermission(game.user, "OBSERVER") === true;
}

/**
 * "Mentioned in" rows for one entry, permission-filtered for the current
 * user: gmOnly mentions are GM-only, and a source entry the user can't
 * observe is dropped entirely (its existence must not leak).
 */
export function backlinksForEntry(targetUuid) {
  const idx = ensureIndex();
  return backlinksFor(backlinks, targetUuid, { gm: game.user.isGM })
    .filter(({ uuid }) => userCanSee(uuid))
    .map(({ uuid, count, gmOnly }) => {
      const rec = idx.records.get(uuid);
      return { uuid, count, gmOnly, name: rec?.name ?? fromUuidSync(uuid)?.name ?? uuid, type: rec?.type ?? "" };
    });
}

/** Per-entry visible-mention counts for the Hub index badges. */
export function mentionBadgeCounts() {
  ensureIndex();
  return visibleMentionCounts(backlinks, { gm: game.user.isGM, canSee: (uuid) => userCanSee(uuid) });
}

/** Raw source→target pairs for the graph overlay (gmOnly pairs GM-only). */
export function backlinkPairs() {
  ensureIndex();
  const pairs = [];
  for (const [source, { refs, gmRefs }] of backlinks.outbound) {
    for (const [target, count] of refs) pairs.push({ source, target, count, gmOnly: false });
    if (game.user.isGM) for (const [target, count] of gmRefs) pairs.push({ source, target, count, gmOnly: true });
  }
  return pairs;
}

/** Register the incremental-update hooks. Call once (from campaign-companion.mjs's init/ready). */
export function initSearchHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("createJournalEntryPage", (page) => {
    if (!index) return; // not built yet - buildIndex() will pick this page up
    indexPage(page);
  });

  // Foundry does NOT fire "createJournalEntryPage" for pages embedded in a
  // parent JournalEntry's own create() call (`JournalEntry.create({pages:
  // [...]})`) - only for pages added afterward via a separate
  // `entry.createEmbeddedDocuments("JournalEntryPage", [...])` call.
  // Confirmed live via Task 14's e2e suite (Hooks.on("createJournalEntryPage")
  // genuinely never fires for this creation shape). Every real creation path
  // in this module uses the single-call-with-embedded-pages shape: MEJ's own
  // "New Entry" dialog, auto-capture's Encounter creation (data/mej-entry.mjs),
  // and the docx import wizard all do - so without this, any entry created
  // after the index's first build (which happens on the Hub's very first
  // render each session, before the user necessarily visits the search tab -
  // see CampaignHubPage.mjs's _prepareBodyContext, which preps all three
  // tabs' contexts including search on every render) would silently never
  // become searchable until a rebuildIndex()/page reload.
  Hooks.on("createJournalEntry", (entry) => {
    if (!index) return;
    reindexEntry(entry);
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

  // Deleting a whole JournalEntry fires no per-page deleteJournalEntryPage
  // hooks - without this, the entry's record (and its outbound backlink
  // refs) would linger until the next rebuild. Records are keyed by the
  // entry uuid, so one removal call each suffices.
  Hooks.on("deleteJournalEntry", (entry) => {
    if (!index) return;
    removeRecord(index, entry.uuid);
    removeSourceRefs(backlinks, entry.uuid);
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

/**
 * Entries this entry's own content references (outbound @UUID refs) — the
 * prep board's "linked entries" (spec §8). Public refs for everyone
 * (filtered to entries the user can observe); gmRefs added for the GM.
 */
export function outboundRefsForEntry(sourceUuid) {
  const idx = ensureIndex();
  const source = backlinks.outbound.get(sourceUuid);
  if (!source) return [];
  const rows = [];
  const push = (target, count) => {
    if (!userCanSee(target)) return;
    const rec = idx.records.get(target);
    rows.push({ uuid: target, count, name: rec?.name ?? fromUuidSync(target)?.name ?? target, type: rec?.type ?? "" });
  };
  for (const [target, count] of source.refs) push(target, count);
  if (game.user.isGM) for (const [target, count] of source.gmRefs) push(target, count);
  return rows;
}

/** GM-only: every indexed record carrying secret blocks (Secrets tracker, spec §7). Empty for non-GM. */
export function gmSecretRecords() {
  if (!game.user.isGM) return [];
  const idx = ensureIndex();
  const rows = [];
  for (const record of idx.records.values()) {
    const secrets = record.meta?.secrets ?? [];
    if (secrets.length) rows.push({ uuid: record.uuid, name: record.name, type: record.type, secrets });
  }
  return rows;
}
