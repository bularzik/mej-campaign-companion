import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tpl = readFileSync(new URL("../templates/session.hbs", import.meta.url), "utf8");
const headerTpl = readFileSync(new URL("../templates/session-header.hbs", import.meta.url), "utf8");
const between = (from, to) => tpl.slice(tpl.indexOf(from), tpl.indexOf(to, tpl.indexOf(from)));
const SECRETS = '<details class="mej-cc-section secrets-section"';
const GM_PREP = '<details class="mej-cc-section gm-prep"';
const details = between('data-tab="session"', 'data-tab="relationships"');

describe("session.hbs player gates (spec 2026-10-15 item 9)", () => {
  it("the Details tab no longer carries an attendees section (they live in the header)", () => {
    expect(tpl).not.toContain("attendees-section");
    expect(tpl).not.toContain("attendees-list");
  });
  it("the header's attendee control and chip remove render only when canManageAttendees (GM or owner)", () => {
    const control = headerTpl.slice(headerTpl.indexOf('data-action="manageAttendees"') - 200, headerTpl.indexOf('data-action="manageAttendees"'));
    expect(control).toContain("{{#if header.canManageAttendees}}");
    const remove = headerTpl.slice(headerTpl.indexOf('data-action="removeAttendee"') - 120, headerTpl.indexOf('data-action="removeAttendee"'));
    expect(remove).toContain("{{#if @root.header.canManageAttendees}}");
  });
  it("the Secrets section renders for the GM, or for a player who has revealed secrets to read", () => {
    const idx = tpl.indexOf(SECRETS);
    expect(idx).toBeGreaterThan(-1);
    const before = tpl.slice(idx - 80, idx);
    // Not a bare isGM gate: `secrets` is already filtered to what this viewer
    // may see (SessionSheet context), so a player with a revealed checklist
    // secret must still get the section; only the empty heading goes away.
    expect(before).toContain("{{#if (or @root.isGM secrets.length)}}");
  });
  it("GM Prep stays GM-only", () => {
    const idx = tpl.indexOf(GM_PREP);
    expect(idx).toBeGreaterThan(-1);
    expect(tpl.slice(idx - 80, idx)).toContain("{{#if @root.isGM}}");
    // The editor itself lives inside that gated section.
    const prep = tpl.slice(idx, tpl.indexOf("</details>", idx));
    expect(prep).toContain('class="flexcol editor-parent gm-notes"');
  });
});

describe("session.hbs Details tab (spec 2026-10-19 §4.5)", () => {
  it("holds two collapsible sections, Secrets & clues and GM Prep", () => {
    expect(details.match(/<details class="mej-cc-section[ "]/g)).toHaveLength(2);
  });
  it("the Secrets summary carries + add and the prep-board link, GM-only", () => {
    const idx = details.indexOf(SECRETS);
    const summary = details.slice(details.indexOf("<summary", idx), details.indexOf("</summary>", idx));
    expect(summary).toContain('data-action="addSecret"');
    expect(summary).toContain('data-action="openPrepBoard"');
    expect(summary).toContain("{{#if @root.isGM}}");
    expect(summary).toContain("secrets.length");
  });
  it("the in-game date is one row of the same five fields", () => {
    const row = between('class="form-group mej-cc-date-row"', "</div>");
    for (const f of ["year", "month", "day", "hour", "minute"]) {
      expect(row).toContain(`name="flags.mej-campaign-companion.session.campaignDate.${f}"`);
    }
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
