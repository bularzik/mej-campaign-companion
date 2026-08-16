import { describe, it, expect } from "vitest";
import { GM_ACTIONS, isAuthorizedForAction } from "../scripts/hooks/socket.mjs";
import { UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION, SAVE_RECAP_ACTION } from "../scripts/constants.mjs";

// I4: the socket dispatcher's routing decision (which actions require the elected active
// GM) was previously only exercised implicitly, inside registerSocketDispatcher's real
// game.socket.on callback. isAuthorizedForAction is the pure seam that decision was
// extracted into, so it's directly testable without registering a real socket listener.
describe("GM_ACTIONS", () => {
  it("includes SAVE_RECAP_ACTION - player-recap relay writes are GM-side", () => {
    expect(GM_ACTIONS.has(SAVE_RECAP_ACTION)).toBe(true);
  });

  it("includes UPLOAD_MEDIA_ACTION - media relay uploads are GM-side", () => {
    expect(GM_ACTIONS.has(UPLOAD_MEDIA_ACTION)).toBe(true);
  });

  it("excludes UPLOAD_MEDIA_RESULT_ACTION - it settles the requester's own promise, not a GM-only write", () => {
    expect(GM_ACTIONS.has(UPLOAD_MEDIA_RESULT_ACTION)).toBe(false);
  });
});

describe("isAuthorizedForAction", () => {
  it("refuses a GM_ACTIONS action on a non-active-GM client", () => {
    expect(isAuthorizedForAction(SAVE_RECAP_ACTION, false)).toBe(false);
    expect(isAuthorizedForAction(UPLOAD_MEDIA_ACTION, false)).toBe(false);
  });

  it("authorizes a GM_ACTIONS action on the active-GM client", () => {
    expect(isAuthorizedForAction(SAVE_RECAP_ACTION, true)).toBe(true);
    expect(isAuthorizedForAction(UPLOAD_MEDIA_ACTION, true)).toBe(true);
  });

  it("authorizes a non-GM action (UPLOAD_MEDIA_RESULT_ACTION) regardless of active-GM status", () => {
    expect(isAuthorizedForAction(UPLOAD_MEDIA_RESULT_ACTION, false)).toBe(true);
    expect(isAuthorizedForAction(UPLOAD_MEDIA_RESULT_ACTION, true)).toBe(true);
  });

  it("refuses an unknown action outright", () => {
    expect(isAuthorizedForAction("bogus-action", true)).toBe(false);
  });
});
