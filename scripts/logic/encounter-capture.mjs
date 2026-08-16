/**
 * Pure adaptation logic bridging campaign-record's generic auto-capture rows
 * ({id,name,count,actor}, see auto-capture.mjs's collapseParticipants /
 * mergeParticipants) to MEJ's own Encounter-page `actors` flag shape.
 *
 * MEJ's real shape (verified against sheets/EncounterSheet.js and the
 * getItemData() row builder in sheets/EnhancedJournalSheet.js:2265-2283 of
 * the monks-enhanced-journal source): flags["monks-enhanced-journal"].actors
 * is a PLAIN OBJECT keyed by an opaque row id, each value
 * `{ id, uuid, img, name, quantity, type }` where quantity is a STRING
 * ("1", not 1). EncounterSheet#getActors() re-resolves name/img live from
 * the actor when it renders, so the name/img stored here are only a
 * best-effort fallback (shown verbatim if the actor fails to resolve, e.g.
 * for name-only "Mook" combatants with no linked actor).
 *
 * No Foundry globals — unit-tested with vitest.
 */

const FALLBACK_ACTOR_IMG = "icons/svg/mystery-man.svg";

/** Build MEJ's `actors` flag object from collapseParticipants()-shaped rows. */
export function buildEncounterActorRows(participants) {
  const actors = {};
  for (const row of participants) {
    actors[row.id] = {
      uuid: row.actor ?? undefined,
      name: row.name,
      img: FALLBACK_ACTOR_IMG,
      quantity: String(row.count)
    };
  }
  return actors;
}

/**
 * Inverse of buildEncounterActorRows: read an existing Encounter page's
 * `actors` flag object back into collapseParticipants()-shaped rows, so it
 * can be combined with a fresh roster via auto-capture.mjs's
 * mergeParticipants() (additive: keeps the larger count per id).
 */
export function rowsFromEncounterActors(actorsFlag) {
  return Object.entries(actorsFlag ?? {}).map(([id, row]) => ({
    id,
    name: row.name,
    count: Number.parseInt(row.quantity, 10) || 1,
    actor: row.uuid ?? null
  }));
}

/** "Encounter: <scene> (<date>)", or "Encounter (<date>)" with no scene. */
export function buildEncounterName(sceneName, dateLabel) {
  return sceneName ? `Encounter: ${sceneName} (${dateLabel})` : `Encounter (${dateLabel})`;
}
