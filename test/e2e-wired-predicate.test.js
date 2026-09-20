import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { COMPANION_WIRED } from "../tests/e2e/helpers/foundry.mjs";

const ID = "mej-campaign-companion";

function world({ companion = true, mej = true, registered = true, api = false, shellHosting = true, sessionType = false, settingsThrow = false } = {}) {
  const modules = new Map([[ID, { active: companion }], ["monks-enhanced-journal", { active: mej }]]);
  const MonksEnhancedJournal = mej ? {
    ...(api ? { getApi: () => ({}) } : {}),
    getDocumentTypes: () => (sessionType ? { session: "x", shop: "y" } : { shop: "y" })
  } : undefined;
  globalThis.game = {
    modules,
    MonksEnhancedJournal,
    settings: { get: (m, k) => { if (settingsThrow) throw new Error("not registered"); return k === "shellHosting" ? shellHosting : undefined; } }
  };
  globalThis.CONFIG = { JournalEntryPage: { sheetClasses: { [`${ID}.session`]: registered ? { [`${ID}.SessionSheet`]: {} } : {} } } };
}

describe("COMPANION_WIRED", () => {
  const saved = {};
  beforeEach(() => { saved.game = globalThis.game; saved.CONFIG = globalThis.CONFIG; });
  afterEach(() => { globalThis.game = saved.game; globalThis.CONFIG = saved.CONFIG; });

  it("is vacuously true when the companion is inactive", () => {
    world({ companion: false, registered: false });
    expect(COMPANION_WIRED(ID)).toBe(true);
  });

  it("is vacuously true when MEJ is inactive (mode absent registers nothing)", () => {
    world({ mej: false, registered: false });
    expect(COMPANION_WIRED(ID)).toBe(true);
  });

  it("waits for the session sheet registration first", () => {
    world({ registered: false, api: true });
    expect(COMPANION_WIRED(ID)).toBe(false);
  });

  it("is true once registered when MEJ carries the extension API (api mode)", () => {
    world({ api: true });
    expect(COMPANION_WIRED(ID)).toBe(true);
  });

  it("native mode: waits for the shim's type-map wrap when shell hosting is wanted", () => {
    world({ sessionType: false });
    expect(COMPANION_WIRED(ID)).toBe(false);
    world({ sessionType: true });
    expect(COMPANION_WIRED(ID)).toBe(true);
  });

  it("native mode: does not wait for the shim when the shellHosting setting is off", () => {
    world({ shellHosting: false, sessionType: false });
    expect(COMPANION_WIRED(ID)).toBe(true);
  });

  it("treats an unreadable shellHosting setting as shell wanted", () => {
    world({ settingsThrow: true, sessionType: false });
    expect(COMPANION_WIRED(ID)).toBe(false);
  });
});
