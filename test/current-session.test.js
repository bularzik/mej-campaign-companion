import { describe, it, expect } from "vitest";
import {
  currentSession, currentSessionUpdate, clearCurrentSessionUpdate, nextSessionNumber, startedToday,
  recapOwnershipUpdate, routeNote, adoptHeldUpdate
} from "../scripts/logic/current-session.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

const P = "mej-campaign-companion";
const S = "JournalEntry.s.JournalEntryPage.p";

describe("current session flag", () => {
  it("reads and writes under the campaign flag", () => {
    const folder = { flags: { [P]: { campaign: { ownershipDefault: "observer", currentSession: { uuid: S, startedAt: 5 } } } } };
    expect(currentSession(folder)).toEqual({ uuid: S, startedAt: 5 });
    expect(currentSession({ flags: {} })).toBeNull();
    expect(currentSessionUpdate(S, 7)).toEqual({ [`flags.${P}.campaign.currentSession`]: { uuid: S, startedAt: 7 } });
    expect(clearCurrentSessionUpdate()).toEqual({ [`flags.${P}.campaign.-=currentSession`]: null });
  });
});

describe("numbering and day check", () => {
  it("next number is max+1, 1 when none", () => {
    expect(nextSessionNumber([3, null, 7])).toBe(8);
    expect(nextSessionNumber([])).toBe(1);
    expect(nextSessionNumber([NaN, Infinity, 2])).toBe(3);
  });
  it("startedToday compares local calendar days", () => {
    const now = new Date(2026, 9, 15, 20, 0).getTime();
    expect(startedToday(new Date(2026, 9, 15, 1, 0).getTime(), now)).toBe(true);
    expect(startedToday(new Date(2026, 9, 14, 23, 59).getTime(), now)).toBe(false);
    expect(startedToday(null, now)).toBe(false);
  });
});

describe("recapOwnershipUpdate (Review Focus 4: adds, never removes)", () => {
  it("grants OWNER to missing or lower users only", () => {
    expect(recapOwnershipUpdate({ default: 2, u1: 3 }, ["u1", "u2"], { ownerLevel: 3 })).toEqual({ "ownership.u2": 3 });
  });
  it("null when nothing to add; never emits -= keys", () => {
    expect(recapOwnershipUpdate({ default: 2, u1: 3, u2: 3 }, ["u1"], { ownerLevel: 3 })).toBeNull();
    const up = recapOwnershipUpdate({ u9: 3 }, ["u1"], { ownerLevel: 3 });
    expect(Object.keys(up).some((k) => k.includes("-="))).toBe(false);
  });
});

describe("routeNote (Review Focus 3)", () => {
  it("one open session wins regardless of visibility list", () => {
    expect(routeNote({ openSessions: [{ campaignId: "c1", sessionUuid: S }], visibleCampaignIds: ["c1", "c2"] }))
      .toEqual({ kind: "session", campaignId: "c1", sessionUuid: S });
  });
  it("two open sessions refuse", () => {
    expect(routeNote({ openSessions: [{ campaignId: "c1", sessionUuid: S }, { campaignId: "c2", sessionUuid: "x" }], visibleCampaignIds: ["c1", "c2"] }))
      .toEqual({ kind: "refuse", reason: "ambiguous" });
  });
  it("no open session: held for the single visible campaign, else refuse", () => {
    expect(routeNote({ openSessions: [], visibleCampaignIds: ["c1"] })).toEqual({ kind: "held", campaignId: "c1" });
    expect(routeNote({ openSessions: [], visibleCampaignIds: ["c1", "c2"] })).toEqual({ kind: "refuse", reason: "ambiguous" });
    expect(routeNote({ openSessions: [], visibleCampaignIds: [] })).toEqual({ kind: "refuse", reason: "none" });
  });
});

describe("adoptHeldUpdate (Review Focus 5)", () => {
  it("stamps every held note and leaves filed ones alone", () => {
    const notes = normalizeNotes({ a: { text: "a", authorId: "u", at: 1 }, b: { text: "b", authorId: "u", at: 2, sessionUuid: "x" } });
    expect(adoptHeldUpdate(notes, S)).toEqual({ [`flags.${P}.notes.a.sessionUuid`]: S });
    expect(adoptHeldUpdate(notes.filter((n) => n.id === "b"), S)).toBeNull();
  });
});
