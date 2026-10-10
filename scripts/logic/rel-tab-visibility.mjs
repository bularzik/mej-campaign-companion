// Relationships tab for non-GMs (spec 2026-10-09 §3, §4.7). MEJ removes the
// tab when the raw relationships flag is empty (EnhancedJournalSheet.js:228-232)
// and PlaceSheet removes it again when no non-person/shop rows exist
// (PlaceSheet.js:74-76) - both on RAW rows, so a player whose rows are all
// hidden sees an empty tab while a player who could contribute sees none.
// These pure functions decide and apply the companion's rule instead.
import { visibleRelRows } from "./rel-reveals.mjs";

const KEY = "relationships";
// PlaceSheet shows person and shop rows on its own Townsfolk / Shops tabs.
const PLACE_OWN_TABS = new Set(["person", "shop"]);

export function relationshipsTabVisible({ isGM, visibleGmRows, visiblePlayerRows, canAdd }) {
  if (isGM) return true;
  return visibleGmRows > 0 || visiblePlayerRows > 0 || canAdd === true;
}

function relTypeById(relationships) {
  const entries = Array.isArray(relationships)
    ? relationships.map((rel) => [rel?.id ?? "", rel])
    : relationships && typeof relationships === "object" ? Object.entries(relationships) : [];
  return new Map(entries.map(([key, rel]) => [String(rel?.id ?? key), rel?.type]));
}

/** GM rows this player sees on the Relationships tab itself (rule 1). */
export function countVisibleGmRows(relationships, relReveals, { userId, groups, sheetType, canSeeTarget }) {
  const types = relTypeById(relationships);
  return visibleRelRows(relationships, relReveals ?? {}, { userId, groups, isGM: false })
    .filter((r) => sheetType !== "place" || !PLACE_OWN_TABS.has(types.get(r.id)))
    .filter((r) => canSeeTarget(r.uuid))
    .length;
}

/**
 * Apply the decision to a prepared tabs record. Removing an active tab
 * activates the first remaining one (returned as `activate` so the caller
 * can update tabGroups); restoring takes the pre-MEJ-filtering tab object
 * from `fullTabs` and keeps the original order. A tab hidden by MEJ's
 * per-sheet-type `shown: false` setting is never restored.
 */
export function applyRelationshipsTab(tabs, { visible, hiddenBySetting, fullTabs }) {
  if (!tabs) return { tabs, activate: null };
  if (hiddenBySetting || !visible) {
    if (!(KEY in tabs)) return { tabs, activate: null };
    const wasActive = tabs[KEY]?.active === true;
    const next = { ...tabs };
    delete next[KEY];
    if (!wasActive) return { tabs: next, activate: null };
    const first = Object.keys(next)[0] ?? null;
    if (first) next[first] = { ...next[first], active: true, cssClass: "active" };
    return { tabs: next, activate: first };
  }
  if (KEY in tabs || !fullTabs?.[KEY]) return { tabs, activate: null };
  const anyActive = Object.values(tabs).some((t) => t?.active === true);
  const restored = anyActive ? { ...fullTabs[KEY], active: false, cssClass: "" } : { ...fullTabs[KEY] };
  const next = {};
  for (const key of Object.keys(fullTabs)) {
    if (key === KEY) next[key] = restored;
    else if (key in tabs) next[key] = tabs[key];
  }
  for (const key of Object.keys(tabs)) if (!(key in next)) next[key] = tabs[key];
  return { tabs: next, activate: null };
}
