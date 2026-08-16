import { describe, it, expect } from "vitest";
import {
  normalizeTargetUuid, extractRefs, createBacklinkIndex,
  setSourceRefs, removeSourceRefs, backlinksFor, visibleMentionCounts
} from "../scripts/logic/backlink-index.mjs";

describe("normalizeTargetUuid", () => {
  it("collapses page uuids to the parent entry", () => {
    expect(normalizeTargetUuid("JournalEntry.a1.JournalEntryPage.p1")).toBe("JournalEntry.a1");
    expect(normalizeTargetUuid("JournalEntry.a1")).toBe("JournalEntry.a1");
    expect(normalizeTargetUuid("Actor.x9")).toBe("Actor.x9");
  });
});

describe("extractRefs", () => {
  const record = {
    uuid: "JournalEntry.self",
    fields: {
      text: 'Met @UUID[JournalEntry.npc1]{Bob} and @UUID[JournalEntry.npc1.JournalEntryPage.p]{Bob again} at @UUID[JournalEntry.place1]',
      other: "@UUID[JournalEntry.self]{me} nothing"
    },
    gmFields: { gmNotes: "@UUID[JournalEntry.secret1]{S} and @UUID[JournalEntry.npc1]" }
  };
  it("counts public refs per normalized target, excluding self-links", () => {
    const { refs } = extractRefs(record);
    expect(refs.get("JournalEntry.npc1")).toBe(2);
    expect(refs.get("JournalEntry.place1")).toBe(1);
    expect(refs.has("JournalEntry.self")).toBe(false);
  });
  it("routes gm-field refs to gmRefs unless already publicly referenced", () => {
    const { refs, gmRefs } = extractRefs(record);
    expect(gmRefs.get("JournalEntry.secret1")).toBe(1);
    expect(gmRefs.has("JournalEntry.npc1")).toBe(false); // already public
    expect(refs.has("JournalEntry.secret1")).toBe(false);
  });
});

describe("backlink index CRUD + queries", () => {
  const seeded = () => {
    const bidx = createBacklinkIndex();
    setSourceRefs(bidx, "JournalEntry.a", { refs: new Map([["JournalEntry.t", 2]]), gmRefs: new Map() });
    setSourceRefs(bidx, "JournalEntry.b", { refs: new Map(), gmRefs: new Map([["JournalEntry.t", 1]]) });
    return bidx;
  };
  it("backlinksFor hides gmOnly sources from players", () => {
    const bidx = seeded();
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: false })).toEqual([{ uuid: "JournalEntry.a", count: 2, gmOnly: false }]);
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: true })).toEqual([
      { uuid: "JournalEntry.a", count: 2, gmOnly: false },
      { uuid: "JournalEntry.b", count: 1, gmOnly: true }
    ]);
  });
  it("setSourceRefs replaces prior refs; removeSourceRefs clears them", () => {
    const bidx = seeded();
    setSourceRefs(bidx, "JournalEntry.a", { refs: new Map([["JournalEntry.z", 1]]), gmRefs: new Map() });
    expect(backlinksFor(bidx, "JournalEntry.t", { gm: false })).toEqual([]);
    expect(backlinksFor(bidx, "JournalEntry.z", { gm: false })).toHaveLength(1);
    removeSourceRefs(bidx, "JournalEntry.a");
    expect(backlinksFor(bidx, "JournalEntry.z", { gm: false })).toEqual([]);
  });
  it("visibleMentionCounts honors gm and canSee", () => {
    const bidx = seeded();
    const counts = visibleMentionCounts(bidx, { gm: true, canSee: (u) => u !== "JournalEntry.b" });
    expect(counts.get("JournalEntry.t")).toBe(2); // b's gm mention filtered by canSee
    const playerCounts = visibleMentionCounts(bidx, { gm: false, canSee: () => true });
    expect(playerCounts.get("JournalEntry.t")).toBe(2); // gmOnly source excluded, a's count=2
  });
});
