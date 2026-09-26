import { describe, it, expect } from "vitest";
import { panViewBox } from "../scripts/logic/graph-pan.mjs";

describe("panViewBox", () => {
  it("moves the view opposite to the drag at 1:1 scale", () => {
    expect(panViewBox([0, 0, 800, 600], 10, -20, 800, 600)).toEqual([-10, 20, 800, 600]);
  });
  it("scales the drag by the zoom (viewBox units per pixel)", () => {
    expect(panViewBox([100, 50, 1600, 1200], 10, 10, 800, 600)).toEqual([80, 30, 1600, 1200]);
  });
  it("uses the larger axis scale, matching preserveAspectRatio meet", () => {
    // 800x400 viewBox in an 800x800 box: meet scale is max(1, 0.5) = 1.
    expect(panViewBox([0, 0, 800, 400], 10, 10, 800, 800)).toEqual([-10, -10, 800, 400]);
  });
  it("treats a zero-size box as 1:1", () => {
    expect(panViewBox([0, 0, 800, 600], 5, 5, 0, 0)).toEqual([-5, -5, 800, 600]);
  });
});
