import { describe, it, expect } from "vitest";
import { segmentRunText, subtitleRuns } from "../scripts/logic/docx-runs.mjs";

describe("segmentRunText", () => {
  it("passes plain text through as one non-breaking segment", () => {
    expect(segmentRunText("hello")).toEqual([{ text: "hello", lineBreak: false }]);
  });
  it("splits on \\n with breaks on every segment after the first", () => {
    expect(segmentRunText("a\nb\nc")).toEqual([
      { text: "a", lineBreak: false },
      { text: "b", lineBreak: true },
      { text: "c", lineBreak: true }
    ]);
  });
  it("drops an empty first segment: '\\n' becomes one empty breaking segment", () => {
    expect(segmentRunText("\n")).toEqual([{ text: "", lineBreak: true }]);
  });
  it("keeps empty middle/trailing segments as break-only segments", () => {
    expect(segmentRunText("a\n\nb")).toEqual([
      { text: "a", lineBreak: false },
      { text: "", lineBreak: true },
      { text: "b", lineBreak: true }
    ]);
  });
});

describe("subtitleRuns", () => {
  it("forces italics on every run of a subtitle paragraph", () => {
    const node = { kind: "paragraph", style: "subtitle", runs: [{ text: "x", bold: true }] };
    expect(subtitleRuns(node)).toEqual([{ text: "x", bold: true, italics: true }]);
  });
  it("returns runs unchanged for non-subtitle paragraphs", () => {
    const node = { kind: "paragraph", runs: [{ text: "x" }] };
    expect(subtitleRuns(node)).toBe(node.runs);
  });
});
