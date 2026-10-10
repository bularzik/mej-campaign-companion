// Player -> active GM relay for player connections (spec 2026-10-09 §4.4),
// the entity-from-selection-relay.mjs pattern: the player emits
// { action, requestId, op, fromUuid, connectionId, side, payload }; only
// game.users.activeGM handles it (socket.mjs GM_ACTIONS); the sender id is
// the one Foundry's server appends to the socket message, never a payload
// field; the reply is correlated by requestId; the player times out after
// ENTITY_RELAY_TIMEOUT_MS. A GM writes directly through applyConnectionOp.
import {
  MODULE_ID, I18N, SOCKET, PLAYER_CONNECTION_ACTION, PLAYER_CONNECTION_RESULT_ACTION,
  PLAYER_CONNECTIONS_FLAG, PLAYER_CONNECTIONS_SETTING, ENTITY_RELAY_TIMEOUT_MS
} from "../constants.mjs";
import { normalizeConnections, validateRequest, connectionUpdate } from "../logic/player-connections.mjs";
import { mejTypeWith } from "../logic/mej-type.mjs";

const FIELDS = ["op", "fromUuid", "connectionId", "side", "payload"];
const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p?.[k]]));
const REASONS = new Set([
  "no-entry", "disabled", "no-access", "type-not-allowed", "self", "duplicate", "bad-label", "not-author",
  "gone", "locked", "bad-request", "bad-sender", "no-gm", "timeout", "failed"
]);

const getMEJType = (doc) => game.MonksEnhancedJournal?.getMEJType?.(doc);

function foundryEnv() {
  return {
    emit: (msg) => game.socket.emit(SOCKET, msg),
    users: game.users,
    knownUserIds: () => new Set(game.users.map((u) => u.id)),
    userId: game.user.id,
    isGM: game.user.isGM === true,
    activeGM: () => game.users.activeGM ?? null,
    randomId: () => foundry.utils.randomID(),
    now: () => Date.now(),
    enabled: () => game.settings.get(MODULE_ID, PLAYER_CONNECTIONS_SETTING) !== false,
    resolveSource: async (uuid) => {
      const entry = typeof uuid === "string" ? await fromUuid(uuid) : null;
      if (!(entry instanceof JournalEntry)) return null;
      const page = entry.pages.contents.find((p) => mejTypeWith(p, getMEJType)) ?? null;
      if (!page) return null;
      let allowed = [];
      try {
        // MEJ's own addRelationship reads the target page's sheet the same way.
        allowed = [...(page.sheet?.allowedRelationships ?? [])];
      } catch {
        allowed = [];
      }
      return { uuid: entry.uuid, page, typed: true, locked: entry.compendium?.locked === true, allowed };
    },
    typeOf: (uuid) => {
      const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
      return entry instanceof JournalEntry ? (mejTypeWith(entry, getMEJType) || null) : null;
    },
    canAccess: (user, uuid, level) => {
      const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
      return entry instanceof JournalEntry && entry.testUserPermission(user, level) === true;
    },
    update: (page, data) => page.update(data)
  };
}

/** Validate and write one op for `senderId`. Never throws. */
export async function applyConnectionOp(request, senderId, env = foundryEnv()) {
  try {
    const sender = typeof senderId === "string" ? env.users.get(senderId) ?? null : null;
    if (!sender) return { ok: false, reason: "bad-sender" };
    const source = await env.resolveSource(request?.fromUuid);
    const connections = source
      ? normalizeConnections(source.page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], source.uuid)
      : [];
    const verdict = validateRequest(request?.op, request, {
      sender: { id: sender.id, isGM: sender.isGM === true },
      enabled: env.enabled(),
      source: source && { uuid: source.uuid, typed: source.typed, locked: source.locked, allowed: source.allowed },
      typeOf: env.typeOf,
      canAccess: (uuid, level) => env.canAccess(sender, uuid, level),
      connections
    });
    if (!verdict.ok) return verdict;
    if (verdict.noop) return { ok: true, connectionId: request.connectionId, noop: true };
    const newId = request.op === "add" ? env.randomId() : null;
    const data = connectionUpdate(request.op, request, {
      senderId: sender.id, senderName: sender.name ?? "", now: env.now(), newId, connections
    });
    await env.update(source.page, data);
    return { ok: true, connectionId: newId ?? request.connectionId };
  } catch (err) {
    console.error(`${MODULE_ID} | player connection: ${request?.op} failed`, err);
    return { ok: false, reason: "failed" };
  }
}

/** GM side. `senderId` comes from the socket, never from the payload. */
export async function handleConnectionRequest(payload, senderId, env = foundryEnv()) {
  if (typeof senderId !== "string" || typeof payload?.requestId !== "string") return;
  const outcome = await applyConnectionOp(pick(payload), senderId, env);
  env.emit({ action: PLAYER_CONNECTION_RESULT_ACTION, requestId: payload.requestId, recipient: senderId, ...outcome });
}

const pending = new Map(); // requestId -> { resolve, timer }

export function requestConnectionOp(request, env = foundryEnv()) {
  if (env.isGM) return applyConnectionOp(pick(request), env.userId, env);
  if (!env.activeGM()) return Promise.resolve({ ok: false, reason: "no-gm" });
  const requestId = env.randomId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, ENTITY_RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    env.emit({ action: PLAYER_CONNECTION_ACTION, requestId, ...pick(request) });
  });
}

/** Requester side: settle our own pending request, only from a GM's reply. */
export function handleConnectionResult(payload, senderId, env = foundryEnv()) {
  if (payload?.recipient !== env.userId) return;
  if (env.users?.get(senderId)?.isGM !== true) return;
  const { action, requestId, recipient, ...outcome } = payload;
  const waiting = pending.get(requestId);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  pending.delete(requestId);
  waiting.resolve(outcome);
}

export function connectionReasonKey(reason) {
  return `${I18N}.playerConnections.reasons.${REASONS.has(reason) ? reason : "failed"}`;
}

/** Spec §7: a localized warning per reason; nothing on success. */
export function showConnectionOutcome(outcome) {
  if (outcome?.ok) return;
  ui.notifications.warn(game.i18n.localize(connectionReasonKey(outcome?.reason)));
}
