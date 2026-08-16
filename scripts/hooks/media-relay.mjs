// Adapted from campaign-record's scripts/hooks/media-relay.mjs. Structural
// port: requester-side chunk+emit, GM-side chunked-upload assembler,
// requester-side result settlement. Differences from campaign-record:
//  - Socket channel is the companion's own SOCKET (constants.mjs), not a
//    dedicated `module.${MODULE_ID}` constant computed locally - matches
//    this repo's existing convention (see hooks/auto-capture.mjs et al).
//  - No "group" document to validate the upload against: campaign-record
//    scopes uploads into a per-group media directory and checks isGroup().
//    The companion has no equivalent per-entry media directory - every
//    relayed/direct upload lands in one shared RELAY_UPLOAD_DIR()
//    (constants.mjs, a sibling of the import wizard's IMPORT_MEDIA_DIR()).
//    The wire payload still carries a `groupId` field (unchanged from the
//    verbatim-ported scripts/logic/media-relay.mjs's chunkProblem/
//    createRelayAssembler, which validate and store it under that name) -
//    here it just carries the target session page's uuid for logging
//    context, not an access-scoping id. See relayUploadMedia's doc comment.
//  - This module does NOT self-register a socket listener. Requirement:
//    "single game.socket.on(SOCKET, handler) registered once (ready hook);
//    route by action field" - the shared dispatcher lives in
//    scripts/hooks/socket.mjs and imports handleUploadRequest/
//    handleUploadResult from here instead.
//  - Reply/upload destination: RELAY_UPLOAD_DIR() via
//    apps/import-upload.mjs's uploadCompanionFile(), not campaign-record's
//    per-group uploadHubMedia().
import {
  MODULE_ID, SOCKET, UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION, RELAY_UPLOAD_DIR, SESSION_DOCUMENT_TYPE
} from "../constants.mjs";
import {
  chunkBase64, createRelayAssembler, base64ByteLength, isRelayableImageType, enforcedImageName,
  MAX_RELAY_FILE_BYTES
} from "../logic/media-relay.mjs";
import { uploadCompanionFile } from "../apps/import-upload.mjs";

const RELAY_TIMEOUT_MS = 30_000;

const pending = new Map(); // requestId -> {resolve, reject, timer} on the requesting client
const assembler = createRelayAssembler();

export class RelayUploadError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "RelayUploadError";
  }
}

/** Encode a File's bytes as base64 without exceeding the call stack. */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/** Timestamp+random-prefixed filename so concurrent relayed uploads never collide on disk. */
export function relayFilename(name) {
  return `${Date.now()}-${foundry.utils.randomID(6)}-${name}`;
}

/**
 * Ask the active GM to upload this image on our behalf; resolves with the
 * stored path. Images only, capped at MAX_RELAY_FILE_BYTES. The caller
 * ensures an active GM exists (see logic/player-recap.mjs's
 * recapWriteRoute / SessionSheet's upload-permission branch).
 * `contextUuid` travels as the wire payload's `groupId` field purely for
 * GM-side logging context (see this module's header comment) - it plays no
 * access-scoping role, unlike campaign-record's group id.
 */
export async function relayUploadMedia(contextUuid, file) {
  if (!isRelayableImageType(file.type)) {
    throw new RelayUploadError(`mej-campaign-companion | not a relayable image: ${file.name}`);
  }
  const base64 = await fileToBase64(file);
  if (base64ByteLength(base64) > MAX_RELAY_FILE_BYTES) {
    throw new RelayUploadError(`mej-campaign-companion | too large to relay: ${file.name}`);
  }
  const requestId = foundry.utils.randomID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new RelayUploadError(`mej-campaign-companion | relay upload timed out for ${file.name}`));
    }, RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
  });
  chunkBase64(base64).forEach((data, seq, chunks) => {
    game.socket.emit(SOCKET, {
      action: UPLOAD_MEDIA_ACTION,
      requestId, senderId: game.user.id, groupId: contextUuid, name: file.name, type: file.type,
      seq, total: chunks.length, data
    });
  });
  return result;
}

/**
 * GM side: reassemble, validate, upload, reply. Requests are untrusted
 * (module sockets carry no authenticated sender): only renderable image
 * types under the size cap are accepted, the caller's claimed extension is
 * never trusted (enforcedImageName forces it to match the validated MIME),
 * and the stored filename is uniquified so two players relaying
 * same-named files can't overwrite each other. Called from the shared
 * dispatcher (hooks/socket.mjs), already gated there on
 * `game.user === game.users.activeGM`.
 */
export async function handleUploadRequest(payload) {
  const outcome = assembler.accept(payload, Date.now());
  if (outcome.status === "pending") return;
  const requestId = outcome.status === "complete" ? outcome.request.requestId : payload?.requestId;
  const reply = (message) => {
    if (typeof requestId === "string" && requestId) {
      game.socket.emit(SOCKET, { action: UPLOAD_MEDIA_RESULT_ACTION, requestId, ...message });
    }
  };
  if (outcome.status === "invalid") return reply({ error: outcome.reason });
  const sender = game.users.get(outcome.request.senderId);
  if (!sender) {
    console.debug(`${MODULE_ID} | dropped relayed media upload from unknown user id`, outcome.request.senderId);
    return reply({ error: "bad-sender" });
  }
  const session = await fromUuid(outcome.request.groupId).catch(() => null);
  if (
    !(session instanceof JournalEntryPage) ||
    session.type !== SESSION_DOCUMENT_TYPE ||
    !session.parent?.testUserPermission(sender, "OBSERVER")
  ) {
    console.debug(
      `${MODULE_ID} | dropped relayed media upload - sender can't observe the session context`,
      sender.id, outcome.request.groupId
    );
    return reply({ error: "bad-context" });
  }
  // Never trust the caller's extension: force it to match the validated
  // MIME so a mismatched pair (evil.html, image/png) can't land as .html.
  const name = enforcedImageName(outcome.request.name, outcome.request.type);
  if (!name) return reply({ error: "bad-type" });
  try {
    const bytes = Uint8Array.from(atob(outcome.request.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], relayFilename(name), { type: outcome.request.type });
    const path = await uploadCompanionFile(file, RELAY_UPLOAD_DIR());
    reply({ path });
  } catch (error) {
    console.error(`${MODULE_ID} | relayed media upload failed`, error);
    reply({ error: "upload-failed" });
  }
}

/**
 * Requester side: settle the pending promise for this requestId, if ours.
 * Runs on every client (not GM-gated) - called from the shared dispatcher
 * regardless of who happens to be the active GM.
 */
export function handleUploadResult(payload) {
  const entry = typeof payload?.requestId === "string" ? pending.get(payload.requestId) : null;
  if (!entry) return;
  pending.delete(payload.requestId);
  clearTimeout(entry.timer);
  // The GM-side reply claims a stored path; never trust it blindly - a compromised or
  // forged GM-side reply could otherwise point a requester at an arbitrary path outside
  // the relay's own upload directory. Only accept paths actually rooted under RELAY_UPLOAD_DIR().
  if (typeof payload.path === "string" && payload.path && payload.path.startsWith(`${RELAY_UPLOAD_DIR()}/`)) {
    entry.resolve(payload.path);
  } else if (typeof payload.path === "string" && payload.path) {
    console.warn(`${MODULE_ID} | dropped relay upload result with path outside RELAY_UPLOAD_DIR()`, payload.path);
    entry.reject(new RelayUploadError("mej-campaign-companion | relay upload refused: bad-path"));
  } else {
    entry.reject(new RelayUploadError(`mej-campaign-companion | relay upload refused: ${payload.error ?? "unknown"}`));
  }
}
