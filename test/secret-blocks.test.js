import { describe, it, expect } from "vitest";
import { extractSecretBlocks, stripSecretSections, setSectionRevealed, sectionRevealedAll } from "../scripts/logic/secret-blocks.mjs";

const HTML = [
  "<p>Intro prose.</p>",
  '<section class="secret" id="secret-aaa"><p>The duke is a <b>vampire</b>.</p></section>',
  "<p>Middle.</p>",
  '<section id="secret-bbb" class="secret revealed"><p>Known to all.</p></section>',
  '<section class="secret"><p>No id here.</p></section>',
  '<section class="content-embed"><p>Not a secret.</p></section>'
].join("");

describe("extractSecretBlocks", () => {
  it("finds secret sections with id, preview, revealedAll", () => {
    const blocks = extractSecretBlocks(HTML);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ id: "secret-aaa", preview: "The duke is a vampire.", revealedAll: false });
    expect(blocks[1]).toEqual({ id: "secret-bbb", preview: "Known to all.", revealedAll: true });
    expect(blocks[2].id).toBe("");
  });
  it("ignores non-secret sections and empty input", () => {
    expect(extractSecretBlocks("")).toEqual([]);
    expect(extractSecretBlocks("<section class='content-embed'>x</section>")).toEqual([]);
  });
  it("truncates long previews to 140 chars", () => {
    const long = `<section class="secret" id="s"><p>${"x".repeat(300)}</p></section>`;
    expect(extractSecretBlocks(long)[0].preview).toHaveLength(140);
  });
  it("parses single-quoted class and id attributes", () => {
    const singleQuoted = `<section class='secret' id='secret-sq'><p>Single quoted.</p></section>`;
    const blocks = extractSecretBlocks(singleQuoted);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ id: "secret-sq", preview: "Single quoted.", revealedAll: false });
  });
  it("ignores data-class decoy and finds real class attribute", () => {
    const decoy = `<section data-class="foo" class="secret" id="secret-decoy"><p>Found it.</p></section>`;
    const blocks = extractSecretBlocks(decoy);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("secret-decoy");
  });
  it("ignores data-id decoy and finds real id attribute", () => {
    const decoy = `<section class="secret" data-id="wrong" id="secret-correct"><p>Correct id.</p></section>`;
    const blocks = extractSecretBlocks(decoy);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("secret-correct");
  });
});

describe("stripSecretSections", () => {
  it("removes unrevealed secrets, keeps revealed and normal content", () => {
    const out = stripSecretSections(HTML);
    expect(out).toContain("Intro prose.");
    expect(out).toContain("Known to all.");
    expect(out).toContain("Not a secret.");
    expect(out).not.toContain("vampire");
    expect(out).not.toContain("No id here.");
  });
  it("includeAll passes through untouched", () => {
    expect(stripSecretSections(HTML, { includeAll: true })).toBe(HTML);
  });
  it("strips single-quoted unrevealed secrets", () => {
    const singleQuoted = `<p>Public.</p><section class='secret' id='sq'><p>Hidden.</p></section>`;
    const out = stripSecretSections(singleQuoted);
    expect(out).toContain("Public.");
    expect(out).not.toContain("Hidden.");
  });
  it("strips unrevealed secrets with data-class decoy", () => {
    const decoy = `<p>Safe.</p><section data-class="foo" class="secret"><p>Leak!</p></section>`;
    const out = stripSecretSections(decoy);
    expect(out).toContain("Safe.");
    expect(out).not.toContain("Leak!");
  });
  it("strips unrevealed secrets with data-id decoy", () => {
    const decoy = `<p>OK.</p><section class="secret" data-id="x" id="y"><p>Exposed!</p></section>`;
    const out = stripSecretSections(decoy);
    expect(out).toContain("OK.");
    expect(out).not.toContain("Exposed!");
  });
});

describe("setSectionRevealed", () => {
  const plain = '<p>Intro.</p><section class="secret" id="secret-a">Hidden.</section><p>Outro.</p>';
  const revealed = '<p>Intro.</p><section class="secret revealed" id="secret-a">Hidden.</section><p>Outro.</p>';

  it("adds the revealed class", () => {
    expect(setSectionRevealed(plain, "secret-a", true)).toBe(revealed);
  });

  it("removes the revealed class", () => {
    expect(setSectionRevealed(revealed, "secret-a", false)).toBe(plain);
  });

  it("is idempotent in both directions", () => {
    expect(setSectionRevealed(revealed, "secret-a", true)).toBe(revealed);
    expect(setSectionRevealed(plain, "secret-a", false)).toBe(plain);
  });

  it("leaves other sections alone", () => {
    const two = '<section class="secret" id="secret-a">A</section><section class="secret" id="secret-b">B</section>';
    expect(setSectionRevealed(two, "secret-a", true)).toBe(
      '<section class="secret revealed" id="secret-a">A</section><section class="secret" id="secret-b">B</section>'
    );
  });

  it("preserves other classes and attributes on the section", () => {
    const rich = '<section id="secret-a" class="secret fancy" data-x="1">A</section>';
    expect(setSectionRevealed(rich, "secret-a", true)).toBe(
      '<section id="secret-a" class="secret fancy revealed" data-x="1">A</section>'
    );
  });

  it("handles single-quoted attributes", () => {
    const sq = "<section class='secret' id='secret-a'>A</section>";
    expect(setSectionRevealed(sq, "secret-a", true)).toBe("<section class='secret revealed' id='secret-a'>A</section>");
  });

  it("ignores non-secret sections with a matching id", () => {
    const notSecret = '<section class="note" id="secret-a">A</section>';
    expect(setSectionRevealed(notSecret, "secret-a", true)).toBe(notSecret);
  });

  it("returns the input unchanged for a missing id, empty body, or junk", () => {
    expect(setSectionRevealed(plain, "secret-zzz", true)).toBe(plain);
    expect(setSectionRevealed("", "secret-a", true)).toBe("");
    expect(setSectionRevealed(null, "secret-a", true)).toBe("");
    expect(setSectionRevealed(plain, "", true)).toBe(plain);
    expect(setSectionRevealed(plain, null, true)).toBe(plain);
  });

  it("does not treat $-sequences in the body as replacement patterns", () => {
    const dollars = '<section class="secret" id="secret-a">Cost $5 &amp; $&amp; $` $\'</section>';
    expect(setSectionRevealed(dollars, "secret-a", true)).toBe(
      '<section class="secret revealed" id="secret-a">Cost $5 &amp; $&amp; $` $\'</section>'
    );
  });
});

// The single reader every surface shares (design §4). Both eras count as
// "everyone": the native class written today, and the legacy audience.all
// flag left in worlds written before it - which is never written true again
// but is honoured forever, so an unconvertible record keeps working.
describe("sectionRevealedAll", () => {
  const native = '<section class="secret revealed" id="secret-a">A</section>';
  const plain = '<section class="secret" id="secret-a">A</section>';
  const legacy = { users: [], groups: [], all: true };

  it("is true from the native class alone", () => {
    expect(sectionRevealedAll(native, "secret-a", { users: [], groups: [], all: false })).toBe(true);
    expect(sectionRevealedAll(native, "secret-a", undefined)).toBe(true);
  });

  it("is true from the legacy flag alone", () => {
    expect(sectionRevealedAll(plain, "secret-a", legacy)).toBe(true);
  });

  it("is true when both agree", () => {
    expect(sectionRevealedAll(native, "secret-a", legacy)).toBe(true);
  });

  it("is false when neither says everyone", () => {
    expect(sectionRevealedAll(plain, "secret-a", { users: ["u1"], groups: [], all: false })).toBe(false);
  });

  it("is false for an id that isn't in the body, and ignores OTHER sections' reveal state", () => {
    expect(sectionRevealedAll(native, "secret-zzz", undefined)).toBe(false);
    expect(sectionRevealedAll(native, "secret-zzz", { all: false })).toBe(false);
  });

  it("tolerates an empty or null body", () => {
    expect(sectionRevealedAll("", "secret-a", undefined)).toBe(false);
    expect(sectionRevealedAll(null, "secret-a", undefined)).toBe(false);
    expect(sectionRevealedAll(undefined, "secret-a", legacy)).toBe(true);
  });

  it("only accepts a strictly-true legacy flag, not a truthy one", () => {
    expect(sectionRevealedAll(plain, "secret-a", { all: "yes" })).toBe(false);
    expect(sectionRevealedAll(plain, "secret-a", { all: 1 })).toBe(false);
  });
});
