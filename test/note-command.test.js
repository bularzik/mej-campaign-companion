import { describe, it, expect } from "vitest";
import { parseNoteCommand, chatMessageText } from "../scripts/logic/note-command.mjs";

describe("parseNoteCommand", () => {
  it("accepts /note and /n with text", () => {
    expect(parseNoteCommand("/note the duke is lying")).toEqual({ text: "the duke is lying" });
    expect(parseNoteCommand("/n  trailing  ")).toEqual({ text: "trailing" });
    expect(parseNoteCommand("/NOTE caps")).toEqual({ text: "caps" });
  });
  it("rejects other commands, bare command, and prefixes of longer words", () => {
    expect(parseNoteCommand("/roll 1d20")).toBeNull();
    expect(parseNoteCommand("/note")).toBeNull();
    expect(parseNoteCommand("/notes x")).toBeNull();
    expect(parseNoteCommand("/nothing x")).toBeNull();
    expect(parseNoteCommand("plain text")).toBeNull();
  });
  // Foundry 14's prose-mirror chat input sends serialized HTML to processMessage.
  it("accepts the HTML-wrapped message Foundry 14's chat box sends", () => {
    expect(parseNoteCommand("<p>/note we think X is lying</p>")).toEqual({ text: "we think X is lying" });
    expect(parseNoteCommand("<p>/n a<br>b</p>")).toEqual({ text: "a\nb" });
    expect(parseNoteCommand("<p>/note a</p><p>b</p>")).toEqual({ text: "a\nb" });
    expect(parseNoteCommand("<p>/note Tom &amp; Jerry &lt;3&nbsp;x</p>")).toEqual({ text: "Tom & Jerry <3 x" });
  });
  it("keeps literal tag text in a plain-text note (Foundry 13)", () => {
    expect(parseNoteCommand("/note the <div> tag")).toEqual({ text: "the <div> tag" });
  });
  it("still parses plain text and still rejects HTML-wrapped non-commands", () => {
    expect(parseNoteCommand("/note x")).toEqual({ text: "x" });
    expect(parseNoteCommand("<p>hello</p>")).toBeNull();
    expect(parseNoteCommand("<p>/roll 1d20</p>")).toBeNull();
    expect(parseNoteCommand("<p>/note</p>")).toBeNull();
  });
});

describe("chatMessageText", () => {
  // Foundry 13's textarea sends plain text; a player typing a literal tag-like
  // word must keep it (spec 2026-10-16 §5). Foundry 14's prose-mirror box
  // always wraps the message in a block element, which is the only HTML cue.
  it("treats a message as HTML only when it starts with a block wrapper", () => {
    expect(chatMessageText("/note the <div> tag")).toBe("/note the <div> tag");
    expect(chatMessageText("/note <b>bold</b> stays")).toBe("/note <b>bold</b> stays");
    expect(chatMessageText("  <p>/note a</p>")).toBe("/note a");
    expect(chatMessageText("<div>/note a<br>b</div>")).toBe("/note a\nb");
    expect(chatMessageText("<P>/note caps</P>")).toBe("/note caps");
  });
  it("leaves plain text alone apart from trimming and converts markup to text", () => {
    expect(chatMessageText("  /note a < b  ")).toBe("/note a < b");
    expect(chatMessageText("<p>a<br/>b</p>")).toBe("a\nb");
    expect(chatMessageText("<p><strong>/n</strong> x &#39;y&#x27;</p>")).toBe("/n x 'y'");
    expect(chatMessageText(null)).toBe("");
  });
});
