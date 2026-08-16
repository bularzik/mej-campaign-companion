import { describe, it, expect } from "vitest";
import { SORT_KEYS, buildSortMenu } from "../scripts/logic/sort-menu.mjs";

describe("buildSortMenu", () => {
  const labelOf = (k) => `L:${k}`;

  it("lists every sort key with resolved labels", () => {
    const { items } = buildSortMenu("name", labelOf);
    expect(items.map((i) => i.value)).toEqual(SORT_KEYS);
    expect(items.map((i) => i.label)).toEqual(SORT_KEYS.map((k) => `L:${k}`));
  });

  it("marks the current key selected and no other", () => {
    const { items } = buildSortMenu("updated", labelOf);
    expect(items.filter((i) => i.selected).map((i) => i.value)).toEqual(["updated"]);
  });

  it("selects nothing when the current key is unknown", () => {
    const { items } = buildSortMenu("bogus", labelOf);
    expect(items.some((i) => i.selected)).toBe(false);
  });
});
