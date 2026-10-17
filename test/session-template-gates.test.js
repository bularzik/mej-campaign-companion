import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tpl = readFileSync(new URL("../templates/session.hbs", import.meta.url), "utf8");
const between = (from, to) => tpl.slice(tpl.indexOf(from), tpl.indexOf(to, tpl.indexOf(from)));

describe("session.hbs player gates (spec 2026-10-15 item 9)", () => {
  it("the attendee drag hint renders only for editors", () => {
    const attendees = between('<div class="attendees-section">', '<div class="secrets-section">');
    expect(attendees).toMatch(/\{\{#if \(and @root\.editable @root\.isGM\)\}\}\s*<li class="instruction">\{\{localize 'MEJCampaignCompanion\.session\.dragActorHint'\}\}<\/li>/);
  });
  it("the Secrets section renders for the GM, or for a player who has revealed secrets to read", () => {
    const idx = tpl.indexOf('<div class="secrets-section">');
    const before = tpl.slice(idx - 80, idx);
    // Not a bare isGM gate: `secrets` is already filtered to what this viewer
    // may see (SessionSheet context), so a player with a revealed checklist
    // secret must still get the section; only the empty heading goes away.
    expect(before).toContain("{{#if (or @root.isGM secrets.length)}}");
  });
  it("GM Notes stay GM-only", () => {
    const idx = tpl.indexOf('class="flexcol editor-parent gm-notes"');
    expect(tpl.slice(idx - 80, idx)).toContain("{{#if @root.isGM}}");
  });
});
