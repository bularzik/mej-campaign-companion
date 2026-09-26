import { describe, it, expect, vi } from "vitest";
import {
  ENTITY_TYPES, qualifySelection, countOccurrences, linkSelectionInSource, validateSelectionRequest,
  normalizeEntityName, matchingEntities, safeMatches, linkedToastArgs
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

describe("linkSelectionInSource with maskSecrets (non-owner relay path)", () => {
  const link = (text, occurrence, total, html, opts) =>
    linkSelectionInSource(html, { text, occurrence, total, uuid: U }, opts);
  const html = `<p>Elara waits.</p><section class="secret" id="secret-1"><p>Elara is a spy.</p></section><p>Then Elara left.</p>`;

  it("without the option, secret text counts (GM path unchanged)", () => {
    expect(link("Elara", 1, 3, html)).toBe(html.replace("Elara is", `@UUID[${U}]{Elara} is`));
    expect(link("Elara", 0, 2, html)).toBeNull();
  });
  it("masked: secret text is neither counted nor linked", () => {
    const opts = { maskSecrets: true };
    expect(link("Elara", 0, 2, html, opts)).toBe(html.replace("<p>Elara waits", `<p>@UUID[${U}]{Elara} waits`));
    expect(link("Elara", 1, 2, html, opts)).toBe(html.replace("Then Elara", `Then @UUID[${U}]{Elara}`));
    // An inflated client total that would reach into the secret is refused.
    expect(link("Elara", 2, 3, html, opts)).toBeNull();
    expect(link("spy", 0, 1, html, opts)).toBeNull();
  });
  it("masks sections nested inside a secret and resumes after the secret closes", () => {
    const nested = `<section class="secret"><section><p>Elara</p></section><p>Elara</p></section><p>Elara</p>`;
    expect(link("Elara", 0, 1, nested, { maskSecrets: true })).toBe(
      `<section class="secret"><section><p>Elara</p></section><p>Elara</p></section><p>@UUID[${U}]{Elara}</p>`);
    expect(link("Elara", 0, 3, nested, { maskSecrets: true })).toBeNull();
  });
  it("masks a secret nested in a plain section, not the plain section's own text", () => {
    const outer = `<section class="journal"><p>Elara</p><section class='gm secret'><p>Elara</p></section><p>Elara</p></section>`;
    expect(link("Elara", 1, 2, outer, { maskSecrets: true })).toBe(
      `<section class="journal"><p>Elara</p><section class='gm secret'><p>Elara</p></section><p>@UUID[${U}]{Elara}</p></section>`);
  });
  it("keeps index maps aligned when entities precede the match after a secret", () => {
    const s = `<section class="secret"><p>Tom &amp; Jerry</p></section><p>&quot;Tom &amp; Jerry&quot;</p>`;
    expect(link("Tom & Jerry", 0, 1, s, { maskSecrets: true })).toBe(
      `<section class="secret"><p>Tom &amp; Jerry</p></section><p>&quot;@UUID[${U}]{Tom &amp; Jerry}&quot;</p>`);
  });
  it("only the exact 'secret' class counts", () => {
    const notSecret = `<section class="secretive"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, notSecret, { maskSecrets: true })).toBe(
      `<section class="secretive"><p>@UUID[${U}]{Elara}</p></section>`);
  });
});

describe("normalizeEntityName / matchingEntities", () => {
  const C = [
    { name: "Vex", uuid: "A" }, { name: "Old  Mill", uuid: "B" },
    { name: "vex", uuid: "C" }, { name: "Vexa", uuid: "D" }
  ];
  it("normalises: trim, collapse whitespace (incl. nbsp), lower-case", () => {
    expect(normalizeEntityName("  Old   MILL ")).toBe("old mill");
    expect(normalizeEntityName(7)).toBe("");
  });
  it("matches case-insensitively and keeps candidate order", () => {
    expect(matchingEntities("VEX", C)).toEqual([C[0], C[2]]);
  });
  it("collapses inner whitespace on both sides", () => {
    expect(matchingEntities("old mill", C)).toEqual([C[1]]);
  });
  it("no match, empty text, or missing candidates → []", () => {
    expect(matchingEntities("Vexx", C)).toEqual([]);
    expect(matchingEntities("   ", C)).toEqual([]);
    expect(matchingEntities("Vex", null)).toEqual([]);
  });
});

describe("validateSelectionRequest link mode", () => {
  const link = {
    requestId: "r1", pageUuid: "JournalEntry.a.JournalEntryPage.b", fieldKey: "text.content",
    text: "Elara", occurrence: 0, total: 1, entityUuid: "JournalEntry.e"
  };
  const ctx = { sender: { id: "u1", isGM: false }, isContributor: true, canObserve: true, regionKeys: ["text.content"] };
  const v = (patch = {}, cpatch = {}) => validateSelectionRequest({ ...link, ...patch }, { ...ctx, ...cpatch });

  it("accepts without type, name or linkOthers", () => expect(v()).toEqual({ ok: true }));
  it("ignores a bad type/name in link mode", () => expect(v({ type: "session", name: "" })).toEqual({ ok: true }));
  it.each([
    [{ entityUuid: "" }, {}, "bad-payload"],
    [{ entityUuid: 7 }, {}, "bad-payload"],
    [{ entityUuid: null }, {}, "bad-payload"],
    [{ occurrence: 1 }, {}, "bad-payload"],
    [{}, { isContributor: false }, "not-contributor"],
    [{}, { canObserve: false }, "not-visible"],
    [{ fieldKey: "system.gmNotes" }, {}, "bad-field"],
    [{ text: " Elara " }, {}, "bad-selection"]
  ])("rejects %j %j as %s", (patch, cpatch, reason) => {
    expect(v(patch, cpatch)).toEqual({ ok: false, reason });
  });
});

describe("safeMatches", () => {
  it("returns the computed matches", () => {
    expect(safeMatches(() => [{ name: "Vex", uuid: "A" }], () => {})).toEqual([{ name: "Vex", uuid: "A" }]);
  });
  it("a throw in candidate building yields [] (Create stays offered) and is logged", () => {
    const log = vi.fn();
    const err = new Error("bad entry");
    expect(safeMatches(() => { throw err; }, log)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.any(String), err);
  });
});

describe("linkSelectionInSource viewer-aware masking", () => {
  const link = (text, occurrence, total, html, opts) =>
    linkSelectionInSource(html, { text, occurrence, total, uuid: U }, opts);

  it("a secret revealed to everyone (class 'revealed') counts and can be linked", () => {
    const html = `<p>Elara</p><section class="secret revealed" id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 1, 2, html, { maskSecrets: true })).toBe(
      `<p>Elara</p><section class="secret revealed" id="secret-a"><p>@UUID[${U}]{Elara}</p></section>`);
  });
  it("a secret whose id is in visibleSecretIds counts; others stay masked", () => {
    const html = `<p>Elara</p><section class="secret" id="secret-a"><p>Elara</p></section><section class="secret" id="secret-b"><p>Elara</p></section>`;
    const opts = { maskSecrets: true, visibleSecretIds: new Set(["secret-a"]) };
    expect(link("Elara", 0, 2, html, opts)).toBe(html.replace("<p>Elara</p><section", `<p>@UUID[${U}]{Elara}</p><section`));
    expect(link("Elara", 1, 2, html, opts)).toBe(
      html.replace(`id="secret-a"><p>Elara</p>`, `id="secret-a"><p>@UUID[${U}]{Elara}</p>`));
    expect(link("Elara", 2, 3, html, opts)).toBeNull();
  });
  it("accepts an array of ids", () => {
    const html = `<section class="secret" id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBe(
      `<section class="secret" id="secret-a"><p>@UUID[${U}]{Elara}</p></section>`);
  });
  it("a hidden secret nested in a visible one is masked", () => {
    const html = `<section class="secret revealed" id="secret-a"><p>Elara</p><section class="secret" id="secret-b"><p>Elara</p></section></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true })).toBe(
      html.replace(`id="secret-a"><p>Elara</p>`, `id="secret-a"><p>@UUID[${U}]{Elara}</p>`));
  });
  it("a visible secret nested in a hidden one is masked", () => {
    const html = `<section class="secret" id="secret-b"><section class="secret revealed" id="secret-a"><p>Elara</p></section></section><p>Elara</p>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBe(
      html.replace("</section><p>Elara</p>", `</section><p>@UUID[${U}]{Elara}</p>`));
  });
  it("data-id is not id", () => {
    const html = `<section class="secret" data-id="secret-a"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBeNull();
  });
  it("without maskSecrets the visible set is irrelevant (everything counts)", () => {
    const html = `<section class="secret" id="secret-b"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { visibleSecretIds: [] })).toBe(
      `<section class="secret" id="secret-b"><p>@UUID[${U}]{Elara}</p></section>`);
  });
});

describe("linkedToastArgs", () => {
  it("names the type when there is one", () => {
    expect(linkedToastArgs("Person", "Vex")).toEqual(["linked", { type: "Person", name: "Vex" }]);
  });
  it("omits the type instead of leaving a double space", () => {
    expect(linkedToastArgs("", "Vex")).toEqual(["linkedNoType", { name: "Vex" }]);
  });
});

describe("linkSelectionInSource attribute parsing (final review)", () => {
  const link = (text, occurrence, total, html, opts) =>
    linkSelectionInSource(html, { text, occurrence, total, uuid: U }, opts);
  it("an id= inside another attribute's value is not the section id", () => {
    const html = `<section class="secret" title="see id=secret-a" id="secret-z"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBeNull();
  });
  it("data-class does not hide the real class=secret", () => {
    const html = `<section data-class="x" class="secret" id="secret-z"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true })).toBeNull();
  });
  it("a class= inside another attribute's value is not the section class", () => {
    const html = `<section title='class="secret revealed"' class="secret" id="secret-z"><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true })).toBeNull();
  });
  it("unquoted and single-quoted attributes still parse", () => {
    const html = `<section class=secret id='secret-a'><p>Elara</p></section>`;
    expect(link("Elara", 0, 1, html, { maskSecrets: true, visibleSecretIds: ["secret-a"] })).toBe(
      `<section class=secret id='secret-a'><p>@UUID[${U}]{Elara}</p></section>`);
  });
});
