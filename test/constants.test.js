import { describe, it, expect } from "vitest";
import {
  MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE, SOCKET,
  PLAYER_CONNECTIONS_FLAG, PLAYER_CONNECTIONS_SETTING, PLAYER_CONNECTION_ACTION, PLAYER_CONNECTION_RESULT_ACTION
} from "../scripts/constants.mjs";

describe("constants", () => {
  it("socket channel is derived from module id", () => {
    expect(SOCKET).toBe(`module.${MODULE_ID}`);
    expect(MODULE_ID).toBe("mej-campaign-companion");
    expect(SESSION_TYPE).toBe("session");
  });
  it("SESSION_DOCUMENT_TYPE is the module-prefixed real page type", () => {
    expect(SESSION_DOCUMENT_TYPE).toBe(`${MODULE_ID}.${SESSION_TYPE}`);
    expect(SESSION_DOCUMENT_TYPE).toBe("mej-campaign-companion.session");
  });
  it("player connections names (spec 2026-10-09)", () => {
    expect(PLAYER_CONNECTIONS_FLAG).toBe("playerConnections");
    expect(PLAYER_CONNECTIONS_SETTING).toBe("playerConnectionsEnabled");
    expect(PLAYER_CONNECTION_ACTION).toBe("player-connection");
    expect(PLAYER_CONNECTION_RESULT_ACTION).toBe("player-connection-result");
  });
});
