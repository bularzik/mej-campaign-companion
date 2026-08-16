import { describe, it, expect } from "vitest";
import { buildEncounterActorRows, rowsFromEncounterActors, buildEncounterName } from "../scripts/logic/encounter-capture.mjs";

describe("buildEncounterActorRows", () => {
  it("maps a collapsed actor row into MEJ's actors-flag shape", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" }
    ]);
    expect(rows).toEqual({
      "Actor.gob": { uuid: "Actor.gob", name: "Goblin", img: "icons/svg/mystery-man.svg", quantity: "2" }
    });
  });

  it("stores a nameless-actor row with uuid undefined", () => {
    const rows = buildEncounterActorRows([
      { id: "name:Mook", name: "Mook", count: 3, actor: null }
    ]);
    expect(rows["name:Mook"].uuid).toBeUndefined();
    expect(rows["name:Mook"].quantity).toBe("3");
  });

  it("keys the object by each row's id, one entry per row", () => {
    const rows = buildEncounterActorRows([
      { id: "Actor.a", name: "Aldric", count: 1, actor: "Actor.a" },
      { id: "Actor.b", name: "Thorne", count: 1, actor: "Actor.b" }
    ]);
    expect(Object.keys(rows)).toEqual(["Actor.a", "Actor.b"]);
  });

  it("returns {} for an empty participant list", () => {
    expect(buildEncounterActorRows([])).toEqual({});
  });
});

describe("rowsFromEncounterActors", () => {
  it("inverts buildEncounterActorRows back into collapsed-row shape", () => {
    const flag = buildEncounterActorRows([{ id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" }]);
    expect(rowsFromEncounterActors(flag)).toEqual([
      { id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" }
    ]);
  });

  it("defaults a missing/non-numeric quantity to 1", () => {
    expect(rowsFromEncounterActors({ x: { name: "Odd", quantity: "not-a-number" } }))
      .toEqual([{ id: "x", name: "Odd", count: 1, actor: null }]);
  });

  it("returns [] for null/undefined input", () => {
    expect(rowsFromEncounterActors(undefined)).toEqual([]);
    expect(rowsFromEncounterActors(null)).toEqual([]);
  });

  it("round-trips through buildEncounterActorRows for a merge cycle", () => {
    const original = [{ id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" }];
    const roundTripped = rowsFromEncounterActors(buildEncounterActorRows(original));
    expect(roundTripped).toEqual(original);
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
