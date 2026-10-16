import { describe, it, expect } from "vitest";
import { parseNoteCommand } from "../scripts/logic/note-command.mjs";

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
});
