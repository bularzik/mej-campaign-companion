import { describe, it, expect } from "vitest";
import { graphRowsFor, combineLabel } from "../scripts/logic/graph-rows.mjs";
import { buildGraph } from "../scripts/logic/graph-data.mjs";

function page(type, relationships = []) {
  return { __type: type, __rels: relationships };
}
function entry(uuid, name, pages, { observable = true } = {}) {
  return { uuid, name, pages: { contents: pages }, __observable: observable };
}
const ctx = (over = {}) => ({
  isGM: false, userId: "u1", groups: [],
  getType: (p) => p.__type,
  canObserve: (e) => e.__observable,
  relRevealsOf: () => ({}),
  relationshipsOf: (p) => p.__rels,
  ...over
});

describe("combineLabel", () => {
  it("joins label and secret, drops null/empty parts", () => {
    expect(combineLabel("ally", "owes a debt")).toBe("ally / owes a debt");
    expect(combineLabel("ally", null)).toBe("ally");
    expect(combineLabel("", null)).toBe("");
  });
});

describe("graphRowsFor", () => {
  it("emits one row per MEJ-typed entry, first typed page wins", () => {
    const rows = graphRowsFor([
      entry("J.a", "A", [page(null), page("person"), page("place")]),
      entry("J.b", "B", [page("quest")])
    ], ctx());
    expect(rows).toEqual([
      { uuid: "J.a", name: "A", type: "person", relationships: [] },
      { uuid: "J.b", name: "B", type: "quest", relationships: [] }
    ]);
  });

  it("skips untyped entries entirely", () => {
    expect(graphRowsFor([entry("J.x", "X", [page(null)])], ctx())).toEqual([]);
  });

  it("gates non-observable entries for players but not for the GM", () => {
    const es = [entry("J.h", "H", [page("person")], { observable: false })];
    expect(graphRowsFor(es, ctx())).toEqual([]);
    expect(graphRowsFor(es, ctx({ isGM: true }))).toHaveLength(1);
  });

  it("maps visible relationship rows with combined labels", () => {
    const rels = [{ id: "r1", uuid: "J.b", hidden: false, relationship: "ally", secret: "owes gold" }];
    const rows = graphRowsFor([entry("J.a", "A", [page("person", rels)])], ctx({ isGM: true }));
    expect(rows[0].relationships).toEqual([
      { id: "r1", uuid: "J.b", hidden: false, revealedToViewer: false, label: "ally / owes gold" }
    ]);
  });

  it("scope is exactly the entries passed in (no world reads)", () => {
    const a = entry("J.a", "A", [page("person", [{ id: "r", uuid: "J.out", hidden: false, relationship: "knows" }])]);
    expect(graphRowsFor([a], ctx()).map((r) => r.uuid)).toEqual(["J.a"]);
  });

  it("buildGraph clips edges whose far end is out of scope (no ghost nodes)", () => {
    const rows = graphRowsFor([
      entry("J.a", "A", [page("person", [{ id: "r", uuid: "J.gone", hidden: false, relationship: "knows" }])]),
      entry("J.b", "B", [page("place")])
    ], ctx({ isGM: true }));
    const g = buildGraph(rows, [], { mode: "all", isGM: true, maxNodes: 200 });
    expect(g.nodes.map((n) => n.uuid).sort()).toEqual(["J.a", "J.b"]);
    expect(g.edges).toHaveLength(0);
  });
});
