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
});
