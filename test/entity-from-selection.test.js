import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES, qualifySelection, countOccurrences, linkSelectionInSource, validateSelectionRequest
} from "../scripts/logic/entity-from-selection.mjs";

const U = "JournalEntry.abc";

describe("qualifySelection", () => {
  it("trims and accepts 1–80 chars", () => {
    expect(qualifySelection("  Elara  ")).toBe("Elara");
    expect(qualifySelection("a".repeat(80))).toBe("a".repeat(80));
    expect(qualifySelection(` ${"a".repeat(80)} `)).toBe("a".repeat(80));
  });
  it("rejects empty, whitespace, >80, non-strings", () => {
    for (const bad of ["", "   ", "a".repeat(81), null, undefined, 42]) expect(qualifySelection(bad)).toBeNull();
  });
  it("rejects line breaks and enricher-breaking characters", () => {
    for (const bad of ["Elara\nMoon", "Elara\r", "A[b]", "A{b}", "@Elara"]) expect(qualifySelection(bad)).toBeNull();
  });
  it("accepts non-ASCII names and nbsp inside", () => {
    expect(qualifySelection("Ærwen Ó Súilleabháin")).toBe("Ærwen Ó Súilleabháin");
    expect(qualifySelection("Old Tom")).toBe("Old Tom");
  });
});

describe("ENTITY_TYPES", () => {
  it("is the wizard order without session", () => {
    expect(ENTITY_TYPES).toEqual(["journalentry", "person", "place", "organization", "quest",
      "encounter", "event", "poi", "shop", "loot", "list"]);
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping, case-sensitive", () => {
    expect(countOccurrences("Ana Ana ana", "Ana")).toBe(2);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("", "x")).toBe(0);
  });
});

describe("linkSelectionInSource", () => {
  const link = (text, occurrence, total, html) => linkSelectionInSource(html, { text, occurrence, total, uuid: U });

  it("links the 1st, 2nd and Nth occurrence", () => {
    const html = "<p>Elara met Elara.</p><p>Then Elara left.</p>";
    expect(link("Elara", 0, 3, html)).toBe(`<p>@UUID[${U}]{Elara} met Elara.</p><p>Then Elara left.</p>`);
    expect(link("Elara", 1, 3, html)).toBe(`<p>Elara met @UUID[${U}]{Elara}.</p><p>Then Elara left.</p>`);
    expect(link("Elara", 2, 3, html)).toBe(`<p>Elara met Elara.</p><p>Then @UUID[${U}]{Elara} left.</p>`);
  });
  it("skips occurrences inside existing links and code/pre", () => {
    const html = "<p>@UUID[JournalEntry.x]{Elara} <a href='#'>Elara</a> <code>Elara</code> <pre>Elara</pre> Elara</p>";
    expect(link("Elara", 0, 1, html)).toBe(
      `<p>@UUID[JournalEntry.x]{Elara} <a href='#'>Elara</a> <code>Elara</code> <pre>Elara</pre> @UUID[${U}]{Elara}</p>`);
  });
  it("skips occurrences inside inline rolls and other @Enrichers", () => {
    const html = "<p>[[/r 1d6 # Goblin]] @Check[dex]{Goblin} Goblin</p>";
    expect(link("Goblin", 0, 1, html)).toBe(`<p>[[/r 1d6 # Goblin]] @Check[dex]{Goblin} @UUID[${U}]{Goblin}</p>`);
  });
  it("does not count case-different matches", () => {
    expect(link("Elara", 0, 1, "<p>elara Elara</p>")).toBe(`<p>elara @UUID[${U}]{Elara}</p>`);
  });
  it("matches decoded entities and keeps the encoded source as the label", () => {
    expect(link("Tom & Jerry", 0, 1, "<p>Tom &amp; Jerry</p>")).toBe(`<p>@UUID[${U}]{Tom &amp; Jerry}</p>`);
    expect(link('"Quoted"', 0, 1, "<p>&quot;Quoted&quot;</p>")).toBe(`<p>@UUID[${U}]{&quot;Quoted&quot;}</p>`);
    expect(link("Old\u00A0Tom", 0, 1, "<p>Old&nbsp;Tom</p>")).toBe(`<p>@UUID[${U}]{Old&nbsp;Tom}</p>`);
  });
  it("returns null when the total differs (rendered/source mismatch)", () => {
    expect(link("Elara", 0, 2, "<p>Elara</p>")).toBeNull();
  });
  it("returns null for an out-of-range occurrence", () => {
    expect(link("Elara", 1, 1, "<p>Elara</p>")).toBeNull();
  });
  it("returns null for a match spanning markup", () => {
    expect(link("Elara Moon", 0, 0, "<p>Elara <em>Moon</em></p>")).toBeNull();
  });
  it("tolerates empty/non-string source", () => {
    expect(link("Elara", 0, 1, "")).toBeNull();
    expect(link("Elara", 0, 1, undefined)).toBeNull();
  });
  it("handles astral entities correctly (index map alignment)", () => {
    // &#128512; is grinning face emoji (U+1F600), encoded as surrogate pair in UTF-16
    expect(link("BC", 0, 1, "<p>A&#128512;BC</p>")).toBe(`<p>A&#128512;@UUID[${U}]{BC}</p>`);
    // Match after hex astral entity
    expect(link("Xyz", 0, 1, "<p>A&#x1F600;Xyz</p>")).toBe(`<p>A&#x1F600;@UUID[${U}]{Xyz}</p>`);
  });
  it("nbsp decoding distinguishes ASCII space from non-breaking space", () => {
    // ASCII space selection should NOT match nbsp-encoded text
    expect(link("Old Tom", 0, 0, "<p>Old&nbsp;Tom</p>")).toBeNull();
    // nbsp selection should match nbsp-encoded text (need U+00A0 in selection)
    expect(link("Old\u00A0Tom", 0, 1, "<p>Old&nbsp;Tom</p>")).toBe(`<p>@UUID[${U}]{Old&nbsp;Tom}</p>`);
  });
  it("out-of-range numeric entities fall through to raw text instead of throwing", () => {
    expect(() => link("Elara", 0, 1, "<p>&#99999999; Elara</p>")).not.toThrow();
    expect(link("Elara", 0, 1, "<p>&#99999999; Elara</p>")).toBe(`<p>&#99999999; @UUID[${U}]{Elara}</p>`);
    expect(link("Elara", 0, 1, "<p>&#x110000;&#0; Elara</p>")).toBe(`<p>&#x110000;&#0; @UUID[${U}]{Elara}</p>`);
    // The undecoded entity is ordinary text, matchable like any other.
    expect(link("&#99999999;", 0, 1, "<p>&#99999999;</p>")).toBe(`<p>@UUID[${U}]{&#99999999;}</p>`);
  });
});

describe("validateSelectionRequest", () => {
  const good = {
    requestId: "r1", pageUuid: "JournalEntry.a.JournalEntryPage.b", fieldKey: "text.content",
    text: "Elara", occurrence: 0, total: 1, type: "person", name: "Elara", linkOthers: true
  };
  const ctx = { sender: { id: "u1", isGM: false }, isContributor: true, canObserve: true, regionKeys: ["text.content"] };
  const v = (patch = {}, cpatch = {}) => validateSelectionRequest({ ...good, ...patch }, { ...ctx, ...cpatch });

  it("accepts a valid request", () => expect(v()).toEqual({ ok: true }));
  it.each([
    [{ requestId: "" }, {}, "bad-payload"],
    [{ occurrence: -1 }, {}, "bad-payload"],
    [{ occurrence: 1, total: 1 }, {}, "bad-payload"],
    [{ total: 1.5 }, {}, "bad-payload"],
    [{ linkOthers: "yes" }, {}, "bad-payload"],
    [{}, { sender: null }, "bad-sender"],
    [{}, { sender: { id: "gm", isGM: true } }, "bad-sender"],
    [{}, { isContributor: false }, "not-contributor"],
    [{}, { canObserve: false }, "not-visible"],
    [{ fieldKey: "flags.x.notes" }, {}, "bad-field"],
    [{ text: "a".repeat(81) }, {}, "bad-selection"],
    [{ text: " Elara " }, {}, "bad-selection"],
    [{ type: "session" }, {}, "bad-type"],
    [{ name: "   " }, {}, "bad-name"],
    [{ name: "x".repeat(121) }, {}, "bad-name"],
    [{ name: 7 }, {}, "bad-name"]
  ])("rejects %j %j as %s", (patch, cpatch, reason) => {
    expect(v(patch, cpatch)).toEqual({ ok: false, reason });
  });
});
