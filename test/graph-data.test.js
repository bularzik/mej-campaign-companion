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
    expect(player.edges).toEqual([{ source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship", label: "", hidden: false }]);
    const gm = buildGraph(rows, [], { mode: "all", isGM: true });
    expect(gm.edges).toHaveLength(2);
  });

  it("backlink overlay adds dashed pairs without duplicating relationship edges", () => {
    const g = buildGraph(rows, [...pairs, { source: "JournalEntry.a", target: "JournalEntry.b", gmOnly: false }], { mode: "all", isGM: false, includeBacklinks: true });
    expect(g.edges).toEqual([
      { source: "JournalEntry.a", target: "JournalEntry.b", kind: "relationship", label: "", hidden: false },
      { source: "JournalEntry.d", target: "JournalEntry.a", kind: "backlink" }
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
    expect(g.edges).toEqual([{ source: "U.a", target: "U.b", kind: "relationship", label: "Nemesis", hidden: true }]);
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

describe("buildGraph player edges (spec 2026-10-09 §6.1)", () => {
  const pc = (to, authorName, fromLabel = "", toLabel = "") => ({ id: `${authorName}-${to}`, to, authorName, fromLabel, toLabel });
  const rowsWith = (aRels = [], aPcs = [], bPcs = []) => [
    { uuid: "J.a", name: "A", type: "person", relationships: aRels, playerConnections: aPcs },
    { uuid: "J.b", name: "B", type: "person", relationships: [], playerConnections: bPcs }
  ];
  it("one player edge per pair, a tooltip line per connection", () => {
    const g = buildGraph(rowsWith([], [pc("J.b", "Dana", "Sister of", "Brother of"), pc("J.b", "Jo", "Rival")]), [], { isGM: false });
    expect(g.edges).toEqual([{ source: "J.a", target: "J.b", kind: "player", label: "", tooltip: "Dana: Sister of / Brother of\nJo: Rival" }]);
  });
  it("connections stored on either end of the same pair collapse into one edge", () => {
    const g = buildGraph(rowsWith([], [pc("J.b", "Dana", "Sister of")], [pc("J.a", "Jo", "Cousin of")]), [], {});
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].tooltip).toBe("Dana: Sister of\nJo: Cousin of");
  });
  it("a GM relationship on the pair wins", () => {
    const g = buildGraph(rowsWith([{ id: "r1", uuid: "J.b", hidden: false, label: "ally" }], [pc("J.b", "Dana", "x")]), [], {});
    expect(g.edges.map((e) => e.kind)).toEqual(["relationship"]);
  });
  it("a GM edge hidden from this player leaves their player edge", () => {
    const g = buildGraph(rowsWith([{ id: "r1", uuid: "J.b", hidden: true, label: "secret" }], [pc("J.b", "Dana", "x")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["player"]);
  });
  it("player edges beat mention links; includePlayer:false drops them and lets the link through", () => {
    const links = [{ source: "J.a", target: "J.b" }];
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana", "x")]), links, { includeBacklinks: true }).edges.map((e) => e.kind)).toEqual(["player"]);
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana", "x")]), links, { includeBacklinks: true, includePlayer: false }).edges.map((e) => e.kind)).toEqual(["backlink"]);
  });
  it("only the author when both labels are empty; a missing endpoint draws nothing", () => {
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana")]), [], {}).edges[0].tooltip).toBe("Dana");
    expect(buildGraph(rowsWith([], [pc("J.zzz", "Dana", "x")]), [], {}).edges).toEqual([]);
  });
});
