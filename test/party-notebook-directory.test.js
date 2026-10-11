// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hidePartyNotebookRows, registerPartyNotebookDirectory } from "../scripts/hooks/party-notebook-directory.mjs";

beforeEach(() => {
  globalThis.game = { journal: new Map([
    ["nb", { flags: { "mej-campaign-companion": { partyNotebook: true } } }],
    ["e1", { flags: {} }]
  ]) };
});

describe("hidePartyNotebookRows", () => {
  it("removes notebook rows only, idempotently", () => {
    document.body.innerHTML = `<ol><li data-entry-id="nb"></li><li data-entry-id="e1"></li></ol>`;
    hidePartyNotebookRows(document.body);
    hidePartyNotebookRows(document.body);
    expect([...document.querySelectorAll("li")].map((li) => li.dataset.entryId)).toEqual(["e1"]);
  });
});

describe("registerPartyNotebookDirectory (registered at init - Final review IMP 2)", () => {
  afterEach(() => {
    delete globalThis.Hooks;
    delete globalThis.ui;
  });
  it("hooks both sidebars and hides rows already rendered", () => {
    const on = vi.fn();
    globalThis.Hooks = { on };
    document.body.innerHTML = `<section id="sidebar"><li data-entry-id="nb"></li><li data-entry-id="e1"></li></section>`;
    globalThis.ui = { journal: { rendered: true, element: document.querySelector("#sidebar") } };
    registerPartyNotebookDirectory();
    expect(on.mock.calls.map((c) => c[0])).toEqual(["renderJournalDirectory", "renderEnhancedJournal"]);
    expect([...document.querySelectorAll("li")].map((li) => li.dataset.entryId)).toEqual(["e1"]);
    document.body.innerHTML = `<ol><li data-entry-id="nb"></li></ol>`;
    on.mock.calls[0][1]({}, document.body);
    expect(document.querySelectorAll("li")).toHaveLength(0);
  });
  it("is a no-op before the sidebar renders or journal data exists", () => {
    globalThis.Hooks = { on: vi.fn() };
    globalThis.ui = { journal: { rendered: false } };
    expect(() => registerPartyNotebookDirectory()).not.toThrow();
    delete globalThis.game;
    expect(() => hidePartyNotebookRows(document.body)).not.toThrow();
  });
});
