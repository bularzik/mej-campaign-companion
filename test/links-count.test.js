import { describe, it, expect } from "vitest";
import { linksCount } from "../scripts/logic/links-count.mjs";

describe("linksCount", () => {
  it("sums every group", () => expect(linksCount({ notes: 1, tags: 2, attributes: 0, backlinks: 2 })).toBe(5));
  it("defaults to zero", () => expect(linksCount({})).toBe(0));
});
