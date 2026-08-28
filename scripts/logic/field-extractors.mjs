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
 *
 * Phase C final-review fix (finding C1): raw body text (bodyText() below)
 * can itself contain native Foundry `<section class="secret">` blocks -
 * unrelated to session's own flag-based checklist secrets above, these are
 * inline prose secrets any MEJ page type can carry. Indexing the raw text
 * under the PUBLIC `fields.text` made unrevealed secret prose (and any
 * @UUID refs inside it) searchable and backlink-visible to players. Every
 * extractor now indexes `stripSecretSections(bodyText(page))` publicly and
 * only adds `gmFields.text` (the unstripped body) when stripping actually
 * changed something - see textFields() below.
 */

import { stripSecretSections } from "./secret-blocks.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const COMPANION_FLAGS = "mej-campaign-companion";

/**
 * Which field holds a page's body, and what is in it. Session pages keep their
 * body in system.recap; everything else uses text.content. Callers that need
 * to WRITE the body (hooks/secrets-ui.mjs, apps/CampaignHubPage.mjs) need the
 * key as well as the content, and a second copy of this fallback would be free
 * to drift from this one - so bodyText is defined in terms of it below rather
 * than beside it.
 */
export function bodyRegion(page) {
  const recap = page?.system?.recap;
  if (recap !== undefined && recap !== null) return { key: "system.recap", content: String(recap) };
  return { key: "text.content", content: String(page?.text?.content ?? "") };
}

export function bodyText(page) {
  return bodyRegion(page).content;
}

/**
 * Public/GM split of a page's body text (finding C1): strips unrevealed
 * native secret sections out of the public `text` field and, only when that
 * actually removed something, stashes the full unstripped body under
 * `gmFields.text` (so a GM's own search still finds secret prose, without
 * double-indexing every page's full text under `gm:` when there's nothing
 * secret in it).
 */
function textFields(page) {
  const raw = bodyText(page);
  const stripped = stripSecretSections(raw);
  const gmFields = {};
  if (stripped !== raw) gmFields.text = raw;
  return { fields: { text: stripped }, gmFields };
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
  const { fields, gmFields } = textFields(page);
  return {
    fields: {
      ...fields,
      role: flags.role ?? "",
      attributes: joinValues(flags.attributes)
    },
    gmFields
  };
}

/**
 * Partition a person's raw attribute values (flags["monks-enhanced-journal"]
 * .attributes, a flat key->string map) into a publicly-searchable joined
 * string and a GM-only joined string, by key membership in `hiddenKeys`.
 *
 * Exists as a small pure function specifically so the split itself is
 * vitest-testable: this module has no access to `game.settings`, so it
 * can't determine which attribute keys MEJ's per-attribute `playerHidden`
 * sheet-settings marks hidden (see sheets/EnhancedJournalSheet.js's
 * `fieldlist()`, a world SETTING, not page data) - the caller
 * (scripts/search/live-index.mjs) resolves `hiddenKeys` and this function
 * just does the mechanical split.
 *
 * @param {object} attributes  raw key->string map
 * @param {Iterable<string>} hiddenKeys
 * @returns {{visible: string, hidden: string}}
 */
export function splitHiddenAttributes(attributes, hiddenKeys) {
  const hidden = new Set(hiddenKeys ?? []);
  const visibleValues = {};
  const hiddenValues = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    (hidden.has(key) ? hiddenValues : visibleValues)[key] = value;
  }
  return { visible: joinValues(visibleValues), hidden: joinValues(hiddenValues) };
}

function questExtractor(page) {
  const flags = mejFlags(page);
  const objectives = Object.values(flags.objectives ?? {});
  const available = objectives.filter((o) => o?.available);
  const hidden = objectives.filter((o) => !o?.available);
  const { fields, gmFields } = textFields(page);
  if (hidden.length) gmFields.objectives = hidden.map((o) => o?.content ?? "").join(" ");
  return {
    fields: {
      ...fields,
      status: flags.status ?? "",
      objectives: available.map((o) => o?.content ?? "").join(" ")
    },
    gmFields
  };
}

function itemsExtractor(page) {
  const flags = mejFlags(page);
  const items = Object.values(flags.items ?? {});
  const { fields, gmFields } = textFields(page);
  return {
    fields: {
      ...fields,
      items: items.map((i) => i?.name ?? "").join(" ")
    },
    gmFields
  };
}

function sessionExtractor(page) {
  const session = page?.flags?.[COMPANION_FLAGS]?.session ?? {};
  const secrets = session.secrets ?? [];
  const revealed = secrets.filter((s) => s?.revealed);
  const { fields, gmFields } = textFields(page);
  gmFields.gmNotes = page?.system?.gmNotes ?? "";
  if (secrets.length) gmFields.secrets = secrets.map((s) => s?.text ?? "").join(" ");
  return {
    fields: {
      ...fields,
      secrets: revealed.map((s) => s?.text ?? "").join(" ")
    },
    gmFields
  };
}

function genericExtractor(page) {
  const { fields, gmFields } = textFields(page);
  return { fields, gmFields };
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
