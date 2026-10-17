import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldFileSession, holdsSessionPage, pickFallbackCampaign, filingUpdate, filingLevel } from "../scripts/logic/session-filing.mjs";
import { campaignSessionTargetLevel } from "../scripts/logic/session-ownership.mjs";

const SESSION = "mej-campaign-companion.session";
// MEJ's fixType() leaves `type` as the bare key; `_source.type` keeps the subtype.
const sessionPage = (overrides = {}) => ({ type: "session", _source: { type: SESSION }, ...overrides });
const textPage = () => ({ type: "text", _source: { type: "text" } });
const entry = ({ folder = null, pages = [sessionPage()] } = {}) => ({ documentName: "JournalEntry", folder, pages: { contents: pages } });

describe("shouldFileSession (spec 2026-10-16 §1b)", () => {
  it("files a folderless entry holding a session page, even after MEJ rewrote the in-memory type", () => {
    expect(shouldFileSession(entry())).toBe(true);
  });
  it("leaves an entry in ANY folder alone — plain or campaign", () => {
    expect(shouldFileSession(entry({ folder: { id: "f1", flags: {} } }))).toBe(false);
    expect(shouldFileSession(entry({ folder: { id: "c1", flags: { "mej-campaign-companion": { campaign: {} } } } }))).toBe(false);
  });
  it("ignores folderless non-session entries, pages and nulls", () => {
    expect(shouldFileSession(entry({ pages: [textPage()] }))).toBe(false);
    expect(shouldFileSession({ documentName: "JournalEntryPage", parent: entry() })).toBe(false);
    expect(shouldFileSession(null)).toBe(false);
  });
  it("leaves a compendium (pack) entry alone", () => {
    expect(shouldFileSession({ documentName: "JournalEntry", folder: null, pack: "world.sessions", pages: { contents: [sessionPage()] } })).toBe(false);
  });
  it("files a multi-page entry whole when one page is a session", () => {
    expect(shouldFileSession(entry({ pages: [textPage(), sessionPage()] }))).toBe(true);
  });
  it("holdsSessionPage accepts creation-shaped data with a plain pages array", () => {
    expect(holdsSessionPage({ pages: [{ type: SESSION }] })).toBe(true);
    expect(holdsSessionPage({ pages: [{ type: "text" }] })).toBe(false);
  });
});

describe("pickFallbackCampaign (spec §1c reuse rule)", () => {
  const root = { id: "a", name: "New Campaign", folder: null };
  it("reuses the root campaign with exactly that name", () => {
    expect(pickFallbackCampaign([{ id: "x", name: "Alpha", folder: null }, root], "New Campaign")).toBe(root);
  });
  it("never matches a renamed, differently-cased or nested folder, nor an empty list", () => {
    expect(pickFallbackCampaign([{ id: "b", name: "New Campaign (old)", folder: null }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([{ id: "c", name: "new campaign", folder: null }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([{ id: "d", name: "New Campaign", folder: { id: "p" } }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([], "New Campaign")).toBeNull();
  });
  it("ships the English name the spec fixes", () => {
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    expect(lang.MEJCampaignCompanion.campaign.fallbackName).toBe("New Campaign");
  });
});

describe("filing ownership (spec §1b)", () => {
  const opts = { sessionType: "session", sessionDocumentType: SESSION, observerLevel: 2, ownerLevel: 3 };
  it("a session filed into an observer campaign becomes player-owned (the session-aware level)", () => {
    expect(campaignSessionTargetLevel(entry(), 2, opts)).toBe(3);
  });
  it("a session filed into a GM-only campaign takes the baseline", () => {
    expect(campaignSessionTargetLevel(entry(), 0, opts)).toBe(0);
  });
  it("the filing update touches folder and default ownership only — explicit per-user ownership is untouched", () => {
    expect(filingUpdate("c1", 3)).toEqual({ folder: "c1", "ownership.default": 3 });
    expect(Object.keys(filingUpdate("c1", 3))).toHaveLength(2);
  });
});

describe("filingLevel (hidden sessions stay hidden)", () => {
  it("a session hidden now (default NONE) stays NONE when filed", () => {
    expect(filingLevel(0, 3, 0)).toBe(0);
  });
  it("an OBSERVER session filed into an observer campaign becomes OWNER", () => {
    const target = campaignSessionTargetLevel(entry(), 2, { sessionType: "session", sessionDocumentType: SESSION, observerLevel: 2, ownerLevel: 3 });
    expect(filingLevel(2, target, 0)).toBe(3);
  });
  it("a LIMITED session takes the campaign's level (OWNER)", () => {
    expect(filingLevel(1, 3, 0)).toBe(3);
  });
  it("an unset default is treated as NONE, matching Foundry", () => {
    expect(filingLevel(undefined, 3, 0)).toBe(0);
    expect(filingLevel(undefined, 3)).toBe(0);
  });
  it("a GM-only campaign's baseline still applies to a visible session", () => {
    expect(filingLevel(2, 0, 0)).toBe(0);
  });
});
