import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import {
  eligibleEntries, orderEligibleEntries, relationshipsHtml, sessionBodyHtml,
  pageRelationships, recordSnapshot, buildGroupSnapshot, SESSION_KIND
} from "../scripts/logic/doc-export-snapshot.mjs";
import { snapshotToDocModel } from "../scripts/logic/doc-export.mjs";
import { RECORD_TYPE_MARKER_RE, suggestType } from "../scripts/logic/doc-import.mjs";
import { COMPANION_IMPORT_TYPES, SESSION_DOCUMENT_TYPE } from "../scripts/constants.mjs";
import { formatCampaignDate } from "../scripts/logic/campaign-calendar.mjs";

const labels = { relationships: "Relationships", sessionNumber: "Session Number", campaignDate: "Campaign Date" };

function mejEntry(uuid, name, kind, extra = {}) {
  return {
    uuid, name,
    pages: { contents: [{ type: "text", text: { content: "<p>body</p>" }, flags: { "monks-enhanced-journal": { type: kind } }, ...extra }] }
  };
}

function sessionEntry(uuid, name, sessionFlags = {}, type = "session") {
  return {
    uuid, name,
    pages: {
      contents: [{
        type,
        system: { recap: "<p>recap</p>", gmNotes: "" },
        getFlag: (scope, key) => (scope === "mej-campaign-companion" && key === "session" ? sessionFlags : undefined),
        flags: { "mej-campaign-companion": { session: sessionFlags } }
      }]
    }
  };
}

describe("eligibleEntries", () => {
  it("includes MEJ-typed entries via getMEJType", () => {
    const getMEJType = (entry) => entry.pages.contents[0].flags["monks-enhanced-journal"]?.type || false;
    const rows = eligibleEntries([mejEntry("u1", "Verity", "person")], getMEJType);
    expect(rows).toEqual([{ uuid: "u1", name: "Verity", kind: "person", page: expect.any(Object) }]);
  });

  it("includes session entries by native page type even when getMEJType is false", () => {
    const getMEJType = () => false;
    const rows = eligibleEntries([sessionEntry("u2", "Session 1")], getMEJType);
    expect(rows.map((r) => r.kind)).toEqual([SESSION_KIND]);
  });

  it("includes session entries by the real prefixed module-subtype page type (module.json's actual runtime type)", () => {
    const getMEJType = () => false;
    const rows = eligibleEntries([sessionEntry("u3", "Session 2", {}, SESSION_DOCUMENT_TYPE)], getMEJType);
    expect(rows.map((r) => r.kind)).toEqual([SESSION_KIND]);
  });

  it("skips entries with neither an MEJ type nor a session page", () => {
    const getMEJType = () => false;
    const rows = eligibleEntries([mejEntry("u3", "Plain", null)], getMEJType);
    expect(rows).toEqual([]);
  });

  it("skips entries with no pages", () => {
    const rows = eligibleEntries([{ uuid: "u4", name: "Empty", pages: { contents: [] } }], () => "person");
    expect(rows).toEqual([]);
  });
});

describe("orderEligibleEntries", () => {
  const entries = [
    { uuid: "c", name: "Charlie" }, { uuid: "a", name: "Alpha" }, { uuid: "b", name: "Bravo" }, { uuid: "z", name: "Zulu" }
  ];

  it("orders timeline-linked entries first in timepoint/link order, then remaining alphabetically", () => {
    const timepoints = [
      { links: [{ uuid: "z" }, { uuid: "c" }] },
      { links: [{ uuid: "a" }] }
    ];
    const ordered = orderEligibleEntries(entries, timepoints);
    expect(ordered.map((e) => e.uuid)).toEqual(["z", "c", "a", "b"]);
  });

  it("dedupes an entry linked from multiple timepoints to its first appearance", () => {
    const timepoints = [{ links: [{ uuid: "a" }] }, { links: [{ uuid: "a" }, { uuid: "b" }] }];
    const ordered = orderEligibleEntries(entries, timepoints);
    expect(ordered.map((e) => e.uuid)).toEqual(["a", "b", "c", "z"]);
  });

  it("falls back to full alphabetical order with no timepoints", () => {
    expect(orderEligibleEntries(entries, []).map((e) => e.uuid)).toEqual(["a", "b", "c", "z"]);
    expect(orderEligibleEntries(entries, undefined).map((e) => e.uuid)).toEqual(["a", "b", "c", "z"]);
  });

  it("ignores links pointing at entries outside the eligible set", () => {
    const timepoints = [{ links: [{ uuid: "not-eligible" }, { uuid: "b" }] }];
    expect(orderEligibleEntries(entries, timepoints).map((e) => e.uuid)).toEqual(["b", "a", "c", "z"]);
  });
});

describe("relationshipsHtml", () => {
  const resolved = [{ name: "Duke Aracusa", hidden: false }, { name: "The Mole", hidden: true }];

  it("drops hidden relationships when includeGM is false", () => {
    const html = relationshipsHtml(resolved, false, "Relationships");
    expect(html).toContain("Duke Aracusa");
    expect(html).not.toContain("The Mole");
  });

  it("includes hidden relationships when includeGM is true", () => {
    const html = relationshipsHtml(resolved, true, "Relationships");
    expect(html).toContain("Duke Aracusa");
    expect(html).toContain("The Mole");
  });

  it("returns an empty string when nothing would render", () => {
    expect(relationshipsHtml([], false, "Relationships")).toBe("");
    expect(relationshipsHtml([{ name: "Hidden", hidden: true }], false, "Relationships")).toBe("");
  });

  it("escapes relationship names", () => {
    expect(relationshipsHtml([{ name: "<script>", hidden: false }], false, "R")).not.toContain("<script>");
  });
});

describe("pageRelationships", () => {
  it("resolves names via the injected resolver and drops unresolved targets", () => {
    const page = { flags: { "monks-enhanced-journal": { relationships: {
      a: { id: "a", uuid: "JournalEntry.a", hidden: false },
      b: { id: "b", uuid: "JournalEntry.b", hidden: true },
      c: { id: "c", uuid: "JournalEntry.c", hidden: false }
    } } } };
    const resolveName = (uuid) => (uuid === "JournalEntry.c" ? null : `Name-${uuid}`);
    const rows = pageRelationships(page, resolveName);
    expect(rows).toEqual([
      { name: "Name-JournalEntry.a", hidden: false },
      { name: "Name-JournalEntry.b", hidden: true }
    ]);
  });

  it("returns [] for a page with no relationships flag", () => {
    expect(pageRelationships({}, () => "x")).toEqual([]);
  });
});

describe("sessionBodyHtml", () => {
  it("prepends session number and campaign date lines before the recap", () => {
    const page = { system: { recap: "<p>recap</p>" }, getFlag: () => ({ sessionNumber: 3, campaignDate: { year: 100 } }) };
    const html = sessionBodyHtml(page, {
      sessionNumberLabel: "Session Number", campaignDateLabel: "Campaign Date",
      formatCampaignDate: () => "Year 100"
    });
    expect(html).toBe("<p><strong>Session Number:</strong> 3</p><p><strong>Campaign Date:</strong> Year 100</p><p>recap</p>");
  });

  it("omits lines for unset session number/campaign date", () => {
    const page = { system: { recap: "<p>recap</p>" }, getFlag: () => ({}) };
    expect(sessionBodyHtml(page, { sessionNumberLabel: "SN", campaignDateLabel: "CD" })).toBe("<p>recap</p>");
  });

  // I5 regression: a stored campaignDate.month is 0-based (the module's storage contract
  // - see campaign-calendar.mjs's sessionMonthOptions doc comment). Exercise the REAL
  // formatCampaignDate (not a stub) against a specific 0-based month index and confirm the
  // exported doc line shows the correct calendar month name, not an off-by-one neighbor.
  describe("with the real formatCampaignDate against a stored 0-based month", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("shows the calendar's own month name for month index 1 (Alturiak, not Hammer or Ches)", () => {
      vi.stubGlobal("game", {
        i18n: { localize: (k) => k.replace("MONTH.", "") },
        time: {
          calendar: {
            timeToComponents: () => ({}),
            months: { values: [
              { name: "MONTH.Hammer", days: 30 },
              { name: "MONTH.Alturiak", days: 30 },
              { name: "MONTH.Ches", days: 30 }
            ] },
            days: { hoursPerDay: 24, minutesPerHour: 60 }
          }
        }
      });
      const page = {
        system: { recap: "<p>recap</p>" },
        getFlag: () => ({ campaignDate: { year: 1492, month: 1, day: 15, hour: null, minute: null } })
      };
      const html = sessionBodyHtml(page, {
        sessionNumberLabel: "Session Number", campaignDateLabel: "Campaign Date", formatCampaignDate
      });
      expect(html).toContain("Alturiak 15, 1492");
      expect(html).not.toContain("Hammer");
      expect(html).not.toContain("Ches");
    });
  });
});

describe("recordSnapshot", () => {
  it("builds a session record with system.gmNotes and a sessionBodyHtml body", () => {
    const row = { uuid: "u1", name: "Session One", kind: SESSION_KIND, page: {
      system: { recap: "<p>recap</p>", gmNotes: "<p>secret</p>" },
      getFlag: () => ({ sessionNumber: 1 })
    } };
    const record = recordSnapshot(row, { includeGM: false, labels });
    expect(record.kind).toBe(SESSION_KIND);
    expect(record.hidden).toBe(false);
    expect(record.system).toEqual({ gmNotes: "<p>secret</p>" });
    expect(record.html).toContain("recap");
  });

  it("builds an MEJ-typed record with html = body text + relationships, system = {}", () => {
    const row = { uuid: "u2", name: "Verity", kind: "person", page: { text: { content: "<p>An elf.</p>" } } };
    const record = recordSnapshot(row, {
      includeGM: true, relationships: [{ name: "Duke Aracusa", hidden: false }], labels
    });
    expect(record).toEqual({
      name: "Verity", kind: "person", hidden: false, system: {},
      html: expect.stringContaining("An elf.")
    });
    expect(record.html).toContain("Duke Aracusa");
  });
});

describe("buildGroupSnapshot", () => {
  it("assembles name/timeline/records in the shape snapshotToDocModel expects", () => {
    const timepoints = [{ label: "Session 1", links: [{ name: "Verity" }, { name: null }] }];
    const rows = [{ uuid: "u1", name: "Verity", kind: "person", page: { text: { content: "<p>x</p>" } } }];
    const snapshot = buildGroupSnapshot("My Campaign", timepoints, rows, (row) => recordSnapshot(row, { includeGM: false, labels }));
    expect(snapshot.name).toBe("My Campaign");
    expect(snapshot.timeline).toEqual([{ label: "Session 1", items: ["Verity"] }]);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0].name).toBe("Verity");
  });

  it("drops document-linked timeline items an isVisible predicate rejects when includeGM is false", () => {
    const timepoints = [{ label: "S1", links: [
      { uuid: "hidden-uuid", name: "Secret Lair" },
      { uuid: "visible-uuid", name: "Tavern" }
    ] }];
    const isVisible = (uuid) => uuid === "visible-uuid";
    const snapshot = buildGroupSnapshot("G", timepoints, [], () => null, { includeGM: false, isVisible });
    expect(snapshot.timeline[0].items).toEqual(["Tavern"]);
  });

  it("keeps every document-linked timeline item when includeGM is true, ignoring isVisible", () => {
    const timepoints = [{ label: "S1", links: [{ uuid: "hidden-uuid", name: "Secret Lair" }] }];
    const snapshot = buildGroupSnapshot("G", timepoints, [], () => null, { includeGM: true, isVisible: () => false });
    expect(snapshot.timeline[0].items).toEqual(["Secret Lair"]);
  });

  it("treats a document link as hidden when includeGM is false and no isVisible predicate is supplied", () => {
    const timepoints = [{ label: "S1", links: [{ uuid: "x", name: "X" }] }];
    expect(buildGroupSnapshot("G", timepoints, [], () => null).timeline[0].items).toEqual([]);
  });

  it("gates raw-image links by their own showPlayers flag when includeGM is false", () => {
    const timepoints = [{ label: "S1", links: [
      { src: "a.png", name: "Map A", showPlayers: true },
      { src: "b.png", name: "Map B", showPlayers: false },
      { src: "c.png", name: "Map C" }
    ] }];
    const snapshot = buildGroupSnapshot("G", timepoints, [], () => null, { includeGM: false });
    expect(snapshot.timeline[0].items).toEqual(["Map A"]);
  });

  it("keeps every image link when includeGM is true regardless of showPlayers", () => {
    const timepoints = [{ label: "S1", links: [{ src: "b.png", name: "Map B", showPlayers: false }] }];
    const snapshot = buildGroupSnapshot("G", timepoints, [], () => null, { includeGM: true });
    expect(snapshot.timeline[0].items).toEqual(["Map B"]);
  });
});

// The whole point of the type-marker line doc-export.mjs emits
// ("Campaign Record type: <kind>") is that a later re-import through this
// module's own import wizard suggests the same type back. Every kind this
// module ever emits must be one of COMPANION_IMPORT_TYPES (or "session"),
// and doc-import.mjs's normalizeType() must resolve it back to itself
// (verified below via suggestType, exactly the function the import wizard
// calls per section) - not silently degrade to "text".
describe("export marker round-trips through the import wizard's suggestType", () => {
  const i18n = (key) => key.split(".").pop();
  const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;

  for (const kind of [...COMPANION_IMPORT_TYPES]) {
    it(`round-trips "${kind}"`, () => {
      const row = kind === SESSION_KIND
        ? { uuid: "u", name: "N", kind, page: { system: { recap: "<p>x</p>" }, getFlag: () => ({}) } }
        : { uuid: "u", name: "N", kind, page: { text: { content: "<p>x</p>" } } };
      const record = recordSnapshot(row, { includeGM: false, labels });
      const nodes = snapshotToDocModel({ name: "G", timeline: null, records: [record] }, { includeGM: false, parse, i18n });

      const subtitle = nodes.find((n) => n.style === "subtitle");
      expect(subtitle, `no marker emitted for kind "${kind}"`).toBeTruthy();
      const markerText = subtitle.runs[0].text;
      expect(markerText).toBe(`Campaign Record type: ${kind}`);
      expect(RECORD_TYPE_MARKER_RE.test(markerText)).toBe(true);

      // Simulate re-import: a docx section whose html leads with this exact
      // marker paragraph, same as stripTypeMarker/suggestType would see.
      const section = { title: "N", isSession: false, html: `<p>${markerText}</p><p>body</p>` };
      const suggestion = suggestType(section, COMPANION_IMPORT_TYPES);
      expect(suggestion).toEqual({ type: kind, fromMarker: true });
    });
  }
});

// Four of this module's real kinds (place, shop, loot, quest via
// COMPANION_IMPORT_TYPES... actually quest/encounter) happen to share a
// literal key with doc-export.mjs's own FIELD_RENDERERS table (keyed by
// campaign-record's kind vocabulary). Confirms recordSnapshot's system={}
// (never null) keeps those renderers from crashing on a null dereference.
describe("FIELD_RENDERERS collision safety (place/shop/loot/quest/encounter)", () => {
  const i18n = (key) => key.split(".").pop();
  const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;

  for (const kind of ["place", "shop", "loot", "quest", "encounter"]) {
    it(`does not throw for kind "${kind}" with an empty system object`, () => {
      const row = { uuid: "u", name: "N", kind, page: { text: { content: "<p>x</p>" } } };
      const record = recordSnapshot(row, { includeGM: false, labels });
      expect(() => snapshotToDocModel({ name: "G", timeline: null, records: [record] }, { includeGM: false, parse, i18n }))
        .not.toThrow();
    });
  }
});
