// Person <-> Actor link (spec 2026-09-25): every decision the sync and the UI
// make, as pure functions over plain objects. No Foundry globals, so the
// whole behavior table is unit-tested here; hooks/actor-link.mjs and
// hooks/actor-link-ui.mjs only move data between these and Foundry.
//
// The link itself is MEJ's own flags["monks-enhanced-journal"].actor, the
// same value MEJ's addActor writes on an Actor drop - the companion builds on
// it and never patches MEJ.
export const MEJ_FLAG = "monks-enhanced-journal";

// Text a game system itself marks as player-facing. Only these ever reach the
// Person's (player-visible) description.
export const PUBLIC_BIO_PATHS = Object.freeze([
  "system.details.biography.public", // dnd5e
  "system.details.publicNotes"       // pf2e
]);

// The full biography - may hold GM-only text, so it only ever goes to the
// linking user's own MEJ Notes.
export const FULL_BIO_PATHS = Object.freeze([
  "system.details.biography.value", // dnd5e
  "system.details.privateNotes",    // pf2e
  "system.details.biography",       // string form, several systems
  "system.biography",
  "system.description.value",
  "system.description"
]);

const MEDIA_RE = /<(img|video|audio|iframe|embed|object)\b/i;

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** True for a non-string, or HTML with no text and no embedded media. */
export function isEmptyHtml(html) {
  if (typeof html !== "string") return true;
  if (MEDIA_RE.test(html)) return false;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length === 0;
}

/** First path in `paths` holding a non-empty HTML string, else null. */
export function actorBiography(actor, paths) {
  if (!actor) return null;
  for (const path of paths) {
    const value = getPath(actor, path);
    if (typeof value === "string" && !isEmptyHtml(value)) return value;
  }
  return null;
}

export function isPersonPage(page) {
  return page?.flags?.[MEJ_FLAG]?.type === "person";
}

const WORLD_ACTOR_UUID = /^Actor\.([^.]+)$/;

/** The linked world actor's id, or null (absent flag, compendium link, non-world uuid). */
export function linkedActorId(page) {
  const link = page?.flags?.[MEJ_FLAG]?.actor;
  if (typeof link === "string") return WORLD_ACTOR_UUID.exec(link)?.[1] ?? null; // legacy uuid string
  if (!link || typeof link !== "object" || link.pack) return null;
  if (typeof link.id === "string" && link.id) return link.id;
  return typeof link.uuid === "string" ? (WORLD_ACTOR_UUID.exec(link.uuid)?.[1] ?? null) : null;
}

/** Does an update diff set, replace or remove MEJ's actor link? */
export function linkChanged(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (`flags.${MEJ_FLAG}.actor` in changes || `flags.${MEJ_FLAG}.-=actor` in changes) return true;
  const mej = changes.flags?.[MEJ_FLAG];
  return !!mej && typeof mej === "object" && ("actor" in mej || "-=actor" in mej);
}

/** MEJ's own link value for `actor` (EnhancedJournalSheet.getItemData's shape). */
export function actorFlagFor(actor) {
  return {
    id: actor.id, uuid: actor.uuid, img: actor.img, name: actor.name,
    quantity: "1", type: actor.flags?.[MEJ_FLAG]?.type
  };
}

/**
 * The page update for a new or changed link, or null when nothing changes:
 * image always follows; the public biography seeds an empty description;
 * the full biography seeds `userId`'s own empty MEJ Notes.
 */
export function linkSyncUpdate(page, actor, userId) {
  const update = {};
  if (typeof actor?.img === "string" && actor.img && actor.img !== page?.src) update.src = actor.img;
  if (isEmptyHtml(page?.text?.content)) {
    const publicBio = actorBiography(actor, PUBLIC_BIO_PATHS);
    if (publicBio) update["text.content"] = publicBio;
  }
  if (typeof userId === "string" && userId && isEmptyHtml(page?.flags?.[MEJ_FLAG]?.[userId]?.notes)) {
    const fullBio = actorBiography(actor, FULL_BIO_PATHS);
    if (fullBio) update[`flags.${MEJ_FLAG}.${userId}.notes`] = fullBio;
  }
  return Object.keys(update).length ? update : null;
}

/** Per-entry page updates that bring every Person linked to `actor` onto its current image. */
export function imageFollowPlan(actor, entries) {
  const plan = [];
  if (!actor?.id || typeof actor.img !== "string" || !actor.img) return plan;
  for (const entry of entries ?? []) {
    const updates = [];
    for (const page of entry.pages ?? []) {
      if (isPersonPage(page) && linkedActorId(page) === actor.id && page.src !== actor.img) {
        updates.push({ _id: page.id, src: actor.img });
      }
    }
    if (updates.length) plan.push({ entryId: entry.id, updates });
  }
  return plan;
}
