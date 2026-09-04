// Ported from campaign-record's tests/doc-import.test.js. suggestType's
// expectations are adjusted to the companion's type list
// (COMPANION_IMPORT_TYPES): "Character List" now suggests "person" (was
// "pc") since the companion has no separate pc/npc type - both collapse to
// "person" (see doc-import.mjs's LEGACY_TYPE_ALIASES). Everything else is
// unchanged.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cleanTitle, detectSessionHeader, parseSectionDate, sessionsDetectedHint } from "../scripts/logic/doc-import.mjs";

describe("cleanTitle", () => {
  it("strips stray bold markers and trailing colons", () => {
    expect(cleanTitle("Character List**")).toBe("Character List");
    expect(cleanTitle("**Arc 5, Session 1**")).toBe("Arc 5, Session 1");
    expect(cleanTitle("  Loot:  ")).toBe("Loot");
  });
});

describe("detectSessionHeader", () => {
  it.each([
    "Session Zero 10/6/2024",
    "Arc 1 Session 1 10/26/24",
    "Arc 2 Session 3 2/23/25",
    "Arc 5, Session 1",
    "Arc 3 Session 2 5/18/25  part 1",
    "IN PERSON SESSION 1 11/14/25",
    "Out of Arc - 3/2/23  - Sidequest",
    "Arc 6  Session 6  6/14/26"
  ])("accepts %s", (line) => {
    expect(detectSessionHeader(line)).toBe(true);
  });

  it.each([
    "We talked about the session yesterday",
    "The session ended when Arc told us to stop by the tavern for a long rest",
    "Session 5 saw the party finally reach the ruined tower",
    "Loot:",
    ""
  ])("rejects %s", (line) => {
    expect(detectSessionHeader(line)).toBe(false);
  });
});

describe("parseSectionDate", () => {
  it("parses numeric dates with 2- and 4-digit years", () => {
    expect(parseSectionDate("Session Zero 10/6/2024")).toBe("2024-10-06");
    expect(parseSectionDate("Arc 2 Session 3 2/23/25")).toBe("2025-02-23");
  });

  it("parses spelled-out month dates", () => {
    expect(parseSectionDate("Radiant Citadel - April 27th 2025")).toBe("2025-04-27");
  });

  it("returns null for missing or invalid dates", () => {
    expect(parseSectionDate("Arc 5, Session 1")).toBeNull();
    expect(parseSectionDate("Arc 3 Session 1 3/3025")).toBeNull(); // typo: not M/D/Y
    expect(parseSectionDate("Session 4 9/31/25")).toBeNull(); // Sept 31 doesn't exist
  });
});

import { JSDOM } from "jsdom";
import { splitSections } from "../scripts/logic/doc-import.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("splitSections", () => {
  it("splits on h1-h3 and captures the doc title from a leading h1", () => {
    const { title, sections } = splitSections(body(`
      <h1>Adventure Notes</h1>
      <p>Some intro prose.</p>
      <h1>Character List**</h1>
      <p>Aracusa - Half Elf Rogue</p>
      <h3>Radiant Citadel - April 27th 2025</h3>
      <p>We arrive at the citadel.</p>`));
    expect(title).toBe("Adventure Notes");
    expect(sections.map((s) => s.title)).toEqual(
      ["Introduction", "Character List", "Radiant Citadel - April 27th 2025"]);
    expect(sections[2].date).toBe("2025-04-27");
  });

  it("splits on plain and fully-bold session-header paragraphs", () => {
    const { sections } = splitSections(body(`
      <p>Session Zero 10/6/2024</p>
      <p>We are in Natick again.</p>
      <p><strong>Arc 2 Session 3 2/23/25</strong></p>
      <p>We fight the cult.</p>
      <p><strong>Not a session</strong> but a bold lead-in to a very long paragraph of prose.</p>`));
    expect(sections.map((s) => s.title)).toEqual(
      ["Session Zero 10/6/2024", "Arc 2 Session 3 2/23/25"]);
    expect(sections[0].isSession).toBe(true);
    expect(sections[0].date).toBe("2024-10-06");
    expect(sections[1].html).toContain("cult");
    expect(sections[1].html).toContain("bold lead-in");
  });

  it("drops whitespace-only paragraphs and flags empty sections", () => {
    // h2, not h1: a leading h1 is consumed as the document title.
    const { sections } = splitSections(body(`
      <h2>Party Inventory</h2>
      <p>  </p>
      <p> </p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].empty).toBe(true);
    expect(sections[0].wordCount).toBe(0);
  });

  it("detects session headers split across or nested inside bold runs", () => {
    const { sections } = splitSections(body(`
      <p><strong>Session</strong> <strong>Zero 10/6/2024</strong></p>
      <p>We begin.</p>
      <p><strong><b>Arc 2 Session 3 2/23/25</b></strong></p>
      <p>We fight.</p>`));
    expect(sections.map((s) => s.title)).toEqual(
      ["Session Zero 10/6/2024", "Arc 2 Session 3 2/23/25"]);
  });

  it("keeps tables and lists inside their section html", () => {
    const { sections } = splitSections(body(`
      <h2>Bastion</h2>
      <table><tr><td>Aracusa</td><td>Bedroom</td></tr></table>
      <ul><li>one</li><li>two</li></ul>`));
    expect(sections[0].html).toContain("<table>");
    expect(sections[0].html).toContain("<li>one</li>");
    expect(sections[0].empty).toBe(false);
  });

  it("exposes blocks whose join reconstructs the section html", () => {
    const { sections } = splitSections(body(`
      <h2>Bastion</h2>
      <p>Room one.</p>
      <p>Room two.</p>`));
    expect(sections[0].blocks).toEqual(["<p>Room one.</p>", "<p>Room two.</p>"]);
    expect(sections[0].blocks.join("\n")).toBe(sections[0].html);
  });

  it("keeps picture-only paragraphs (mammoth emits standalone images as <p><img></p>) and still drops empty ones", () => {
    const { sections } = splitSections(body(`
      <h1>Doc</h1>
      <h2>Gallery</h2>
      <p><img src="data:image/png;base64,AA==" alt="map"></p>
      <p>   </p>
      <p>Caption text.</p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].blocks).toHaveLength(2);
    expect(sections[0].blocks[0]).toContain('<img src="data:image/png;base64,AA=="');
    expect(sections[0].html).toContain("<img");
    expect(sections[0].wordCount).toBe(2);
  });

  it("keeps a bare top-level media element and a video wrapped in a paragraph", () => {
    const { sections } = splitSections(body(`
      <h2>Gallery</h2>
      <img src="data:image/png;base64,AA==" alt="map">
      <p>   </p>
      <p><video src="x.webm"></video></p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].blocks).toHaveLength(2);
    expect(sections[0].blocks[0]).toContain('<img src="data:image/png;base64,AA=="');
    expect(sections[0].blocks[1]).toContain("<video");
    expect(sections[0].html).toContain("<img");
    expect(sections[0].html).toContain("<video");
  });
});

import { suggestType, stripTypeMarker, buildImportPlan } from "../scripts/logic/doc-import.mjs";

// COMPANION_IMPORT_TYPES (constants.mjs), inlined here to keep this pure
// logic test independent of Foundry-touching constants.mjs.
const KINDS = ["person", "place", "quest", "shop", "loot", "encounter",
  "organization", "poi", "event", "list", "session", "journalentry"];
const sec = (over = {}) => ({
  title: "Untitled", level: 1, date: null, isSession: false,
  html: "<p>x</p>", wordCount: 1, empty: false, ...over
});

describe("suggestType", () => {
  it("suggests from title keywords", () => {
    expect(suggestType(sec({ title: "Party Inventory" }), KINDS).type).toBe("loot");
    // was "pc" against campaign-record's RECORD_TYPES; the companion has no
    // separate pc/npc type, so the "character|party member" keyword's
    // output is normalized to "person" (see LEGACY_TYPE_ALIASES).
    expect(suggestType(sec({ title: "Character List" }), KINDS).type).toBe("person");
    expect(suggestType(sec({ title: "Bastion Information" }), KINDS).type).toBe("place");
  });

  it("also normalizes the npc keyword to person", () => {
    expect(suggestType(sec({ title: "NPC Roster" }), KINDS).type).toBe("person");
  });

  it("normalizes the checklist keyword to list", () => {
    expect(suggestType(sec({ title: "Checklist" }), KINDS).type).toBe("list");
  });

  it("suggests session for session-shaped sections", () => {
    expect(suggestType(sec({ title: "Arc 1 Session 1 10/26/24", isSession: true }), KINDS).type).toBe("session");
    // A session-shaped title never falls into the keyword table.
    expect(suggestType(sec({ title: "Session 3 - The Quest Begins", isSession: true }), KINDS).type).toBe("session");
  });

  it("defaults unknown titles to journalentry (Text and Image)", () => {
    expect(suggestType(sec({ title: "Radiant Citadel" }), KINDS).type).toBe("journalentry");
  });

  it("a round-trip marker still beats the session shape", () => {
    const s = sec({ title: "Session 1 1/5/25", isSession: true, html: "<p>Campaign Record type: quest</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "quest", fromMarker: true });
  });

  it("normalizes a legacy text marker to journalentry", () => {
    const s = sec({ title: "Untitled", html: "<p>Campaign Record type: text</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "journalentry", fromMarker: true });
  });

  it("honors the exporter round-trip marker over keywords", () => {
    const s = sec({ title: "Party Inventory", html: "<p>Campaign Record type: quest</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "quest", fromMarker: true });
  });

  it("normalizes a legacy campaign-record marker value (item -> journalentry)", () => {
    const s = sec({ title: "Untitled", html: "<p>Campaign Record type: item</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "journalentry", fromMarker: true });
  });
});

describe("stripTypeMarker", () => {
  it("removes only a leading marker paragraph", () => {
    expect(stripTypeMarker("<p>Campaign Record type: quest</p><p>body</p>")).toBe("<p>body</p>");
    expect(stripTypeMarker("<p>body</p>")).toBe("<p>body</p>");
  });
});

describe("buildImportPlan", () => {
  const sections = [
    sec({ title: "Intro" }),
    sec({ title: "Session 1 1/5/25", isSession: true, date: "2025-01-05" }),
    sec({ title: "Part 2", html: "<p>more</p>" }),
    sec({ title: "Empty", empty: true, html: "", wordCount: 0 })
  ];

  it("creates pages, merges, and skips", () => {
    const { pages, warnings } = buildImportPlan(sections, [
      { title: "Intro", type: "journalentry", timepoint: false },
      { title: "Session 1", type: "journalentry", timepoint: true },
      { title: "Part 2", type: "merge", timepoint: false },
      { title: "Empty", type: "skip", timepoint: false }
    ], KINDS);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toEqual({
      name: "Session 1", type: "journalentry",
      html: "<p>x</p>\n<p>more</p>", timepoint: "Session 1"
    });
    expect(warnings).toEqual([]);
  });

  it("rejects unknown types and downgrades a leading merge", () => {
    const { pages, warnings } = buildImportPlan([sections[0]], [
      { title: "Intro", type: "merge", timepoint: false }
    ], KINDS);
    expect(pages).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(() => buildImportPlan([sections[0]], [{ title: "x", type: "wizard", timepoint: false }], KINDS))
      .toThrow(/unknown/i);
  });

  it("normalizes the retired text pseudo-type to journalentry (stale form state)", () => {
    const { pages } = buildImportPlan([sections[0]], [
      { title: "Intro", type: "text", timepoint: false }
    ], KINDS);
    expect(pages[0].type).toBe("journalentry");
  });
});

import { mergeSections, splitSectionAt } from "../scripts/logic/doc-import.mjs";

describe("mergeSections", () => {
  const blk = (over = {}) => ({
    title: "S", level: 1, date: null, isSession: false,
    blocks: ["<p>x</p>"], html: "<p>x</p>", wordCount: 1, empty: false, ...over
  });

  it("merges a section into the previous one, keeping the upper title", () => {
    const before = [
      blk({ title: "One", blocks: ["<p>a</p>"], html: "<p>a</p>", wordCount: 1 }),
      blk({ title: "Two", blocks: ["<p>b</p>", "<p>c</p>"], html: "<p>b</p>\n<p>c</p>", wordCount: 2 })
    ];
    const after = mergeSections(before, 1);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("One");
    expect(after[0].blocks).toEqual(["<p>a</p>", "<p>b</p>", "<p>c</p>"]);
    expect(after[0].html).toBe("<p>a</p>\n<p>b</p>\n<p>c</p>");
    expect(after[0].wordCount).toBe(3);
  });

  it("returns a copy and ignores index 0 or out of range", () => {
    const before = [blk(), blk()];
    expect(mergeSections(before, 0)).not.toBe(before);
    expect(mergeSections(before, 0)).toHaveLength(2);
    expect(mergeSections(before, 9)).toHaveLength(2);
  });
});

describe("splitSectionAt", () => {
  const base = {
    title: "Big", level: 1, date: null, isSession: false,
    blocks: ["<p>Alpha</p>", "<p>Beta</p>", "<p>Gamma</p>"],
    html: "<p>Alpha</p>\n<p>Beta</p>\n<p>Gamma</p>", wordCount: 3, empty: false
  };

  it("splits blocks into contiguous runs at the cut indices", () => {
    const after = splitSectionAt([base], 0, [2]);
    expect(after).toHaveLength(2);
    expect(after[0].blocks).toEqual(["<p>Alpha</p>", "<p>Beta</p>"]);
    expect(after[0].title).toBe("Big"); // first run keeps the original title
    expect(after[1].blocks).toEqual(["<p>Gamma</p>"]);
    expect(after[1].title).toBe("Gamma"); // derived from its first block
    expect(after[1].html).toBe("<p>Gamma</p>");
  });

  it("supports multiple cuts producing N+1 sections", () => {
    const after = splitSectionAt([base], 0, [1, 2]);
    expect(after.map((s) => s.blocks)).toEqual([
      ["<p>Alpha</p>"], ["<p>Beta</p>"], ["<p>Gamma</p>"]
    ]);
  });

  it("re-detects session/date on new runs and ignores invalid cuts", () => {
    const sec = {
      ...base,
      blocks: ["<p>Intro</p>", "<p>Session Zero 10/6/2024</p>", "<p>We begin.</p>"],
      html: "x", wordCount: 3
    };
    const after = splitSectionAt([sec], 0, [1, 0, 99]); // 0 and 99 are invalid
    expect(after).toHaveLength(2);
    expect(after[1].title).toBe("Session Zero 10/6/2024");
    expect(after[1].isSession).toBe(true);
    expect(after[1].date).toBe("2024-10-06");
  });
});

describe("sessionsDetectedHint", () => {
  it("selects the singular string for exactly one detected session", () => {
    expect(sessionsDetectedHint(1)).toEqual({ sessionsDetected: 1, sessionsDetectedOne: true });
  });
  it("selects the plural string for zero and for many", () => {
    expect(sessionsDetectedHint(0)).toEqual({ sessionsDetected: 0, sessionsDetectedOne: false });
    expect(sessionsDetectedHint(4)).toEqual({ sessionsDetected: 4, sessionsDetectedOne: false });
  });
});

// The hint itself is rendered by a template, so the branch is pinned against
// the template source: the singular string must be chosen by an {{#if}} on
// sessionsDetectedOne with the plural in its {{else}}. Deleting the branch, or
// inverting it, fails here. (Foundry's i18n does plain {token} substitution
// with no plural selection, which is why the choice is made in the context.)
describe("import wizard template selects the sessions hint", () => {
  const template = readFileSync(new URL("../templates/import-wizard.hbs", import.meta.url), "utf8");
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

  it("branches on sessionsDetectedOne, singular first, plural in the else", () => {
    expect(template).toMatch(
      /\{\{#if sessionsDetectedOne\}\}\{\{localize "MEJCampaignCompanion\.import\.sessionsDetectedOne"\}\}\s*\{\{else\}\}\{\{localize "MEJCampaignCompanion\.import\.sessionsDetected" count=sessionsDetected\}\}\{\{\/if\}\}/
    );
    expect(template).not.toContain("#unless sessionsDetectedOne");
  });
  it("ships a singular string that is actually singular, and a plural one that takes the count", () => {
    expect(lang.MEJCampaignCompanion.import.sessionsDetectedOne).toMatch(/\b1 section\b/);
    expect(lang.MEJCampaignCompanion.import.sessionsDetectedOne).not.toMatch(/\bsections\b/);
    expect(lang.MEJCampaignCompanion.import.sessionsDetected).toContain("{count}");
  });
});
