import { describe, it, expect } from "vitest";
import { isVisibleToUser, buildIndexSource, filterIndexRows } from "../scripts/logic/hub-index.mjs";

function entry(uuid, name, { limited = true } = {}) {
  return { uuid, name, testUserPermission: () => limited };
}

describe("isVisibleToUser", () => {
  it("is always true for a GM", () => {
    expect(isVisibleToUser(entry("a", "A", { limited: false }), { isGM: true })).toBe(true);
  });

  it("defers to testUserPermission(LIMITED) for a non-GM", () => {
    expect(isVisibleToUser(entry("a", "A", { limited: true }), { isGM: false })).toBe(true);
    expect(isVisibleToUser(entry("a", "A", { limited: false }), { isGM: false })).toBe(false);
  });
});

describe("buildIndexSource", () => {
  const getMEJType = (e) => e.mejType ?? false;
  const getIcon = (type) => `fa-${type}`;

  it("skips entries with no MEJ type", () => {
    const entries = [
      { ...entry("a", "A"), mejType: "person" },
      { ...entry("b", "B"), mejType: false }
    ];
    const rows = buildIndexSource(entries, { isGM: true }, getMEJType, getIcon);
    expect(rows.map((r) => r.uuid)).toEqual(["a"]);
  });

  it("maps each typed entry to {uuid,name,type,icon}", () => {
    const entries = [{ ...entry("a", "Strahd"), mejType: "person" }];
    const rows = buildIndexSource(entries, { isGM: true }, getMEJType, getIcon);
    expect(rows).toEqual([{ uuid: "a", name: "Strahd", type: "person", icon: "fa-person" }]);
  });

  it("hides entries a non-GM lacks LIMITED permission on", () => {
    const entries = [
      { ...entry("a", "Visible", { limited: true }), mejType: "person" },
      { ...entry("b", "Hidden", { limited: false }), mejType: "person" }
    ];
    const rows = buildIndexSource(entries, { isGM: false }, getMEJType, getIcon);
    expect(rows.map((r) => r.uuid)).toEqual(["a"]);
  });

  it("returns [] for no entries", () => {
    expect(buildIndexSource([], { isGM: true }, getMEJType, getIcon)).toEqual([]);
    expect(buildIndexSource(undefined, { isGM: true }, getMEJType, getIcon)).toEqual([]);
  });
});

describe("filterIndexRows", () => {
  const rows = [
    { uuid: "a", name: "Strahd", type: "person", icon: "fa-person" },
    { uuid: "b", name: "Barovia", type: "place", icon: "fa-place" },
    { uuid: "c", name: "Ireena", type: "person", icon: "fa-person" }
  ];
  const labelOf = (t) => (t === "person" ? "Person" : "Place");

  it("returns every row, sorted by name, with no filters", () => {
    const out = filterIndexRows(rows, { types: new Set(), query: "", sort: "name" }, labelOf);
    expect(out.map((r) => r.name)).toEqual(["Barovia", "Ireena", "Strahd"]);
    expect(out[0].typeLabel).toBe("Place");
  });

  it("filters by selected types", () => {
    const out = filterIndexRows(rows, { types: new Set(["place"]), query: "", sort: "name" }, labelOf);
    expect(out.map((r) => r.uuid)).toEqual(["b"]);
  });

  it("filters by case-insensitive substring of name", () => {
    const out = filterIndexRows(rows, { types: new Set(), query: "stra", sort: "name" }, labelOf);
    expect(out.map((r) => r.uuid)).toEqual(["a"]);
  });

  it("sorts by type label, tiebroken by name, when sort is 'type'", () => {
    // typeLabel "Person" < "Place"; within Person, "Ireena" < "Strahd".
    const out = filterIndexRows(rows, { types: new Set(), query: "", sort: "type" }, labelOf);
    expect(out.map((r) => r.uuid)).toEqual(["c", "a", "b"]);
  });

  it("combines type and text filters", () => {
    const out = filterIndexRows(rows, { types: new Set(["person"]), query: "ire", sort: "name" }, labelOf);
    expect(out.map((r) => r.uuid)).toEqual(["c"]);
  });
});
