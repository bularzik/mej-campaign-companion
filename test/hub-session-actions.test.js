import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/apps/CampaignHubPage.mjs", import.meta.url), "utf8");
const method = (name) => {
  const start = src.indexOf(`static async ${name}(`);
  const end = src.indexOf("\n  static ", start + 1);
  return src.slice(start, end);
};

describe("Hub session actions (spec 2026-10-16 §1a, §1h)", () => {
  it("New Session never creates a loose session: a dismissed prompt falls back to the fallback campaign, silently", () => {
    const body = method("onNewSession");
    expect(body).toContain("?? await ensureFallbackCampaign()");
    expect(body).toContain("silent: true");
    expect(body).not.toMatch(/destination\s*=\s*campaign\s*\?/);
  });
  it("Start Session aborts when its prompt is dismissed and never falls back", () => {
    const body = method("onStartSession");
    expect(body).toContain("if (!campaign) return;");
    expect(body).not.toContain("ensureFallbackCampaign");
  });
  it("Add Timepoint with no campaign in scope files into the fallback campaign", () => {
    expect(method("onAddTimepoint")).toContain("?? await ensureFallbackCampaign()");
  });
});
