import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../templates/${f}`, import.meta.url), "utf8");

describe("note link markup (spec 2026-10-19 §4.3, §4.7)", () => {
  for (const file of ["table-talk.hbs", "knowledge-panel.hbs"]) {
    it(`${file} wraps a linked note's text in openNoteLink with kind and target`, () => {
      const tpl = read(file);
      expect(tpl).toMatch(/\{\{#if this\.link\}\}<a class="mej-cc-note-link" data-action="openNoteLink" data-kind="\{\{this\.link\.kind\}\}" data-target="\{\{#if this\.link\.src\}\}\{\{this\.link\.src\}\}\{\{else\}\}\{\{this\.link\.uuid\}\}\{\{\/if\}\}">\{\{\{this\.text\}\}\}<\/a>\{\{else\}\}\{\{\{this\.text\}\}\}\{\{\/if\}\}/);
    });
  }
  it("rail rows begin with the session name as an openNoteSession link, when there is one", () => {
    expect(read("knowledge-panel.hbs")).toMatch(/\{\{#if this\.sessionUuid\}\}<a class="mej-cc-note-session" data-action="openNoteSession" data-uuid="\{\{this\.sessionUuid\}\}">\{\{this\.sessionName\}\}<\/a> · \{\{\/if\}\}\{\{this\.timeLabel\}\}/);
  });
});

describe("Links rail tab (spec 2026-10-19 §4.7)", () => {
  const tpl = read("knowledge-panel.hbs");
  it("is one button with the count label, no summary span and no chevron", () => {
    expect(tpl).toContain('class="mej-cc-knowledge-tab{{#unless linksCount}} empty{{/unless}}"');
    expect(tpl).toContain("{{linksLabel}}");
    expect(tpl).not.toContain("mej-cc-knowledge-summary");
    expect(tpl).not.toContain("mej-cc-knowledge-chevron");
  });
});
