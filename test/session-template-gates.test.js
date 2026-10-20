import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tpl = readFileSync(new URL("../templates/session.hbs", import.meta.url), "utf8");
const headerTpl = readFileSync(new URL("../templates/session-header.hbs", import.meta.url), "utf8");
const between = (from, to) => tpl.slice(tpl.indexOf(from), tpl.indexOf(to, tpl.indexOf(from)));

describe("session.hbs player gates (spec 2026-10-15 item 9)", () => {
  it("the attendee drag hint renders for anyone who can edit — GM or owning player (spec 2026-10-16 §4)", () => {
    const attendees = between('<div class="attendees-section">', '<div class="secrets-section">');
    expect(attendees).toMatch(/\{\{#if @root\.editable\}\}\s*<li class="instruction">\{\{localize 'MEJCampaignCompanion\.session\.dragActorHint'\}\}<\/li>/);
    expect(attendees).not.toContain("(and @root.editable @root.isGM)");
  });
  it("the Secrets section renders for the GM, or for a player who has revealed secrets to read", () => {
    const idx = tpl.indexOf('<div class="secrets-section">');
    const before = tpl.slice(idx - 80, idx);
    // Not a bare isGM gate: `secrets` is already filtered to what this viewer
    // may see (SessionSheet context), so a player with a revealed checklist
    // secret must still get the section; only the empty heading goes away.
    expect(before).toContain("{{#if (or @root.isGM secrets.length)}}");
  });
  it("GM Prep stays GM-only", () => {
    const idx = tpl.indexOf('class="flexcol editor-parent gm-notes"');
    expect(tpl.slice(idx - 80, idx)).toContain("{{#if @root.isGM}}");
  });
});

describe("session.hbs header (spec 2026-10-19 §4.2)", () => {
  it("renders the companion header partial, not MEJ's detailed header or the Tonight strip", () => {
    expect(tpl).toContain('{{> "modules/mej-campaign-companion/templates/session-header.hbs"}}');
    expect(tpl).not.toContain("hub-tonight.hbs");
    expect(tpl).not.toContain("sheet-detailed-header.hbs");
  });
  it("the header is one region carrying the thumbnail, rename, value carrier and GM button", () => {
    expect(headerTpl).toMatch(/<header class="mej-cc-session-header[^"]*" data-cc-region="header"/);
    expect(headerTpl).toContain('data-action="viewImage"');
    expect(headerTpl).toContain('data-action="addImage"');
    expect(headerTpl).toMatch(/<img class="mej-cc-compact-src" data-edit="src"/);
    expect(headerTpl).toMatch(/<input type="text" name="name"/);
    expect(headerTpl).toContain('data-action="{{header.button.action}}"');
    expect(headerTpl).toContain('class="mej-cc-session-attendees"');
  });
});
