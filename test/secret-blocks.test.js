import { describe, it, expect } from "vitest";
import { extractSecretBlocks, stripSecretSections } from "../scripts/logic/secret-blocks.mjs";

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
