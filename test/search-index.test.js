import { describe, it, expect, beforeEach } from "vitest";
import {
  createIndex, indexRecord, removeRecord, search, stripHtml, tokenize
} from "../scripts/logic/search-index.mjs";

const npc = {
  uuid: "u1", name: "Strahd von Zarovich", type: "campaign-record.npc",
  tags: ["vampire", "villain"],
  fields: { role: "Dark lord of Barovia", description: "<p>Rules from Castle Ravenloft.</p>" },
  gmFields: { gmNotes: "<p>Secretly seeks Ireena.</p>" }
};
const place = {
  uuid: "u2", name: "Vallaki", type: "campaign-record.place",
  tags: [], fields: { description: "A town under the Baron's iron fist." }, gmFields: {}
};

let index;
beforeEach(() => {
  index = createIndex();
  indexRecord(index, npc);
  indexRecord(index, place);
});

describe("tokenize / stripHtml", () => {
  it("strips tags and lowercases tokens of length >= 2", () => {
    expect(stripHtml("<p>Hello <b>World</b></p>")).toContain("Hello");
    expect(tokenize("<p>Hello, World! A</p>")).toEqual(["hello", "world"]);
  });
});

describe("search", () => {
  it("matches by prefix across name and fields", () => {
    const hits = search(index, "strah", { gm: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].uuid).toBe("u1");
    expect(hits[0].matches.some((m) => m.field === "name")).toBe(true);
  });

  it("matches tags", () => {
    expect(search(index, "vampire", { gm: false })[0].uuid).toBe("u1");
  });

  it("ANDs multiple terms", () => {
    expect(search(index, "castle ravenloft", { gm: false })).toHaveLength(1);
    expect(search(index, "castle vallaki", { gm: false })).toHaveLength(0);
  });

  it("GM-only fields hit for GMs and are invisible to players", () => {
    expect(search(index, "ireena", { gm: true })).toHaveLength(1);
    expect(search(index, "ireena", { gm: false })).toHaveLength(0);
  });

  it("returns a snippet containing the matched term", () => {
    const [hit] = search(index, "baron", { gm: false });
    expect(hit.uuid).toBe("u2");
    const snippet = hit.matches.find((m) => m.field === "description").snippet;
    expect(snippet.toLowerCase()).toContain("baron");
  });

  it("re-indexing a record replaces its old tokens", () => {
    indexRecord(index, { ...place, fields: { description: "A quiet hamlet." } });
    expect(search(index, "baron", { gm: false })).toHaveLength(0);
    expect(search(index, "hamlet", { gm: false })).toHaveLength(1);
  });

  it("removeRecord drops the record from results", () => {
    removeRecord(index, "u1");
    expect(search(index, "strahd", { gm: true })).toHaveLength(0);
  });

  it("empty or too-short queries return no results", () => {
    expect(search(index, "", { gm: true })).toEqual([]);
    expect(search(index, "a", { gm: true })).toEqual([]);
  });

  it("snippet centers on the token-boundary match, not an embedded substring", () => {
    // "cast" appears as a non-token-boundary substring inside "outcast" near the start,
    // and as a real token-boundary match at the start of "castle" much later. The text
    // is long enough (>80 chars) that the snippet window can't just cover the whole
    // string, so a wrong match position produces a genuinely different (wrong) snippet.
    indexRecord(index, {
      uuid: "u3", name: "Watchtower", type: "campaign-record.place", tags: [],
      fields: {
        description:
          "An outcast wandered through the dark forest for many long years before " +
          "finally arriving near the old castle gates at last."
      },
      gmFields: {}
    });
    const [hit] = search(index, "cast", { gm: false }).filter((h) => h.uuid === "u3");
    const snippet = hit.matches.find((m) => m.field === "description").snippet;
    expect(snippet).toMatch(/castle/i);
    // the snippet is centered on "castle" near the end, not the "outcast" false hit near the start
    expect(snippet.startsWith("An outcast")).toBe(false);
  });

  it("a gm field never shadows a same-named public field", () => {
    indexRecord(index, {
      uuid: "u4", name: "Twin", type: "campaign-record.npc", tags: [],
      fields: { notes: "public sunflower" }, gmFields: { notes: "secret moonpetal" }
    });
    expect(search(index, "sunflower", { gm: false })).toHaveLength(1);
    expect(search(index, "moonpetal", { gm: false })).toHaveLength(0);
    expect(search(index, "moonpetal", { gm: true })).toHaveLength(1);
    expect(search(index, "sunflower", { gm: true })).toHaveLength(1);
  });
});

describe("phase 3 polish", () => {
  it("removeRecord only touches the record's own tokens (per-record token set)", () => {
    const index = createIndex();
    indexRecord(index, { uuid: "u1", name: "Alpha", type: "t", fields: { role: "wizard" } });
    indexRecord(index, { uuid: "u2", name: "Beta", type: "t", fields: { role: "warrior" } });
    removeRecord(index, "u1");
    expect(index.records.has("u1")).toBe(false);
    expect(index.records.get("u2").tokens).toBeInstanceOf(Set);
    expect(search(index, "warrior")).toHaveLength(1);
    expect(search(index, "wizard")).toHaveLength(0);
  });

  it("dedupes matches that collapse to the same display field name", () => {
    const index = createIndex();
    indexRecord(index, {
      uuid: "u1", name: "Gamma", type: "t",
      fields: { notes: "secret plan" }, gmFields: { notes: "secret gm plan" }
    });
    const [hit] = search(index, "secret", { gm: true });
    const labels = hit.matches.map((m) => m.field);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
