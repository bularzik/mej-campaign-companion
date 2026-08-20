import { describe, it, expect } from "vitest";
import { guideUrl } from "../scripts/constants.mjs";

describe("guideUrl", () => {
  it("GMs get the GM guide", () => {
    expect(guideUrl(true)).toBe(
      "https://github.com/bularzik/mej-campaign-companion/blob/main/docs/gm-guide.md"
    );
  });
  it("players get the player guide", () => {
    expect(guideUrl(false)).toBe(
      "https://github.com/bularzik/mej-campaign-companion/blob/main/docs/player-guide.md"
    );
  });
});
