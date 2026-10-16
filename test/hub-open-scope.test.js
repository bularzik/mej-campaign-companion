import { describe, it, expect } from "vitest";
import { hubScopeForOpenDocument } from "../scripts/logic/hub-open-scope.mjs";

const campaignIdOf = (doc) => doc?.campaign ?? null;
const isHubPlaceholder = (doc) => doc?.type === "campaign-hub";

describe("hubScopeForOpenDocument (spec item 4, shell control)", () => {
  it("an entry filed in a campaign scopes the Hub to it", () => {
    expect(hubScopeForOpenDocument({ campaign: "c1" }, { campaignIdOf, isHubPlaceholder })).toBe("c1");
  });
  it("an unfiled entry, no document, or the Hub placeholder itself means All", () => {
    expect(hubScopeForOpenDocument({ campaign: null }, { campaignIdOf, isHubPlaceholder })).toBe("");
    expect(hubScopeForOpenDocument(null, { campaignIdOf, isHubPlaceholder })).toBe("");
    expect(hubScopeForOpenDocument({ type: "campaign-hub", campaign: "c1" }, { campaignIdOf, isHubPlaceholder })).toBe("");
  });
});
