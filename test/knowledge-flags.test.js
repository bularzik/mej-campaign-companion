import { describe, it, expect } from "vitest";
import { getTags, getAttributes, splitAttributeText, normalizeTagInput } from "../scripts/logic/knowledge-flags.mjs";

const FLAGS = "mej-campaign-companion";
const page = (cc) => ({ flags: { [FLAGS]: cc } });

describe("getTags", () => {
  it("returns [] for missing flags", () => {
    expect(getTags({})).toEqual([]);
    expect(getTags(page({}))).toEqual([]);
  });
  it("trims, drops empties, and dedupes case-insensitively keeping first casing", () => {
    expect(getTags(page({ tags: [" Villain ", "", "villain", "ally", 7] }))).toEqual(["Villain", "ally"]);
  });
});

describe("getAttributes", () => {
  it("returns [] for missing flags and drops malformed rows", () => {
    expect(getAttributes({})).toEqual([]);
    const rows = getAttributes(page({ attributes: [
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a2", key: "", value: "x" },
      { id: "a3", key: "secret", value: "yes", playerHidden: true },
      "junk"
    ] }));
    expect(rows).toEqual([
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a3", key: "secret", value: "yes", playerHidden: true }
    ]);
  });
});

describe("splitAttributeText", () => {
  it("routes playerHidden rows to hidden", () => {
    expect(splitAttributeText([
      { id: "a1", key: "faction", value: "Zhentarim", playerHidden: false },
      { id: "a2", key: "patron", value: "Asmodeus", playerHidden: true }
    ])).toEqual({ visible: "faction Zhentarim", hidden: "patron Asmodeus" });
  });
});

describe("normalizeTagInput", () => {
  it("splits on commas, trims, dedupes", () => {
    expect(normalizeTagInput(" a, b ,, a ")).toEqual(["a", "b"]);
  });
});
