// tests/auto-link-candidates.test.js
import { describe, it, expect } from "vitest";
import { selectCandidates } from "../scripts/logic/auto-link-candidates.mjs";

const page = (id, name, extra = {}) =>
  ({ id, uuid: `u:${id}`, name, indexable: true, visible: true, ...extra });

describe("selectCandidates", () => {
  it("excludes self, invisible, non-indexable, and short names; sorts longest-first", () => {
    const pages = [
      page("self", "Frodo"),
      page("a", "Waterdeep Harbor"),
      page("b", "Sam"),
      page("c", "Hidden", { visible: false }),
      page("d", "Raw", { indexable: false }),
      page("e", "Ok") // 2 chars → excluded
    ];
    expect(selectCandidates({ pages, selfId: "self" })).toEqual([
      { name: "Waterdeep Harbor", uuid: "u:a" },
      { name: "Sam", uuid: "u:b" }
    ]);
  });

  it("keeps both entries when names collide (first wins downstream)", () => {
    const pages = [page("a", "Inn"), page("b", "Inn")];
    const out = selectCandidates({ pages, selfId: "x" });
    expect(out).toHaveLength(2);
  });
});

import { dropAmbiguousNames } from "../scripts/logic/auto-link-candidates.mjs";

describe("dropAmbiguousNames", () => {
  it("drops every candidate whose normalized name collides; reports each name once", () => {
    const { kept, ambiguousNames } = dropAmbiguousNames([
      { name: "Waterdeep Harbor", uuid: "u1" },
      { name: "Inn", uuid: "u2" },
      { name: "inn ", uuid: "u3" },
      { name: "Sam", uuid: "u4" }
    ]);
    expect(kept).toEqual([
      { name: "Waterdeep Harbor", uuid: "u1" },
      { name: "Sam", uuid: "u4" }
    ]);
    expect(ambiguousNames).toEqual(["Inn"]);
  });

  it("passes a collision-free list through untouched", () => {
    const list = [{ name: "A1b", uuid: "x" }];
    expect(dropAmbiguousNames(list)).toEqual({ kept: list, ambiguousNames: [] });
  });
});
