// Contributor → active GM relay for "Create Entity from Selection" (spec
// 2026-09-22 §4.5), mirroring the media-upload request/result pair. The
// GM trusts only the socket-supplied sender id (spike note 2026-09-22,
// section (a): Foundry's server appends its own `this.user.id` as the
// LAST handler argument and discards forged extra client args), so
// payload.userId is ignored, so a player cannot act as another user.
import {
  MODULE_ID, SOCKET, ENTITY_FROM_SELECTION_ACTION, ENTITY_FROM_SELECTION_RESULT_ACTION,
  ENTITY_RELAY_TIMEOUT_MS, PLAYER_GROUPS_SETTING
} from "../constants.mjs";
import { validateSelectionRequest } from "../logic/entity-from-selection.mjs";
import { isContributor, campaignOf, campaignFlagOf } from "../logic/campaigns.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { runEntityFromSelection } from "../logic/entity-from-selection-run.mjs";

const FIELDS = ["pageUuid", "fieldKey", "text", "occurrence", "total", "type", "name", "linkOthers"];
const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p?.[k]]));

function foundryEnv() {
  return {
    emit: (msg) => game.socket.emit(SOCKET, msg),
    users: game.users,
    fromUuid: (u) => fromUuid(u),
    campaignFlagFor: (page) => campaignFlagOf(campaignOf(page)),
    groups: game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING),
    run: async (request) => {
      const { pipelineDeps } = await import("./entity-from-selection.mjs");
      return runEntityFromSelection(request, pipelineDeps());
    },
    userId: game.user.id,
    randomId: () => foundry.utils.randomID(),
    onLate: async (outcome) => {
      const { showEntityOutcome } = await import("./entity-from-selection.mjs");
      showEntityOutcome(outcome, { type: outcome.type, name: outcome.name, sheet: null });
    }
  };
}

/**
 * Regions a relayed request may write: never a GM-only one (a session's
 * system.gmNotes), which the contributor cannot see - otherwise a forged
 * fieldKey could write into GM notes and the `linked` reply would leak
 * whether the text occurs there.
 */
export function relayRegionKeys(page) {
  return linkableRegions(page).filter((r) => !r.gmOnly).map((r) => r.key);
}

/** GM side. `senderId` comes from the socket, never from the payload. */
export async function handleEntityRequest(payload, senderId, env = foundryEnv()) {
  const reply = (outcome) => env.emit({
    action: ENTITY_FROM_SELECTION_RESULT_ACTION, requestId: payload?.requestId, recipient: senderId, ...outcome
  });
  if (typeof senderId !== "string" || typeof payload?.requestId !== "string") return;
  try {
    // Sender first: an unknown user or a GM is rejected before fromUuid, so
    // the reply cannot tell an arbitrary client whether a page exists.
    const sender = env.users.get(senderId) ?? null;
    if (!sender || sender.isGM) return reply({ ok: false, reason: "bad-sender" });
    const page = typeof payload.pageUuid === "string" ? await env.fromUuid(payload.pageUuid) : null;
    if (!page) return reply({ ok: false, reason: "page-missing" });
    const flag = env.campaignFlagFor(page);
    const verdict = validateSelectionRequest(payload, {
      sender: { id: sender.id, isGM: false },
      isContributor: !!flag && isContributor({ id: sender.id, isGM: false }, flag, env.groups),
      canObserve: page.parent?.testUserPermission(sender, "OBSERVER") === true,
      regionKeys: relayRegionKeys(page)
    });
    if (!verdict.ok) return reply(verdict);
    // Foundry renders secret sections only for owners, so a non-owner's
    // occurrence/total never covered them (linkSelectionInSource).
    const maskSecrets = page.testUserPermission?.(sender, "OWNER") !== true;
    return reply(await env.run({ ...pick(payload), maskSecrets }));
  } catch (err) {
    // Without a reply the requester would time out into "No GM responded;
    // nothing was created", which may be false once creation has happened.
    console.error(`${MODULE_ID} | entity-from-selection: relayed request failed`, err);
    return reply({ ok: false, reason: "create-failed" });
  }
}

const pending = new Map();   // requestId -> { resolve, timer, meta }
const late = new Map();      // requestId -> meta, after a timeout

export function requestEntityViaGm(request, env = foundryEnv()) {
  const requestId = env.randomId();
  const meta = { type: request.type, name: request.name };
  const result = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      late.set(requestId, meta);
      resolve({ ok: false, reason: "no-gm" });
    }, ENTITY_RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer, meta });
  });
  env.emit({ action: ENTITY_FROM_SELECTION_ACTION, requestId, userId: env.userId, ...pick(request) });
  return result;
}

/**
 * Requester side: settle our own pending request; toast a result that
 * arrives after the timeout. Takes `_senderId` (the GM's id, per the
 * dispatcher's `handler(payload, senderId)` call shape - socket.mjs) as its
 * second positional argument even though it is unused here, so that shape
 * lines up with `handleEntityRequest`'s and the default `env` parameter
 * lands in the third slot instead of silently absorbing the sender id
 * (fix round 1: a two-parameter signature let `senderId` fall into `env`'s
 * position, so `env.userId` was undefined and every relay looked like a
 * timeout - "No GM responded" - even on success).
 */
export function handleEntityResult(payload, _senderId, env = foundryEnv()) {
  if (payload?.recipient !== env.userId) return;
  const { action, requestId, recipient, ...outcome } = payload;
  const waiting = pending.get(requestId);
  if (waiting) {
    clearTimeout(waiting.timer);
    pending.delete(requestId);
    waiting.resolve(outcome);
    return;
  }
  const meta = late.get(requestId);
  if (meta) {
    late.delete(requestId);
    env.onLate({ ...outcome, ...meta });
  }
}
