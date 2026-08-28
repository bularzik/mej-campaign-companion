import { describe, it, expect } from "vitest";
import {
  buildEncounterActorRows, rowsFromEncounterActors, describeUnlinkedParticipants, buildEncounterName,
  OUTCOME_MARKER, wrapOutcomeHtml, mergeOutcomeHtml
} from "../scripts/logic/encounter-capture.mjs";

describe("buildEncounterActorRows", () => {
  it("keys a bare Actor uuid row by its dot-free document id", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.gob123456789012", name: "Goblin", count: 2, actor: "Actor.gob123456789012" }
    ]);
    expect(Object.keys(rows)).toEqual(["gob123456789012"]);
    expect(rows["gob123456789012"]).toEqual({
      id: "gob123456789012",
      uuid: "Actor.gob123456789012",
      name: "Goblin",
      img: "icons/svg/mystery-man.svg",
      quantity: "2"
    });
  });

  it("keys an unlinked-token synthetic Actor uuid by its trailing (dot-free) actor id", () => {
    const rows = buildEncounterActorRows([
      {
        id: "Scene.scn12345678901234.Token.tok1234567890123.Actor.act1234567890123",
        name: "Skeleton",
        count: 1,
        actor: "Scene.scn12345678901234.Token.tok1234567890123.Actor.act1234567890123"
      }
    ]);
    expect(Object.keys(rows)).toEqual(["act1234567890123"]);
    expect(rows["act1234567890123"].uuid).toBe("Scene.scn12345678901234.Token.tok1234567890123.Actor.act1234567890123");
  });

  it("skips actor-less rows entirely (no safe slot in the actors flag)", () => {
    const rows = buildEncounterActorRows([
      { id: "name:Mook", name: "Mook", count: 3, actor: null }
    ]);
    expect(rows).toEqual({});
  });

  it("keys the object by each row's dot-free actor id, one entry per row", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.aaaaaaaaaaaaaaaa", name: "Aldric", count: 1, actor: "Actor.aaaaaaaaaaaaaaaa" },
      { id: "Actor.bbbbbbbbbbbbbbbb", name: "Thorne", count: 1, actor: "Actor.bbbbbbbbbbbbbbbb" }
    ]);
    expect(Object.keys(rows).sort()).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  it("returns {} for an empty participant list", () => {
    expect(buildEncounterActorRows([])).toEqual({});
  });

  it("returns {} when every row is actor-less", () => {
    expect(buildEncounterActorRows([{ id: "name:A", name: "A", count: 1, actor: null }])).toEqual({});
  });

  it("merges three unlinked-token instances of one base actor into a single row with summed quantity", () => {
    const rows = buildEncounterActorRows([
      { id: "Scene.scn1.Token.tokAAAAAAAAAAAA.Actor.gob123456789012", name: "Goblin", count: 1, actor: "Scene.scn1.Token.tokAAAAAAAAAAAA.Actor.gob123456789012" },
      { id: "Scene.scn1.Token.tokBBBBBBBBBBBB.Actor.gob123456789012", name: "Goblin", count: 1, actor: "Scene.scn1.Token.tokBBBBBBBBBBBB.Actor.gob123456789012" },
      { id: "Scene.scn1.Token.tokCCCCCCCCCCCC.Actor.gob123456789012", name: "Goblin", count: 1, actor: "Scene.scn1.Token.tokCCCCCCCCCCCC.Actor.gob123456789012" }
    ]);
    expect(Object.keys(rows)).toEqual(["gob123456789012"]);
    expect(rows["gob123456789012"].quantity).toBe("3");
    expect(rows["gob123456789012"].name).toBe("Goblin");
  });

  it("merges a linked actor row and an unlinked token of the same base actor, summing counts", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.gob123456789012", name: "Goblin (linked)", count: 1, actor: "Actor.gob123456789012" },
      { id: "Scene.scn1.Token.tokAAAAAAAAAAAA.Actor.gob123456789012", name: "Goblin", count: 2, actor: "Scene.scn1.Token.tokAAAAAAAAAAAA.Actor.gob123456789012" }
    ]);
    expect(Object.keys(rows)).toEqual(["gob123456789012"]);
    expect(rows["gob123456789012"].quantity).toBe("3");
    // First colliding row's identity wins.
    expect(rows["gob123456789012"].name).toBe("Goblin (linked)");
    expect(rows["gob123456789012"].uuid).toBe("Actor.gob123456789012");
  });

  it("leaves rows for distinct actors unaffected by the merge-on-collision logic", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.aaaaaaaaaaaaaaaa", name: "Aldric", count: 1, actor: "Actor.aaaaaaaaaaaaaaaa" },
      { id: "Actor.bbbbbbbbbbbbbbbb", name: "Thorne", count: 1, actor: "Actor.bbbbbbbbbbbbbbbb" }
    ]);
    expect(rows["aaaaaaaaaaaaaaaa"].quantity).toBe("1");
    expect(rows["bbbbbbbbbbbbbbbb"].quantity).toBe("1");
  });
});

describe("rowsFromEncounterActors", () => {
  it("keys merge rows by the resolved actor uuid, not the flag's dot-free storage key", () => {
    const flag = buildEncounterActorRows([{ id: "Actor.gob123456789012", name: "Goblin", count: 2, actor: "Actor.gob123456789012" }]);
    expect(rowsFromEncounterActors(flag)).toEqual([
      { id: "Actor.gob123456789012", name: "Goblin", count: 2, actor: "Actor.gob123456789012" }
    ]);
  });

  it("defaults a missing/non-numeric quantity to 1", () => {
    expect(rowsFromEncounterActors({ x: { name: "Odd", quantity: "not-a-number" } }))
      .toEqual([{ id: "name:Odd", name: "Odd", count: 1, actor: null }]);
  });

  it("falls back to a name-keyed id for a row with no uuid", () => {
    expect(rowsFromEncounterActors({ x: { name: "Mystery", quantity: "1" } }))
      .toEqual([{ id: "name:Mystery", name: "Mystery", count: 1, actor: null }]);
  });

  it("returns [] for null/undefined input", () => {
    expect(rowsFromEncounterActors(undefined)).toEqual([]);
    expect(rowsFromEncounterActors(null)).toEqual([]);
  });

  it("round-trips through buildEncounterActorRows for a merge cycle", () => {
    const original = [{ id: "Actor.gob123456789012", name: "Goblin", count: 2, actor: "Actor.gob123456789012" }];
    const roundTripped = rowsFromEncounterActors(buildEncounterActorRows(original));
    expect(roundTripped).toEqual(original);
  });
});

describe("describeUnlinkedParticipants", () => {
  it("joins actor-less rows with counts, omitting ×1", () => {
    const desc = describeUnlinkedParticipants([
      { id: "name:Mook", name: "Mook", count: 2, actor: null },
      { id: "Actor.a", name: "Aldric", count: 1, actor: "Actor.a" },
      { id: "name:Ghost", name: "Ghost", count: 1, actor: null }
    ]);
    expect(desc).toBe("Mook ×2, Ghost");
  });

  it("returns an empty string when every row has an actor", () => {
    expect(describeUnlinkedParticipants([{ id: "Actor.a", name: "Aldric", count: 1, actor: "Actor.a" }])).toBe("");
  });

  it("returns an empty string for an empty list", () => {
    expect(describeUnlinkedParticipants([])).toBe("");
  });
});

describe("buildEncounterName", () => {
  it("includes the scene name when present", () => {
    expect(buildEncounterName("Goblin Cave", "8/16/2026")).toBe("Encounter: Goblin Cave (8/16/2026)");
  });

  it("omits the scene segment when there is no scene", () => {
    expect(buildEncounterName(null, "8/16/2026")).toBe("Encounter (8/16/2026)");
    expect(buildEncounterName("", "8/16/2026")).toBe("Encounter (8/16/2026)");
  });
});

// C2: mergeEncounter is documented as an additive merge, and the actor
// roster genuinely is merged - but it replaced text.content wholesale with a
// regenerated summary, so a GM who wrote up an encounter lost that prose the
// next time the same combat's end fired (the re-fire path the
// encounterPagesByCombatId map exists to serve). The generated summary now
// lives in its own marked container so everything around it survives.
describe("wrapOutcomeHtml", () => {
  it("wraps generated summary html in the marked container", () => {
    expect(wrapOutcomeHtml("<p>No casualties.</p>"))
      .toBe(`<div data-${OUTCOME_MARKER}="1"><p>No casualties.</p></div>`);
  });
  it("produces nothing for an empty summary", () => {
    expect(wrapOutcomeHtml("")).toBe("");
    expect(wrapOutcomeHtml(null)).toBe("");
  });
});

describe("mergeOutcomeHtml", () => {
  const wrapped = (s) => `<div data-${OUTCOME_MARKER}="1">${s}</div>`;

  it("replaces only the generated block, preserving the GM's prose around it", () => {
    const existing = `<p>The party was ambushed.</p>${wrapped("<p>Old.</p>")}<p>They fled north.</p>`;
    expect(mergeOutcomeHtml(existing, "<p>New.</p>"))
      .toBe(`<p>The party was ambushed.</p>${wrapped("<p>New.</p>")}<p>They fled north.</p>`);
  });

  it("appends the block when the page has none yet (entries predating this fix)", () => {
    expect(mergeOutcomeHtml("<p>Hand-written notes.</p>", "<p>New.</p>"))
      .toBe(`<p>Hand-written notes.</p>${wrapped("<p>New.</p>")}`);
  });

  it("never loses GM prose even when the new summary is empty", () => {
    expect(mergeOutcomeHtml("<p>Hand-written notes.</p>", "")).toBe("<p>Hand-written notes.</p>");
    expect(mergeOutcomeHtml(`<p>Notes.</p>${wrapped("<p>Old.</p>")}`, "")).toBe("<p>Notes.</p>");
  });

  it("handles an empty or missing existing body", () => {
    expect(mergeOutcomeHtml("", "<p>New.</p>")).toBe(wrapped("<p>New.</p>"));
    expect(mergeOutcomeHtml(null, "<p>New.</p>")).toBe(wrapped("<p>New.</p>"));
    expect(mergeOutcomeHtml(undefined, "")).toBe("");
  });

  it("treats $-sequences in the summary as literal text, not replacement patterns", () => {
    // String.replace would expand `$&` into the whole match; the summary is
    // built from actor names, which a GM controls.
    const existing = wrapped("<p>Old.</p>");
    expect(mergeOutcomeHtml(existing, "<p>Cost $5 &amp; $&amp; $` $'</p>"))
      .toBe(wrapped("<p>Cost $5 &amp; $&amp; $` $'</p>"));
  });

  it("is idempotent across repeated merges rather than nesting blocks", () => {
    let html = mergeOutcomeHtml("<p>Notes.</p>", "<p>A.</p>");
    html = mergeOutcomeHtml(html, "<p>B.</p>");
    html = mergeOutcomeHtml(html, "<p>C.</p>");
    expect(html).toBe(`<p>Notes.</p>${wrapped("<p>C.</p>")}`);
  });
});
