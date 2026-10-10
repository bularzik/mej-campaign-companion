// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// rel-tab-wrap.mjs dynamically imports MEJ's sheet classes by absolute
// /modules/ URL, which vite cannot resolve outside Foundry.
vi.mock("../scripts/hooks/rel-tab-wrap.mjs", () => ({ playerConnectionsEnabled: () => true }));
import { connectionEntries, entryType, trackEditing, shouldKeepBlock } from "../scripts/hooks/player-connections-ui.mjs";

// mejType() (mej-adapter) asks game.MonksEnhancedJournal.getMEJType; stub it.
beforeEach(() => {
  globalThis.game = { MonksEnhancedJournal: { getMEJType: (doc) => doc?.__type ?? false } };
});
afterEach(() => {
  delete globalThis.game;
  document.body.innerHTML = "";
});

const page = (type, flag) => ({ __type: type, flags: flag ? { "mej-campaign-companion": { playerConnections: flag } } : {} });
const entryOf = (uuid, ...pages) => ({ uuid, pages: { contents: pages } });

describe("entryType (shared with the add-connection dialog)", () => {
  it("is the MEJ type of the entry's first MEJ-typed page", () => {
    expect(entryType(entryOf("J.ilva", page(false), page("person"), page("place")))).toBe("person");
  });
  it("resolves a uuid first; null for no typed page, no entry or an unresolvable uuid", () => {
    const ilva = entryOf("J.ilva", page("place"));
    const resolve = (uuid) => (uuid === "J.ilva" ? ilva : null);
    expect(entryType("J.ilva", resolve)).toBe("place");
    expect(entryType("J.gone", resolve)).toBeNull();
    expect(entryType(entryOf("J.text", page(false)))).toBeNull();
    expect(entryType(null)).toBeNull();
  });
});

describe("connectionEntries (spec §3, §4.5)", () => {
  const note = (label) => ({ authorName: "x", label, secret: "", revealed: false, updated: 1 });
  const conn = (id, to, authorId, shared = true) => ({ id, to, authorId, authorName: authorId, shared, sides: { from: { notes: { [authorId]: note(id) } } } });
  const ilvaPage = page("person", {
    c1: conn("c1", "J.mara", "u1"),
    c2: conn("c2", "J.bren", "u2", false),
    c3: conn("c3", "J.hidden", "u1"),
    c4: conn("c4", "J.gone", "u1")
  });
  const ilva = entryOf("J.ilva", ilvaPage);
  const incomingRow = { id: "c9", from: "J.bren", to: "J.ilva", authorId: "u2", authorName: "u2", shared: true, created: 0,
    sides: { from: { notes: { u2: note("Rival of") } }, to: { notes: {} } } };
  const names = { "J.mara": "Mara", "J.bren": "Bren", "J.hidden": "Hidden" };
  const deps = (over = {}) => ({
    userId: "u1", isGM: false, enabled: true, knownUserIds: new Set(["u1", "u2"]),
    canObserve: () => true,
    canLimited: (uuid) => uuid !== "J.hidden" && uuid !== "J.gone",
    incoming: (uuid) => (uuid === "J.ilva" ? [{ fromUuid: "J.bren", row: incomingRow }] : []),
    targetInfo: (uuid) => (names[uuid] ? { uuid, name: names[uuid], img: "x.png", type: "person" } : null),
    ...over
  });

  it("lists this entry's own connections (from side) and those pointing at it (to side)", () => {
    const rows = connectionEntries(ilva, ilvaPage, deps({ isGM: true }));
    expect(rows.map((r) => [r.view.id, r.view.side, r.target?.name ?? null])).toEqual([
      ["c1", "from", "Mara"], ["c2", "from", "Bren"], ["c3", "from", "Hidden"], ["c4", "from", null], ["c9", "to", "Bren"]
    ]);
    expect(rows[0].row.from).toBe("J.ilva");
    expect(rows[4].view.reverse).toBe(true);
    expect(rows[4].view.otherUuid).toBe("J.bren");
  });
  it("a player sees shared rows and their own private ones, never a row whose other end they can't see", () => {
    const ids = connectionEntries(ilva, ilvaPage, deps()).map((r) => r.view.id);
    expect(ids).toEqual(["c1", "c9"]);
    const asU2 = connectionEntries(ilva, ilvaPage, deps({ userId: "u2" })).map((r) => r.view.id);
    expect(asU2).toEqual(["c1", "c2", "c9"]);
  });
  it("an unresolved target reaches the block as target null (GM only)", () => {
    const gone = connectionEntries(ilva, ilvaPage, deps({ isGM: true })).find((r) => r.view.id === "c4");
    expect(gone.target).toBeNull();
  });
  it("OBSERVER on this entry gates adding notes; the setting gates editing", () => {
    const noObserve = connectionEntries(ilva, ilvaPage, deps({ userId: "u2", canObserve: () => false }));
    expect(noObserve.find((r) => r.view.id === "c1").view.canAddNote).toBe(false);
    const observe = connectionEntries(ilva, ilvaPage, deps({ userId: "u2" }));
    expect(observe.find((r) => r.view.id === "c1").view.canAddNote).toBe(true);
    const off = connectionEntries(ilva, ilvaPage, deps({ enabled: false }));
    expect(off.find((r) => r.view.id === "c1").view.main.editable).toBe(false);
  });
  it("no flag and nothing incoming = no rows", () => {
    const bare = page("person");
    expect(connectionEntries(entryOf("J.x", bare), bare, deps())).toEqual([]);
  });
});

describe("trackEditing - a re-render never wipes text being typed", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  function setup() {
    const block = document.createElement("section");
    block.innerHTML = '<input class="a" value="abc"><button type="button">x</button>'
      + '<ol><li class="mej-cc-pc-note new"><input class="draft"></li></ol>';
    const outside = document.createElement("input");
    document.body.append(block, outside);
    const onSettled = vi.fn();
    return { block, outside, onSettled, tracker: trackEditing(block, onSettled) };
  }

  it("a focused text field is an edit in progress; moving focus out settles it", async () => {
    const { block, outside, onSettled, tracker } = setup();
    expect(tracker.editing()).toBe(false);
    block.querySelector("input.a").focus();
    expect(tracker.editing()).toBe(true);
    outside.focus();
    await tick();
    expect(tracker.editing()).toBe(false);
    expect(onSettled).toHaveBeenCalled();
  });
  it("focus on a button is not an edit (its click result should show at once)", () => {
    const { block, tracker } = setup();
    block.querySelector("button").focus();
    expect(tracker.editing()).toBe(false);
  });
  it("being removed by a re-render does not count as leaving; restoreFocus puts the caret back", async () => {
    const { block, onSettled, tracker } = setup();
    const input = block.querySelector("input.a");
    input.focus();
    input.setSelectionRange(1, 2);
    block.remove();
    // jsdom fires nothing on removal; some browsers fire focusout - cover that.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();
    expect(tracker.editing()).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();
    document.body.append(block);
    tracker.restoreFocus();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 2]);
  });
  it("an add-note draft holding unsent text is an edit until its change event sends it", async () => {
    const { block, onSettled, tracker } = setup();
    const draft = block.querySelector("input.draft");
    draft.value = "Owes me";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tracker.editing()).toBe(true);
    draft.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(tracker.editing()).toBe(false);
    expect(onSettled).toHaveBeenCalled();
  });
});

describe("shouldKeepBlock", () => {
  it("keeps the live block only for the same page while an edit is in progress", () => {
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P1", editing: true })).toBe(true);
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P1", editing: false })).toBe(false);
    expect(shouldKeepBlock({ prevPageUuid: "P1", pageUuid: "P2", editing: true })).toBe(false);
    expect(shouldKeepBlock({ prevPageUuid: undefined, pageUuid: "P1", editing: true })).toBe(false);
  });
});
