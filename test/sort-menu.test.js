import { describe, it, expect } from "vitest";
import { SORT_KEYS, buildSortMenu } from "../scripts/logic/sort-menu.mjs";

describe("SORT_KEYS", () => {
  it("does not include 'updated' - no MEJ-side timestamp backs it (Task 7 review)", () => {
    expect(SORT_KEYS).toEqual(["name", "type"]);
    expect(SORT_KEYS).not.toContain("updated");
  });
});

describe("buildSortMenu", () => {
  const labelOf = (k) => `L:${k}`;

  it("lists every sort key with resolved labels", () => {
    const { items } = buildSortMenu("name", labelOf);
    expect(items.map((i) => i.value)).toEqual(SORT_KEYS);
    expect(items.map((i) => i.label)).toEqual(SORT_KEYS.map((k) => `L:${k}`));
  });

  it("marks the current key selected and no other", () => {
    const { items } = buildSortMenu("type", labelOf);
    expect(items.filter((i) => i.selected).map((i) => i.value)).toEqual(["type"]);
  });

  it("selects nothing when the current key is unknown", () => {
    const { items } = buildSortMenu("bogus", labelOf);
    expect(items.some((i) => i.selected)).toBe(false);
  });
});
