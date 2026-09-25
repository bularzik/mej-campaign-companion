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
    regionKeys: (page) => linkableRegions(page).map((r) => r.key),
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

/** GM side. `senderId` comes from the socket, never from the payload. */
export async function handleEntityRequest(payload, senderId, env = foundryEnv()) {
  const reply = (outcome) => env.emit({
    action: ENTITY_FROM_SELECTION_RESULT_ACTION, requestId: payload?.requestId, recipient: senderId, ...outcome
  });
  if (typeof senderId !== "string" || typeof payload?.requestId !== "string") return;
  const sender = env.users.get(senderId) ?? null;
  const page = typeof payload.pageUuid === "string" ? await env.fromUuid(payload.pageUuid) : null;
  if (!page) return reply({ ok: false, reason: "page-missing" });
  const flag = env.campaignFlagFor(page);
  const verdict = validateSelectionRequest(payload, {
    sender: sender ? { id: sender.id, isGM: !!sender.isGM } : null,
    isContributor: !!sender && !!flag && isContributor({ id: sender.id, isGM: false }, flag, env.groups),
    canObserve: !!sender && page.parent?.testUserPermission(sender, "OBSERVER") === true,
    regionKeys: env.regionKeys(page)
  });
  if (!verdict.ok) return reply(verdict);
  return reply(await env.run(pick(payload)));
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
