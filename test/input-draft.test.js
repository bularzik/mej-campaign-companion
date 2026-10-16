import { describe, it, expect } from "vitest";
import { trackDraft, restoreDraft, clearDraft, keepDraft, sessionDraftKey, tonightDraftKey } from "../scripts/logic/input-draft.mjs";

// Minimal stand-in for an <input> in a document (vitest runs in node).
function fakeDoc() {
  const doc = { body: { isConnected: true }, activeElement: null };
  doc.activeElement = doc.body;
  return doc;
}
function fakeInput(doc) {
  const listeners = {};
  const input = {
    ownerDocument: doc, value: "", selectionStart: 0, selectionEnd: 0, isConnected: true,
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    fire: (type) => (listeners[type] ?? []).forEach((fn) => fn({ currentTarget: input })),
    type(text) { input.value = text; input.selectionStart = input.selectionEnd = text.length; doc.activeElement = input; input.fire("input"); },
    focus() { doc.activeElement = input; },
    setSelectionRange(a, b) { input.selectionStart = a; input.selectionEnd = b; }
  };
  return input;
}
const tick = () => new Promise((r) => queueMicrotask(r));

describe("capture box drafts survive re-renders (whole-branch finding 2)", () => {
  it("a re-render that replaces the focused box restores its value, focus and caret", async () => {
    const doc = fakeDoc();
    const drafts = new Map();
    const key = sessionDraftKey("JournalEntry.s.JournalEntryPage.p");
    const before = fakeInput(doc);
    trackDraft(before, drafts, key);
    before.type("the duke lied");
    before.setSelectionRange(4, 4);
    before.fire("keyup");
    // Render: the old box leaves the document (a browser may fire blur), focus falls to body.
    before.isConnected = false;
    doc.activeElement = doc.body;
    before.fire("blur");
    await tick();
    const after = fakeInput(doc);
    expect(restoreDraft(after, drafts, key)).toBe(true);
    expect(after.value).toBe("the duke lied");
    expect(doc.activeElement).toBe(after);
    expect([after.selectionStart, after.selectionEnd]).toEqual([4, 4]);
  });

  it("keeps the text but not focus once the user has left the box", async () => {
    const doc = fakeDoc();
    const drafts = new Map();
    const key = tonightDraftKey();
    const before = fakeInput(doc);
    trackDraft(before, drafts, key);
    before.type("half a thought");
    doc.activeElement = doc.body;
    before.fire("blur"); // still connected: a real blur
    await tick();
    const after = fakeInput(doc);
    restoreDraft(after, drafts, key);
    expect(after.value).toBe("half a thought");
    expect(doc.activeElement).toBe(doc.body);
  });

  it("never steals focus from another field the user moved into", () => {
    const doc = fakeDoc();
    const drafts = new Map();
    keepDraft(drafts, "k", "draft");
    const other = { isConnected: true };
    doc.activeElement = other;
    const after = fakeInput(doc);
    restoreDraft(after, drafts, "k");
    expect(after.value).toBe("draft");
    expect(doc.activeElement).toBe(other);
  });

  it("a filed note clears the draft, so the next render shows an empty box", () => {
    const doc = fakeDoc();
    const drafts = new Map();
    const before = fakeInput(doc);
    trackDraft(before, drafts, "k");
    before.type("filed");
    clearDraft(drafts, "k");
    const after = fakeInput(doc);
    expect(restoreDraft(after, drafts, "k")).toBe(false);
    expect(after.value).toBe("");
  });

  it("emptying the box drops the draft; a failed capture keeps the text", () => {
    const doc = fakeDoc();
    const drafts = new Map();
    const input = fakeInput(doc);
    trackDraft(input, drafts, "k");
    input.type("x");
    input.type("");
    expect(drafts.has("k")).toBe(false);
    keepDraft(drafts, "k", "retry me");
    input.isConnected = false; // the post-capture render replaced the box
    const after = fakeInput(doc);
    restoreDraft(after, drafts, "k");
    expect(after.value).toBe("retry me");
    expect(after.selectionStart).toBe(8);
  });
});
