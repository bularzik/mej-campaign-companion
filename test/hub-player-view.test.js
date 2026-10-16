import { describe, it, expect } from "vitest";
import { playerHeaderMode, scopeOptionsForUser, playerTabOrder, lockedScopeId, defaultHubTab } from "../scripts/logic/hub-player-view.mjs";

const one = [{ id: "c1", name: "Radiant Citadel" }];
const two = [{ id: "c1", name: "Radiant Citadel" }, { id: "c2", name: "Vale" }];
const labels = { all: "All campaigns", unfiled: "Unfiled", newCampaign: "➕ New Campaign…" };
const TABS = [
  { id: "index" }, { id: "timeline" }, { id: "graph" }, { id: "search" }, { id: "dashboards" }, { id: "secrets" }
];

describe("playerHeaderMode", () => {
  it("non-GM with exactly one visible campaign gets a title", () => {
    expect(playerHeaderMode(one, { isGM: false })).toEqual({ mode: "title", title: "Radiant Citadel", campaignId: "c1" });
  });
  it("non-GM with two visible campaigns keeps the picker (Review Focus 2)", () => {
    expect(playerHeaderMode(two, { isGM: false })).toEqual({ mode: "picker", title: null, campaignId: null });
  });
  it("non-GM with no visible campaign keeps the picker (Review Focus 1)", () => {
    expect(playerHeaderMode([], { isGM: false })).toEqual({ mode: "picker", title: null, campaignId: null });
  });
  it("a GM always gets the picker, even with one campaign", () => {
    expect(playerHeaderMode(one, { isGM: true }).mode).toBe("picker");
  });
});

describe("scopeOptionsForUser", () => {
  it("GM: all, campaigns, unfiled when present, new campaign", () => {
    const out = scopeOptionsForUser(two, "c2", { isGM: true, hasUnfiled: true, labels });
    expect(out.map((o) => o.value)).toEqual(["", "c1", "c2", "unfiled", "__new"]);
    expect(out.find((o) => o.value === "c2").selected).toBe(true);
  });
  it("player: all and campaigns only, never unfiled or new (Review Focus 2)", () => {
    const out = scopeOptionsForUser(two, "", { isGM: false, hasUnfiled: true, labels });
    expect(out.map((o) => o.value)).toEqual(["", "c1", "c2"]);
    expect(out[0].label).toBe("All campaigns");
  });
  it("player with no campaigns: just All (Review Focus 1)", () => {
    expect(scopeOptionsForUser([], "", { isGM: false, hasUnfiled: true, labels }).map((o) => o.value)).toEqual([""]);
  });
});

describe("playerTabOrder", () => {
  it("GM order is untouched", () => {
    expect(playerTabOrder(TABS, { isGM: true, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["index", "timeline", "graph", "search", "dashboards", "secrets"]);
  });
  it("player order is sessions, index, timeline, graph, search", () => {
    expect(playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["sessions", "index", "timeline", "graph", "search"]);
  });
  it("player gets dashboards last only when one is visible to them", () => {
    expect(playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: true }).map((t) => t.id))
      .toEqual(["sessions", "index", "timeline", "graph", "search", "dashboards"]);
  });
  it("sessions tab object carries the icon the template needs", () => {
    const sessions = playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: false })[0];
    expect(sessions).toEqual({ id: "sessions", icon: "fa-solid fa-dice-d20" });
  });
  it("GM order includes sessions after index when the input has it", () => {
    const withSessions = [{ id: "index" }, { id: "sessions", icon: "fa-solid fa-dice-d20" }, ...TABS.slice(1)];
    expect(playerTabOrder(withSessions, { isGM: true, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["index", "sessions", "timeline", "graph", "search", "dashboards", "secrets"]);
  });
});

describe("lockedScopeId", () => {
  it("title mode forces the campaign", () => {
    expect(lockedScopeId({ mode: "title", campaignId: "c1" }, "")).toBe("c1");
    expect(lockedScopeId({ mode: "title", campaignId: "c1" }, "unfiled")).toBe("c1");
  });
  it("picker mode keeps the stored scope", () => {
    expect(lockedScopeId({ mode: "picker", campaignId: null }, "c2")).toBe("c2");
  });
});

describe("defaultHubTab", () => {
  it("player with no stored tab lands on Sessions while a session is open", () => {
    expect(defaultHubTab({ isGM: false, storedTab: null, hasOpenSession: true, fallback: "index" })).toBe("sessions");
  });
  it("a stored tab wins over the open session", () => {
    expect(defaultHubTab({ isGM: false, storedTab: "timeline", hasOpenSession: true, fallback: "index" })).toBe("timeline");
  });
  it("GM is unaffected by an open session", () => {
    expect(defaultHubTab({ isGM: true, storedTab: null, hasOpenSession: true, fallback: "index" })).toBe("index");
    expect(defaultHubTab({ isGM: true, storedTab: "graph", hasOpenSession: true, fallback: "index" })).toBe("graph");
  });
  it("no open session keeps the existing default", () => {
    expect(defaultHubTab({ isGM: false, storedTab: null, hasOpenSession: false, fallback: "index" })).toBe("index");
    expect(defaultHubTab({ isGM: false, storedTab: "", hasOpenSession: false, fallback: "index" })).toBe("index");
  });
});
