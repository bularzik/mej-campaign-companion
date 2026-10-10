import { describe, it, expect } from "vitest";
import {
  LABEL_MAX, entryIdOf, pairId, normalizeRows, findPair, sideOf, targetProblem, eligibleTargets,
  linesForEntry, createRowUpdate, labelUpdate, deleteUpdate, exportLines
} from "../scripts/logic/party-rows.mjs";

const A = "JournalEntry.aaaaaaaaaaaaaaaa";
const B = "JournalEntry.bbbbbbbbbbbbbbbb";
const C = "JournalEntry.cccccccccccccccc";
const P = "mej-campaign-companion";

describe("entryIdOf / pairId", () => {
  it("accepts world JournalEntry uuids only", () => {
    expect(entryIdOf(A)).toBe("aaaaaaaaaaaaaaaa");
    expect(entryIdOf("Compendium.x.y.JournalEntry.aaaaaaaaaaaaaaaa")).toBeNull();
    expect(entryIdOf("JournalEntry.a.JournalEntryPage.b")).toBeNull();
    expect(entryIdOf(null)).toBeNull();
  });
  it("is order independent and flag-safe", () => {
    expect(pairId(A, B)).toBe("aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb");
    expect(pairId(B, A)).toBe(pairId(A, B));
    expect(pairId(A, B)).not.toMatch(/[.|]/);
  });
  it("null for self or non-world uuids", () => {
    expect(pairId(A, A)).toBeNull();
    expect(pairId(A, "Compendium.x.y.JournalEntry.b")).toBeNull();
  });
});

describe("normalizeRows", () => {
  it("skips malformed rows and coerces fields", () => {
    const rows = normalizeRows({
      k1: { a: A, b: B, labels: { a: "Sister of", b: 7 }, createdName: "Dana", editedName: "Jo", updated: 5 },
      bad1: { a: A },
      bad2: "nope",
      bad3: { a: A, b: A }
    });
    expect(rows).toEqual([{
      key: "k1", a: A, b: B, labels: { a: "Sister of", b: "7" },
      createdBy: "", createdName: "Dana", editedBy: "", editedName: "Jo", updated: 5
    }]);
  });
  it("nullish and arrays give []", () => {
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows([])).toEqual([]);
  });
  it("non-object labels become empty", () => {
    expect(normalizeRows({ k: { a: A, b: B, labels: "x" } })[0].labels).toEqual({ a: "", b: "" });
  });
});

describe("findPair / sideOf (identity from a/b, never the key - Review Focus 1)", () => {
  // Omnipresence rewrote the uuids but kept the old key.
  const rows = normalizeRows({ "oldid1-oldid2": { a: B, b: A, labels: { a: "x", b: "y" } } });
  it("finds a pair in either order under a stale key", () => {
    expect(findPair(rows, A, B)?.key).toBe("oldid1-oldid2");
    expect(findPair(rows, B, A)?.key).toBe("oldid1-oldid2");
    expect(findPair(rows, A, C)).toBeNull();
  });
  it("sideOf reads the stored a/b", () => {
    expect(sideOf(rows[0], B)).toBe("a");
    expect(sideOf(rows[0], A)).toBe("b");
    expect(sideOf(rows[0], C)).toBeNull();
  });
});

describe("targetProblem / eligibleTargets", () => {
  const doc = (uuid, name, type, limited = true) => ({ uuid, name, type, limited });
  const ctx = { sourceUuid: A, allowed: ["person", "place"], typeOf: (d) => d.type, canLimited: (d) => d.limited };
  it("reasons", () => {
    expect(targetProblem(null, ctx)).toBe("not-journal");
    expect(targetProblem(doc(A, "A", "person"), ctx)).toBe("self");
    expect(targetProblem(doc(B, "B", "person", false), ctx)).toBe("no-access");
    expect(targetProblem(doc(B, "B", "quest"), ctx)).toBe("type-not-allowed");
    expect(targetProblem(doc("Compendium.x.y.JournalEntry.z", "Z", "person"), ctx)).toBe("not-journal");
    expect(targetProblem(doc(B, "B", "person"), ctx)).toBeNull();
  });
  it("filters, searches case-insensitively, sorts by name", () => {
    const list = [doc(C, "zed", "place"), doc(B, "Bea", "person"), doc(A, "Self", "person")];
    expect(eligibleTargets(list, ctx).map((r) => r.name)).toEqual(["Bea", "zed"]);
    expect(eligibleTargets(list, ctx, "ZE").map((r) => r.name)).toEqual(["zed"]);
  });
});

describe("linesForEntry", () => {
  const nb = (uuid, campaignName, flag) => ({ uuid, campaignName, rows: normalizeRows(flag) });
  const flag1 = { k1: { a: A, b: B, labels: { a: "Sister of", b: "Older sister" }, editedName: "Jo" } };
  it("returns this entry's side and the other side", () => {
    const lines = linesForEntry(B, [nb("JournalEntry.n1", "Red", flag1)], { canLimited: () => true });
    expect(lines).toEqual([{
      notebookUuid: "JournalEntry.n1", key: "k1", campaignName: "Red", other: A,
      side: "b", label: "Older sister", otherLabel: "Sister of", editedName: "Jo"
    }]);
  });
  it("drops rows whose other end the viewer can't see", () => {
    expect(linesForEntry(A, [nb("n1", "Red", flag1)], { canLimited: (u) => u !== B })).toEqual([]);
  });
  it("keeps the same pair from two notebooks, one line each", () => {
    const lines = linesForEntry(A, [nb("n1", "Red", flag1), nb("n2", "Blue", flag1)], { canLimited: () => true });
    expect(lines.map((l) => l.campaignName)).toEqual(["Red", "Blue"]);
  });
});

describe("update paths", () => {
  const user = { id: "u1", name: "Dana" };
  it("createRowUpdate writes one keyed row with empty labels", () => {
    const { key, update } = createRowUpdate({ sourceUuid: B, targetUuid: A, user, now: 9 });
    expect(key).toBe(pairId(A, B));
    expect(update).toEqual({
      [`flags.${P}.partyRows.${key}`]: {
        a: B, b: A, labels: { a: "", b: "" },
        createdBy: "u1", createdName: "Dana", editedBy: "u1", editedName: "Dana", updated: 9
      }
    });
  });
  it("createRowUpdate can carry the source side's first label (one write for create + label)", () => {
    const { key, update } = createRowUpdate({ sourceUuid: B, targetUuid: A, user, now: 9, label: "  Ally " });
    expect(update[`flags.${P}.partyRows.${key}`].labels).toEqual({ a: "Ally", b: "" });
    const long = createRowUpdate({ sourceUuid: B, targetUuid: A, user, now: 9, label: "x".repeat(LABEL_MAX + 5) });
    expect(long.update[`flags.${P}.partyRows.${long.key}`].labels.a).toHaveLength(LABEL_MAX);
  });
  it("labelUpdate touches only that side plus edit stamp (unknown fields survive)", () => {
    const row = normalizeRows({ k1: { a: A, b: B } })[0];
    expect(labelUpdate(row, "b", "  Rival ", { user, now: 3 })).toEqual({
      [`flags.${P}.partyRows.k1.labels.b`]: "Rival",
      [`flags.${P}.partyRows.k1.editedBy`]: "u1",
      [`flags.${P}.partyRows.k1.editedName`]: "Dana",
      [`flags.${P}.partyRows.k1.updated`]: 3
    });
  });
  it("labelUpdate refuses over-long or non-string text and bad sides", () => {
    const row = normalizeRows({ k1: { a: A, b: B } })[0];
    expect(labelUpdate(row, "a", "x".repeat(LABEL_MAX + 1), { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "a", 5, { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "c", "x", { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "a", "", { user, now: 1 })).not.toBeNull();
  });
  it("deleteUpdate uses the -= key", () => {
    expect(deleteUpdate("k1")).toEqual({ [`flags.${P}.partyRows.-=k1`]: null });
  });
});

describe("exportLines", () => {
  const labels = { edited: (n) => `edited by ${n}` };
  it("Name — label (edited by X), sorted by name; empty label omits the dash", () => {
    const lines = [
      { otherName: "Mara", label: "Sister of", editedName: "Jo" },
      { otherName: "Bram", label: "", editedName: "Dana" }
    ];
    expect(exportLines(lines, labels)).toEqual([
      { text: "Bram (edited by Dana)", children: [] },
      { text: "Mara — Sister of (edited by Jo)", children: [] }
    ]);
  });
});
