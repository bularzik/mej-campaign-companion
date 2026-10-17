import { describe, it, expect, beforeEach, vi } from "vitest";

const settings = new Map();
const journals = new Map();

beforeEach(() => {
  settings.clear();
  journals.clear();
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.game = {
    user: { isGM: true },
    settings: {
      get: (mod, key) => settings.get(key) ?? "",
      set: vi.fn(async (mod, key, value) => { settings.set(key, value); })
    },
    journal: { get: (id) => journals.get(id) ?? null, contents: [] }
  };
  globalThis.JournalEntry = { create: vi.fn(async (data) => ({ id: "created", ...data })) };
});

describe("ensureTimelineJournal with no campaign (spec 2026-10-16 §1e)", () => {
  it("returns null and creates nothing when the world has no legacy timeline", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    expect(await ensureTimelineJournal(null)).toBeNull();
    expect(await ensureTimelineJournal()).toBeNull();
    expect(JournalEntry.create).not.toHaveBeenCalled();
    expect(game.settings.set).not.toHaveBeenCalled();
  });
  it("still hands back the legacy singleton the timelineJournalId setting names", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    const legacy = { id: "L1", name: "Campaign Timeline" };
    settings.set("timelineJournalId", "L1");
    journals.set("L1", legacy);
    expect(await ensureTimelineJournal(null)).toBe(legacy);
    expect(JournalEntry.create).not.toHaveBeenCalled();
  });
  it("still creates a campaign's own timeline for a GM", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    const campaign = {
      id: "c1", name: "Alpha", folder: null, contents: [],
      flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } },
      getFlag: () => null
    };
    const created = await ensureTimelineJournal(campaign);
    expect(JournalEntry.create).toHaveBeenCalledTimes(1);
    expect(created.name).toBe("Alpha — Timeline");
    expect(created.folder).toBe("c1");
  });
  it("a non-GM gets null, never a create", async () => {
    globalThis.game.user.isGM = false;
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    expect(await ensureTimelineJournal({ id: "c1", name: "Alpha", contents: [], flags: {}, getFlag: () => null })).toBeNull();
    expect(JournalEntry.create).not.toHaveBeenCalled();
  });
});
