import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { replaceUuidTags, htmlToNodes } from "../scripts/logic/doc-export.mjs";
import { snapshotToDocModel } from "../scripts/logic/doc-export.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("replaceUuidTags", () => {
  it("renders labeled and label-less enrichers as bold text", () => {
    expect(replaceUuidTags("<p>See @UUID[JournalEntry.a.JournalEntryPage.b]{The Duke}.</p>"))
      .toBe("<p>See <strong>The Duke</strong>.</p>");
    expect(replaceUuidTags("<p>@UUID[Actor.abc]</p>")).toBe("<p><strong>abc</strong></p>");
  });
});

describe("htmlToNodes", () => {
  it("converts paragraphs with inline formatting and links", () => {
    const nodes = htmlToNodes(body(
      `<p>Meet <strong>Verity</strong>, an <em>elf</em> — <a href="https://5e.tools">rules</a></p>`));
    expect(nodes).toEqual([{
      kind: "paragraph",
      runs: [
        { text: "Meet " },
        { text: "Verity", bold: true },
        { text: ", an " },
        { text: "elf", italics: true },
        { text: " — " },
        { text: "rules", link: "https://5e.tools" }
      ]
    }]);
  });

  it("converts headings, nested lists, tables, and images", () => {
    const nodes = htmlToNodes(body(`
      <h2>Bastion</h2>
      <ul><li>outer<ul><li>inner</li></ul></li></ul>
      <ol><li>first</li></ol>
      <table><tr><td>Aracusa</td><td><strong>Bedroom</strong></td></tr></table>
      <img src="assets/map.png" alt="Old Map">`));
    expect(nodes[0]).toEqual({ kind: "heading", level: 2, text: "Bastion" });
    expect(nodes[1]).toEqual({
      kind: "list", ordered: false,
      items: [{ runs: [{ text: "outer" }], level: 0 }, { runs: [{ text: "inner" }], level: 1 }]
    });
    expect(nodes[2]).toEqual({ kind: "list", ordered: true, items: [{ runs: [{ text: "first" }], level: 0 }] });
    expect(nodes[3]).toEqual({
      kind: "table",
      rows: [[[{ text: "Aracusa" }], [{ text: "Bedroom", bold: true }]]]
    });
    expect(nodes[4]).toEqual({ kind: "image", src: "assets/map.png", caption: "Old Map" });
  });

  it("emits a paragraph's text first, then all its images in order", () => {
    const nodes = htmlToNodes(body(
      `<p><img src="a.png" alt="A">Text between<img src="b.png" alt="B"></p>`));
    expect(nodes).toEqual([
      { kind: "paragraph", runs: [{ text: "Text between" }] },
      { kind: "image", src: "a.png", caption: "A" },
      { kind: "image", src: "b.png", caption: "B" }
    ]);
  });

  it("maps underline and strike inline tags", () => {
    const nodes = htmlToNodes(body(`<p><u>under</u> and <s>gone</s> and <del>also</del></p>`));
    expect(nodes[0].runs).toEqual([
      { text: "under", underline: true },
      { text: " and " },
      { text: "gone", strike: true },
      { text: " and " },
      { text: "also", strike: true }
    ]);
  });

  it("flattens mixed nested lists under the outer list's ordered flag", () => {
    const nodes = htmlToNodes(body(`<ul><li>outer<ol><li>step</li></ol></li></ul>`));
    expect(nodes).toEqual([{
      kind: "list", ordered: false,
      items: [{ runs: [{ text: "outer" }], level: 0 }, { runs: [{ text: "step" }], level: 1 }]
    }]);
  });

  it("renders <br> as a newline run", () => {
    const nodes = htmlToNodes(body(`<p>line one<br>line two</p>`));
    expect(nodes[0].runs).toEqual([
      { text: "line one" }, { text: "\n" }, { text: "line two" }
    ]);
  });

  it("skips empty paragraphs and unwraps blockquotes/divs", () => {
    const nodes = htmlToNodes(body(`<p>  </p><blockquote><p>quoted</p></blockquote>`));
    expect(nodes).toEqual([{ kind: "paragraph", runs: [{ text: "quoted", italics: true }] }]);
  });
});

const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;
const i18n = (key) => key.split(".").pop(); // "…Status.alive" -> "alive"
const opts = (over = {}) => ({ includeGM: false, parse, i18n, ...over });

const rec = (over = {}) => ({
  name: "Verity", kind: "npc", hidden: false,
  system: { role: "Captain", location: "", race: "", gender: "", profession: "",
    voice: "", faction: "", status: "alive", tags: [], gmNotes: "" },
  html: "<p>A stern captain.</p>", ...over
});

describe("snapshotToDocModel", () => {
  it("renders a group with timeline, record heading, marker, fields, and body", () => {
    const nodes = snapshotToDocModel({
      name: "My Campaign",
      timeline: [{ label: "Session 1", items: ["Verity"] }],
      records: [rec()]
    }, opts());
    const texts = nodes.map((n) => n.text ?? n.runs?.map((r) => r.text).join("") ?? n.kind);
    expect(nodes[0]).toEqual({ kind: "heading", level: 1, text: "My Campaign" });
    expect(texts).toContain("Timeline");
    expect(texts).toContain("Session 1");
    expect(nodes.find((n) => n.style === "subtitle").runs[0].text).toBe("Campaign Record type: npc");
    expect(texts).toContain("Role: Captain");
    expect(texts).toContain("Status: alive");
    expect(texts).toContain("A stern captain.");
  });

  it("strips hidden records, gmNotes, and gmOnly objectives without includeGM", () => {
    const quest = rec({
      name: "Find the Rattle", kind: "quest",
      system: {
        source: "", status: "active", rewards: "",
        objectives: [
          { id: "a", text: "Ask around", done: true, gmOnly: false },
          { id: "b", text: "Secret twist", done: false, gmOnly: true }
        ],
        tags: [], gmNotes: "<p>the duke did it</p>"
      }
    });
    const hiddenRec = rec({ name: "Hidden NPC", hidden: true });

    const player = snapshotToDocModel({ name: "G", timeline: null, records: [quest, hiddenRec] }, opts());
    const playerText = JSON.stringify(player);
    expect(playerText).not.toContain("Hidden NPC");
    expect(playerText).not.toContain("Secret twist");
    expect(playerText).not.toContain("the duke did it");
    expect(playerText).toContain("[x] Ask around");

    const gm = snapshotToDocModel({ name: "G", timeline: null, records: [quest, hiddenRec] },
      opts({ includeGM: true }));
    const gmText = JSON.stringify(gm);
    expect(gmText).toContain("Hidden NPC");
    expect(gmText).toContain("Secret twist");
    expect(gmText).toContain("the duke did it");
  });

  it("renders shop inventory and loot currency", () => {
    const nodes = snapshotToDocModel({
      name: "G", timeline: null,
      records: [
        rec({ name: "Emporium", kind: "shop", system: {
          shopType: "", location: "", owner: "Gander",
          inventory: [{ id: "i1", name: "Rope", price: "1 gp", quantity: 2, item: null }],
          tags: [], gmNotes: ""
        } }),
        rec({ name: "Haul", kind: "loot", system: {
          currency: { cp: 0, sp: 3, ep: 0, gp: 12, pp: 0 },
          items: [{ id: "l1", name: "Helm", quantity: 1, item: null }],
          source: null, distribution: "", tags: [], gmNotes: ""
        } })
      ]
    }, opts());
    const table = nodes.find((n) => n.kind === "table");
    expect(table.rows[1][0][0].text).toBe("Rope");
    expect(JSON.stringify(nodes)).toContain("12 gp, 3 sp");
  });

  it("renders a single text page body", () => {
    const nodes = snapshotToDocModel({
      name: "G", timeline: null,
      records: [{ name: "Notes", kind: "text", hidden: false, system: null, html: "<p>hello</p>" }]
    }, opts());
    expect(JSON.stringify(nodes)).toContain("hello");
    expect(nodes.find((n) => n.style === "subtitle")).toBeUndefined();
  });
});
