import { describe, it, expect } from "vitest";
import { relationshipsTabVisible, countVisibleGmRows, applyRelationshipsTab } from "../scripts/logic/rel-tab-visibility.mjs";

describe("relationshipsTabVisible (spec §3 tab rules)", () => {
  const none = { isGM: false, visibleGmRows: 0, visiblePlayerRows: 0, canAdd: false };
  it("GM always", () => expect(relationshipsTabVisible({ ...none, isGM: true })).toBe(true));
  it("rule 1: a visible GM row", () => expect(relationshipsTabVisible({ ...none, visibleGmRows: 1 })).toBe(true));
  it("rule 2: a visible player connection", () => expect(relationshipsTabVisible({ ...none, visiblePlayerRows: 1 })).toBe(true));
  it("rule 3: can add", () => expect(relationshipsTabVisible({ ...none, canAdd: true })).toBe(true));
  it("nothing visible and can't add (LIMITED viewer, or setting off): hidden", () => expect(relationshipsTabVisible(none)).toBe(false));
});

describe("countVisibleGmRows", () => {
  const rels = {
    r1: { id: "r1", uuid: "J.a", hidden: false, type: "person" },
    r2: { id: "r2", uuid: "J.b", hidden: true, type: "place" },
    r3: { id: "r3", uuid: "J.c", hidden: false, type: "quest" },
    r4: { id: "r4", uuid: "J.gone", hidden: false, type: "quest" }
  };
  const base = { userId: "u1", groups: [], sheetType: "person", canSeeTarget: (u) => u !== "J.gone" };
  it("counts non-hidden rows whose target the viewer can see", () => {
    expect(countVisibleGmRows(rels, {}, base)).toBe(2);
  });
  it("counts a hidden row revealed to this player through relReveals", () => {
    expect(countVisibleGmRows(rels, { r2: { row: { users: ["u1"], groups: [], all: false } } }, base)).toBe(3);
  });
  it("on a Place, person/shop rows live on their own tabs and don't count", () => {
    expect(countVisibleGmRows(rels, {}, { ...base, sheetType: "place" })).toBe(1);
  });
  it("tolerates the legacy array form and nullish", () => {
    expect(countVisibleGmRows([{ id: "x", uuid: "J.a" }], {}, base)).toBe(1);
    expect(countVisibleGmRows(undefined, undefined, base)).toBe(0);
  });
});

describe("applyRelationshipsTab (spec §4.7)", () => {
  const tab = (id, active = false) => ({ id, group: "primary", active, cssClass: active ? "active" : "" });
  const full = { description: tab("description", true), relationships: tab("relationships"), notes: tab("notes") };
  it("removes the tab when not visible", () => {
    const { tabs, activate } = applyRelationshipsTab({ ...full }, { visible: false, hiddenBySetting: false, fullTabs: null });
    expect(Object.keys(tabs)).toEqual(["description", "notes"]);
    expect(activate).toBeNull();
  });
  it("activates the first remaining tab when the removed one was active", () => {
    const tabs = { description: tab("description"), relationships: tab("relationships", true), notes: tab("notes") };
    const out = applyRelationshipsTab(tabs, { visible: false, hiddenBySetting: false, fullTabs: null });
    expect(out.activate).toBe("description");
    expect(out.tabs.description).toMatchObject({ active: true, cssClass: "active" });
  });
  it("restores the tab MEJ removed for an empty raw flag, in its original position, inactive", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: false, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "relationships", "notes"]);
    expect(tabs.relationships).toMatchObject({ active: false, cssClass: "" });
  });
  it("never restores a tab the sheet-type setting hid (shown: false still wins)", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: true, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "notes"]);
  });
  it("keeps tabs a subclass added after the base list", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes"), townsfolk: tab("townsfolk") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: false, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "relationships", "notes", "townsfolk"]);
  });
  it("is a no-op on a sheet without a relationships tab, and idempotent (Place runs it twice)", () => {
    const hub = { index: tab("index", true) };
    expect(applyRelationshipsTab(hub, { visible: true, hiddenBySetting: false, fullTabs: { index: tab("index") } }).tabs).toBe(hub);
    const once = applyRelationshipsTab({ description: tab("description", true) }, { visible: true, hiddenBySetting: false, fullTabs: full }).tabs;
    const twice = applyRelationshipsTab(once, { visible: true, hiddenBySetting: false, fullTabs: full }).tabs;
    expect(twice).toEqual(once);
  });
});
