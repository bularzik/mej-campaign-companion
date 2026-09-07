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
    // playerPage still surfaces as a row (reader "b" can't see the entity),
    // but only under `hidden` - `matches` (what gets written) stays gmOnly-only.
    expect(rows.filter((r) => r.matches.length).map((r) => r.pageUuid)).toEqual(["gmOnly"]);
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

  it("never links a GM-only entity (empty viewer set) into a page players can view - reports it hidden instead", () => {
    const { rows } = planOne({ ...ENTITY, viewerIds: [] }, [
      page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].matches).toEqual([]);
    expect(rows[0].newHtml).toBeNull();
    expect(rows[0].hidden).toEqual([{ entityUuid: ENTITY.uuid, entityName: "Gandalf", count: 1 }]);
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

  it("copies the page's region key onto the row, defaulting to text.content", () => {
    const { rows } = planOne(ENTITY, [
      page("p1", "<p>Gandalf</p>"),
      page("p2", "<p>Gandalf</p>", { key: "system.recap" })
    ]);
    expect(rows.map((r) => [r.pageUuid, r.key])).toEqual([["p1", "text.content"], ["p2", "system.recap"]]);
  });

  it("emits one row per region of the same page (recap and gmNotes share a pageUuid)", () => {
    const { rows } = planOne(ENTITY, [
      page("s1", "<p>Gandalf in recap</p>", { key: "system.recap" }),
      page("s1", "<p>Gandalf in notes</p>", { key: "system.gmNotes", viewerIds: [] })
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.pageUuid === "s1")).toBe(true);
    expect(rows.map((r) => r.key)).toEqual(["system.recap", "system.gmNotes"]);
  });

  it("links only pages in the entity's campaign scope", () => {
    const inA = { ...ENTITY, campaignId: "A" };
    const { rows } = planOne(inA, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pb", "<p>Gandalf</p>", { campaignId: "B" }),
      page("pu", "<p>Gandalf</p>", { campaignId: null })
    ]);
    expect(rows.map((r) => r.pageUuid)).toEqual(["pa", "pu"]);
  });

  it("an unfiled entity links into every campaign", () => {
    const unfiled = { ...ENTITY, campaignId: null };
    const { rows } = planOne(unfiled, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pb", "<p>Gandalf</p>", { campaignId: "B" })
    ]);
    expect(rows.map((r) => r.pageUuid)).toEqual(["pa", "pb"]);
  });

  it("a same-named twin outside the page's scope does not make the name ambiguous", () => {
    const inA = { ...ENTITY, campaignId: "A" };
    const twinInB = { viewerIds: [], campaignId: "B" };
    const { rows } = planOne(inA, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pu", "<p>Gandalf</p>", { campaignId: null })
    ], [twinInB]);
    const byPage = Object.fromEntries(rows.map((r) => [r.pageUuid, r]));
    expect(byPage.pa.matches).toHaveLength(1);
    expect(byPage.pa.ambiguous).toEqual([]);
    // The unfiled page is in reach of both Gandalfs: ambiguous there, as before.
    expect(byPage.pu.matches).toEqual([]);
    expect(byPage.pu.ambiguous).toHaveLength(1);
    expect(byPage.pu.newHtml).toBeNull();
  });

  it("a mixed burst pairs each entity with pages in its own scope", () => {
    const a = { uuid: "JournalEntry.a", name: "Aragorn", viewerIds: [], campaignId: "A" };
    const u = { uuid: "JournalEntry.u", name: "Boromir", viewerIds: [], campaignId: null };
    const { rows } = buildRetroPlanBatch({
      entities: [a, u],
      pages: [page("pb", "<p>Aragorn and Boromir</p>", { campaignId: "B" })]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].matches.map((m) => m.entityUuid)).toEqual(["JournalEntry.u"]);
    expect(rows[0].newHtml).not.toContain("JournalEntry.a");
  });

  it("reports an in-scope entity the page's readers cannot see under `hidden`, unwritten", () => {
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Eldin says hello. Eldin again.</p>", { viewerIds: ["u1"] });
    const { rows } = planOne(gmOnly, [playerPage]);
    expect(rows).toHaveLength(1);
    expect(rows[0].newHtml).toBe(null);
    expect(rows[0].matches).toEqual([]);
    expect(rows[0].hidden).toEqual([{ entityUuid: "JournalEntry.eldin", entityName: "Eldin", count: 2 }]);
  });

  it("does not report a hidden entity that would not have matched anyway", () => {
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Nobody here.</p>", { viewerIds: ["u1"] });
    expect(planOne(gmOnly, [playerPage]).rows).toEqual([]);
  });

  it("gates the hidden bucket on a cheap substring test without producing false positives", () => {
    // First word entirely absent from the content: the substring gate itself
    // rejects it, so soloCount never even runs.
    const absent = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const noMention = page("p1", "<p>Nobody here.</p>", { viewerIds: ["u1"] });
    expect(planOne(absent, [noMention]).rows).toEqual([]);

    // First word appears only inside a longer word ("Eldinor" contains
    // "Eldin"): the substring gate passes it through, but the real
    // tokenizer inside soloCount still rejects the partial match, so the
    // gate must not manufacture a false positive on its own.
    const eldin = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const substringOnly = page("p1", "<p>Eldinor walks.</p>", { viewerIds: ["u1"] });
    expect(planOne(eldin, [substringOnly]).rows).toEqual([]);
  });

  it("keeps writable matches and hidden matches on the same row", () => {
    const visible = { uuid: "JournalEntry.beren", name: "Beren", viewerIds: ["u1"] };
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Beren met Eldin.</p>", { viewerIds: ["u1"] });
    const { rows } = buildRetroPlanBatch({ entities: [visible, gmOnly], pages: [playerPage], otherSameNamed: {} });
    expect(rows).toHaveLength(1);
    expect(rows[0].matches.map((m) => m.entityUuid)).toEqual(["JournalEntry.beren"]);
    expect(rows[0].hidden.map((m) => m.entityUuid)).toEqual(["JournalEntry.eldin"]);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.beren]");
    expect(rows[0].newHtml).not.toContain("@UUID[JournalEntry.eldin]");
  });

  it("an entity out of campaign scope is neither written nor reported hidden", () => {
    const inB = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [], campaignId: "B" };
    const pageA = page("p1", "<p>Eldin.</p>", { viewerIds: ["u1"], campaignId: "A" });
    expect(planOne(inB, [pageA]).rows).toEqual([]);
  });
});
