import { describe, it, expect } from "vitest";
import {
  buildEncounterActorRows, rowsFromEncounterActors, describeUnlinkedParticipants, buildEncounterName
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
