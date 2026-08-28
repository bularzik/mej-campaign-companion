import { describe, it, expect } from "vitest";
import { graphSignature } from "../scripts/logic/graph-signature.mjs";

const graph = () => ({
  nodes: [
    { uuid: "JournalEntry.a", name: "Elara", type: "person", image: "a.png" },
    { uuid: "JournalEntry.b", name: "The Docks", type: "place", image: null }
  ],
  edges: [{ source: "JournalEntry.a", target: "JournalEntry.b", kind: "rel", label: "works at", hidden: false }],
  truncated: false
});

const opts = { centerUuid: "JournalEntry.a", width: 800, height: 540 };

describe("graphSignature", () => {
  it("is stable across calls on equal data", () => {
    expect(graphSignature(graph(), opts)).toBe(graphSignature(graph(), opts));
  });

  it("returns null when there is no graph", () => {
    expect(graphSignature(null, opts)).toBe(null);
    expect(graphSignature(undefined, opts)).toBe(null);
  });

  // Each of these is a change the pane actually renders, so each must force a
  // redraw. The point of the whole-structure stringify is that this list does
  // not have to stay in sync with the node/edge shape by hand.
  it("changes when a node is added or removed", () => {
    const fewer = graph();
    fewer.nodes.pop();
    expect(graphSignature(fewer, opts)).not.toBe(graphSignature(graph(), opts));
  });

  it("changes when a node's rendered fields change", () => {
    for (const [field, value] of [["name", "Elara Moonwhisper"], ["type", "npc"], ["image", "b.png"]]) {
      const changed = graph();
      changed.nodes[0][field] = value;
      expect(graphSignature(changed, opts)).not.toBe(graphSignature(graph(), opts));
    }
  });

  it("changes when an edge's rendered fields change", () => {
    for (const [field, value] of [["label", "owns"], ["hidden", true], ["kind", "backlink"], ["target", "JournalEntry.c"]]) {
      const changed = graph();
      changed.edges[0][field] = value;
      expect(graphSignature(changed, opts)).not.toBe(graphSignature(graph(), opts));
    }
  });

  it("changes when the ego center changes", () => {
    expect(graphSignature(graph(), { ...opts, centerUuid: "JournalEntry.b" }))
      .not.toBe(graphSignature(graph(), opts));
  });

  // The pane falls back to 800x540 when the SVG has no layout box, which is
  // the case while its tab is hidden. If dimensions were not part of the
  // fingerprint, a graph first drawn at that fallback size would be pinned
  // there by this very cache once the tab became visible.
  it("changes when the measured pane size changes", () => {
    expect(graphSignature(graph(), { ...opts, width: 1200 })).not.toBe(graphSignature(graph(), opts));
    expect(graphSignature(graph(), { ...opts, height: 900 })).not.toBe(graphSignature(graph(), opts));
  });

  it("defaults its options so a bare call is still usable", () => {
    expect(graphSignature(graph())).toBe(graphSignature(graph(), { centerUuid: null, width: 0, height: 0 }));
  });
});
