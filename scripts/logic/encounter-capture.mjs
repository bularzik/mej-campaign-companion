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
 * Collision correction (second-round review finding): stripping the
 * token-id segment means every unlinked-token instance of the SAME base
 * Actor - e.g. three unlinked "Goblin" tokens dragged from a compendium,
 * the default way GMs place monster mobs - collapses onto one dot-free key.
 * collapseParticipants() keys by the full (distinct) synthetic uuid, so
 * each token is its own row with count 1; naively overwriting `actors[id]`
 * per row would keep only the LAST one, silently losing the other two
 * instead of recording three. buildEncounterActorRows instead MERGES on a
 * key collision - summing quantities and keeping the first row's
 * name/img/uuid - so three unlinked Goblin rows correctly become one
 * `actors` entry with quantity "3" (also naturally collapsing same-actor
 * duplicates into the readable "×N" form the brief's "collapsed counts"
 * acceptance criterion calls for, rather than three separate rows).
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
 * description text with describeUnlinkedParticipants() instead. Rows that
 * collide on that dot-free key (distinct combatants resolving to the same
 * base actor - most commonly several unlinked-token instances of one
 * monster) are MERGED, not overwritten: their quantities are summed and the
 * first colliding row's name/img/uuid is kept.
 */
export function buildEncounterActorRows(participants) {
  const actors = {};
  for (const row of participants) {
    if (!row.actor) continue;
    const id = idFromUuid(row.actor);
    const existing = actors[id];
    if (existing) {
      existing.quantity = String((Number(existing.quantity) || 0) + row.count);
    } else {
      actors[id] = {
        id,
        uuid: row.actor,
        name: row.name,
        img: FALLBACK_ACTOR_IMG,
        quantity: String(row.count)
      };
    }
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

/**
 * Auto-capture's generated outcome summary lives in its own marked container
 * inside the Encounter page's body, so a re-fired capture can replace just
 * that block instead of the whole body.
 *
 * Why it needs to: hooks/auto-capture.mjs's mergeEncounter() runs when the
 * same combat's end fires twice (the encounterPagesByCombatId re-fire path).
 * It merges the actor roster additively, but it used to overwrite
 * `text.content` outright with a freshly generated summary - so a GM who had
 * written the encounter up in the meantime lost every word of it.
 *
 * Regex rather than DOM parsing, for the same reason logic/secret-blocks.mjs
 * is: this module is pure and Foundry-free so vitest can load it. The
 * non-greedy close-tag match is safe here because the block's contents are
 * only ever this module's own <p> elements - never a nested <div>.
 */
export const OUTCOME_MARKER = "mej-cc-outcome";

const OUTCOME_RE = new RegExp(`<div data-${OUTCOME_MARKER}="1">[\\s\\S]*?<\\/div>`, "i");

/** Wrap generated summary html in the marked container. Empty summary -> no block at all. */
export function wrapOutcomeHtml(inner) {
  return inner ? `<div data-${OUTCOME_MARKER}="1">${inner}</div>` : "";
}

/**
 * Fold a freshly generated summary into an existing page body, replacing only
 * the previously generated block and leaving everything a GM wrote intact.
 * A body with no block yet (an Encounter created before this existed) gets one
 * appended rather than having its content touched.
 */
export function mergeOutcomeHtml(existingHtml, outcomeHtml) {
  const existing = typeof existingHtml === "string" ? existingHtml : "";
  const block = wrapOutcomeHtml(outcomeHtml);
  // Function replacement, not a string: the summary is built from actor names,
  // and String#replace would expand `$&`/`$'` in them as replacement patterns.
  if (OUTCOME_RE.test(existing)) return existing.replace(OUTCOME_RE, () => block);
  if (!block) return existing;
  return `${existing}${block}`;
}
