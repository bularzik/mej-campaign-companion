import { describe, it, expect } from "vitest";
import { noteToPlainText, linkNoteHtml } from "../scripts/logic/note-text.mjs";

describe("noteToPlainText", () => {
  it("replaces @UUID shorthand with its label", () => {
    expect(noteToPlainText("met @UUID[JournalEntry.abc]{Old Bob} today")).toBe("met Old Bob today");
  });
  it("decodes the entities linkNoteHtml writes", () => {
    expect(noteToPlainText("a &amp; b &lt;i&gt; &quot;q&quot; &#x27;s&#x27; &#64;x &#91;&#91;y")).toBe(`a & b <i> "q" 's' @x [[y`);
  });
  it("decodes once: &amp;lt; stays &lt;", () => {
    expect(noteToPlainText("&amp;lt;")).toBe("&lt;");
  });
  it("leaves unknown entities and non-strings alone", () => {
    expect(noteToPlainText("&nope; x")).toBe("&nope; x");
    expect(noteToPlainText(null)).toBe("");
  });
  it("round trip of an unedited note is stable", () => {
    const plain = `Tom & "Jerry" said @here [[x]] <b>`;
    const stored = linkNoteHtml(plain, []);
    expect(noteToPlainText(stored)).toBe(plain);
    expect(linkNoteHtml(noteToPlainText(stored), [])).toBe(stored);
  });
});
