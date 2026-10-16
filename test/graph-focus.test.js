import { describe, it, expect } from "vitest";
import { focusTransition, focusPickerRows } from "../scripts/logic/graph-focus.mjs";

describe("focusTransition", () => {
  it("focusing a new node switches to ego mode centred on it", () => {
    expect(focusTransition({ graphMode: "all", graphCenterUuid: null }, "E.1"))
      .toEqual({ graphMode: "ego", graphCenterUuid: "E.1", changed: true });
  });
  it("focusing the node that is already the centre is a no-op (Review Focus 5)", () => {
    expect(focusTransition({ graphMode: "ego", graphCenterUuid: "E.1" }, "E.1"))
      .toEqual({ graphMode: "ego", graphCenterUuid: "E.1", changed: false });
  });
  it("an empty uuid changes nothing", () => {
    expect(focusTransition({ graphMode: "all", graphCenterUuid: null }, "").changed).toBe(false);
  });
});

describe("focusPickerRows", () => {
  it("lists scope nodes sorted by name with the centre marked", () => {
    const nodes = [{ uuid: "E.2", name: "Zed", type: "person" }, { uuid: "E.1", name: "Amy", type: "place" }];
    expect(focusPickerRows(nodes, "E.2")).toEqual([
      { uuid: "E.1", name: "Amy", type: "place", selected: false },
      { uuid: "E.2", name: "Zed", type: "person", selected: true }
    ]);
  });
});
