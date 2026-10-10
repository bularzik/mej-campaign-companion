import { describe, it, expect } from "vitest";
import { wantsSessionTimepoint, sessionTimepointDraft, timepointSyncPatch } from "../scripts/logic/session-timepoint.mjs";
import { SESSION_DOCUMENT_TYPE } from "../scripts/constants.mjs";

const M = "mej-campaign-companion";
const date = { year: 1492, month: 2, day: 5, hour: 18, minute: 30 };

describe("wantsSessionTimepoint", () => {
  it("accepts a bare session page", () => {
    expect(wantsSessionTimepoint({ type: SESSION_DOCUMENT_TYPE }, M)).toBe(true);
  });
  it("rejects other page types and null", () => {
    expect(wantsSessionTimepoint({ type: "text" }, M)).toBe(false);
    expect(wantsSessionTimepoint(null, M)).toBe(false);
  });
  it("rejects an already-linked session", () => {
    const flags = { [M]: { session: { timepointId: "abc" } } };
    expect(wantsSessionTimepoint({ type: SESSION_DOCUMENT_TYPE, flags }, M)).toBe(false);
  });
  it("rejects a page that opted out (docx import)", () => {
    const flags = { [M]: { session: { autoTimepoint: false } } };
    expect(wantsSessionTimepoint({ type: SESSION_DOCUMENT_TYPE, flags }, M)).toBe(false);
  });
});

describe("sessionTimepointDraft", () => {
  it("copies the session's own date without stamping", () => {
    expect(sessionTimepointDraft({ name: "S1", campaignDate: date }, null))
      .toEqual({ label: "S1", campaignDate: date, stampSession: false });
  });
  it("falls back to the world date and stamps the session", () => {
    expect(sessionTimepointDraft({ name: "S1", campaignDate: null }, date))
      .toEqual({ label: "S1", campaignDate: date, stampSession: true });
  });
  it("has no date and no stamp when there is no calendar", () => {
    expect(sessionTimepointDraft({ name: "S1", campaignDate: null }, null))
      .toEqual({ label: "S1", campaignDate: null, stampSession: false });
  });
});

describe("timepointSyncPatch", () => {
  const tp = { label: "S1", campaignDate: date };
  it("is null when they agree", () => {
    expect(timepointSyncPatch({ name: "S1", campaignDate: { ...date } }, tp)).toBeNull();
  });
  it("patches a rename", () => {
    expect(timepointSyncPatch({ name: "S2", campaignDate: date }, tp)).toEqual({ label: "S2" });
  });
  it("patches a date change", () => {
    const next = { ...date, day: 6 };
    expect(timepointSyncPatch({ name: "S1", campaignDate: next }, tp)).toEqual({ campaignDate: next });
  });
  it("ignores a cleared session date", () => {
    expect(timepointSyncPatch({ name: "S1", campaignDate: null }, tp)).toBeNull();
  });
});
