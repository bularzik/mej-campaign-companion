import { describe, it, expect } from "vitest";
import { recapChanged, shouldRefreshForRecap } from "../scripts/logic/recap-refresh.mjs";

describe("recapChanged", () => {
  it("is true for a recap or gmNotes change only", () => {
    expect(recapChanged({ system: { recap: "<p>x</p>" } })).toBe(true);
    expect(recapChanged({ system: { gmNotes: "" } })).toBe(true);
    expect(recapChanged({ name: "n" })).toBe(false);
    expect(recapChanged({ flags: { "mej-campaign-companion": { session: {} } } })).toBe(false);
    expect(recapChanged(undefined)).toBe(false);
  });
});

describe("shouldRefreshForRecap", () => {
  const changes = { system: { recap: "<p>x</p>" } };
  it("refreshes when the shell shows that page and nothing is being edited", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: false })).toBe(true);
  });
  it("never refreshes while an editor is open locally", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: true })).toBe(false);
  });
  it("ignores other pages and irrelevant changes", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p2", pageId: "p1", editing: false })).toBe(false);
    expect(shouldRefreshForRecap({ changes: { name: "n" }, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: false })).toBe(false);
    expect(shouldRefreshForRecap({ changes, activeEntityId: null, pageId: "p1", editing: false })).toBe(false);
  });
});
