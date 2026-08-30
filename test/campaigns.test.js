import { describe, it, expect } from "vitest";
import { MODULE_ID } from "../scripts/constants.mjs";
import { adoptionPlan, campaignChoicePlan, campaignControls } from "../scripts/logic/campaigns.mjs";
import { readFileSync } from "node:fs";

const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function folder(id, { campaign = null, parent = null } = {}) {
  return { id, folder: parent, flags: campaign ? { [MODULE_ID]: { campaign } } : {} };
}
function entry(id, { folder: f = null, timeline = false } = {}) {
  return {
    id, documentName: "JournalEntry", folder: f,
    flags: timeline ? { [MODULE_ID]: { timeline: { timepoints: [] } } } : {}
  };
}

describe("campaigns module", async () => {
  const { campaignFlagOf, isCampaignFolder, campaignOf, campaignIdOf, isMemberOf, partitionByCampaign, isTimelineJournal, ownershipLevelFor, canAttachToTimeline, isCampaignPortal } = await import("../scripts/logic/campaigns.mjs");

  describe("isCampaignFolder / campaignFlagOf", () => {
    it("detects the campaign flag", () => {
      const c = folder("c1", { campaign: { ownershipDefault: "owner" } });
      expect(isCampaignFolder(c)).toBe(true);
      expect(campaignFlagOf(c)).toEqual({ ownershipDefault: "owner" });
    });
    it("rejects plain folders and null", () => {
      expect(isCampaignFolder(folder("f1"))).toBe(false);
      expect(isCampaignFolder(null)).toBe(false);
      expect(campaignFlagOf(undefined)).toBe(null);
    });
  });

  describe("campaignOf", () => {
    const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
    it("resolves direct membership", () => {
      expect(campaignOf(entry("e1", { folder: camp }))).toBe(camp);
    });
    it("resolves through subfolders (ancestry)", () => {
      const sub = folder("s1", { parent: camp });
      expect(campaignOf(entry("e1", { folder: sub }))).toBe(camp);
    });
    it("nearest flagged ancestor wins (defensive nesting rule)", () => {
      const inner = folder("c2", { campaign: { ownershipDefault: "none" }, parent: camp });
      expect(campaignOf(entry("e1", { folder: inner }))).toBe(inner);
    });
    it("returns null for loose entries and null docs", () => {
      expect(campaignOf(entry("e1"))).toBe(null);
      expect(campaignOf(entry("e1", { folder: folder("f1") }))).toBe(null);
      expect(campaignOf(null)).toBe(null);
    });
    it("resolves a page via its parent entry", () => {
      const page = { documentName: "JournalEntryPage", parent: entry("e1", { folder: camp }) };
      expect(campaignOf(page)).toBe(camp);
    });
    it("campaignIdOf/isMemberOf wrap it", () => {
      expect(campaignIdOf(entry("e1", { folder: camp }))).toBe("c1");
      expect(campaignIdOf(entry("e1"))).toBe(null);
      expect(isMemberOf(entry("e1", { folder: camp }), camp)).toBe(true);
      expect(isMemberOf(entry("e1"), camp)).toBe(false);
      expect(isMemberOf(entry("e1", { folder: camp }), null)).toBe(false);
    });
  });

  describe("partitionByCampaign", () => {
    it("groups by campaign id with null for unfiled", () => {
      const camp = folder("c1", { campaign: {} });
      const a = entry("a", { folder: camp });
      const b = entry("b");
      const byId = partitionByCampaign([a, b]);
      expect(byId.get("c1")).toEqual([a]);
      expect(byId.get(null)).toEqual([b]);
    });
  });

  describe("isTimelineJournal", () => {
    it("detects the timeline flag", () => {
      expect(isTimelineJournal(entry("t", { timeline: true }))).toBe(true);
      expect(isTimelineJournal(entry("e"))).toBe(false);
      expect(isTimelineJournal(null)).toBe(false);
    });
  });

  describe("ownershipLevelFor", () => {
    it("maps keys, defaulting unknown to OBSERVER", () => {
      expect(ownershipLevelFor("none", LEVELS)).toBe(0);
      expect(ownershipLevelFor("observer", LEVELS)).toBe(2);
      expect(ownershipLevelFor("owner", LEVELS)).toBe(3);
      expect(ownershipLevelFor("banana", LEVELS)).toBe(2);
      expect(ownershipLevelFor(undefined, LEVELS)).toBe(2);
    });
  });

  describe("canAttachToTimeline (spec §3 attachment discipline)", () => {
    const camp = folder("c1", { campaign: {} });
    const other = folder("c2", { campaign: {} });
    it("allows same-campaign attachment", () => {
      expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { folder: camp, timeline: true }))).toBe(true);
    });
    it("refuses cross-campaign and unfiled-entry attachment", () => {
      expect(canAttachToTimeline(entry("e", { folder: other }), entry("t", { folder: camp, timeline: true }))).toBe(false);
      expect(canAttachToTimeline(entry("e"), entry("t", { folder: camp, timeline: true }))).toBe(false);
    });
    it("legacy un-campaigned timeline accepts anything (pre-adoption worlds)", () => {
      expect(canAttachToTimeline(entry("e"), entry("t", { timeline: true }))).toBe(true);
      expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { timeline: true }))).toBe(true);
    });
    it("only governs journal documents - a non-journal drop (e.g. an Actor) is never refused, even outside the timeline's campaign", () => {
      const otherFolder = { id: "af1", folder: null, flags: {} };
      const actor = { documentName: "Actor", folder: otherFolder };
      expect(canAttachToTimeline(actor, entry("t", { folder: camp, timeline: true }))).toBe(true);
    });
    it("a world timeline (no campaign) accepts an entry from any campaign", () => {
      const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
      const worldTimeline = entry("wt", { timeline: true });           // no folder => no campaign
      const member = entry("m1", { folder: camp });
      expect(canAttachToTimeline(member, worldTimeline)).toBe(true);
    });
    it("a campaign timeline still refuses another campaign's entry", () => {
      const campA = folder("ca", { campaign: { ownershipDefault: "observer" } });
      const campB = folder("cb", { campaign: { ownershipDefault: "observer" } });
      const timelineA = entry("ta", { folder: campA, timeline: true });
      expect(canAttachToTimeline(entry("mb", { folder: campB }), timelineA)).toBe(false);
    });
    it("a campaign timeline accepts its own campaign's entry", () => {
      const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
      const timeline = entry("t1", { folder: camp, timeline: true });
      expect(canAttachToTimeline(entry("m1", { folder: camp }), timeline)).toBe(true);
    });
  });

  describe("bulkOwnershipPlan", () => {
    it("plans updates only for entries not already at the level", async () => {
      const { bulkOwnershipPlan } = await import("../scripts/logic/campaigns.mjs");
      const entries = [
        { id: "a", ownership: { default: 0 } },
        { id: "b", ownership: { default: 2 } },
        { id: "c", ownership: {} },
        { id: "d" }
      ];
      expect(bulkOwnershipPlan(entries, 2)).toEqual([
        { _id: "a", "ownership.default": 2 },
        { _id: "c", "ownership.default": 2 },
        { _id: "d", "ownership.default": 2 }
      ]);
      expect(bulkOwnershipPlan([], 2)).toEqual([]);
    });
    it("with skipLevel, also skips entries hidden (at skipLevel) - a bulk apply must not un-hide them", async () => {
      const { bulkOwnershipPlan } = await import("../scripts/logic/campaigns.mjs");
      const entries = [
        { id: "a", ownership: { default: 0 } }, // NONE - hidden via the eye toggle
        { id: "b", ownership: { default: 1 } }, // some other pre-existing level
        { id: "c", ownership: { default: 2 } }  // already at target level
      ];
      expect(bulkOwnershipPlan(entries, 2, { skipLevel: 0 })).toEqual([
        { _id: "b", "ownership.default": 2 }
      ]);
      // Without skipLevel, the NONE entry is un-hidden like any other (old behavior preserved).
      expect(bulkOwnershipPlan(entries, 2)).toEqual([
        { _id: "a", "ownership.default": 2 },
        { _id: "b", "ownership.default": 2 }
      ]);
    });
  });

  describe("isCampaignPortal exclusion shape", () => {
    const portalEntry = {
      id: "pe", documentName: "JournalEntry", folder: null,
      pages: { contents: [{ documentName: "JournalEntryPage", type: "mej-campaign-companion.campaign" }] },
      flags: {}
    };
    it("marks portal entries", () => {
      expect(isCampaignPortal(portalEntry)).toBe(true);
    });
    it("does not mark timeline journals or plain entries", () => {
      expect(isCampaignPortal(entry("t1", { timeline: true }))).toBe(false);
      expect(isCampaignPortal(entry("e1"))).toBe(false);
    });

    // C1 regression: MEJ's fixType() normalizes an OPENED portal page's
    // in-memory `.type` to bare "campaign" for the rest of the session;
    // isCampaignPortal must still match so campaignEntries/unfiledEntries
    // keep excluding the portal after a GM has opened it once.
    it("still marks a portal entry whose page .type was normalized to bare \"campaign\" by MEJ", () => {
      const normalizedEntry = {
        id: "pe2", documentName: "JournalEntry", folder: null,
        pages: {
          contents: [{
            documentName: "JournalEntryPage",
            type: "campaign",
            _source: { type: "mej-campaign-companion.campaign" }
          }]
        },
        flags: {}
      };
      expect(isCampaignPortal(normalizedEntry)).toBe(true);
    });

    it("marks a page-shaped entry via the companion's own campaignPortal flag alone", () => {
      const flaggedEntry = {
        id: "pe3", documentName: "JournalEntry", folder: null,
        pages: { contents: [{ documentName: "JournalEntryPage", type: "text", flags: { [MODULE_ID]: { campaignPortal: true } } }] },
        flags: {}
      };
      expect(isCampaignPortal(flaggedEntry)).toBe(true);
    });
  });

});

describe("adoptionPlan (spec §6)", () => {
  const typed = (id) => ({ id, folder: null, documentName: "JournalEntry", flags: {} });
  const getMEJType = (e) => (e.id.startsWith("t") ? "person" : false);
  it("moves root-level MEJ-typed entries and the legacy timeline; skips foldered and untyped", () => {
    const entries = [
      typed("t1"),
      { ...typed("t2"), folder: { id: "f1", flags: {} } },   // user-foldered: preserved
      typed("plain"),                                        // untyped: manual filing
      typed("timeline-x")                                    // untyped but IS the legacy timeline
    ];
    expect(adoptionPlan(entries, getMEJType, "timeline-x")).toEqual(["t1", "timeline-x"]);
    expect(adoptionPlan([], getMEJType, null)).toEqual([]);
  });
});

// T4 (spec Group T). The Hub's three campaign-dependent GM controls and
// promptCampaignChoice's short-circuit both used to be silent in a world with
// no campaigns yet: the controls rendered enabled and did nothing, because
// promptCampaignChoice returned the same bare `null` for "no campaigns exist"
// as for "the GM cancelled" and every caller returns on null. Both decisions
// now live here, where they can be tested without a Foundry world - the Hub is
// an ApplicationV2 subclass and is not unit-reachable.
describe("campaignChoicePlan", () => {
  const alpha = { id: "a", name: "Alpha" };
  const beta = { id: "b", name: "Beta" };

  it("refuses with a reason when the world has no campaigns", () => {
    expect(campaignChoicePlan([])).toEqual({
      kind: "none", campaign: null, warnKey: "MEJCampaignCompanion.hub.noCampaignsYet"
    });
  });
  it("names a string the module actually ships for that refusal", () => {
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    const { warnKey } = campaignChoicePlan([]);
    const value = warnKey.split(".").reduce((node, key) => node?.[key], lang);
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });
  it("takes the only campaign without a dialog", () => {
    expect(campaignChoicePlan([alpha])).toEqual({ kind: "single", campaign: alpha, warnKey: null });
  });
  it("refuses even when the caller insists on a prompt - onNewSession passes alwaysPrompt", () => {
    expect(campaignChoicePlan([], { alwaysPrompt: true })).toEqual({
      kind: "none", campaign: null, warnKey: "MEJCampaignCompanion.hub.noCampaignsYet"
    });
  });
  it("still prompts on a single campaign when the caller insists", () => {
    expect(campaignChoicePlan([alpha], { alwaysPrompt: true })).toEqual({ kind: "prompt", campaign: null, warnKey: null });
  });
  it("prompts whenever there is a real choice", () => {
    expect(campaignChoicePlan([alpha, beta])).toEqual({ kind: "prompt", campaign: null, warnKey: null });
  });
});

describe("campaignControls", () => {
  it("disables the filing/capture controls, with the reason as their tooltip, when there are no campaigns", () => {
    expect(campaignControls([])).toEqual({
      disabled: true, tooltipKey: "MEJCampaignCompanion.hub.noCampaignsYet"
    });
  });
  it("leaves them alone as soon as one campaign exists", () => {
    expect(campaignControls([{ id: "a", name: "Alpha" }])).toEqual({
      disabled: false, tooltipKey: null
    });
  });
});

// The three controls are rendered by templates, not by JS, so the wiring
// itself is asserted against the template sources: each button must take its
// disabled state and its tooltip from campaignControls, inside one {{#if}} on
// campaignControls.disabled. The shape is pinned rather than the substrings -
// asserting only that the button "contains disabled" is vacuous (so does the
// word campaignControls.disabled), and asserting only that it mentions the
// flag is polarity-blind (an inverted {{#unless}} would pass). The e2e in
// tests/e2e/14-campaigns.spec.mjs proves the rendered result, but only in a
// zero-campaign world, which the shared test world is not always in.
describe("hub templates consume campaignControls", () => {
  const read = (name) => readFileSync(new URL(`../templates/${name}`, import.meta.url), "utf8");
  const buttonFor = (html, marker) => {
    const start = html.indexOf(marker);
    expect(start, `no button matching ${marker}`).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf("<button", start), html.indexOf(">", html.indexOf("data-action", start)) + 1);
  };
  // {{#if [@root.]campaignControls.disabled}} immediately followed by the
  // disabled attribute and, in the same block, the tooltip.
  const GUARD = /\{\{#if (?:@root\.)?campaignControls\.disabled\}\}disabled data-tooltip="\{\{localize (?:@root\.)?campaignControls\.tooltipKey\}\}"/;
  // The bare `disabled` ATTRIBUTE, as opposed to the flag name
  // `campaignControls.disabled`: preceded by whitespace, the tag start, or the
  // `}}` that closes a Handlebars expression (which is how the guarded one
  // appears - the reviewer's plain \s boundary never matches it), and followed
  // by whitespace, `>`, or a `{{`.
  const BARE_DISABLED = /(?:^|[\s}])disabled(?=[\s>{]|$)/g;

  // Matching the guard is not enough on its own: a second, UNCONDITIONAL
  // `disabled` anywhere else in the same opening tag leaves every other
  // assertion green while the button is permanently dead. So the attribute
  // must appear exactly once in the tag, and that one occurrence must lie
  // inside the guard; likewise every data-tooltip must sit inside the
  // conditional (the row button legitimately carries two - the disabled
  // reason and the normal "File into campaign" - in mutually exclusive
  // branches of one {{#if}}/{{else}}, so they are bounded, not counted).
  const expectGuardedAndNothingElse = (tag) => {
    const guard = tag.match(GUARD);
    expect(guard, "button does not carry the campaignControls guard").not.toBeNull();
    const guardStart = tag.indexOf(guard[0]);
    const guardEnd = guardStart + guard[0].length;

    const attrs = [...tag.matchAll(BARE_DISABLED)].map((m) => m.index + m[0].indexOf("disabled"));
    expect(attrs, `expected exactly one bare "disabled" attribute in: ${tag}`).toHaveLength(1);
    expect(attrs[0]).toBeGreaterThanOrEqual(guardStart);
    expect(attrs[0]).toBeLessThan(guardEnd);

    const condStart = tag.indexOf("{{#if");
    const condEnd = tag.indexOf("{{/if}}") + "{{/if}}".length;
    expect(condStart).toBeGreaterThan(-1);
    expect(condEnd).toBeGreaterThan(condStart);
    const tooltips = [...tag.matchAll(/data-tooltip=/g)].map((m) => m.index);
    expect(tooltips.length).toBeGreaterThan(0);
    for (const at of tooltips) {
      expect(at, `data-tooltip outside the conditional in: ${tag}`).toBeGreaterThan(condStart);
      expect(at).toBeLessThan(condEnd);
    }
    expect(tag).not.toContain("#unless");
  };

  it("disables File all shown", () => {
    expectGuardedAndNothingElse(buttonFor(read("hub.hbs"), 'class="mej-cc-file-all"'));
  });
  it("disables the per-row File into control", () => {
    const button = buttonFor(read("hub.hbs"), 'class="mej-cc-row-file"');
    expectGuardedAndNothingElse(button);
    expect(button).toContain("@root.campaignControls.disabled");
  });
  it("disables the Tools menu's auto-capture target", () => {
    expectGuardedAndNothingElse(buttonFor(read("hub-header.hbs"), 'data-action="setCaptureCampaign"'));
  });
});
