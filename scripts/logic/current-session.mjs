// Pure rules for the one open session per campaign (spec 2026-10-15 item 2,
// §9 calls). Foundry wiring: hooks/current-session.mjs.
import { MODULE_ID, CAMPAIGN_FLAG, CURRENT_SESSION_KEY, NOTES_FLAG } from "../constants.mjs";
import { campaignFlagOf } from "./campaigns.mjs";
import { heldNotes } from "./notes.mjs";

export function currentSession(campaign) {
  const cs = campaignFlagOf(campaign)?.[CURRENT_SESSION_KEY];
  return cs && typeof cs.uuid === "string" ? { uuid: cs.uuid, startedAt: typeof cs.startedAt === "number" ? cs.startedAt : 0 } : null;
}

export const currentSessionUpdate = (uuid, now) => ({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}.${CURRENT_SESSION_KEY}`]: { uuid, startedAt: now } });
export const clearCurrentSessionUpdate = () => ({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}.-=${CURRENT_SESSION_KEY}`]: null });

export function nextSessionNumber(numbers) {
  const max = Math.max(0, ...(numbers ?? []).filter((n) => Number.isFinite(n)));
  return max + 1;
}

export function startedToday(startedAt, now) {
  if (typeof startedAt !== "number") return false;
  const a = new Date(startedAt);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Grant OWNER on the session entry to `userIds` that lack it. Adds only (Review Focus 4). */
export function recapOwnershipUpdate(ownership, userIds, { ownerLevel }) {
  const update = {};
  for (const id of userIds ?? []) {
    if ((ownership?.[id] ?? -1) < ownerLevel) update[`ownership.${id}`] = ownerLevel;
  }
  return Object.keys(update).length ? update : null;
}

/** Where a `/note` goes (spec §9): the one open session; else held for the one visible campaign; else refuse. */
export function routeNote({ openSessions, visibleCampaignIds }) {
  const open = openSessions ?? [];
  if (open.length === 1) return { kind: "session", campaignId: open[0].campaignId, sessionUuid: open[0].sessionUuid };
  if (open.length > 1) return { kind: "refuse", reason: "ambiguous" };
  const visible = visibleCampaignIds ?? [];
  if (visible.length === 1) return { kind: "held", campaignId: visible[0] };
  return { kind: "refuse", reason: visible.length ? "ambiguous" : "none" };
}

/** Stamp every held note of this campaign's entry with the session that just started. */
export function adoptHeldUpdate(notes, sessionUuid) {
  const update = {};
  for (const n of heldNotes(notes)) update[`flags.${MODULE_ID}.${NOTES_FLAG}.${n.id}.sessionUuid`] = sessionUuid;
  return Object.keys(update).length ? update : null;
}
