import { describe, it, expect } from "vitest";
import { linkNoteHtml } from "../scripts/logic/note-text.mjs";
import { mentionsOf } from "../scripts/logic/notes.mjs";

const cands = (...names) => names.map((name, i) => ({ name, uuid: `JournalEntry.e${i}` }));

describe("linkNoteHtml", () => {
  it("links a plain name to @UUID shorthand", () => {
    expect(linkNoteHtml("We met Marla today", cands("Marla"))).toBe("We met @UUID[JournalEntry.e0]{Marla} today");
  });
  it("escapes markup characters", () => {
    expect(linkNoteHtml('a <b> & "c"', [])).toBe("a &lt;b&gt; &amp; &quot;c&quot;");
  });
  it("neutralizes typed enrichers so nothing but auto-added shorthand survives", () => {
    const out = linkNoteHtml("see @UUID[JournalEntry.x]{X} and [[/r 1d20]] and @Embed[JournalEntry.y]", []);
    expect(out).not.toContain("@");
    expect(out).not.toContain("[[");
    expect(mentionsOf(out)).toEqual([]);
  });
  it("a typed enricher does not hide a real mention from linking", () => {
    const out = linkNoteHtml("@UUID[JournalEntry.x]{X} Marla", cands("Marla"));
    expect(mentionsOf(out)).toEqual(["JournalEntry.e0"]);
  });
  it("links names containing an apostrophe", () => {
    expect(linkNoteHtml("Drinks at Zed's Tavern", cands("Zed's Tavern"))).toBe("Drinks at @UUID[JournalEntry.e0]{Zed's Tavern}");
  });
  it("does not link a word inside an escaped entity", () => {
    expect(linkNoteHtml("salt & pepper", cands("amp"))).toBe("salt &amp; pepper");
  });
  it("stray sentinel characters in input are removed", () => {
    expect(linkNoteHtml("xy", [])).toBe("xy");
  });
});
