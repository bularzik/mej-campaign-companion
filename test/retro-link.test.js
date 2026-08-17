import { describe, it, expect } from "vitest";
import { buildRetroPlan, countEntityLinks } from "../scripts/logic/retro-link.mjs";

const ENTITY = { uuid: "JournalEntry.new1", name: "Gandalf", viewerIds: [] };
const page = (uuid, content, extra = {}) => ({
  uuid, name: `page ${uuid}`, content, viewerIds: [], noAutoLink: false, isOwn: false, ...extra
});

describe("countEntityLinks", () => {
  it("counts @UUID occurrences for exactly that uuid", () => {
    const html = "<p>@UUID[JournalEntry.new1]{Gandalf} and @UUID[JournalEntry.other]{X}</p>";
    expect(countEntityLinks(html, "JournalEntry.new1")).toBe(1);
    expect(countEntityLinks(html, "JournalEntry.none")).toBe(0);
  });
});

describe("buildRetroPlan", () => {
  it("links plain mentions in contained pages and counts matches", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>Gandalf arrives. Gandalf smokes.</p>")],
      otherSameNamed: []
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pageUuid).toBe("p1");
    expect(rows[0].matchCount).toBe(2);
    expect(rows[0].ambiguous).toBe(false);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new1]{Gandalf}");
  });

  it("skips pages without a mention, own pages, noAutoLink pages, and empty content", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [
        page("p1", "<p>No mention here.</p>"),
        page("p2", "<p>Gandalf</p>", { isOwn: true }),
        page("p3", "<p>Gandalf</p>", { noAutoLink: true }),
        page("p4", "")
      ],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });

  it("enforces containment: a page with a viewer outside the entity's set is skipped", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, viewerIds: ["a"] },
      pages: [
        page("gmOnly", "<p>Gandalf</p>", { viewerIds: [] }),
        page("playerPage", "<p>Gandalf</p>", { viewerIds: ["a", "b"] })
      ],
      otherSameNamed: []
    });
    expect(rows.map((r) => r.pageUuid)).toEqual(["gmOnly"]);
  });

  it("marks a page ambiguous (newHtml null) when a same-named entity also passes containment there", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      otherSameNamed: [{ viewerIds: ["a", "b"] }]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].ambiguous).toBe(true);
    expect(rows[0].newHtml).toBeNull();
    expect(rows[0].matchCount).toBe(1);
  });

  it("does not mark ambiguous when the same-named twin fails containment for that page", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, viewerIds: ["a"] },
      pages: [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      otherSameNamed: [{ viewerIds: [] }]
    });
    expect(rows[0].ambiguous).toBe(false);
    expect(rows[0].newHtml).toContain("@UUID[");
  });

  it("returns no rows for names under the length floor", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, name: "Ok" },
      pages: [page("p1", "<p>Ok then.</p>")],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });

  it("never links inside an existing @UUID link", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>@UUID[JournalEntry.old]{Gandalf}</p>")],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });
});
