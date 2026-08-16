// Pure view-model logic for the Campaign Hub's Index pane. Kept out of
// CampaignHubPage.mjs (which imports MEJ's Foundry-served EnhancedJournalSheet
// and so can't be loaded by vitest) so this stays unit-testable.

/** True when a non-GM user has at least LIMITED permission on a journal entry. */
export function isVisibleToUser(entry, user) {
  return user.isGM || entry.testUserPermission(user, "LIMITED") === true;
}

/**
 * Row descriptors for every MEJ-typed journal entry, permission-filtered for
 * non-GM users. `getMEJType`/`getIcon` are injected (they're
 * game.MonksEnhancedJournal statics) so this stays callable without Foundry.
 *
 * @param {object[]} entries  candidate JournalEntry documents (e.g. game.journal.contents)
 * @param {object} user  game.user
 * @param {(entry: object) => string|false} getMEJType
 * @param {(type: string) => string} getIcon
 * @returns {{uuid:string, name:string, type:string, icon:string}[]}
 */
export function buildIndexSource(entries, user, getMEJType, getIcon) {
  const rows = [];
  for (const entry of entries ?? []) {
    const type = getMEJType(entry);
    if (!type) continue;
    if (!isVisibleToUser(entry, user)) continue;
    rows.push({ uuid: entry.uuid, name: entry.name, type, icon: getIcon(type) });
  }
  return rows;
}

/**
 * Apply the Index pane's type filter, text filter, and sort. Non-mutating.
 * @param {{uuid:string,name:string,type:string,icon:string}[]} rows
 * @param {{types: Set<string>, query: string, sort: "name"|"type"}} state
 * @param {(type: string) => string} labelOf
 * @returns {{uuid:string,name:string,type:string,icon:string,typeLabel:string}[]}
 */
export function filterIndexRows(rows, { types, query, sort }, labelOf) {
  let filtered = rows;
  if (types?.size) filtered = filtered.filter((r) => types.has(r.type));
  const q = (query ?? "").trim().toLowerCase();
  if (q) filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
  const decorated = filtered.map((r) => ({ ...r, typeLabel: labelOf(r.type) }));
  decorated.sort((a, b) => {
    if (sort === "type") return a.typeLabel.localeCompare(b.typeLabel) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  return decorated;
}
