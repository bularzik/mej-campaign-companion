import { describe, it, expect } from "vitest";
import { buildReverseIndex, reindexSource, removeSource, incomingFor, createReverseIndex } from "../scripts/logic/player-connections.mjs";

const row = (id, to) => ({ id, to, authorId: "u1", authorName: "Dana", sides: { from: { notes: { u1: { label: id } } } } });
const flag = (...rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("reverse index (spec §4.3)", () => {
  it("indexes each connection under its target, from every source", () => {
    const index = buildReverseIndex([
      { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara"), row("c2", "J.bren")) },
      { fromUuid: "J.bren", flag: flag(row("c3", "J.mara")) },
      { fromUuid: "J.empty", flag: undefined }
    ]);
    expect(incomingFor(index, "J.mara").map((e) => [e.fromUuid, e.row.id])).toEqual([["J.ilva", "c1"], ["J.bren", "c3"]]);
    expect(incomingFor(index, "J.bren").map((e) => e.row.from)).toEqual(["J.ilva"]);
    expect(incomingFor(index, "J.nobody")).toEqual([]);
    expect(incomingFor(null, "J.mara")).toEqual([]);
  });
  it("add: reindexing a source picks up a new connection and reports what changed", () => {
    const index = createReverseIndex();
    const affected = reindexSource(index, { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) });
    expect([...affected].sort()).toEqual(["J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toHaveLength(1);
  });
  it("update: a retargeted or removed connection leaves its old target, and both are reported", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) }]);
    const affected = reindexSource(index, { fromUuid: "J.ilva", flag: flag(row("c1", "J.bren")) });
    expect([...affected].sort()).toEqual(["J.bren", "J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toEqual([]);
    expect(incomingFor(index, "J.bren")).toHaveLength(1);
  });
  it("update: other sources' entries for the same target survive", () => {
    const index = buildReverseIndex([
      { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) },
      { fromUuid: "J.bren", flag: flag(row("c3", "J.mara")) }
    ]);
    reindexSource(index, { fromUuid: "J.ilva", flag: {} });
    expect(incomingFor(index, "J.mara").map((e) => e.fromUuid)).toEqual(["J.bren"]);
  });
  it("delete: removing a source drops all its connections and reports its targets", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: flag(row("c1", "J.mara"), row("c2", "J.bren")) }]);
    expect([...removeSource(index, "J.ilva")].sort()).toEqual(["J.bren", "J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toEqual([]);
    expect(index.outbound.has("J.ilva")).toBe(false);
    expect([...removeSource(index, "J.unknown")]).toEqual(["J.unknown"]);
  });
  it("malformed rows never enter the index", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: { bad: { id: "bad" }, c1: row("c1", "J.mara") } }]);
    expect(incomingFor(index, "J.mara")).toHaveLength(1);
  });
});
