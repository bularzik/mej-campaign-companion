import { describe, it, expect } from "vitest";
import { EXTRACTORS, extractRecord, registerExtractor, splitHiddenAttributes } from "../scripts/logic/field-extractors.mjs";

// Fixtures below mirror real MEJ flag/system shapes, verified against the
// MEJ worktree (see task-8 report for the exact evidence per type):
// - person: flags["monks-enhanced-journal"].attributes (flat key->string
//   value map, EnhancedJournalSheet#fieldlist) + flags["monks-enhanced-journal"].role
//   (PersonSheet#_documentControls' role control reads this flag).
// - quest: flags["monks-enhanced-journal"].objectives (dict of
//   {id, content, available, status...}; QuestSheet#_prepareBodyContext
//   filters `this.document.isOwner || o.available` - "available" is the
//   only GM/hidden marker MEJ stores) + flags["monks-enhanced-journal"].status
//   (QuestSheet.defaultObject's top-level `status` flag).
// - shop/loot: flags["monks-enhanced-journal"].items (dict of full Item
//   data keyed by id, each with `.name` - ShopSheet#onRequestItem reads
//   `items[id]`/`item.name`; no per-item hidden/visible marker in either
//   sheet, only whole-page ownership gates visibility).
// - session: page.system.recap / page.system.gmNotes (SessionSheet.mjs
//   enrichedRecap/enrichedGmNotes) + flags["mej-campaign-companion"].session
//   .secrets (session-data.mjs's sessionData(); SessionSheet.mjs's
//   _prepareBodyContext strips unrevealed secret text from non-GM context).

const personPage = {
  name: "Strahd von Zarovich",
  text: { content: "<p>A vampire lord.</p>" },
  flags: {
    "monks-enhanced-journal": {
      role: "Villain",
      attributes: { race: "Vampire", occupation: "Dark Lord" }
    }
  }
};

const questPage = {
  name: "Rescue Ireena",
  text: { content: "<p>Escort her to safety.</p>" },
  flags: {
    "monks-enhanced-journal": {
      status: "inprogress",
      objectives: {
        o1: { id: "o1", content: "Find Ireena", available: true },
        o2: { id: "o2", content: "Discover Strahd's true plan", available: false }
      }
    }
  }
};

const shopPage = {
  name: "Blood on the Vine",
  text: { content: "<p>A tavern in Vallaki.</p>" },
  flags: {
    "monks-enhanced-journal": {
      items: {
        i1: { _id: "i1", name: "Wine of Vallaki" },
        i2: { _id: "i2", name: "Stale Bread" }
      }
    }
  }
};

const lootPage = {
  name: "Chest of Barovia",
  text: { content: "<p>An old iron chest.</p>" },
  flags: {
    "monks-enhanced-journal": {
      items: { i1: { _id: "i1", name: "Sunsword" } }
    }
  }
};

const sessionPage = {
  name: "Session 4",
  system: { recap: "<p>The party entered Castle Ravenloft.</p>", gmNotes: "<p>Strahd is watching from the shadows.</p>" },
  flags: {
    "mej-campaign-companion": {
      session: {
        secrets: [
          { id: "s1", text: "Ireena is Tatyana reincarnated.", revealed: false },
          { id: "s2", text: "The gem in the tower is fake.", revealed: true }
        ]
      }
    }
  }
};

const placePage = {
  name: "Vallaki",
  text: { content: "<p>A town under the Baron's iron fist.</p>" },
  flags: {}
};

describe("EXTRACTORS registry", () => {
  it("exposes an extractor for every documented MEJ type", () => {
    const types = [
      "person", "place", "quest", "shop", "loot", "encounter", "event",
      "organization", "poi", "list", "journalentry", "picture", "slideshow", "session"
    ];
    for (const type of types) {
      expect(typeof EXTRACTORS[type]).toBe("function");
    }
  });
});

describe("extractRecord: person", () => {
  it("extracts body text, role, and attribute values as public fields; no gmFields", () => {
    const record = extractRecord(personPage, "person");
    expect(record.name).toBe("Strahd von Zarovich");
    expect(record.type).toBe("person");
    expect(record.fields.text).toContain("vampire lord");
    expect(record.fields.role).toBe("Villain");
    expect(record.fields.attributes).toContain("Vampire");
    expect(record.fields.attributes).toContain("Dark Lord");
    expect(record.gmFields).toEqual({});
  });

  it("defensively optional-chains a page with no monks-enhanced-journal flags at all", () => {
    const record = extractRecord({ name: "Nobody", text: { content: "" }, flags: {} }, "person");
    expect(record.fields.role).toBe("");
    expect(record.fields.attributes).toBe("");
    expect(record.gmFields).toEqual({});
  });
});

describe("extractRecord: quest", () => {
  it("splits objectives by the `available` marker: available -> public, unavailable -> gmFields", () => {
    const record = extractRecord(questPage, "quest");
    expect(record.fields.status).toBe("inprogress");
    expect(record.fields.objectives).toContain("Find Ireena");
    expect(record.fields.objectives).not.toContain("true plan");
    expect(record.gmFields.objectives).toContain("true plan");
    expect(record.gmFields.objectives).not.toContain("Find Ireena");
  });

  it("gmFields is {} when every objective is available (no hidden marker in play)", () => {
    const allAvailable = {
      ...questPage,
      flags: {
        "monks-enhanced-journal": {
          status: "available",
          objectives: { o1: { id: "o1", content: "Talk to the innkeeper", available: true } }
        }
      }
    };
    const record = extractRecord(allAvailable, "quest");
    expect(record.gmFields).toEqual({});
  });
});

describe("extractRecord: shop / loot", () => {
  it("shop: extracts item names as a public field (no per-item hidden marker exists)", () => {
    const record = extractRecord(shopPage, "shop");
    expect(record.fields.items).toContain("Wine of Vallaki");
    expect(record.fields.items).toContain("Stale Bread");
    expect(record.gmFields).toEqual({});
  });

  it("loot: extracts item names the same way", () => {
    const record = extractRecord(lootPage, "loot");
    expect(record.fields.items).toContain("Sunsword");
    expect(record.gmFields).toEqual({});
  });
});

describe("extractRecord: session", () => {
  it("uses system.recap/gmNotes (not text.content) and splits secrets by `revealed`", () => {
    const record = extractRecord(sessionPage, "session");
    expect(record.fields.text).toContain("Castle Ravenloft");
    expect(record.fields.secrets).toContain("gem in the tower");
    expect(record.fields.secrets).not.toContain("Tatyana");
    expect(record.gmFields.gmNotes).toContain("watching from the shadows");
    expect(record.gmFields.secrets).toContain("Tatyana");
    expect(record.gmFields.secrets).toContain("gem in the tower");
  });

  it("defensively handles a session page with no companion flags yet", () => {
    const record = extractRecord({ name: "Session 1", system: {} }, "session");
    expect(record.fields.text).toBe("");
    expect(record.fields.secrets).toBe("");
    expect(record.gmFields.gmNotes).toBe("");
  });
});

describe("extractRecord: generic types (place/encounter/event/organization/poi/list/journalentry/picture/slideshow)", () => {
  it("falls back to body text only, no gmFields", () => {
    const record = extractRecord(placePage, "place");
    expect(record.fields.text).toContain("Baron's iron fist");
    expect(record.gmFields).toEqual({});
  });
});

describe("registerExtractor", () => {
  it("allows Phase B to plug in a new type extractor at runtime", () => {
    registerExtractor("custom-type", (page) => ({
      fields: { text: page.text?.content ?? "", custom: "yes" },
      gmFields: {}
    }));
    const record = extractRecord({ name: "Widget", text: { content: "a widget" } }, "custom-type");
    expect(record.fields.custom).toBe("yes");
    expect(EXTRACTORS["custom-type"]).toBeTypeOf("function");
  });
});

describe("splitHiddenAttributes", () => {
  // Pure split used by scripts/search/live-index.mjs to route playerHidden
  // person attributes (a world SETTING - see sheets/EnhancedJournalSheet.js's
  // fieldlist(), `f.shown && (game.user.isGM || !f.playerHidden)` - that
  // this Foundry-free module has no access to) out of the public
  // `fields.attributes` and into `gmFields.attributes`. live-index.mjs
  // resolves `hiddenKeys`; this function just does the mechanical split.
  const attributes = { race: "Vampire", secret: "Actually a doppelganger", occupation: "Dark Lord" };

  it("partitions attribute values by key membership in hiddenKeys", () => {
    const { visible, hidden } = splitHiddenAttributes(attributes, ["secret"]);
    expect(visible).toContain("Vampire");
    expect(visible).toContain("Dark Lord");
    expect(visible).not.toContain("doppelganger");
    expect(hidden).toBe("Actually a doppelganger");
  });

  it("returns everything as visible when hiddenKeys is empty", () => {
    const { visible, hidden } = splitHiddenAttributes(attributes, []);
    expect(visible).toContain("Vampire");
    expect(visible).toContain("doppelganger");
    expect(hidden).toBe("");
  });

  it("defensively handles missing attributes / hiddenKeys", () => {
    expect(splitHiddenAttributes(undefined, undefined)).toEqual({ visible: "", hidden: "" });
    expect(splitHiddenAttributes({}, ["race"])).toEqual({ visible: "", hidden: "" });
  });
});
