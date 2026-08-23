import { describe, it, expect } from "vitest";
import { MODULE_ID } from "../scripts/constants.mjs";
import { campaignOfFolder, destinationFolderOptions, resolveDestinationId } from "../scripts/logic/campaigns.mjs";

function folder(id, name, { campaign = null, parent = null } = {}) {
  return { id, name, folder: parent, flags: campaign ? { [MODULE_ID]: { campaign } } : {} };
}

describe("campaignOfFolder", () => {
  const camp = folder("c1", "Campaign", { campaign: { ownershipDefault: "observer" } });
  it("returns the folder itself when flagged", () => {
    expect(campaignOfFolder(camp)).toBe(camp);
  });
  it("walks to the nearest flagged ancestor", () => {
    const sub = folder("s1", "Sub", { parent: camp });
    const subsub = folder("s2", "SubSub", { parent: sub });
    expect(campaignOfFolder(subsub)).toBe(camp);
  });
  it("returns null for unflagged chains and null input", () => {
    expect(campaignOfFolder(folder("f1", "Loose"))).toBe(null);
    expect(campaignOfFolder(null)).toBe(null);
  });
});

describe("destinationFolderOptions", () => {
  const campA = folder("ca", "Alpha", { campaign: { ownershipDefault: "observer" } });
  const campB = folder("cb", "Beta", { campaign: { ownershipDefault: "observer" } });

  it("lists campaigns at depth 0 in the given order", () => {
    expect(destinationFolderOptions([campA, campB], [campA, campB])).toEqual([
      { id: "ca", name: "Alpha", depth: 0 },
      { id: "cb", name: "Beta", depth: 0 }
    ]);
  });

  it("nests descendant subfolders depth-first, name-sorted per level", () => {
    const subZ = folder("sz", "Zed", { parent: campA });
    const subM = folder("sm", "Mid", { parent: campA });
    const deep = folder("dp", "Deep", { parent: subM });
    const rows = destinationFolderOptions([campA], [campA, subZ, subM, deep]);
    expect(rows).toEqual([
      { id: "ca", name: "Alpha", depth: 0 },
      { id: "sm", name: "Mid", depth: 1 },
      { id: "dp", name: "Deep", depth: 2 },
      { id: "sz", name: "Zed", depth: 1 }
    ]);
  });

  it("excludes folders outside any campaign", () => {
    const loose = folder("lo", "Loose");
    const looseChild = folder("lc", "LooseChild", { parent: loose });
    const rows = destinationFolderOptions([campA], [campA, loose, looseChild]);
    expect(rows.map((r) => r.id)).toEqual(["ca"]);
  });

  it("does not duplicate a (defensively) nested campaign under its parent", () => {
    const nested = folder("cn", "Nested", { campaign: { ownershipDefault: "owner" }, parent: campA });
    const rows = destinationFolderOptions([campA, nested], [campA, nested]);
    expect(rows).toEqual([
      { id: "ca", name: "Alpha", depth: 0 },
      { id: "cn", name: "Nested", depth: 0 }
    ]);
  });
});

describe("resolveDestinationId", () => {
  const ids = ["ca", "sm", "__new"];
  it("keeps a still-valid explicit choice", () => {
    expect(resolveDestinationId(ids, "sm", "ca")).toBe("sm");
  });
  it("falls back to the active campaign when no explicit choice", () => {
    expect(resolveDestinationId(ids, null, "ca")).toBe("ca");
  });
  it("ignores a stale explicit choice in favor of the active campaign", () => {
    expect(resolveDestinationId(ids, "gone", "ca")).toBe("ca");
  });
  it("falls back to the first option when neither applies", () => {
    expect(resolveDestinationId(ids, null, "")).toBe("ca");
    expect(resolveDestinationId(ids, null, "gone")).toBe("ca");
  });
  it("returns null for an empty option list", () => {
    expect(resolveDestinationId([], null, null)).toBe(null);
  });
});
