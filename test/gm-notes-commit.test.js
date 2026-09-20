import { describe, it, expect } from "vitest";
import { shouldCommitGmNotes } from "../scripts/logic/gm-notes-commit.mjs";

describe("shouldCommitGmNotes", () => {
  it("writes when the live value differs from the stored one", () => {
    expect(shouldCommitGmNotes("<p>new</p>", "<p>old</p>")).toBe(true);
  });

  it("does not write when the live value equals the stored one", () => {
    expect(shouldCommitGmNotes("<p>same</p>", "<p>same</p>")).toBe(false);
  });

  it("treats a missing stored value as empty", () => {
    expect(shouldCommitGmNotes("", undefined)).toBe(false);
    expect(shouldCommitGmNotes("", null)).toBe(false);
    expect(shouldCommitGmNotes("<p>x</p>", undefined)).toBe(true);
  });

  it("never writes a non-string live value (editor missing or not a prose-mirror)", () => {
    expect(shouldCommitGmNotes(undefined, "<p>old</p>")).toBe(false);
    expect(shouldCommitGmNotes(null, "")).toBe(false);
    expect(shouldCommitGmNotes(42, "")).toBe(false);
  });
});
