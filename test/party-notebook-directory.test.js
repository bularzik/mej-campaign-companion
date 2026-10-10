// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { hidePartyNotebookRows } from "../scripts/hooks/party-notebook.mjs";

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
