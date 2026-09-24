import { describe, it, expect, vi } from "vitest";
import { runEntityFromSelection } from "../scripts/logic/entity-from-selection-run.mjs";

const M = "mej-campaign-companion";
const get = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

function setup({ content = "<p>Elara waits.</p>", createThrows = false, updateThrows = false, folderId = "F1" } = {}) {
  const page = {
    text: { content },
    parent: { folder: folderId ? { id: folderId } : null },
    update: vi.fn(async (u) => { if (updateThrows) throw new Error("nope"); page.text.content = u["text.content"]; })
  };
  const entry = { uuid: "JournalEntry.new" };
  const deps = {
    moduleId: M,
    fromUuid: vi.fn(async (u) => (u === "P" ? page : null)),
    createMejEntry: vi.fn(async () => { if (createThrows) throw new Error("boom"); return { parent: entry }; }),
    runRetroPass: vi.fn(async () => {}),
    getProperty: get,
    logError: vi.fn()
  };
  return { page, entry, deps };
}
const req = (p = {}) => ({ pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
  type: "person", name: "Elara", linkOthers: true, ...p });

describe("runEntityFromSelection", () => {
  it("creates in the source folder with the retro opt-out, links, then runs the retro pass", async () => {
    const { page, entry, deps } = setup();
    const out = await runEntityFromSelection(req(), deps);
    expect(deps.createMejEntry).toHaveBeenCalledWith("person", "Elara", "", {}, null, "F1", { [M]: { skipRetroLink: true } });
    expect(page.text.content).toBe("<p>@UUID[JournalEntry.new]{Elara} waits.</p>");
    expect(deps.runRetroPass).toHaveBeenCalledWith([entry]);
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true });
  });
  it("uses the trimmed edited name but keeps the selected text as the label", async () => {
    const { page, deps } = setup();
    await runEntityFromSelection(req({ name: "  Elara Moonwhisper " }), deps);
    expect(deps.createMejEntry.mock.calls[0][1]).toBe("Elara Moonwhisper");
    expect(page.text.content).toContain("{Elara}");
  });
  it("unfiled source → null folder; linkOthers false → no retro", async () => {
    const { deps } = setup({ folderId: null });
    const out = await runEntityFromSelection(req({ linkOthers: false }), deps);
    expect(deps.createMejEntry.mock.calls[0][5]).toBeNull();
    expect(deps.runRetroPass).not.toHaveBeenCalled();
    expect(out.retro).toBe(false);
  });
  it("content changed since capture → entity kept, not linked, retro still runs", async () => {
    const { page, deps } = setup({ content: "<p>Elara and Elara.</p>" });
    const out = await runEntityFromSelection(req(), deps);
    expect(page.update).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: false, retro: true });
  });
  it("page update throws → entity kept, not linked, retro skipped", async () => {
    const { deps } = setup({ updateThrows: true });
    const out = await runEntityFromSelection(req(), deps);
    expect(out).toEqual({ ok: true, entryUuid: "JournalEntry.new", linked: false, retro: false });
    expect(deps.runRetroPass).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalled();
  });
  it("missing page / create failure → ok:false, nothing written", async () => {
    const a = setup();
    expect(await runEntityFromSelection(req({ pageUuid: "X" }), a.deps)).toEqual({ ok: false, reason: "page-missing" });
    expect(a.deps.createMejEntry).not.toHaveBeenCalled();
    const b = setup({ createThrows: true });
    expect(await runEntityFromSelection(req(), b.deps)).toEqual({ ok: false, reason: "create-failed" });
    expect(b.page.update).not.toHaveBeenCalled();
  });
});
