import { describe, it, expect } from "vitest";
import { buildDoctypeFilter } from "../scripts/logic/doctype-filter.mjs";

const TYPES = ["person", "place", "quest", "shop", "session", "journalentry"];
const label = (t) => `L:${t}`;
const icon = (t) => `fa-${t}`;
const ALL = "All types";

describe("buildDoctypeFilter", () => {
  it("lists every provided type, all unchecked, when nothing is selected", () => {
    const vm = buildDoctypeFilter(TYPES, new Set(), label, icon, ALL);
    expect(vm.items.map((i) => i.type)).toEqual(TYPES);
    expect(vm.items.every((i) => i.checked === false)).toBe(true);
    expect(vm.summary).toBe(ALL);
  });

  it("marks selected types checked and carries icon + label", () => {
    const vm = buildDoctypeFilter(TYPES, new Set(["person"]), label, icon, ALL);
    const person = vm.items.find((i) => i.type === "person");
    expect(person.checked).toBe(true);
    expect(person.icon).toBe("fa-person");
    expect(person.label).toBe("L:person");
  });

  it("summarizes a single selection as that type's label", () => {
    const vm = buildDoctypeFilter(TYPES, new Set(["quest"]), label, icon, ALL);
    expect(vm.summary).toBe("L:quest");
  });

  it("summarizes multiple selections as first label + remaining count, in list order", () => {
    // list order is person, place, quest, ...; person is the earliest selected here.
    const vm = buildDoctypeFilter(TYPES, new Set(["quest", "person", "place"]), label, icon, ALL);
    expect(vm.summary).toBe("L:person +2");
  });

  it("treats an all-selected set the same as none: the all-types label", () => {
    const vm = buildDoctypeFilter(TYPES, new Set(TYPES), label, icon, ALL);
    expect(vm.summary).toBe(ALL);
  });

  it("returns an empty item list and the all-types summary for an empty type list", () => {
    const vm = buildDoctypeFilter([], new Set(), label, icon, ALL);
    expect(vm.items).toEqual([]);
    expect(vm.summary).toBe(ALL);
  });
});
