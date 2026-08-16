/**
 * Pure, dependency-free field extraction for the search index. Every
 * extractor receives a page-LIKE object (a real Foundry JournalEntryPage in
 * production - see scripts/search/live-index.mjs - or a plain fixture in
 * tests) and returns `{ fields, gmFields }` for search-index.mjs's
 * `indexRecord`. No Foundry globals, no `foundry.utils`, nothing that
 * doesn't resolve outside a browser - this file must stay loadable by
 * vitest directly.
 *
 * Field shapes below were verified against the MEJ worktree
 * (monks-enhanced-journal, feat-extension-api) rather than guessed - see
 * test/field-extractors.test.js's fixture comments and task-8-report.md for
 * the exact evidence per type:
 *   - person: flags["monks-enhanced-journal"].attributes (flat key->string
 *     map) + .role. No per-attribute GM/hidden marker lives in page data -
 *     MEJ's `playerHidden` attribute visibility is a world SETTING
 *     (EnhancedJournalSheet#fieldlist reads game.settings, not page.flags),
 *     outside this pure extractor's page-only contract - so person has no
 *     gmFields split. Documented as a known gap in task-8-report.md.
 *   - quest: flags["monks-enhanced-journal"].objectives (dict of
 *     {content, available}) + .status. `available` is the only GM/hidden
 *     marker MEJ stores (QuestSheet#_prepareBodyContext filters
 *     `this.document.isOwner || o.available`) - unavailable objective text
 *     goes to gmFields, matching that visibility rule exactly.
 *   - shop/loot: flags["monks-enhanced-journal"].items (dict of full Item
 *     data keyed by id; `.name` per item). No per-item hidden marker in
 *     either sheet - whole-page ownership is the only gate - so no
 *     gmFields split.
 *   - session (this module's own type): page.system.recap /
 *     page.system.gmNotes (not text.content - session pages don't use it)
 *     + flags["mej-campaign-companion"].session.secrets. gmNotes is
 *     unconditionally GM-only (SessionSheet.mjs never sends it to non-GM
 *     contexts at all). Secrets are split by `revealed`, mirroring
 *     SessionSheet.mjs's own data-minimization: unrevealed secret text
 *     must never reach a public/player-visible search field, so
 *     fields.secrets holds only revealed text and gmFields.secrets holds
 *     everything (so a GM's own search still finds unrevealed secrets).
 *   - all other types (place/encounter/event/organization/poi/list/
 *     journalentry/picture/slideshow): body text only, no gmFields.
 */

const MEJ_FLAGS = "monks-enhanced-journal";
const COMPANION_FLAGS = "mej-campaign-companion";

/** Main body text: session pages carry it under system.recap; every other
 * MEJ page type carries it under text.content. */
function bodyText(page) {
  return page?.system?.recap ?? page?.text?.content ?? "";
}

function mejFlags(page) {
  return page?.flags?.[MEJ_FLAGS] ?? {};
}

function joinValues(obj) {
  return Object.values(obj ?? {})
    .filter((v) => typeof v === "string" && v.length)
    .join(" ");
}

function personExtractor(page) {
  const flags = mejFlags(page);
  return {
    fields: {
      text: bodyText(page),
      role: flags.role ?? "",
      attributes: joinValues(flags.attributes)
    },
    gmFields: {}
  };
}

function questExtractor(page) {
  const flags = mejFlags(page);
  const objectives = Object.values(flags.objectives ?? {});
  const available = objectives.filter((o) => o?.available);
  const hidden = objectives.filter((o) => !o?.available);
  const gmFields = {};
  if (hidden.length) gmFields.objectives = hidden.map((o) => o?.content ?? "").join(" ");
  return {
    fields: {
      text: bodyText(page),
      status: flags.status ?? "",
      objectives: available.map((o) => o?.content ?? "").join(" ")
    },
    gmFields
  };
}

function itemsExtractor(page) {
  const flags = mejFlags(page);
  const items = Object.values(flags.items ?? {});
  return {
    fields: {
      text: bodyText(page),
      items: items.map((i) => i?.name ?? "").join(" ")
    },
    gmFields: {}
  };
}

function sessionExtractor(page) {
  const session = page?.flags?.[COMPANION_FLAGS]?.session ?? {};
  const secrets = session.secrets ?? [];
  const revealed = secrets.filter((s) => s?.revealed);
  const gmFields = { gmNotes: page?.system?.gmNotes ?? "" };
  if (secrets.length) gmFields.secrets = secrets.map((s) => s?.text ?? "").join(" ");
  return {
    fields: {
      text: bodyText(page),
      secrets: revealed.map((s) => s?.text ?? "").join(" ")
    },
    gmFields
  };
}

function genericExtractor(page) {
  return {
    fields: { text: bodyText(page) },
    gmFields: {}
  };
}

export const EXTRACTORS = {
  person: personExtractor,
  place: genericExtractor,
  quest: questExtractor,
  shop: itemsExtractor,
  loot: itemsExtractor,
  encounter: genericExtractor,
  event: genericExtractor,
  organization: genericExtractor,
  poi: genericExtractor,
  list: genericExtractor,
  journalentry: genericExtractor,
  picture: genericExtractor,
  slideshow: genericExtractor,
  session: sessionExtractor
};

/** Phase B extensibility: register (or override) an extractor for a type. */
export function registerExtractor(type, fn) {
  EXTRACTORS[type] = fn;
}

/**
 * @param {object} page  page-like object (real JournalEntryPage in
 *   production, plain fixture in tests) - see module doc above for the
 *   fields each extractor reads.
 * @param {string} type  MEJ type (game.MonksEnhancedJournal.getMEJType(page))
 * @returns {{uuid:string, name:string, type:string, tags: string[], fields: object, gmFields: object}}
 *   an index-record object ready for search-index.mjs's indexRecord(). Its
 *   uuid is whatever `page.uuid` the caller supplied - live-index.mjs
 *   overrides this to the parent JournalEntry's uuid before indexing (see
 *   its own doc comment for why).
 */
export function extractRecord(page, type) {
  const extractor = EXTRACTORS[type] ?? genericExtractor;
  const { fields, gmFields } = extractor(page) ?? { fields: {}, gmFields: {} };
  return {
    uuid: page?.uuid,
    name: page?.name ?? "",
    type,
    tags: [],
    fields,
    gmFields
  };
}
