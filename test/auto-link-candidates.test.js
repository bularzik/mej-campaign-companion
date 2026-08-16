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
