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
  it("still parses plain text and still rejects HTML-wrapped non-commands", () => {
    expect(parseNoteCommand("/note x")).toEqual({ text: "x" });
    expect(parseNoteCommand("<p>hello</p>")).toBeNull();
    expect(parseNoteCommand("<p>/roll 1d20</p>")).toBeNull();
    expect(parseNoteCommand("<p>/note</p>")).toBeNull();
  });
});

describe("chatMessageText", () => {
  it("leaves plain text alone apart from trimming and converts markup to text", () => {
    expect(chatMessageText("  /note a < b  ")).toBe("/note a < b");
    expect(chatMessageText("<p>a<br/>b</p>")).toBe("a\nb");
    expect(chatMessageText("<p><strong>/n</strong> x &#39;y&#x27;</p>")).toBe("/n x 'y'");
    expect(chatMessageText(null)).toBe("");
  });
});
