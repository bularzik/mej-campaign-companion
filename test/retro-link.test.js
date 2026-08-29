import { describe, it, expect } from "vitest";
import { buildRetroPlanBatch, countEntityLinks } from "../scripts/logic/retro-link.mjs";

const ENTITY = { uuid: "JournalEntry.new1", name: "Gandalf", viewerIds: [] };
const page = (uuid, content, extra = {}) => ({
  uuid, name: `page ${uuid}`, content, viewerIds: [], noAutoLink: false,
  entryUuid: `JournalEntry.owner-${uuid}`, ...extra
});
// The single-entity call the batch planner still has to serve: creating one
// entry by hand is the common case, and every scenario below except the last
// two is that case, carried over from when this planner took one entity.
const planOne = (entity, pages, otherSameNamed = []) =>
  buildRetroPlanBatch({
    entities: [entity], pages, otherSameNamed: { [entity.uuid]: otherSameNamed }
  });

describe("countEntityLinks", () => {
  it("counts @UUID occurrences for exactly that uuid", () => {
    const html = "<p>@UUID[JournalEntry.new1]{Gandalf} and @UUID[JournalEntry.other]{X}</p>";
    expect(countEntityLinks(html, "JournalEntry.new1")).toBe(1);
    expect(countEntityLinks(html, "JournalEntry.none")).toBe(0);
  });
});

describe("buildRetroPlanBatch", () => {
  it("links plain mentions in contained pages and counts matches", () => {
    const { rows } = planOne(ENTITY, [page("p1", "<p>Gandalf arrives. Gandalf smokes.</p>")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pageUuid).toBe("p1");
    expect(rows[0].matches).toEqual([
      { entityUuid: ENTITY.uuid, entityName: "Gandalf", count: 2 }
    ]);
    expect(rows[0].ambiguous).toEqual([]);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new1]{Gandalf}");
  });

  it("skips pages without a mention, own pages, noAutoLink pages, and empty content", () => {
    const { rows } = planOne(ENTITY, [
      page("p1", "<p>No mention here.</p>"),
      page("p2", "<p>Gandalf</p>", { entryUuid: ENTITY.uuid }),
      page("p3", "<p>Gandalf</p>", { noAutoLink: true }),
      page("p4", "")
    ]);
    expect(rows).toEqual([]);
  });

  it("enforces containment: a page with a viewer outside the entity's set is skipped", () => {
    const { rows } = planOne({ ...ENTITY, viewerIds: ["a"] }, [
      page("gmOnly", "<p>Gandalf</p>", { viewerIds: [] }),
      page("playerPage", "<p>Gandalf</p>", { viewerIds: ["a", "b"] })
    ]);
    expect(rows.map((r) => r.pageUuid)).toEqual(["gmOnly"]);
  });

  it("marks a page ambiguous (newHtml null) when a same-named entity also passes containment there", () => {
    const { rows } = planOne(
      { ...ENTITY, viewerIds: ["a"] },
      [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      [{ viewerIds: ["a", "b"] }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].matches).toEqual([]);
    expect(rows[0].newHtml).toBeNull();
    expect(rows[0].ambiguous).toEqual([
      { entityUuid: ENTITY.uuid, entityName: "Gandalf", count: 1 }
    ]);
  });

  it("does not mark ambiguous when the same-named twin fails containment for that page", () => {
    const { rows } = planOne(
      { ...ENTITY, viewerIds: ["a"] },
      [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      [{ viewerIds: [] }]
    );
    expect(rows[0].ambiguous).toEqual([]);
    expect(rows[0].newHtml).toContain("@UUID[");
  });

  it("returns no rows for names under the length floor", () => {
    const { rows } = planOne({ ...ENTITY, name: "Ok" }, [page("p1", "<p>Ok then.</p>")]);
    expect(rows).toEqual([]);
  });

  it("never links inside an existing @UUID link", () => {
    const { rows } = planOne(ENTITY, [page("p1", "<p>@UUID[JournalEntry.old]{Gandalf}</p>")]);
    expect(rows).toEqual([]);
  });

  it("never links a GM-only entity (empty viewer set) into a page players can view", () => {
    const { rows } = planOne({ ...ENTITY, viewerIds: [] }, [
      page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })
    ]);
    expect(rows).toEqual([]);
  });

  // The batch behaviour itself (C7).
  const FRODO = { uuid: "JournalEntry.new2", name: "Frodo", viewerIds: [] };

  it("emits ONE row per page carrying every entity that matched it", () => {
    const { rows } = buildRetroPlanBatch({
      entities: [ENTITY, FRODO],
      pages: [page("p1", "<p>Gandalf met Frodo. Gandalf left.</p>")]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].matches).toEqual([
      { entityUuid: ENTITY.uuid, entityName: "Gandalf", count: 2 },
      { entityUuid: FRODO.uuid, entityName: "Frodo", count: 1 }
    ]);
    // One write, carrying both - this is what lets a burst share a plan.
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new1]{Gandalf}");
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new2]{Frodo}");
  });

  it("decides eligibility per entity per page, not per burst", () => {
    const { rows } = buildRetroPlanBatch({
      entities: [{ ...ENTITY, viewerIds: ["a"] }, { ...FRODO, viewerIds: [] }],
      // Visible to player "a": Gandalf (viewers ["a"]) may link here, the
      // GM-only Frodo may not.
      pages: [page("p1", "<p>Gandalf met Frodo.</p>", { viewerIds: ["a"] })]
    });
    expect(rows[0].matches.map((m) => m.entityName)).toEqual(["Gandalf"]);
    expect(rows[0].newHtml).not.toContain("@UUID[JournalEntry.new2]");
  });

  it("keeps one entity's own page linkable for the others in the burst", () => {
    const { rows } = buildRetroPlanBatch({
      entities: [ENTITY, FRODO],
      pages: [page("p1", "<p>Gandalf met Frodo.</p>", { entryUuid: ENTITY.uuid })]
    });
    expect(rows[0].matches.map((m) => m.entityName)).toEqual(["Frodo"]);
  });

  it("writes the unambiguous entities on a page while reporting the ambiguous one", () => {
    const { rows } = buildRetroPlanBatch({
      entities: [ENTITY, FRODO],
      pages: [page("p1", "<p>Gandalf met Frodo.</p>")],
      otherSameNamed: { [FRODO.uuid]: [{ viewerIds: [] }] }
    });
    expect(rows[0].matches.map((m) => m.entityName)).toEqual(["Gandalf"]);
    expect(rows[0].ambiguous.map((m) => m.entityName)).toEqual(["Frodo"]);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new1]");
    expect(rows[0].newHtml).not.toContain("@UUID[JournalEntry.new2]");
  });

  // Overlapping names are the reason batching is more correct than looping:
  // one shared claim array means the longer name wins the words it covers
  // instead of both passes linking the same text independently.
  //
  // BOTH burst orders are asserted deliberately. autoLinkAdded requires its
  // candidates pre-sorted longest-first and they claim words in order, so a
  // test that only passes the already-sorted order passes whether or not the
  // planner sorts - while a burst arriving shortest-first silently links the
  // WRONG entity. Burst order is creation order, which a docx import takes
  // from section order, so shortest-first is not hypothetical.
  const LONG = { uuid: "JournalEntry.long", name: "Elara Moonwhisper", viewerIds: [] };
  const SHORT = { uuid: "JournalEntry.short", name: "Elara", viewerIds: [] };

  for (const [label, entities] of [
    ["longest first", [LONG, SHORT]],
    ["shortest first", [SHORT, LONG]]
  ]) {
    it(`resolves overlapping names against each other in one pass (${label})`, () => {
      const { rows } = buildRetroPlanBatch({
        entities, pages: [page("p1", "<p>Elara Moonwhisper spoke.</p>")]
      });
      expect(rows[0].matches).toEqual([
        { entityUuid: LONG.uuid, entityName: "Elara Moonwhisper", count: 1 }
      ]);
      expect(rows[0].newHtml).toContain("@UUID[JournalEntry.long]{Elara Moonwhisper}");
      expect(rows[0].newHtml).not.toContain("@UUID[JournalEntry.short]");
    });
  }
});
