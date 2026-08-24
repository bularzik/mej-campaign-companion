import { describe, it, expect } from "vitest";
import { isVisibleToUser, buildIndexSource, filterIndexRows, nativeRowType } from "../scripts/logic/hub-index.mjs";

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

  it("includes entries with no MEJ type as type 'journal' (spec §2: membership, not typing)", () => {
    const entries = [
      { ...entry("a", "A"), mejType: "person" },
      { ...entry("b", "B"), mejType: false }
    ];
    const rows = buildIndexSource(entries, { isGM: true }, getMEJType, getIcon);
    expect(rows.map((r) => r.uuid)).toEqual(["a", "b"]);
    expect(rows.find((r) => r.uuid === "b").type).toBe("journal");
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

describe("buildIndexSource untyped rows (spec §2)", () => {
  it("includes untyped entries as type 'journal' with a book icon", () => {
    const entries = [
      { uuid: "e1", name: "Typed", testUserPermission: () => true },
      { uuid: "e2", name: "Plain prose", testUserPermission: () => true }
    ];
    const user = { isGM: true };
    const getMEJType = (e) => (e.uuid === "e1" ? "person" : false);
    const rows = buildIndexSource(entries, user, getMEJType, () => "fas fa-user");
    expect(rows).toEqual([
      { uuid: "e1", name: "Typed", type: "person", icon: "fas fa-user" },
      { uuid: "e2", name: "Plain prose", type: "journal", icon: "fas fa-book" }
    ]);
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

describe("nativeRowType", () => {
  const entry = (pageTypes) => ({ pages: { contents: pageTypes.map((type) => ({ type })) } });

  it("maps the first page's native type to a row type", () => {
    expect(nativeRowType(entry(["pdf"]))).toBe("pdf");
    expect(nativeRowType(entry(["video"]))).toBe("video");
    expect(nativeRowType(entry(["image"]))).toBe("image");
  });
  it("falls back to journal for text and unknown page types", () => {
    expect(nativeRowType(entry(["text"]))).toBe("journal");
    expect(nativeRowType(entry(["whatever"]))).toBe("journal");
  });
  it("falls back to journal for an entry with no pages", () => {
    expect(nativeRowType(entry([]))).toBe("journal");
    expect(nativeRowType({})).toBe("journal");
    expect(nativeRowType(null)).toBe("journal");
  });
  it("only considers the FIRST page (single-page convention)", () => {
    expect(nativeRowType(entry(["text", "pdf"]))).toBe("journal");
  });
});

describe("buildIndexSource media rows", () => {
  const user = { isGM: true };
  const mediaEntry = (uuid, name, type) => ({
    uuid, name, testUserPermission: () => true,
    pages: { contents: [{ type }] }
  });

  it("gives untyped pdf/video entries their own row types and icons", () => {
    const rows = buildIndexSource(
      [mediaEntry("J.p", "Rules", "pdf"), mediaEntry("J.v", "Session 3 VOD", "video")],
      user, () => false, () => "fa-unused");
    expect(rows.map((r) => [r.type, r.icon])).toEqual([
      ["pdf", "fas fa-file-pdf"],
      ["video", "fas fa-film"]
    ]);
  });
  it("still lists untyped text entries as journal rows", () => {
    const rows = buildIndexSource([mediaEntry("J.t", "Prose", "text")], user, () => false, () => "fa-unused");
    expect(rows[0].type).toBe("journal");
    expect(rows[0].icon).toBe("fas fa-book");
  });
  it("lets an MEJ type win over the native page type", () => {
    const rows = buildIndexSource([mediaEntry("J.x", "Person", "pdf")], user, () => "person", (t) => `fa-${t}`);
    expect(rows[0].type).toBe("person");
    expect(rows[0].icon).toBe("fa-person");
  });
});
