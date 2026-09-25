import { describe, it, expect, vi } from "vitest";
vi.mock("../scripts/constants.mjs", () => ({ MODULE_ID: "mej-campaign-companion" }));
import { onPageUpdate, onActorUpdate } from "../scripts/hooks/actor-link.mjs";

const F = "monks-enhanced-journal";
const actor = { id: "a1", uuid: "Actor.a1", img: "new.webp", system: { details: { biography: { value: "<p>Full</p>", public: "<p>Pub</p>" } } } };
function page({ link = { id: "a1" }, src = "old.webp", content = "", type = "person" } = {}) {
  return { id: "p1", src, text: { content }, flags: { [F]: { type, actor: link } }, update: vi.fn(async () => {}) };
}
const env = (over = {}) => ({ userId: "u1", isActiveGM: false, actors: new Map([["a1", actor]]), journal: [], ...over });
const linkDiff = { flags: { [F]: { actor: { id: "a1" } } } };

describe("onPageUpdate", () => {
  it("syncs when this client set the link", async () => {
    const p = page();
    await onPageUpdate(p, linkDiff, {}, "u1", env());
    expect(p.update).toHaveBeenCalledWith({ src: "new.webp", "text.content": "<p>Pub</p>", [`flags.${F}.u1.notes`]: "<p>Full</p>" });
  });
  it("ignores another client's change", async () => {
    const p = page();
    await onPageUpdate(p, linkDiff, {}, "someone-else", env());
    expect(p.update).not.toHaveBeenCalled();
  });
  it("ignores updates that do not touch the link (its own write re-entering)", async () => {
    const p = page();
    await onPageUpdate(p, { src: "new.webp" }, {}, "u1", env());
    expect(p.update).not.toHaveBeenCalled();
  });
  it("ignores non-person pages, removed links and missing actors", async () => {
    const shop = page({ type: "shop" });
    await onPageUpdate(shop, linkDiff, {}, "u1", env());
    const unlinked = page({ link: null });
    await onPageUpdate(unlinked, { flags: { [F]: { "-=actor": null } } }, {}, "u1", env());
    const gone = page({ link: { id: "deleted" } });
    await onPageUpdate(gone, linkDiff, {}, "u1", env());
    for (const p of [shop, unlinked, gone]) expect(p.update).not.toHaveBeenCalled();
  });
  it("writes nothing when already in sync", async () => {
    const p = page({ src: "new.webp", content: "<p>x</p>" });
    p.flags[F].u1 = { notes: "<p>n</p>" };
    await onPageUpdate(p, linkDiff, {}, "u1", env());
    expect(p.update).not.toHaveBeenCalled();
  });
});

describe("onActorUpdate", () => {
  function journalOf(pages) {
    const entry = { id: "e1", pages, updateEmbeddedDocuments: vi.fn(async () => {}) };
    const list = [entry];
    list.get = (id) => list.find((e) => e.id === id);
    return { list, entry };
  }
  it("active GM updates linked person images on an img change", async () => {
    const { list, entry } = journalOf([page()]);
    await onActorUpdate(actor, { img: "new.webp" }, {}, "u9", env({ isActiveGM: true, journal: list }));
    expect(entry.updateEmbeddedDocuments).toHaveBeenCalledWith("JournalEntryPage", [{ _id: "p1", src: "new.webp" }]);
  });
  it("does nothing off the active GM or without an img change", async () => {
    const { list, entry } = journalOf([page()]);
    await onActorUpdate(actor, { img: "new.webp" }, {}, "u9", env({ isActiveGM: false, journal: list }));
    await onActorUpdate(actor, { name: "Renamed" }, {}, "u9", env({ isActiveGM: true, journal: list }));
    expect(entry.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
