// Shared helper for creating a JournalEntry with a single MEJ-typed page,
// extracted from hooks/auto-capture.mjs's original createEncounter() (Task
// 10) so the docx import wizard (apps/import-wizard.mjs, Task 11) can create
// person/place/quest/... pages the same way instead of duplicating the
// flag shape. Both callers still build their own page name/html/extra data;
// this only owns the "how MEJ actually represents a typed page" part.
//
// MEJ's own JournalEntry.prototype._onCreate patch (monks-enhanced-journal.js,
// ~line 1032) creates every non-native-subtype page with Foundry's *native*
// `type: "text"` and stores the real MEJ type under
// `flags["monks-enhanced-journal"].type` (the short, unprefixed key). We
// mirror that exactly - see hooks/auto-capture.mjs's header comment for the
// full citation trail, which still applies verbatim to this helper.

// defaultObject seed per MEJ type, verified against each type's sheet class
// in monks-enhanced-journal's sources (sheets/*.js `static get defaultObject()`).
// Types not listed here (organization, poi, event, journalentry) don't
// override defaultObject and fall back to EnhancedJournalSheet's own `{}`
// (sheets/EnhancedJournalSheet.js).
const MEJ_DEFAULT_OBJECTS = {
  person: { relationships: [], attributes: {} }, // sheets/PersonSheet.js
  place: { shops: [], townsfolk: [], attributes: {} }, // sheets/PlaceSheet.js
  quest: { rewards: [], objectives: [], seen: false, status: "inactive" }, // sheets/QuestSheet.js
  shop: { purchasing: "confirm", selling: "confirm", items: [], opening: 480, closing: 1020 }, // sheets/ShopSheet.js
  loot: { purchasing: "confirm", items: [] }, // sheets/LootSheet.js
  encounter: { items: {}, actors: {}, dcs: {} }, // sheets/EncounterSheet.js
  list: { entries: [], folders: [] }, // sheets/ListSheet.js
  organization: {},
  poi: {},
  event: {},
  journalentry: {}
};

/**
 * Create a JournalEntry with a single MEJ-typed page: native page type
 * "text", `flags["monks-enhanced-journal"].type` set to `type`, seeded with
 * that type's defaultObject keys, then `extraFlags` merged on top (e.g. an
 * Encounter's `actors` rows). Returns the created page.
 * @param {string} type MEJ short type key (person, place, quest, shop, loot,
 *   encounter, organization, poi, event, list, journalentry)
 * @param {string} name entry + page name
 * @param {string} htmlContent page text.content HTML
 * @param {object} [extraFlags] merged over the type's defaultObject seed
 * @returns {Promise<JournalEntryPage>}
 */
export async function createMejEntry(type, name, htmlContent, extraFlags = {}) {
  // JournalEntry.create() returns the created document directly (not an
  // array) when called with a single plain-object `data` argument - an
  // array result only happens when `data` itself is an array. Destructuring
  // it as `const [entry] = await JournalEntry.create({...})` tried to
  // iterate the returned Document, which isn't iterable: confirmed live via
  // Task 14's e2e suite, this threw "TypeError: (intermediate value) is not
  // iterable" on every real call, silently swallowed by auto-capture.mjs's
  // own try/catch (console.error only) - createEncounter() never actually
  // created a page.
  const entry = await JournalEntry.create({
    name,
    pages: [{
      name,
      type: "text",
      text: { content: htmlContent ?? "" },
      flags: {
        "monks-enhanced-journal": {
          type,
          ...(MEJ_DEFAULT_OBJECTS[type] ?? {}),
          ...extraFlags
        }
      }
    }]
  });
  return entry.pages.contents[0];
}
