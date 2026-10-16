import { describe, it, expect } from "vitest";
import { recapDraft } from "../scripts/logic/recap-draft.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

describe("recapDraft", () => {
  const formatTime = (ms) => `T${ms}`;
  it("one paragraph per live note in order, author and time bolded, text kept as stored HTML", () => {
    const notes = normalizeNotes({
      b: { text: "second @UUID[JournalEntry.x]{X}", authorId: "u2", authorName: "Kim", at: 2 },
      a: { text: "first", authorId: "u1", authorName: "Jo", at: 1 },
      r: { text: "gone", authorId: "gm", authorName: "GM", at: 3, kind: "reveal", retracted: 4 }
    });
    expect(recapDraft(notes, { formatTime })).toBe(
      "<p><strong>T1 Jo</strong> first</p><p><strong>T2 Kim</strong> second @UUID[JournalEntry.x]{X}</p>"
    );
  });
  it("empty string for no notes", () => expect(recapDraft([], { formatTime })).toBe(""));
  it("escapes an author name", () => {
    const notes = normalizeNotes({ a: { text: "t", authorId: "u", authorName: "<b>", at: 1 } });
    expect(recapDraft(notes, { formatTime })).toBe("<p><strong>T1 &lt;b&gt;</strong> t</p>");
  });
  it("excludes audience-restricted notes (group or users) and keeps public GM-kind notes", () => {
    const notes = normalizeNotes({
      g: { text: "group secret", authorId: "gm", authorName: "GM", at: 1, kind: "reveal", audience: { groups: ["g1"], users: [], all: false } },
      u: { text: "user secret", authorId: "gm", authorName: "GM", at: 2, kind: "reveal", audience: { users: ["p1"], groups: [], all: false } },
      p: { text: "public gm", authorId: "gm", authorName: "GM", at: 3, kind: "gm", audience: null },
      a: { text: "all players", authorId: "gm", authorName: "GM", at: 4, kind: "reveal", audience: { users: [], groups: [], all: true } }
    });
    expect(recapDraft(notes, { formatTime })).toBe(
      "<p><strong>T3 GM</strong> public gm</p><p><strong>T4 GM</strong> all players</p>"
    );
  });
  it("treats a raw note lacking retracted as live, and skips retracted: 5", () => {
    const raw = [
      { text: "live", authorId: "u", authorName: "Jo", at: 1, audience: null },
      { text: "gone", authorId: "u", authorName: "Jo", at: 2, audience: null, retracted: 5 }
    ];
    expect(recapDraft(raw, { formatTime })).toBe("<p><strong>T1 Jo</strong> live</p>");
  });
  it("typed enrichers (entity and raw forms) never reach the persisted draft live; code auto-links do", () => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', commat: "@", lsqb: "[", lbrack: "[" };
    const decode = (html) => html.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) =>
      name ? (named[name.toLowerCase()] ?? m) : String.fromCodePoint(hex ? parseInt(hex, 16) : parseInt(dec, 10)));
    const notes = normalizeNotes({
      a: { text: "&#64;UUID[JournalEntry.gm]", authorId: "u", authorName: "Jo", at: 1 },
      b: { text: "&#64;Embed[JournalEntry.gm.JournalEntryPage.p secrets=true]", authorId: "u", authorName: "Jo", at: 2 },
      c: { text: "@Embed[JournalEntry.gm.JournalEntryPage.p secrets=true]", authorId: "u", authorName: "Jo", at: 3 },
      d: { text: "&#91;&#91;/r 1d20]] and [[/r 1d20]]", authorId: "u", authorName: "Jo", at: 4 },
      e: { text: "met @UUID[JournalEntry.e1]{Duke}", authorId: "u", authorName: "@Embed[JournalEntry.gm]", at: 5 }
    });
    const out = recapDraft(notes, { formatTime });
    const decoded = decode(out);
    expect(out).toContain("@UUID[JournalEntry.e1]{Duke}");
    // The only enricher trigger left in the decoded draft is the code-generated link.
    expect([...decoded.matchAll(/@\w+\[/gi)].map((m) => m.index)).toEqual([decoded.indexOf("@UUID[JournalEntry.e1]")]);
    expect(decoded).not.toMatch(/\[\[/);
  });
  it("end-to-end: a script tag in stored text never reaches the draft as markup", () => {
    const notes = normalizeNotes({ a: { text: "<script>x</script>", authorId: "u", authorName: "Jo", at: 1 } });
    const out = recapDraft(notes, { formatTime });
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
