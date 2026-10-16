import { describe, it, expect } from "vitest";
import { mergePrepNotes, planPrepNotesSweep } from "../scripts/logic/prep-notes-merge.mjs";

const H = "Scratch notes";

describe("mergePrepNotes", () => {
  it("appends scratch text under a heading, HTML-escaped and paragraphed", () => {
    const out = mergePrepNotes("<p>Existing</p>", "Line one\n<b>two</b>", H);
    expect(out.changed).toBe(true);
    expect(out.gmNotes).toBe("<p>Existing</p><h3>Scratch notes</h3><p>Line one</p><p>&lt;b&gt;two&lt;/b&gt;</p>");
  });
  it("empty GM notes: no leading content", () => {
    expect(mergePrepNotes("", "x", H).gmNotes).toBe("<h3>Scratch notes</h3><p>x</p>");
    expect(mergePrepNotes(undefined, "x", H).gmNotes).toBe("<h3>Scratch notes</h3><p>x</p>");
  });
  it("blank scratch text changes nothing", () => {
    expect(mergePrepNotes("<p>a</p>", "   \n ", H)).toEqual({ gmNotes: "<p>a</p>", changed: false });
    expect(mergePrepNotes("<p>a</p>", null, H)).toEqual({ gmNotes: "<p>a</p>", changed: false });
  });
});

describe("planPrepNotesSweep", () => {
  const page = (prepNotes, gmNotes = "") => ({
    getFlag: (scope, key) => (scope === "mej-campaign-companion" && key === "prepNotes" ? prepNotes : undefined),
    system: { gmNotes }
  });
  it("plans only pages holding scratch text", () => {
    const a = page("keep me", "<p>g</p>");
    const b = page("");
    const c = page(undefined);
    const plan = planPrepNotesSweep([a, b, c], H);
    expect(plan).toHaveLength(1);
    expect(plan[0].page).toBe(a);
    expect(plan[0].gmNotes).toBe("<p>g</p><h3>Scratch notes</h3><p>keep me</p>");
  });
});
