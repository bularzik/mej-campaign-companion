import { describe, it, expect } from "vitest";
import { createDraftStore, draftStorageKey } from "../scripts/logic/draft-store.mjs";

function fakeStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}
const throwing = () => ({
  get length() { throw new Error("denied"); },
  key() { throw new Error("denied"); },
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("quota"); },
  removeItem() { throw new Error("denied"); }
});
const PAGE = "JournalEntry.abc.JournalEntryPage.def";

describe("draftStorageKey", () => {
  it("keys by user, page and field", () =>
    expect(draftStorageKey("u1", PAGE, "recap")).toBe(`mej-cc-draft|u1|${PAGE}|recap`));
  it("differs per user and per field", () => {
    expect(draftStorageKey("u1", PAGE, "recap")).not.toBe(draftStorageKey("u2", PAGE, "recap"));
    expect(draftStorageKey("u1", PAGE, "recap")).not.toBe(draftStorageKey("u1", PAGE, "gmNotes"));
  });
});

describe("createDraftStore", () => {
  it("saves and loads a draft with the value it was based on", () => {
    const s = fakeStorage();
    const store = createDraftStore(() => s, "u1", () => 42);
    expect(store.save(PAGE, "gmNotes", "<p>typed</p>", "<p>old</p>")).toBe(true);
    expect(store.load(PAGE, "gmNotes")).toEqual({ value: "<p>typed</p>", base: "<p>old</p>", at: 42 });
  });
  it("loads nothing for another user's or another field's draft", () => {
    const s = fakeStorage();
    createDraftStore(() => s, "u1").save(PAGE, "recap", "x");
    expect(createDraftStore(() => s, "u2").load(PAGE, "recap")).toBeNull();
    expect(createDraftStore(() => s, "u1").load(PAGE, "myNotes")).toBeNull();
  });
  it("clear removes it", () => {
    const s = fakeStorage();
    const store = createDraftStore(() => s, "u1");
    store.save(PAGE, "recap", "x");
    store.clear(PAGE, "recap");
    expect(store.load(PAGE, "recap")).toBeNull();
    expect(s.map.size).toBe(0);
  });
  it("lists this user's drafts only, with page and field", () => {
    const s = fakeStorage();
    createDraftStore(() => s, "u1", () => 1).save(PAGE, "recap", "a", "b");
    createDraftStore(() => s, "u1", () => 2).save("JournalEntry.x.JournalEntryPage.y", "myNotes", "n");
    createDraftStore(() => s, "u2").save(PAGE, "recap", "other");
    s.setItem("unrelated", "1");
    const list = createDraftStore(() => s, "u1").list().sort((x, y) => x.at - y.at);
    expect(list).toEqual([
      { pageUuid: PAGE, field: "recap", value: "a", base: "b", at: 1 },
      { pageUuid: "JournalEntry.x.JournalEntryPage.y", field: "myNotes", value: "n", base: null, at: 2 }
    ]);
  });
  it("ignores corrupt entries", () => {
    const s = fakeStorage();
    s.setItem(draftStorageKey("u1", PAGE, "recap"), "{not json");
    s.setItem(draftStorageKey("u1", PAGE, "gmNotes"), JSON.stringify({ value: 5 }));
    const store = createDraftStore(() => s, "u1");
    expect(store.load(PAGE, "recap")).toBeNull();
    expect(store.load(PAGE, "gmNotes")).toBeNull();
    expect(store.list()).toEqual([]);
  });
  it("survives a storage that throws on every access", () => {
    const store = createDraftStore(throwing, "u1");
    expect(store.save(PAGE, "recap", "x")).toBe(false);
    expect(store.load(PAGE, "recap")).toBeNull();
    expect(() => store.clear(PAGE, "recap")).not.toThrow();
    expect(store.list()).toEqual([]);
  });
  it("survives a storage accessor that throws, or no storage at all", () => {
    for (const get of [() => { throw new Error("SecurityError"); }, () => null, () => undefined]) {
      const store = createDraftStore(get, "u1");
      expect(store.save(PAGE, "recap", "x")).toBe(false);
      expect(store.load(PAGE, "recap")).toBeNull();
      expect(() => store.clear(PAGE, "recap")).not.toThrow();
      expect(store.list()).toEqual([]);
    }
  });
  it("needs a user and a page", () => {
    const s = fakeStorage();
    expect(createDraftStore(() => s, "").save(PAGE, "recap", "x")).toBe(false);
    expect(createDraftStore(() => s, "u1").save("", "recap", "x")).toBe(false);
    expect(s.map.size).toBe(0);
  });
});
