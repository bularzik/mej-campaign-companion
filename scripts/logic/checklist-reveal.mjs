// scripts/logic/checklist-reveal.mjs
// One audience record drives a Session checklist secret (spec 2026-10-15
// §5.7: one reveal control per checklist secret). "Everyone" is carried by
// the item's existing `revealed` flag - the field every reader (tracker,
// player view, prep board) already honours - and the stored audience's
// `all` is always false, mirroring how block secrets keep "Everyone" in
// Foundry's own class rather than in a companion flag. Pure.
import { normalizeAudience } from "./reveal-state.mjs";

/**
 * @param {{revealed?:boolean, revealedAt?:number|null, audience?:object}} item
 * @param {{all?:boolean, users?:string[], groups?:string[]}} audience  dialog result
 * @param {number} now
 */
export function applyChecklistAudience(item, audience, now = Date.now()) {
  const a = normalizeAudience(audience);
  const revealed = a.all === true;
  const revealedAt = revealed ? (item.revealed === true ? (item.revealedAt ?? now) : now) : null;
  return { ...item, audience: { ...a, all: false }, revealed, revealedAt };
}

/** Seed for promptAudience: users/groups from the record, Everyone from the flag. */
export function checklistSeed(item) {
  return { ...normalizeAudience(item?.audience), all: item?.revealed === true };
}
