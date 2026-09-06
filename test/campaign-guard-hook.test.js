// @vitest-environment jsdom
// stripCampaignOptions is DOM surgery on a page-type <select>; its top-level
// imports are constants + pure logic only (no Hooks/game reference at module
// scope), so it loads fine under jsdom without any Foundry stubbing (spec
// 2026-09-06 §3, final fix wave F1).
import { describe, it, expect } from "vitest";
import { stripCampaignOptions } from "../scripts/hooks/campaign-guard.mjs";

/** Build a <select> (optionally inside an <optgroup>) from {value,label,selected} rows and return it attached to a fresh root. */
function selectFixture(name, options, { grouped = false } = {}) {
  const root = document.createElement("div");
  const select = document.createElement("select");
  select.name = name;
  const parent = grouped ? select.appendChild(document.createElement("optgroup")) : select;
  for (const { value, label = value, selected = false } of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = selected;
    parent.appendChild(opt);
  }
  root.appendChild(select);
  return { root, select };
}

const values = (select) => [...select.options].map((o) => o.value);

describe("stripCampaignOptions", () => {
  it("strips both Campaign spellings from MEJ's own pagetype select", () => {
    const { root, select } = selectFixture('flags.monks-enhanced-journal.pagetype', [
      { value: "text" }, { value: "campaign" }, { value: "mej-campaign-companion.campaign" }, { value: "session" }
    ]);
    stripCampaignOptions(root);
    expect(values(select)).toEqual(["text", "session"]);
  });

  it("strips only the prefixed subtype from Foundry's generic type select, leaving a same-named third-party subtype alone", () => {
    const { root, select } = selectFixture("type", [
      { value: "text" }, { value: "campaign" }, { value: "mej-campaign-companion.campaign" }
    ]);
    stripCampaignOptions(root);
    expect(values(select)).toEqual(["text", "campaign"]);
  });

  it("reselects the first remaining option when the removed option was selected", () => {
    const { root, select } = selectFixture('flags.monks-enhanced-journal.pagetype', [
      { value: "campaign", selected: true }, { value: "text" }, { value: "session" }
    ]);
    stripCampaignOptions(root);
    expect(select.selectedIndex).toBe(0);
    expect(select.value).toBe("text");
  });

  it("removes an optgroup left with zero options after stripping", () => {
    const { root, select } = selectFixture('flags.monks-enhanced-journal.pagetype',
      [{ value: "campaign" }, { value: "mej-campaign-companion.campaign" }], { grouped: true });
    stripCampaignOptions(root);
    expect(select.querySelectorAll("optgroup")).toHaveLength(0);
    expect(values(select)).toEqual([]);
  });

  it("is idempotent: calling twice does nothing further", () => {
    const { root, select } = selectFixture('flags.monks-enhanced-journal.pagetype', [
      { value: "text" }, { value: "campaign" }, { value: "session" }
    ]);
    stripCampaignOptions(root);
    const after1 = values(select);
    stripCampaignOptions(root);
    expect(values(select)).toEqual(after1);
  });
});
