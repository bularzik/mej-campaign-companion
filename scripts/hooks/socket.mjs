// Single shared socket dispatcher for the whole module: one
// `game.socket.on(SOCKET, handler)` registration, routed by `action`.
// Register once, from the ready hook (campaign-companion.mjs) - the same
// requirement MEJ's own `MonksEnhancedJournal.onMessage` dispatcher meets
// (monks-enhanced-journal.js: `game.socket.on(MonksEnhancedJournal.SOCKET,
// MonksEnhancedJournal.onMessage)`, registered once, routing by
// `data.action`).
//
// GM_ACTIONS lists every action whose handler is a GM-side write: gated on
// the elected single writer (`game.user === game.users.activeGM`), matching
// hooks/auto-capture.mjs's own reasoning for why a plain `game.user.isGM`
// guard is insufficient with more than one GM online. UPLOAD_MEDIA_RESULT_ACTION
// is deliberately absent - it settles the REQUESTER's own pending promise,
// which may be a player's client, not a GM-only action at all.
//
// Observer pattern: each handler runs in its own try/catch (including
// awaited rejections, not just synchronous throws) so one handler's failure
// can never prevent another action's handler, or a later socket message,
// from being processed.
import { SOCKET, UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION, SAVE_RECAP_ACTION } from "../constants.mjs";
import { handleUploadRequest, handleUploadResult } from "./media-relay.mjs";
import { handleSaveRecapRequest } from "./player-recap.mjs";

const HANDLERS = {
  [UPLOAD_MEDIA_ACTION]: handleUploadRequest,
  [UPLOAD_MEDIA_RESULT_ACTION]: handleUploadResult,
  [SAVE_RECAP_ACTION]: handleSaveRecapRequest
};

const GM_ACTIONS = new Set([UPLOAD_MEDIA_ACTION, SAVE_RECAP_ACTION]);

/** Register the module's one socket listener. Call once, from the ready hook. */
export function registerSocketDispatcher() {
  game.socket.on(SOCKET, (payload) => {
    const action = payload?.action;
    const handler = HANDLERS[action];
    if (!handler) return;
    if (GM_ACTIONS.has(action) && game.user !== game.users.activeGM) return;
    (async () => {
      try {
        await handler(payload);
      } catch (error) {
        console.error(`mej-campaign-companion | socket handler for "${action}" failed`, error);
      }
    })();
  });
}
