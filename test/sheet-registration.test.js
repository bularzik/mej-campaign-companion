// test/sheet-registration.test.js
import { describe, it, expect } from "vitest";
import { missingSheetRegistrations, missingOwnRegistration, planSheetRegistrations, sheetRegistrationEntries } from "../scripts/logic/sheet-registration.mjs";

const SESSION_TYPE = "mej-campaign-companion.session";
const HUB_TYPE = "campaign-hub";
const CAMPAIGN_TYPE = "mej-campaign-companion.campaign";

describe("missingSheetRegistrations", () => {
  it("reports all three missing when sheetClasses is undefined", () => {
    expect(missingSheetRegistrations(undefined, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports all three missing when sheetClasses is empty", () => {
    expect(missingSheetRegistrations({}, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports all three missing when the type entries are present but empty (the dropped-registration case)", () => {
    const sheetClasses = { [SESSION_TYPE]: {}, [HUB_TYPE]: {}, [CAMPAIGN_TYPE]: {} };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: true, campaign: true, media: false
    });
  });

  it("reports none missing when all three type entries have a registered scope", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: false, campaign: false, media: false
    });
  });

  it("reports only the session missing when just the hub and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: {},
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: true, hub: false, campaign: false, media: false
    });
  });

  it("reports only the hub missing when just the session and campaign entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: {},
      [CAMPAIGN_TYPE]: { "mej-campaign-companion": {} }
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: true, campaign: false, media: false
    });
  });

  it("reports only the campaign missing when just the session and hub entries are populated", () => {
    const sheetClasses = {
      [SESSION_TYPE]: { "mej-campaign-companion": {} },
      [HUB_TYPE]: { "mej-campaign-companion": {} },
      [CAMPAIGN_TYPE]: {}
    };
    expect(missingSheetRegistrations(sheetClasses, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, [])).toEqual({
      session: false, hub: false, campaign: true, media: false
    });
  });

  // Regression coverage (fix round 1): core itself registers a sheet for
  // pdf/video (CONFIG.JournalEntryPage.sheetClasses.pdf/.video always carry
  // a `core.JournalEntryPagePDFSheet`/`core.JournalEntryPageVideoSheet`
  // entry), so these use the REAL registerSheet key shape
  // (`${scope}.${sheetClass.name}`, per document-sheet-config.mjs) rather
  // than toy keys - a toy key like "a" can't distinguish "core registered
  // this" from "we registered this", which is exactly how the original bug
  // shipped: `missing.media` was permanently false because `has()` only
  // checked whether ANY key was present, and core's own entry always is.
  const OWNER_SCOPE = "mej-campaign-companion";
  const CORE_PDF = { "core.JournalEntryPagePDFSheet": {} };
  const CORE_VIDEO = { "core.JournalEntryPageVideoSheet": {} };
  const OUR_MEDIA = { "mej-campaign-companion.MediaPageSheet": {} };

  it("reports media missing when only core's native pdf/video sheets are registered (the regression)", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF }, video: { ...CORE_VIDEO }
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(true);
  });

  it("reports media registered when our own scope is present alongside core's on every media type", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO, ...OUR_MEDIA }
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(false);
  });

  it("reports media missing when our registration landed on only one of the two media types", () => {
    const classes = {
      [SESSION_TYPE]: { [OWNER_SCOPE]: {} }, [HUB_TYPE]: { [OWNER_SCOPE]: {} }, [CAMPAIGN_TYPE]: { [OWNER_SCOPE]: {} },
      pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO } // video: core only - ours was dropped
    };
    expect(missingSheetRegistrations(classes, SESSION_TYPE, HUB_TYPE, CAMPAIGN_TYPE, ["pdf", "video"], OWNER_SCOPE).media).toBe(true);
  });

  it("treats an empty media list as nothing missing, even with no ownerScope supplied", () => {
    expect(missingSheetRegistrations({}, "s", "h", "c", []).media).toBe(false);
  });

  it("never reports media as registered when ownerScope is omitted, even if a media type has entries", () => {
    // ownerScope defaults to "" - hasOurs() must not fall back to has()'s
    // "any key at all" check, or this silently reintroduces the bug.
    const classes = { pdf: { ...CORE_PDF, ...OUR_MEDIA }, video: { ...CORE_VIDEO, ...OUR_MEDIA } };
    expect(missingSheetRegistrations(classes, "s", "h", "c", ["pdf", "video"]).media).toBe(true);
  });
});

describe("missingOwnRegistration", () => {
  const SCOPE = "mej-campaign-companion";
  const TIMELINE_KEY = `${SCOPE}.TimelineJournalSheet`;
  // CONFIG.JournalEntry.sheetClasses.base always carries core's (and often the
  // system's) own entries, so "any key at all" would read as registered here -
  // this is the JournalEntry-side twin of the media check's hasOurs().
  const CORE_BASE = { "core.JournalEntrySheet": {}, "dnd5e.JournalSheet5e": {} };

  it("reports missing when the sheetClasses map is undefined", () => {
    expect(missingOwnRegistration(undefined, "base", SCOPE)).toBe(true);
  });

  it("reports missing when the type entry is absent", () => {
    expect(missingOwnRegistration({}, "base", SCOPE)).toBe(true);
  });

  it("reports missing when only core/system sheets are registered for the type", () => {
    expect(missingOwnRegistration({ base: { ...CORE_BASE } }, "base", SCOPE)).toBe(true);
  });

  it("reports present once our own scope has an entry alongside core's", () => {
    expect(missingOwnRegistration({ base: { ...CORE_BASE, [TIMELINE_KEY]: {} } }, "base", SCOPE)).toBe(false);
  });

  it("never reads as registered without an ownerScope, even with entries present", () => {
    expect(missingOwnRegistration({ base: { ...CORE_BASE, [TIMELINE_KEY]: {} } }, "base", "")).toBe(true);
  });

  it("does not mistake another module's similarly-named scope for ours", () => {
    // startsWith(`${scope}.`), not startsWith(scope) - "mej-campaign-companion-extra"
    // must not satisfy a "mej-campaign-companion" registration.
    const classes = { base: { "mej-campaign-companion-extra.SomeSheet": {} } };
    expect(missingOwnRegistration(classes, "base", SCOPE)).toBe(true);
  });
});

const TYPES = { sessionType: "mej-campaign-companion.session", hubType: "campaign-hub", campaignType: "mej-campaign-companion.campaign", mediaTypes: ["pdf", "video"], ownerScope: "mej-campaign-companion" };

describe("planSheetRegistrations", () => {
  it("registers everything on an empty registry", () => {
    expect(planSheetRegistrations({}, {}, TYPES)).toEqual({ session: true, hub: true, campaign: true, media: true, timeline: true });
  });

  it("registers nothing when every companion registration is present", () => {
    const pages = {
      "mej-campaign-companion.session": { "mej-campaign-companion.SessionSheet": {} },
      "campaign-hub": { "mej-campaign-companion.CampaignHubPage": {} },
      "mej-campaign-companion.campaign": { "mej-campaign-companion.CampaignHubPage": {} },
      pdf: { "core.JournalEntryPagePDFSheet": {}, "mej-campaign-companion.MediaPageSheet": {} },
      video: { "core.JournalEntryPageVideoSheet": {}, "mej-campaign-companion.MediaPageSheet": {} }
    };
    const entries = { base: { "core.JournalEntrySheet": {}, "mej-campaign-companion.TimelineJournalSheet": {} } };
    expect(planSheetRegistrations(pages, entries, TYPES)).toEqual({ session: false, hub: false, campaign: false, media: false, timeline: false });
  });

  it("registers only what is missing on a partial registry (core's own media and base entries do not count)", () => {
    const pages = {
      "mej-campaign-companion.session": { "mej-campaign-companion.SessionSheet": {} },
      pdf: { "core.JournalEntryPagePDFSheet": {} },
      video: { "core.JournalEntryPageVideoSheet": {}, "mej-campaign-companion.MediaPageSheet": {} }
    };
    const entries = { base: { "core.JournalEntrySheet": {} } };
    expect(planSheetRegistrations(pages, entries, TYPES)).toEqual({ session: false, hub: true, campaign: true, media: true, timeline: true });
  });
});

describe("sheetRegistrationEntries", () => {
  // Stub classes: sheetRegistrationEntries never inspects them, just carries
  // them through into each entry's sheetClass.
  function SessionSheet() {}
  function CampaignHubPage() {}
  function MediaPageSheet() {}
  function TimelineJournalSheet() {}
  const CLASSES = { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet };
  const OPTS = {
    sessionType: "mej-campaign-companion.session", hubType: "campaign-hub",
    campaignType: "mej-campaign-companion.campaign", mediaTypes: ["pdf", "video"],
    i18n: "MEJCampaignCompanion"
  };

  it("returns all five entries, in order, with exactly the option objects the adapter has always used", () => {
    const missing = { session: true, hub: true, campaign: true, media: true, timeline: true };
    expect(sheetRegistrationEntries(missing, CLASSES, OPTS)).toEqual([
      { documentClass: "JournalEntryPage", sheetClass: SessionSheet,
        options: { types: ["mej-campaign-companion.session"], makeDefault: true, label: "MEJCampaignCompanion.sheettype.session" } },
      { documentClass: "JournalEntryPage", sheetClass: CampaignHubPage,
        options: { types: ["campaign-hub"], makeDefault: false, canBeDefault: false, canConfigure: false, label: "MEJCampaignCompanion.hub.title" } },
      { documentClass: "JournalEntryPage", sheetClass: CampaignHubPage,
        options: { types: ["mej-campaign-companion.campaign"], makeDefault: true, canBeDefault: true, canConfigure: false, label: "MEJCampaignCompanion.sheettype.campaign" } },
      { documentClass: "JournalEntryPage", sheetClass: MediaPageSheet,
        options: { types: ["pdf", "video"], makeDefault: true, canBeDefault: true, canConfigure: true, label: "MEJCampaignCompanion.sheettype.media" } },
      { documentClass: "JournalEntry", sheetClass: TimelineJournalSheet,
        options: { types: ["base"], makeDefault: false, canBeDefault: false, label: "MEJCampaignCompanion.sheettype.timelineJournal" } }
    ]);
  });

  it("returns nothing missing when nothing is missing", () => {
    const missing = { session: false, hub: false, campaign: false, media: false, timeline: false };
    expect(sheetRegistrationEntries(missing, CLASSES, OPTS)).toEqual([]);
  });

  it("returns only the missing entries on a partial report (media + timeline)", () => {
    const missing = { session: false, hub: false, campaign: false, media: true, timeline: true };
    const entries = sheetRegistrationEntries(missing, CLASSES, OPTS);
    expect(entries).toHaveLength(2);
    expect(entries[0].documentClass).toBe("JournalEntryPage");
    expect(entries[0].sheetClass).toBe(MediaPageSheet);
    expect(entries[1].documentClass).toBe("JournalEntry");
    expect(entries[1].sheetClass).toBe(TimelineJournalSheet);
  });
});
