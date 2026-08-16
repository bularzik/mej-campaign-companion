import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getTimepoints, timepointsForRecord, addTimepoint, editTimepoint, renameTimepoint,
  moveTimepoint, deleteTimepoint, addLink, removeLink, toggleLinkShowPlayers, resolveLinks
} from "../scripts/data/timepoints.mjs";

/**
 * Fake JournalEntry-like doc storing flags under
 * flags["mej-campaign-companion"].timeline — the retargeted flag scope/key
 * (campaign-record used flags["campaign-record"][GROUP_FLAG]).
 */
function makeJournal(initialTimepoints = []) {
  let stored = { timepoints: initialTimepoints };
  return {
    getFlag: (scope, key) => {
      if (scope !== "mej-campaign-companion" || key !== "timeline") return undefined;
      return stored;
    },
    setFlag: async (scope, key, value) => {
      if (scope !== "mej-campaign-companion" || key !== "timeline") {
        throw new Error(`unexpected flag write: ${scope}/${key}`);
      }
      stored = value;
    }
  };
}

let idCounter = 0;

beforeEach(() => {
  idCounter = 0;
  vi.stubGlobal("foundry", { utils: { randomID: () => `id-${++idCounter}` } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTimepoints / timepointsForRecord", () => {
  it("returns [] for a journal with no timeline flag", () => {
    expect(getTimepoints(makeJournal())).toEqual([]);
  });

  it("returns timepoints sorted by sort key", () => {
    const journal = makeJournal([
      { id: "b", label: "B", sort: 200000 },
      { id: "a", label: "A", sort: 100000 }
    ]);
    expect(getTimepoints(journal).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("finds timepoint ids whose links reference a uuid", () => {
    const journal = makeJournal([
      { id: "t1", sort: 0, links: [{ id: "l1", uuid: "Actor.x" }] },
      { id: "t2", sort: 100000, links: [] }
    ]);
    expect(timepointsForRecord(journal, "Actor.x")).toEqual(["t1"]);
  });
});

describe("addTimepoint", () => {
  it("appends with a generated id, full-gap sort, createdAt, and null campaignDate by default", () => {
    const journal = makeJournal();
    const before = Date.now();
    return addTimepoint(journal, "Session 1").then((tp) => {
      expect(tp.id).toBe("id-1");
      expect(tp.label).toBe("Session 1");
      expect(tp.campaignDate).toBeNull();
      expect(tp.createdAt).toBeGreaterThanOrEqual(before);
      expect(getTimepoints(journal)).toEqual([tp]);
    });
  });

  it("inserts at a clamped position and persists via setFlag", async () => {
    const journal = makeJournal([{ id: "a", label: "A", sort: 100000, createdAt: 1 }]);
    const tp = await addTimepoint(journal, "New", 0);
    expect(getTimepoints(journal).map((t) => t.id)).toEqual([tp.id, "a"]);
  });

  it("stores under the retargeted flag scope/key (mej-campaign-companion/timeline)", async () => {
    const journal = makeJournal();
    let captured = null;
    journal.setFlag = async (scope, key, value) => { captured = { scope, key, value }; };
    await addTimepoint(journal, "X");
    expect(captured.scope).toBe("mej-campaign-companion");
    expect(captured.key).toBe("timeline");
    expect(captured.value.timepoints).toHaveLength(1);
  });
});

describe("editTimepoint / renameTimepoint", () => {
  it("updates only provided keys", async () => {
    const journal = makeJournal([{ id: "a", label: "Old", sort: 0, campaignDate: null }]);
    await editTimepoint(journal, "a", { label: "New" });
    expect(getTimepoints(journal)[0]).toMatchObject({ label: "New", campaignDate: null });

    await editTimepoint(journal, "a", { campaignDate: { year: 1, month: 0, day: 1 } });
    expect(getTimepoints(journal)[0]).toMatchObject({ label: "New", campaignDate: { year: 1, month: 0, day: 1 } });
  });

  it("is a no-op when neither key is provided", async () => {
    const journal = makeJournal([{ id: "a", label: "Old", sort: 0 }]);
    journal.setFlag = async () => { throw new Error("should not write"); };
    await editTimepoint(journal, "a", {});
  });

  it("renameTimepoint delegates to editTimepoint's label patch", async () => {
    const journal = makeJournal([{ id: "a", label: "Old", sort: 0 }]);
    await renameTimepoint(journal, "a", "Renamed");
    expect(getTimepoints(journal)[0].label).toBe("Renamed");
  });
});

describe("moveTimepoint", () => {
  it("relocates a timepoint to a clamped position, assigning a new sort key", async () => {
    const journal = makeJournal([
      { id: "a", label: "A", sort: 100000 },
      { id: "b", label: "B", sort: 200000 },
      { id: "c", label: "C", sort: 300000 }
    ]);
    await moveTimepoint(journal, "c", 0);
    expect(getTimepoints(journal).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("no-ops for an unknown id", async () => {
    const journal = makeJournal([{ id: "a", label: "A", sort: 0 }]);
    journal.setFlag = async () => { throw new Error("should not write"); };
    await moveTimepoint(journal, "missing", 0);
  });
});

describe("deleteTimepoint", () => {
  it("removes the matching timepoint", async () => {
    const journal = makeJournal([{ id: "a", label: "A", sort: 0 }, { id: "b", label: "B", sort: 1 }]);
    await deleteTimepoint(journal, "a");
    expect(getTimepoints(journal).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("addLink / removeLink / toggleLinkShowPlayers", () => {
  it("addLink generates an id, dedupes, and returns null for unknown timepoint or duplicate", async () => {
    const journal = makeJournal([{ id: "t1", label: "T", sort: 0, links: [] }]);
    const entry = await addLink(journal, "t1", { uuid: "Actor.x", name: "Strahd", type: "Actor" });
    expect(entry).toEqual({ id: "id-1", uuid: "Actor.x", name: "Strahd", type: "Actor" });
    expect(getTimepoints(journal)[0].links).toEqual([entry]);

    const dup = await addLink(journal, "t1", { uuid: "Actor.x", name: "Strahd", type: "Actor" });
    expect(dup).toBeNull();

    expect(await addLink(journal, "missing", { uuid: "Actor.y" })).toBeNull();
  });

  it("removeLink drops by link id", async () => {
    const journal = makeJournal([{ id: "t1", label: "T", sort: 0, links: [{ id: "l1", uuid: "Actor.x" }] }]);
    await removeLink(journal, "t1", "l1");
    expect(getTimepoints(journal)[0].links).toEqual([]);
  });

  it("toggleLinkShowPlayers flips only image links", async () => {
    const journal = makeJournal([{
      id: "t1", label: "T", sort: 0,
      links: [{ id: "l1", src: "a.png", showPlayers: false }, { id: "l2", uuid: "Actor.x" }]
    }]);
    await toggleLinkShowPlayers(journal, "t1", "l1");
    expect(getTimepoints(journal)[0].links[0].showPlayers).toBe(true);

    // Document link (no src) is a no-op.
    journal.setFlag = async () => { throw new Error("should not write for a document link"); };
    await toggleLinkShowPlayers(journal, "t1", "l2");
  });
});

describe("resolveLinks", () => {
  const gmUser = { isGM: true };
  const playerUser = { isGM: false };

  afterEach(() => vi.unstubAllGlobals());

  it("resolves an image link, gated on showPlayers for non-GMs", () => {
    const tp = { links: [{ id: "l1", src: "a.png", name: "a.png", showPlayers: false }] };
    expect(resolveLinks(tp, playerUser)).toEqual([]);
    expect(resolveLinks(tp, gmUser)).toHaveLength(1);
  });

  it("resolves a permitted document link via fromUuidSync + testUserPermission", () => {
    const doc = { name: "Strahd", img: "s.png", testUserPermission: () => true };
    vi.stubGlobal("fromUuidSync", () => doc);
    const tp = { links: [{ id: "l1", uuid: "Actor.x", name: "Strahd", type: "Actor" }] };
    const result = resolveLinks(tp, playerUser);
    expect(result).toEqual([{ id: "l1", name: "Strahd", icon: expect.any(String), kind: "document", uuid: "Actor.x", img: "s.png" }]);
  });

  it("hides an unpermitted document link from a non-GM", () => {
    const doc = { name: "Strahd", img: "s.png", testUserPermission: () => false };
    vi.stubGlobal("fromUuidSync", () => doc);
    const tp = { links: [{ id: "l1", uuid: "Actor.x", name: "Strahd", type: "Actor" }] };
    expect(resolveLinks(tp, playerUser)).toEqual([]);
  });

  it("a GM sees a dangling/unpermitted link as broken/permitted regardless of testUserPermission", () => {
    vi.stubGlobal("fromUuidSync", () => null);
    const tp = { links: [{ id: "l1", uuid: "Actor.gone", name: "Gone", type: "Actor" }] };
    const result = resolveLinks(tp, gmUser);
    expect(result[0].kind).toBe("broken");
  });
});
