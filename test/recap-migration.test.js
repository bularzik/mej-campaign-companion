import { describe, it, expect } from "vitest";
import { foldPlayerRecaps } from "../scripts/logic/recap-migration.mjs";

describe("foldPlayerRecaps", () => {
  it("returns the recap unchanged with folded 0 when there are no entries", () => {
    expect(foldPlayerRecaps("<p>gm</p>", [])).toEqual({ recap: "<p>gm</p>", folded: 0 });
    expect(foldPlayerRecaps(undefined, undefined)).toEqual({ recap: "", folded: 0 });
  });
  it("appends one attributed block per non-empty entry, sorted by name", () => {
    const { recap, folded } = foldPlayerRecaps("<p>gm</p>", [
      { name: "Zed", html: "<p>z</p>" },
      { name: "Ann", html: "<p>a</p>" }
    ]);
    expect(folded).toBe(2);
    expect(recap).toBe("<p>gm</p><h3>Recap — Ann</h3><p>a</p><h3>Recap — Zed</h3><p>z</p>");
  });
  it("drops entries that are empty, whitespace-only, tag-only or not strings", () => {
    const { recap, folded } = foldPlayerRecaps("", [
      { name: "A", html: "" },
      { name: "B", html: "<p></p>" },
      { name: "C", html: "<p>&nbsp; </p>" },
      { name: "D", html: null },
      { name: "E", html: "<p>real</p>" }
    ]);
    expect(folded).toBe(1);
    expect(recap).toBe("<h3>Recap — E</h3><p>real</p>");
  });
  it("escapes the player name in the heading", () => {
    const { recap } = foldPlayerRecaps("", [{ name: "<b>x</b> & y", html: "<p>t</p>" }]);
    expect(recap).toBe("<h3>Recap — &lt;b&gt;x&lt;/b&gt; &amp; y</h3><p>t</p>");
  });
});
