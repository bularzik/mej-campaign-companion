import { describe, it, expect } from "vitest";
import { normalizeRelationships, buildGraph } from "../scripts/logic/graph-data.mjs";

describe("normalizeRelationships", () => {
  it("handles the dict form, the legacy array form, and nullish", () => {
    expect(normalizeRelationships({ r1: { uuid: "JournalEntry.a", hidden: true } }))
      .toEqual([{ id: "r1", uuid: "JournalEntry.a", hidden: true, label: "" }]);
    expect(normalizeRelationships([{ id: "x", uuid: "JournalEntry.b" }]))
      .toEqual([{ id: "x", uuid: "JournalEntry.b", hidden: false, label: "" }]);
    expect(normalizeRelationships(undefined)).toEqual([]);
    expect(normalizeRelationships({ r2: { hidden: false } })).toEqual([]);
  });
});

describe("buildGraph", () => {
  const rows = [
    { uuid: "JournalEntry.a", name: "A", type: "person", relationships: [{ id: "r1", uuid: "JournalEntry.b", hidden: false }, { id: "r2", uuid: "JournalEntry.c", hidden: true }] },
    { uuid: "JournalEntry.b", name: "B", type: "place", relationships: [] },
    { uuid: "JournalEntry.c", name: "C", type: "person", relationships: [] },
    { uuid: "JournalEntry.d", name: "D", type: "quest", relationships: [] }
  ];
  const pairs = [{ source: "JournalEntry.d", target: "JournalEntry.a", gmOnly: false }];

  it("whole-campaign mode: relationship edges, hidden edges GM-only, edges only between present nodes", () => {
    const player = buildGraph(rows, [], { mode: "all", isGM: false });
    expect(player.nodes).toHaveLength(4);
    expect(player.edges).toEqual([{ id: "rel:r1", source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship", label: "", hidden: false }]);
    const gm = buildGraph(rows, [], { mode: "all", isGM: true });
    expect(gm.edges).toHaveLength(2);
  });

  it("backlink overlay adds dashed pairs without duplicating relationship edges", () => {
    const g = buildGraph(rows, [...pairs, { source: "JournalEntry.a", target: "JournalEntry.b", gmOnly: false }], { mode: "all", isGM: false, includeBacklinks: true });
    expect(g.edges).toEqual([
      { id: "rel:r1", source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship", label: "", hidden: false },
      { id: "link:JournalEntry.a|JournalEntry.d", source: "JournalEntry.d", target: "JournalEntry.a", kind: "backlink" }
    ]);
  });

  it("ego mode keeps the center and its direct neighbors only", () => {
    const g = buildGraph(rows, pairs, { mode: "ego", centerUuid: "JournalEntry.a", isGM: false, includeBacklinks: true });
    expect(g.nodes.map((n) => n.uuid).sort()).toEqual(["JournalEntry.a", "JournalEntry.b", "JournalEntry.d"]);
  });

  it("caps nodes deterministically and reports truncation", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ uuid: `JournalEntry.n${i}`, name: `N${i}`, type: "person", relationships: [] }));
    const g = buildGraph(many, [], { mode: "all", isGM: true, maxNodes: 5 });
    expect(g.nodes).toHaveLength(5);
    expect(g.truncated).toBe(true);
  });

  it("copies img onto nodes, null when the row has none, through ego mode and truncation", () => {
    const withImg = rows.map((r) => (r.uuid === "JournalEntry.a" ? { ...r, img: "worlds/x/a.png" } : r));
    const all = buildGraph(withImg, [], { mode: "all", isGM: true });
    expect(all.nodes.find((n) => n.uuid === "JournalEntry.a").img).toBe("worlds/x/a.png");
    expect(all.nodes.find((n) => n.uuid === "JournalEntry.b").img).toBeNull();

    const ego = buildGraph(withImg, pairs, { mode: "ego", centerUuid: "JournalEntry.a", isGM: false, includeBacklinks: true });
    expect(ego.nodes.find((n) => n.uuid === "JournalEntry.a").img).toBe("worlds/x/a.png");

    const many = Array.from({ length: 10 }, (_, i) => ({ uuid: `JournalEntry.n${i}`, name: `N${i}`, type: "person", img: `n${i}.png`, relationships: [] }));
    const capped = buildGraph(many, [], { mode: "all", isGM: true, maxNodes: 5 });
    expect(capped.nodes.every((n) => typeof n.img === "string")).toBe(true);
  });
});

describe("edge labels (Phase C)", () => {
  it("normalizeRelationships carries the label", () => {
    const rows = normalizeRelationships({ a: { id: "a", uuid: "U.a", relationship: "Rival", hidden: false } });
    expect(rows[0].label).toBe("Rival");
  });
  it("buildGraph copies label and hidden onto the edge", () => {
    const rows = [
      { uuid: "U.a", name: "A", type: "person", relationships: [{ id: "r", uuid: "U.b", hidden: true, label: "Nemesis" }] },
      { uuid: "U.b", name: "B", type: "person", relationships: [] }
    ];
    const g = buildGraph(rows, [], { isGM: true });
    expect(g.edges[0].label).toBe("Nemesis");
    expect(g.edges[0].hidden).toBe(true);
  });

  it("a non-GM sees a hidden edge that was row-revealed to them (revealedToViewer: true), still dashed", () => {
    const rows = [
      { uuid: "U.a", name: "A", type: "person", relationships: [{ id: "r", uuid: "U.b", hidden: true, revealedToViewer: true, label: "Nemesis" }] },
      { uuid: "U.b", name: "B", type: "person", relationships: [] }
    ];
    const g = buildGraph(rows, [], { isGM: false });
    expect(g.edges).toEqual([{ id: "rel:r", source: "U.a", target: "U.b", kind: "relationship", label: "Nemesis", hidden: true }]);
  });

  it("a non-GM does NOT see a hidden edge without revealedToViewer", () => {
    const rows = [
      { uuid: "U.a", name: "A", type: "person", relationships: [{ id: "r", uuid: "U.b", hidden: true, label: "Nemesis" }] },
      { uuid: "U.b", name: "B", type: "person", relationships: [] }
    ];
    const g = buildGraph(rows, [], { isGM: false });
    expect(g.edges).toEqual([]);
  });
});

describe("buildGraph party edges (spec 2026-10-10 §5.1)", () => {
  const pl = (other, over = {}) => ({ other, label: "Sister of", otherLabel: "Older sister", editedName: "Jo",
    notebookUuid: "JournalEntry.nb", key: "k1", ...over });
  const rows = (aRels = [], aParty = [], bParty = []) => [
    { uuid: "J.a", name: "A", type: "person", relationships: aRels, partyLines: aParty },
    { uuid: "J.b", name: "B", type: "person", relationships: [], partyLines: bParty }
  ];
  it("one party edge per pair with a stable id and both labels in the tooltip", () => {
    const g = buildGraph(rows([], [pl("J.b")], [pl("J.a", { label: "Older sister", otherLabel: "Sister of" })]), [], { isGM: false });
    expect(g.edges).toEqual([{ id: "party:JournalEntry.nb:k1", source: "J.a", target: "J.b", kind: "party", label: "",
      tooltip: "Sister of / Older sister\nedited by Jo" }]);
  });
  it("a visible GM edge wins", () => {
    const g = buildGraph(rows([{ id: "r1", uuid: "J.b", hidden: false, label: "x" }], [pl("J.b")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["relationship"]);
    expect(g.edges[0].id).toBe("rel:r1");
  });
  it("a GM edge hidden from this player leaves the party edge", () => {
    const g = buildGraph(rows([{ id: "r1", uuid: "J.b", hidden: true, label: "x" }], [pl("J.b")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["party"]);
  });
  it("includeParty false drops party edges as data, not styling", () => {
    const g = buildGraph(rows([], [pl("J.b")]), [], { isGM: false, includeParty: false });
    expect(g.edges).toEqual([]);
  });
  it("editedLabel localizes the tooltip", () => {
    const g = buildGraph(rows([], [pl("J.b")]), [], { editedLabel: (n) => `von ${n}` });
    expect(g.edges[0].tooltip).toBe("Sister of / Older sister\nvon Jo");
  });
});
