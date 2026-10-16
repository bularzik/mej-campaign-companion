import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).MEJCampaignCompanion;
const tpl = readFileSync(new URL("../templates/hub-help.hbs", import.meta.url), "utf8");

describe("hub-help partial (spec 2026-10-15 item 11)", () => {
  it("every localize key in the partial exists in en.json", () => {
    const keys = [...tpl.matchAll(/localize ['"]MEJCampaignCompanion\.([\w.]+)['"]/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(4);
    for (const k of keys) {
      const value = k.split(".").reduce((o, p) => o?.[p], en);
      expect(value, k).toBeTypeOf("string");
    }
  });
  it("has the five player lines and the guide link", () => {
    for (const k of ["sessions", "notes", "entries", "reveals", "lookBack"]) expect(en.help.lines[k]).toBeTypeOf("string");
    expect(en.help.open).toBe("Open the full user guide");
    expect(en.help.title).toBe("Help");
  });
  it("the timeline empty state no longer promises a GM action to players", () => {
    expect(en.hub.timelineEmptyState).toBe("No timeline yet.");
  });
});
