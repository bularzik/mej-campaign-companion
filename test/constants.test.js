import { describe, it, expect } from "vitest";
import { MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE, SOCKET } from "../scripts/constants.mjs";

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
});
