import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enrichNoteText, NOTE_ENRICH_OPTIONS } from "../scripts/hooks/note-links.mjs";

describe("enrichNoteText (whole-branch finding 1)", () => {
  let enrichHTML;
  beforeEach(() => {
    enrichHTML = vi.fn(async (html) => html);
    globalThis.foundry = { applications: { ux: { TextEditor: { implementation: { enrichHTML } } } } };
  });
  afterEach(() => { delete globalThis.foundry; });

  it("passes escaped, neutralised input with secrets/rolls/embeds/custom off and documents left on", async () => {
    await enrichNoteText("<b>x</b> &#64;Embed[JournalEntry.g secrets=true] met @UUID[JournalEntry.e1]{Duke}");
    expect(enrichHTML).toHaveBeenCalledTimes(1);
    const [html, options] = enrichHTML.mock.calls[0];
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("@UUID[JournalEntry.e1]{Duke}");
    expect(html).toContain("&#64;&#8288;Embed");
    expect(options).toMatchObject({ secrets: false, rolls: false, embeds: false, custom: false });
    expect(options.documents).not.toBe(false);
  });

  it("caller options cannot switch the disabled enrichers back on", async () => {
    await enrichNoteText("t", { secrets: true, rolls: true, embeds: true, custom: true, relativeTo: "p" });
    const [, options] = enrichHTML.mock.calls[0];
    expect(options).toMatchObject({ secrets: false, rolls: false, embeds: false, custom: false, relativeTo: "p" });
  });

  it("NOTE_ENRICH_OPTIONS disables custom enrichers", () => {
    expect(NOTE_ENRICH_OPTIONS).toEqual({ secrets: false, rolls: false, embeds: false, custom: false });
  });
});
