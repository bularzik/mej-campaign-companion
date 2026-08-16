// Foundry-touching half of the player recap write path (pure decisions live
// in logic/player-recap.mjs). Mirrors monks-enhanced-journal.js's own
// per-user "notes" tab mechanism (EnhancedJournalSheet.js onSubmit's
// `!this.isEditable && flags.monks-enhanced-journal.<uid>` branch, which
// emits "saveUserData"; MonksEnhancedJournal.saveUserData ~line 2934 writes
// it GM-side) - see SessionSheet.mjs's own onSubmit override for where this
// gets invoked from the sheet's form-submit path.
//
// TRUST MODEL (documented honestly, not idealized): Foundry's client-side
// `game.socket.on(SOCKET, handler)` callback receives only the payload the
// emitting client chose to send - there is no server-verified sender id
// available to a receiving client (confirmed against MEJ's own
// `MonksEnhancedJournal.emit()`, which just does
// `args.senderId = game.user.id; game.socket.emit(...)` client-side, and
// `saveUserData`, whose GM-side handler trusts `data.userId` completely
// with no cross-check at all). There is no separate "verified socket userId
// argument" to compare against in Foundry's client socket API - that
// exists only in server-side middleware, which a module cannot reach.
// This handler is intentionally STRICTER than MEJ's own precedent, not just
// a copy of it: it (a) validates `game.users.get(senderId)` resolves to a
// real user in this world (rejects a garbage/forged id outright), (b)
// scopes the write to ONLY `flags.mej-campaign-companion.playerRecaps.<senderId>`
// - a malicious client can therefore, at worst, overwrite another real
// user's recap text with content of the attacker's choosing, never touch
// any other flag/field on the document or on any other document, (c) logs
// every rejection, and (d) round-trips the claimed HTML through
// ProseMirror's own schema before writing it (see sanitizeRecapHtml below) -
// this is the part MEJ's saveUserData has no equivalent of, and matters
// more here than it does there: saveUserData's own per-user notes only ever
// render back to their own author (never shown to anyone else), so a
// malicious payload there could at most attack the sender's own client.
// Our recap is rendered to EVERY OTHER user (including the GM) via
// `{{{recap.enrichedHtml}}}` in session.hbs - an unsanitized relay would let
// any socket-reachable client plant markup (e.g. `<img onerror=...>`) that
// executes in the GM's own client. Sanitizing GM-side, before the write,
// means every reader (including the GM re-rendering their own client)
// only ever sees ProseMirror-schema-clean HTML, never the raw claimed
// payload. That residual "impersonate another user's recap" risk (the
// sender id itself) is NOT eliminated - it can't be, without a server-side
// authority this module doesn't have - only bounded to that one flag path,
// which is the same bound MEJ's own saveUserData accepts for its own
// per-user notes; the content-injection risk, unlike the identity risk,
// IS closed by the sanitization step.
import { MODULE_ID, SOCKET, SAVE_RECAP_ACTION, SESSION_DOCUMENT_TYPE, I18N } from "../constants.mjs";
import { recapPayloadProblem, recapWriteRoute } from "../logic/player-recap.mjs";

/**
 * Round-trip claimed HTML through ProseMirror's own schema
 * (parse -> serialize) before it's ever written to a flag another user's
 * client will render. Drops anything out-of-schema - event handler
 * attributes (onerror=...), <script>, and any other markup ProseMirror's
 * schema doesn't itself model - the same sanitization boundary the
 * prose-mirror editor element enforces for locally-typed content, just
 * applied here to a relayed payload before it's trusted at all. Returns
 * null (caller drops the message) if the input can't be parsed at all.
 */
export function sanitizeRecapHtml(html) {
  try {
    return foundry.prosemirror.dom.serializeString(foundry.prosemirror.dom.parseString(html));
  } catch (error) {
    console.warn(`${MODULE_ID} | dropped player-recap relay - ProseMirror couldn't parse the payload`, error);
    return null;
  }
}

/**
 * Save the current user's own recap on `document` (a Session
 * JournalEntryPage). Writes directly when the user already owns the
 * document (a player-writable session, per the playersWriteSessions
 * setting - see campaign-companion.mjs's preCreateJournalEntry hook);
 * otherwise relays the write to the active GM over the socket, mirroring
 * MEJ's own saveUserData pattern (fire-and-forget, no ack - the eventual
 * document update flows back to this client the normal way, through
 * Foundry's own document sync).
 */
export async function savePlayerRecap(document, html) {
  const route = recapWriteRoute({ isOwner: document.isOwner, hasActiveGM: !!game.users.activeGM });
  const key = `flags.${MODULE_ID}.playerRecaps.${game.user.id}`;
  if (route === "direct") return document.update({ [key]: html });
  if (route === "relay") {
    game.socket.emit(SOCKET, {
      action: SAVE_RECAP_ACTION, senderId: game.user.id, documentUuid: document.uuid, html
    });
    return;
  }
  ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapNoGM`));
}

/**
 * GM side: validate and write. Called from the shared dispatcher
 * (hooks/socket.mjs), already gated there on
 * `game.user === game.users.activeGM`. See this module's header comment
 * for the trust model this validation actually provides.
 */
export async function handleSaveRecapRequest(payload) {
  const problem = recapPayloadProblem(payload);
  if (problem) {
    console.warn(`${MODULE_ID} | dropped malformed player-recap relay (${problem})`, payload);
    return;
  }
  const user = game.users.get(payload.senderId);
  if (!user) {
    console.warn(`${MODULE_ID} | dropped player-recap relay from unknown user id`, payload.senderId);
    return;
  }
  const document = await fromUuid(payload.documentUuid).catch(() => null);
  if (!document) {
    console.warn(`${MODULE_ID} | dropped player-recap relay for missing document`, payload.documentUuid);
    return;
  }
  if (!(document instanceof JournalEntryPage)) {
    console.warn(`${MODULE_ID} | dropped player-recap relay for non-page document`, payload.documentUuid);
    return;
  }
  if (document.type !== SESSION_DOCUMENT_TYPE) {
    console.warn(`${MODULE_ID} | dropped player-recap relay for non-session document`, payload.documentUuid);
    return;
  }
  if (!document.parent?.testUserPermission(user, "OBSERVER")) {
    console.warn(`${MODULE_ID} | dropped player-recap relay - sender lacks OBSERVER on the session`, payload.senderId);
    return;
  }
  const sanitized = sanitizeRecapHtml(payload.html);
  if (sanitized === null) return;
  try {
    await document.update({ [`flags.${MODULE_ID}.playerRecaps.${payload.senderId}`]: sanitized });
  } catch (error) {
    console.error(`${MODULE_ID} | writing relayed player recap failed`, error);
  }
}
