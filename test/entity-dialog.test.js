// @vitest-environment jsdom
// test/entity-dialog.test.js
import { describe, it, expect } from "vitest";
import { typeOptions, readDialogResult } from "../scripts/apps/entity-from-selection-dialog.mjs";

describe("typeOptions", () => {
  it("lists ENTITY_TYPES in order with MEJ labels and marks the selected one", () => {
    const opts = typeOptions({ person: "MEJ.Person", place: "MEJ.Place" }, "place", (k) => `L:${k}`);
    expect(opts.map((o) => o.value)).toEqual(["journalentry", "person", "place", "organization", "quest",
      "encounter", "event", "poi", "shop", "loot", "list"]);
    expect(opts.find((o) => o.value === "person").label).toBe("L:MEJ.Person");
    expect(opts.find((o) => o.value === "quest").label).toBe("L:quest");
    expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(["place"]);
  });
  it("falls back to person for an unknown remembered type", () => {
    expect(typeOptions({}, "session", (k) => k).find((o) => o.selected).value).toBe("person");
  });
});

describe("readDialogResult", () => {
  it("reads type, trimmed name and checkbox", () => {
    const form = document.createElement("form");
    form.innerHTML = '<select name="type"><option value="place" selected>Place</option></select>' +
      '<input name="name" value="  Elara ">' + '<input type="checkbox" name="linkOthers">';
    expect(readDialogResult(form.elements)).toEqual({ type: "place", name: "Elara", linkOthers: false });
  });
});
