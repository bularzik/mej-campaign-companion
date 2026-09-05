import { describe, it, expect } from "vitest";
import { knowledgeSummary } from "../scripts/logic/knowledge-summary.mjs";

// Localizer stub: renders the key's last segment plus the count so both the
// key selection (One vs plural) and the data passed are visible.
const format = (key, data) => `${key.split(".").pop()}:${data.count}`;

describe("knowledgeSummary", () => {
  it("is empty when every count is zero", () => {
    expect(knowledgeSummary({ tags: 0, attributes: 0, backlinks: 0 }, format)).toBe("");
    expect(knowledgeSummary({}, format)).toBe("");
  });
  it("uses the singular key for exactly one", () => {
    expect(knowledgeSummary({ tags: 1, attributes: 0, backlinks: 0 }, format)).toBe("tagsOne:1");
  });
  it("joins non-zero parts in tags, attributes, mentions order with a middle dot", () => {
    expect(knowledgeSummary({ tags: 3, attributes: 1, backlinks: 5 }, format)).toBe("tags:3 · attributesOne:1 · mentions:5");
  });
  it("omits zero parts in the middle", () => {
    expect(knowledgeSummary({ tags: 2, attributes: 0, backlinks: 1 }, format)).toBe("tags:2 · mentionsOne:1");
  });
  it("passes the full i18n key", () => {
    const keys = [];
    knowledgeSummary({ tags: 2 }, (k) => { keys.push(k); return ""; });
    expect(keys).toEqual(["MEJCampaignCompanion.knowledge.summary.tags"]);
  });
});
