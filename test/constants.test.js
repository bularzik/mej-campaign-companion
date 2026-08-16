import { describe, it, expect } from "vitest";
import { MODULE_ID, SESSION_TYPE, SOCKET } from "../scripts/constants.mjs";

describe("constants", () => {
  it("socket channel is derived from module id", () => {
    expect(SOCKET).toBe(`module.${MODULE_ID}`);
    expect(MODULE_ID).toBe("mej-campaign-companion");
    expect(SESSION_TYPE).toBe("session");
  });
});
