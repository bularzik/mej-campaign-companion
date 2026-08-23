import { describe, it, expect } from "vitest";
import { defaultCreateFolderId } from "../scripts/logic/create-dialog.mjs";

class FakeEntry {
  constructor(folderId) {
    this.folder = folderId ? { id: folderId } : null;
  }
}
class FakePage {
  constructor(parent) {
    this.parent = parent;
  }
}
const preds = {
  isPage: (d) => d instanceof FakePage,
  isEntry: (d) => d instanceof FakeEntry
};

describe("defaultCreateFolderId", () => {
  it("resolves an open entry's folder", () => {
    expect(defaultCreateFolderId({}, new FakeEntry("f1"), preds)).toBe("f1");
    expect(defaultCreateFolderId(undefined, new FakeEntry("f1"), preds)).toBe("f1");
  });
  it("resolves an open page via its parent entry", () => {
    expect(defaultCreateFolderId({}, new FakePage(new FakeEntry("f2")), preds)).toBe("f2");
  });
  it("never overrides a caller-supplied folder", () => {
    expect(defaultCreateFolderId({ folder: "chosen" }, new FakeEntry("f1"), preds)).toBe(null);
  });
  it("returns null for a folderless open entry", () => {
    expect(defaultCreateFolderId({}, new FakeEntry(null), preds)).toBe(null);
  });
  it("returns null when nothing (or a non-entry pseudo-document) is open", () => {
    expect(defaultCreateFolderId({}, null, preds)).toBe(null);
    expect(defaultCreateFolderId({}, { notAnEntry: true }, preds)).toBe(null);
    expect(defaultCreateFolderId({}, new FakePage({ notAnEntry: true }), preds)).toBe(null);
  });
});
