import { describe, it, expect } from "vitest";
import { deletePromptKeys, DELETE_KINDS } from "../scripts/apps/confirm-delete.mjs";

describe("deletePromptKeys", () => {
  it("maps every supported kind to its title/body keys", () => {
    for (const kind of DELETE_KINDS) {
      expect(deletePromptKeys(kind)).toEqual({
        title: `MEJCampaignCompanion.confirmDelete.${kind}.title`,
        body: `MEJCampaignCompanion.confirmDelete.${kind}.body`
      });
    }
  });
  it("throws on an unknown kind so a typo cannot silently show the wrong copy", () => {
    expect(() => deletePromptKeys("timeline")).toThrow(/unknown delete kind/);
  });
});
