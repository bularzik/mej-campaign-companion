import { describe, it, expect } from "vitest";
import { parseQuery, matchesMeta, runQuery } from "../scripts/logic/query-grammar.mjs";
import { createIndex, indexRecord } from "../scripts/logic/search-index.mjs";

describe("parseQuery", () => {
  it("splits typed tokens from free text", () => {
    expect(parseQuery("type:person tag:villain attr:faction=Zhentarim red wizard")).toEqual({
      types: ["person"], tags: ["villain"], attrs: [{ key: "faction", value: "Zhentarim" }], text: "red wizard"
    });
  });
  it("supports valueless attr tokens and case-insensitive prefixes", () => {
    expect(parseQuery("Attr:patron TAG:ally")).toEqual({ types: [], tags: ["ally"], attrs: [{ key: "patron", value: null }], text: "" });
  });
  it("throws on empty/whitespace queries", () => {
    expect(() => parseQuery("   ")).toThrow("empty-query");
  });
});

describe("matchesMeta", () => {
  const rec = { type: "person", meta: { tags: ["Villain"], attrs: [
    { key: "faction", value: "Zhentarim", playerHidden: false },
    { key: "patron", value: "Asmodeus", playerHidden: true }
  ] } };
  it("matches type, tag (case-insensitive), and attr key=value substring", () => {
    expect(matchesMeta(rec, parseQuery("type:person tag:villain attr:faction=zhent x"), { gm: false })).toBe(true);
    expect(matchesMeta(rec, parseQuery("type:place x"), { gm: false })).toBe(false);
    expect(matchesMeta(rec, parseQuery("tag:hero x"), { gm: false })).toBe(false);
  });
  it("playerHidden attrs match only for GMs", () => {
    const q = parseQuery("attr:patron x");
    expect(matchesMeta(rec, q, { gm: false })).toBe(false);
    expect(matchesMeta(rec, q, { gm: true })).toBe(true);
  });
});

describe("runQuery", () => {
  const index = createIndex();
  indexRecord(index, { uuid: "u1", name: "Manshoon", type: "person", tags: ["villain"],
    fields: { text: "red wizard rival" }, gmFields: {}, meta: { tags: ["villain"], attrs: [] } });
  indexRecord(index, { uuid: "u2", name: "Elminster", type: "person", tags: [],
    fields: { text: "red robed sage" }, gmFields: {}, meta: { tags: [], attrs: [] } });
  it("intersects full-text results with meta filters", () => {
    const hits = runQuery(index, "tag:villain red", { gm: false });
    expect(hits.map((h) => h.uuid)).toEqual(["u1"]);
    expect(hits[0].matches.length).toBeGreaterThan(0);
  });
  it("meta-only queries return all matching records with empty matches", () => {
    const hits = runQuery(index, "type:person", { gm: false });
    expect(hits.map((h) => h.uuid)).toEqual(["u2", "u1"]); // name-sorted
    expect(hits[0].matches).toEqual([]);
  });
});
