import { describe, it, expect } from "vitest";
import { saveTriggers, shouldPatchRegions, saveFailureNotice } from "../scripts/logic/editor-save.mjs";

describe("saveTriggers", () => {
  it.each(["blur", "tabchange", "close", "interval", "visibilityhidden"])("%s saves", (e) => expect(saveTriggers(e)).toBe(true));
  it("typing alone does not save", () => expect(saveTriggers("input")).toBe(false));
});

describe("shouldPatchRegions", () => {
  it("a Session sheet is patched in place", () => expect(shouldPatchRegions({ isSessionSheet: true })).toBe(true));
  it("other views re-render", () => expect(shouldPatchRegions({ isSessionSheet: false })).toBe(false));
  it("an active editor makes no difference on a Session sheet", () =>
    expect(shouldPatchRegions({ isSessionSheet: true, editorActive: true })).toBe(true));
});

import { autosaveIntervalMs, myNotesSavePath, needsCommit, canRefreshIdleEditor, saveStateKey, EDITOR_IDS } from "../scripts/logic/editor-save.mjs";
import { myNotesDraftKey } from "../scripts/logic/input-draft.mjs";

describe("autosaveIntervalMs (core.editorAutosaveSecs, clamped 30-300)", () => {
  it("uses the setting in seconds", () => expect(autosaveIntervalMs(90)).toBe(90_000));
  it("clamps below 30 and above 300", () => {
    expect(autosaveIntervalMs(5)).toBe(30_000);
    expect(autosaveIntervalMs(1000)).toBe(300_000);
  });
  it("falls back to 60 for a missing or non-numeric value", () => {
    expect(autosaveIntervalMs(undefined)).toBe(60_000);
    expect(autosaveIntervalMs("x")).toBe(60_000);
    expect(autosaveIntervalMs(NaN)).toBe(60_000);
  });
});

describe("myNotesSavePath", () => {
  it("writes directly when the user can edit the page", () =>
    expect(myNotesSavePath({ canEditPage: true, hasActiveGM: false })).toBe("direct"));
  it("relays through MEJ's saveUserData when a GM is connected", () =>
    expect(myNotesSavePath({ canEditPage: false, hasActiveGM: true })).toBe("relay"));
  it("keeps a local draft when no GM is connected", () =>
    expect(myNotesSavePath({ canEditPage: false, hasActiveGM: false })).toBe("draft"));
});

describe("needsCommit", () => {
  it("is true only when the live value differs from what was last saved", () => {
    expect(needsCommit({ live: "<p>a</p>", baseline: "<p>a</p>" })).toBe(false);
    expect(needsCommit({ live: "<p>ab</p>", baseline: "<p>a</p>" })).toBe(true);
  });
  it("an editor that never activated (no baseline) or has no value commits nothing", () => {
    expect(needsCommit({ live: "<p>a</p>", baseline: undefined })).toBe(false);
    expect(needsCommit({ live: undefined, baseline: "<p>a</p>" })).toBe(false);
  });
});

describe("canRefreshIdleEditor", () => {
  it("refreshes only an editor nobody is typing in and that holds nothing unsaved", () => {
    expect(canRefreshIdleEditor({ editing: false, dirty: false, pending: false })).toBe(true);
    expect(canRefreshIdleEditor({ editing: true, dirty: false, pending: false })).toBe(false);
    expect(canRefreshIdleEditor({ editing: false, dirty: true, pending: false })).toBe(false);
    expect(canRefreshIdleEditor({ editing: false, dirty: false, pending: true })).toBe(false);
  });
});

describe("saveStateKey", () => {
  it("maps each indicator state to its string", () => {
    expect(saveStateKey("saving")).toBe("session.saving");
    expect(saveStateKey("saved")).toBe("session.saved");
    expect(saveStateKey("noGM")).toBe("session.saveNoGM");
    expect(saveStateKey("failed")).toBe("session.saveFailed");
    expect(saveStateKey("idle")).toBe(null);
  });
});

describe("EDITOR_IDS", () => {
  it("names the three Session editors", () => expect(EDITOR_IDS).toEqual(["recap", "gmNotes", "myNotes"]));
});

describe("myNotesDraftKey", () => {
  it("keys the no-GM draft by page uuid", () =>
    expect(myNotesDraftKey("JournalEntry.a.JournalEntryPage.b")).toBe("mynotes:JournalEntry.a.JournalEntryPage.b"));
});

import { withBufferedText } from "../scripts/logic/editor-save.mjs";

describe("withBufferedText (keystrokes typed before a collaborative join finished)", () => {
  it("returns the value unchanged when nothing was buffered", () => {
    expect(withBufferedText("<p>a</p>", "")).toBe("<p>a</p>");
    expect(withBufferedText("<p>a</p>", undefined)).toBe("<p>a</p>");
  });
  it("appends the typed text to the last paragraph", () => {
    expect(withBufferedText("<p>Opening line.</p>", " more")).toBe("<p>Opening line. more</p>");
  });
  it("starts a paragraph when the value is empty or does not end in one", () => {
    expect(withBufferedText("", "hello")).toBe("<p>hello</p>");
    expect(withBufferedText("<ul><li>x</li></ul>", "y")).toBe("<ul><li>x</li></ul><p>y</p>");
  });
  it("escapes the typed characters", () => {
    expect(withBufferedText("", "<b>&")).toBe("<p>&lt;b&gt;&amp;</p>");
  });
});

describe("saveFailureNotice", () => {
  it("a failure nobody can see on the page is announced, naming the field", () => {
    expect(saveFailureNotice({ state: "failed", indicators: 0, editorId: "recap" })).toEqual({ key: "session.saveFailedField", fieldKey: "tabs.description" });
    expect(saveFailureNotice({ state: "failed", indicators: 0, editorId: "gmNotes" })).toEqual({ key: "session.saveFailedField", fieldKey: "session.gmNotes" });
    expect(saveFailureNotice({ state: "failed", indicators: 0, editorId: "myNotes" })).toEqual({ key: "session.saveFailedField", fieldKey: "tabs.notes" });
  });
  it("a failure shown on an open sheet's indicator is not", () =>
    expect(saveFailureNotice({ state: "failed", indicators: 1, editorId: "recap" })).toBeNull());
  it.each(["saving", "saved", "noGM", null])("state %s is not a failure", (state) =>
    expect(saveFailureNotice({ state, indicators: 0, editorId: "recap" })).toBeNull());
});
