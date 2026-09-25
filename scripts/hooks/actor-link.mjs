// Person <-> Actor link sync (spec 2026-09-25 §Architecture 2).
//  - Link sync: MEJ's actor flag changed on a Person, on the client that made
//    the change (it already has permission to update the page). Covers MEJ's
//    own Actor drop (addActor -> setFlag) and the companion picker alike.
//  - Image follow: an actor's img changed; the active GM brings every linked
//    Person onto it. No GM online = caught on the next change or a re-link.
// Observers only: a failure logs and never blocks the triggering update.
import { MODULE_ID } from "../constants.mjs";
import { isPersonPage, linkChanged, linkedActorId, linkSyncUpdate, imageFollowPlan } from "../logic/actor-link.mjs";

function foundryEnv() {
  return {
    userId: game.user.id,
    isActiveGM: game.user === game.users.activeGM,
    actors: game.actors,
    journal: game.journal
  };
}

export async function onPageUpdate(page, changes, options, userId, env = foundryEnv()) {
  if (userId !== env.userId) return;
  if (!isPersonPage(page) || !linkChanged(changes)) return;
  const actorId = linkedActorId(page);
  if (!actorId) return; // unlinked, or a compendium link
  const actor = env.actors.get(actorId);
  if (!actor) return;
  const update = linkSyncUpdate(page, actor, env.userId);
  if (update) await page.update(update);
}

export async function onActorUpdate(actor, changes, options, userId, env = foundryEnv()) {
  if (!env.isActiveGM || !changes || !("img" in changes)) return;
  for (const { entryId, updates } of imageFollowPlan(actor, env.journal)) {
    await env.journal.get(entryId)?.updateEmbeddedDocuments("JournalEntryPage", updates);
  }
}

export function registerActorLink() {
  const observe = (label, fn) => (...args) => {
    fn(...args).catch((err) => console.error(`${MODULE_ID} | actor link ${label} failed`, err));
  };
  Hooks.on("updateJournalEntryPage", observe("sync", (page, changes, options, userId) => onPageUpdate(page, changes, options, userId)));
  Hooks.on("updateActor", observe("image follow", (actor, changes, options, userId) => onActorUpdate(actor, changes, options, userId)));
}
