// tests/auto-link.test.js
import { describe, it, expect } from "vitest";
import {
  tokenizeHtml,
  extractWords,
  diffAddedWordFlags,
  autoLinkAdded
} from "../scripts/logic/auto-link.mjs";

describe("tokenizeHtml", () => {
  it("classifies text, tags, anchors, shorthand links and code; round-trips losslessly", () => {
    const html =
      '<p>Met @UUID[JournalEntry.a.JournalEntryPage.b]{Frodo} and ' +
      '<a class="content-link" data-uuid="x">Sam</a> near <code>town</code>.</p>';
    const segs = tokenizeHtml(html);
    expect(segs.map((s) => s.raw).join("")).toBe(html);
    const types = segs.map((s) => s.type);
    expect(types).toContain("text");
    expect(types).toContain("tag");
    expect(types.filter((t) => t === "link")).toHaveLength(2); // shorthand + anchor
    expect(types).toContain("code");
  });

  it("returns a single text segment for plain prose", () => {
    expect(tokenizeHtml("Just words")).toEqual([{ type: "text", raw: "Just words" }]);
  });
});

describe("extractWords", () => {
  it("lists words from text segments only, with segment offsets, skipping links/tags", () => {
    const segs = tokenizeHtml("<p>Met @UUID[x]{Frodo} today</p>");
    const words = extractWords(segs);
    expect(words.map((w) => w.text)).toEqual(["Met", "today"]);
    const met = words[0];
    expect(segs[met.segIndex].raw.slice(met.start, met.end)).toBe("Met");
  });

  it("treats apostrophes and hyphens as intra-word", () => {
    expect(extractWords(tokenizeHtml("Al'Akbar half-elf")).map((w) => w.text))
      .toEqual(["Al'Akbar", "half-elf"]);
  });
});

describe("diffAddedWordFlags", () => {
  it("flags only inserted words", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "then", "frodo", "joined"];
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true, true]);
  });

  it("flags a new occurrence of a word already present elsewhere", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "gandalf", "grinned"];
    // LCS keeps the first three; the 4th 'gandalf' and 'grinned' are added.
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true]);
  });

  it("is case-insensitive when aligning", () => {
    expect(diffAddedWordFlags(["Gandalf"], ["gandalf", "smiled"]))
      .toEqual([false, true]);
  });

  it("flags everything when baseline is empty", () => {
    expect(diffAddedWordFlags([], ["a", "b"])).toEqual([true, true]);
  });
});

const cand = (name, uuid) => ({ name, uuid });
// Longest-first, as the caller guarantees.
const CANDS = [cand("Waterdeep Harbor", "u:wh"), cand("Gandalf", "u:g"),
               cand("Frodo", "u:f"), cand("Waterdeep", "u:w")];

describe("autoLinkAdded", () => {
  it("links a newly added name, preserving typed casing as the label", () => {
    const out = autoLinkAdded("We met.", "We met gandalf.", CANDS);
    expect(out).toBe("We met @UUID[u:g]{gandalf}.");
  });

  it("leaves a baseline mention untouched but links a new occurrence of the same name", () => {
    const out = autoLinkAdded("We met Gandalf.", "We met Gandalf. Gandalf grinned.", CANDS);
    expect(out).toBe("We met Gandalf. @UUID[u:g]{Gandalf} grinned.");
  });

  it("matches whole words only (no 'Frodo' inside 'Frodos')", () => {
    expect(autoLinkAdded("", "Frodos bag", CANDS)).toBe("Frodos bag");
  });

  it("prefers the longest candidate name", () => {
    expect(autoLinkAdded("", "at Waterdeep Harbor now", CANDS))
      .toBe("at @UUID[u:wh]{Waterdeep Harbor} now");
  });

  it("does not link inside an existing link, and is idempotent", () => {
    const linked = "met @UUID[u:g]{Gandalf} today";
    expect(autoLinkAdded("met today", linked, CANDS)).toBe(linked);
  });

  it("links every added occurrence", () => {
    expect(autoLinkAdded("", "Frodo and Frodo", CANDS))
      .toBe("@UUID[u:f]{Frodo} and @UUID[u:f]{Frodo}");
  });

  it("returns input unchanged when there are no candidates", () => {
    expect(autoLinkAdded("", "Gandalf", [])).toBe("Gandalf");
  });

  it("does not match a multi-word name split by non-whitespace (sentence break)", () => {
    // Only the two-word candidate is offered, so the correct result is no link:
    // "Waterdeep" and "Harbor" are separated by ". ", not just whitespace.
    expect(
      autoLinkAdded("", "We reached Waterdeep. Harbor seals were resting.", [
        { name: "Waterdeep Harbor", uuid: "u:wh" }
      ])
    ).toBe("We reached Waterdeep. Harbor seals were resting.");
  });

  it("is truly idempotent: f(f(x)) === f(x)", () => {
    const once = autoLinkAdded("", "met gandalf and Frodo", CANDS);
    expect(autoLinkAdded("", once, CANDS)).toBe(once);
  });
});
