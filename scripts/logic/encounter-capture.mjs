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
 * ("1", not 1).
 *
 * Row-key correction (code review finding): MEJ's monsters-tab template
 * interpolates that object key directly into a dot-notation form field name
 * (`flags.monks-enhanced-journal.actors.{{this.id}}.quantity`, alongside
 * always-present lock/hidden checkboxes), and Foundry's
 * FormDataExtended/expandObject() splits form field names on ".". Keying by
 * a full actor UUID ("Actor.xxxxxxxxxxxxxxxx", or for an unlinked token
 * "Scene.x.Token.y.Actor.z") therefore corrupts the flag the moment a GM
 * saves the Encounter sheet in MEJ: expandObject splits the key on its own
 * embedded dots and merges a bogus nested `actors.Actor = {...}` structure
 * in alongside the real row. Every row here is instead keyed by the
 * DOT-FREE id segment - the tail after the last "." in the full uuid, i.e.
 * the actual document's plain id (identical for a bare Actor uuid and an
 * unlinked token's synthetic Actor uuid, since both end in the real actor's
 * plain id, which never itself contains a dot).
 *
 * Actor-less rows (no actor.uuid: a name-only combatant like "Mook" with no
 * linked actor) have nowhere safe to live in `actors`. MEJ's
 * EncounterSheet#getActors() (EncounterSheet.js:139-181) does NOT show an
 * unresolvable row's stored name verbatim - it OVERWRITES it with the
 * localized "Could not find actor" string plus a warning-triangle image the
 * moment `fromUuid`-style resolution fails. Storing an actor-less row here
 * would therefore render as a visibly broken monster row, not as its name.
 * buildEncounterActorRows SKIPS actor-less rows entirely; the hook
 * (scripts/hooks/auto-capture.mjs) folds their names+counts into the
 * Encounter's description text instead via describeUnlinkedParticipants
 * below, where they render as plain text with no broken-row risk.
 *
 * No Foundry globals — unit-tested with vitest.
 */

const FALLBACK_ACTOR_IMG = "icons/svg/mystery-man.svg";

/** The document id segment of a Foundry uuid - the tail after its last ".". */
function idFromUuid(uuid) {
  return uuid.split(".").pop();
}

/**
 * Build MEJ's `actors` flag object from collapseParticipants()-shaped rows,
 * keyed by the dot-free document id (see module doc comment). Rows with no
 * linked actor (row.actor falsy) are skipped - fold them into the
 * description text with describeUnlinkedParticipants() instead.
 */
export function buildEncounterActorRows(participants) {
  const actors = {};
  for (const row of participants) {
    if (!row.actor) continue;
    const id = idFromUuid(row.actor);
    actors[id] = {
      id,
      uuid: row.actor,
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
 * mergeParticipants() (additive: keeps the larger count per id). Rows are
 * keyed by their resolved actor uuid (not the flag object's own storage
 * key, which is only the dot-free id segment) so a merge lines up correctly
 * against a fresh collapseParticipants() roster, whose row ids are full
 * actor uuids.
 */
export function rowsFromEncounterActors(actorsFlag) {
  return Object.values(actorsFlag ?? {}).map((row) => {
    const actor = row.uuid ?? null;
    return {
      id: actor ?? `name:${row.name}`,
      name: row.name,
      count: Number.parseInt(row.quantity, 10) || 1,
      actor
    };
  });
}

/**
 * Names+counts of participant rows with no linked actor ("Name ×N",
 * comma-joined; empty string when every row has an actor), for appending to
 * the Encounter's description text since MEJ's `actors` flag has no safe
 * slot for them (see module doc comment).
 */
export function describeUnlinkedParticipants(participants) {
  return participants
    .filter((row) => !row.actor)
    .map((row) => (row.count > 1 ? `${row.name} ×${row.count}` : row.name))
    .join(", ");
}

/** "Encounter: <scene> (<date>)", or "Encounter (<date>)" with no scene. */
export function buildEncounterName(sceneName, dateLabel) {
  return sceneName ? `Encounter: ${sceneName} (${dateLabel})` : `Encounter (${dateLabel})`;
}
