import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).MEJCampaignCompanion;
const get = (k) => k.split(".").reduce((o, p) => o?.[p], en);
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : flat(v, `${p}${k}.`)));

describe("wording rules (spec 2026-10-15 item 17)", () => {
  it("'Add …' labels are sentence case", () => {
    for (const [k, v] of flat(en)) {
      if (/^Add [A-Z]/.test(v) && !/^Add (GM|PDF)/.test(v)) expect(`${k}=${v}`).toBe("");
    }
  });
  it("no three-dot ellipsis in any string", () => {
    for (const [k, v] of flat(en)) expect(v, k).not.toMatch(/\.\.\./);
  });
  it("player-facing labels say entry, not entity", () => {
    for (const k of ["entityFromSelection.menu", "entityFromSelection.menuLink", "entityFromSelection.pickLabel", "entityFromSelection.title"]) {
      expect(get(k), k).not.toMatch(/entit/i);
    }
  });
  it("the Index eye tooltip names what it does", () => {
    expect(get("hub.hide")).toBe("Hide entry from players");
    expect(get("hub.reveal")).toBe("Share entry with players");
  });
  it("the contributors hint covers party relationships", () => {
    expect(get("hub.contributorsHint")).toMatch(/party relationships/);
  });
});
