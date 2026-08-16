import { describe, it, expect, vi } from "vitest";
import { resolveTargetGroup, collapseParticipants, mergeParticipants, matchPlaceForScene, pickLatestTimepoint, summarizeOutcome, pickNewestTimepoint, isVideoSrc, appendGalleryImage, mergeGalleryImages, resolveSharedMediaShare, installShareImageWrap } from "../scripts/logic/auto-capture.mjs";

describe("resolveTargetGroup", () => {
  const groups = [{ id: "a" }, { id: "b" }];
  it("returns the matching group", () => {
    expect(resolveTargetGroup("b", groups)).toBe(groups[1]);
  });
  it("returns null for an empty setting", () => {
    expect(resolveTargetGroup("", groups)).toBe(null);
  });
  it("returns null for a stale id", () => {
    expect(resolveTargetGroup("gone", groups)).toBe(null);
  });
});

describe("collapseParticipants", () => {
  it("groups combatants sharing an actor into a count", () => {
    const rows = collapseParticipants([
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.pc", name: "Aldric" }
    ]);
    expect(rows).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" });
    expect(rows).toContainEqual({ id: "Actor.pc", name: "Aldric", count: 1, actor: "Actor.pc" });
  });
  it("groups actor-less combatants by name with a null actor", () => {
    const rows = collapseParticipants([
      { actorUuid: null, name: "Mook" },
      { actorUuid: null, name: "Mook" }
    ]);
    expect(rows).toEqual([{ id: "name:Mook", name: "Mook", count: 2, actor: null }]);
  });
});

describe("mergeParticipants", () => {
  it("takes the element-wise max per id and unions new entries", () => {
    const existing = [{ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" }];
    const incoming = [
      { id: "Actor.gob", name: "Goblin", count: 1, actor: "Actor.gob" },
      { id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" }
    ];
    const merged = mergeParticipants(existing, incoming);
    expect(merged).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" });
    expect(merged).toContainEqual({ id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" });
  });
  it("applies max in reverse: incoming larger wins, and unmatched existing survives", () => {
    const existing = [
      { id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" },
      { id: "Actor.elf", name: "Elf", count: 4, actor: "Actor.elf" }
    ];
    const incoming = [
      { id: "Actor.gob", name: "Goblin", count: 5, actor: "Actor.gob" }
    ];
    const merged = mergeParticipants(existing, incoming);
    expect(merged).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 5, actor: "Actor.gob" });
    expect(merged).toContainEqual({ id: "Actor.elf", name: "Elf", count: 4, actor: "Actor.elf" });
  });
});

describe("matchPlaceForScene", () => {
  const places = [{ scene: "Scene.a" }, { scene: "Scene.b" }];
  it("finds the place for a scene", () => {
    expect(matchPlaceForScene(places, "Scene.b")).toBe(places[1]);
  });
  it("returns null when no place matches", () => {
    expect(matchPlaceForScene(places, "Scene.z")).toBe(null);
  });
});

describe("pickLatestTimepoint", () => {
  const tps = [{ id: "t1", sort: 0 }, { id: "t2", sort: 100 }, { id: "t3", sort: 200 }];
  it("returns the highest-sort attached id", () => {
    expect(pickLatestTimepoint(["t1", "t2"], tps)).toBe("t2");
  });
  it("returns null when nothing is attached", () => {
    expect(pickLatestTimepoint([], tps)).toBe(null);
  });
});

describe("summarizeOutcome", () => {
  const labels = { died: "Died", injured: "Injured", fled: "Fled", none: "All combatants unharmed." };
  it("buckets died, injured, and fled with counts", () => {
    const s = summarizeOutcome({
      present: [
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Aldric", defeated: false, hp: { value: 4, max: 20 } },
        { name: "Thorne", defeated: false, hp: { value: 20, max: 20 } }
      ],
      departed: [{ name: "Bandit", defeated: false }]
    }, labels);
    expect(s).toContain("Died: Goblin ×2");
    expect(s).toContain("Injured: Aldric");
    expect(s).toContain("Fled: Bandit");
    expect(s).not.toContain("Thorne");
  });
  it("skips injuries when HP is unavailable", () => {
    const s = summarizeOutcome({
      present: [{ name: "Ghost", defeated: false, hp: null }],
      departed: []
    }, labels);
    expect(s).toBe(labels.none);
  });
  it("counts a defeated departed combatant as died, not fled", () => {
    const s = summarizeOutcome({
      present: [],
      departed: [{ name: "Orc", defeated: true }]
    }, labels);
    expect(s).toContain("Died: Orc");
    expect(s).not.toContain("Fled");
  });
});

describe("pickNewestTimepoint", () => {
  it("returns the timepoint with the greatest sort", () => {
    const tps = [{ id: "a", sort: 100 }, { id: "c", sort: 300 }, { id: "b", sort: 200 }];
    expect(pickNewestTimepoint(tps)).toEqual({ id: "c", sort: 300 });
  });
  it("returns null for an empty list", () => {
    expect(pickNewestTimepoint([])).toBe(null);
  });
});

describe("isVideoSrc", () => {
  it("recognizes common video extensions case-insensitively", () => {
    expect(isVideoSrc("path/to/clip.webm")).toBe(true);
    expect(isVideoSrc("HANDOUT.MP4")).toBe(true);
    expect(isVideoSrc("worlds/x/scene.m4v?123")).toBe(true);
  });
  it("returns false for images and non-strings", () => {
    expect(isVideoSrc("art/map.webp")).toBe(false);
    expect(isVideoSrc("no-extension")).toBe(false);
    expect(isVideoSrc(null)).toBe(false);
  });
});

describe("appendGalleryImage", () => {
  it("appends a new entry and reports added", () => {
    const { images, added } = appendGalleryImage([{ id: "1", src: "a.webp" }], { id: "2", src: "b.mp4" });
    expect(added).toBe(true);
    expect(images).toEqual([{ id: "1", src: "a.webp" }, { id: "2", src: "b.mp4" }]);
  });
  it("dedups by src and reports not added", () => {
    const existing = [{ id: "1", src: "a.webp" }];
    const { images, added } = appendGalleryImage(existing, { id: "9", src: "a.webp" });
    expect(added).toBe(false);
    expect(images).toBe(existing);
  });
});

describe("mergeGalleryImages", () => {
  const e = (src) => ({ id: src, src, caption: "" });

  it("appends new entries and reports the count added", () => {
    const r = mergeGalleryImages([e("a.png")], [e("b.png"), e("c.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png", "b.png", "c.png"]);
    expect(r.added).toBe(2);
  });

  it("dedupes against existing images by src", () => {
    const existing = [e("a.png")];
    const r = mergeGalleryImages(existing, [e("a.png"), e("b.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png", "b.png"]);
    expect(r.added).toBe(1);
    expect(existing).toEqual([e("a.png")]);
    expect(r.images).not.toBe(existing);
  });

  it("dedupes duplicates within the incoming batch", () => {
    const r = mergeGalleryImages([], [e("a.png"), e("a.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png"]);
    expect(r.added).toBe(1);
  });

  it("returns existing unchanged with added 0 for an empty batch", () => {
    const existing = [e("a.png")];
    const r = mergeGalleryImages(existing, []);
    expect(r.images).toEqual(existing);
    expect(r.added).toBe(0);
  });
});

describe("resolveSharedMediaShare", () => {
  it("returns null for non-GM users", () => {
    expect(resolveSharedMediaShare({ isGM: false, options: { image: "a.png" }, appOptions: {} })).toBe(null);
  });
  it("prefers options.image over appOptions.src", () => {
    const r = resolveSharedMediaShare({ isGM: true, options: { image: "a.png" }, appOptions: { src: "b.png" } });
    expect(r.src).toBe("a.png");
  });
  it("falls back to appOptions.src when options.image is absent", () => {
    const r = resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { src: "b.png" } });
    expect(r.src).toBe("b.png");
  });
  it("resolves caption through the fallback chain", () => {
    expect(resolveSharedMediaShare({ isGM: true, options: { caption: "c1" }, appOptions: { caption: "c2" } }).caption).toBe("c1");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { caption: "c2" } }).caption).toBe("c2");
    expect(resolveSharedMediaShare({ isGM: true, options: { title: "t1" }, appOptions: {} }).caption).toBe("t1");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { window: { title: "wt" } } }).caption).toBe("wt");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: {} }).caption).toBe("");
  });
  it("tolerates missing options and appOptions", () => {
    const r = resolveSharedMediaShare({ isGM: true });
    expect(r).toEqual({ src: undefined, caption: "" });
  });
});

describe("installShareImageWrap", () => {
  const base = () => ({
    moduleId: "campaign-record",
    target: "foundry.applications.apps.ImagePopout.prototype.shareImage",
    wrapper: () => {},
    registerManual: vi.fn(),
    warn: vi.fn()
  });

  it("registers through libWrapper when the module is active", () => {
    const deps = base();
    const register = vi.fn();
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: true },
      libWrapper: { register }
    });
    expect(mode).toBe("libwrapper");
    expect(register).toHaveBeenCalledWith(deps.moduleId, deps.target, deps.wrapper, "WRAPPER");
    expect(deps.registerManual).not.toHaveBeenCalled();
  });

  it("uses the manual patch when the module is inactive", () => {
    const deps = base();
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: false },
      libWrapper: { register: vi.fn() }
    });
    expect(mode).toBe("manual");
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });

  it("uses the manual patch when the module is missing", () => {
    const deps = base();
    const mode = installShareImageWrap({ ...deps, libWrapperModule: undefined, libWrapper: undefined });
    expect(mode).toBe("manual");
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });

  it("falls back to the manual patch and warns when libWrapper.register throws", () => {
    const deps = base();
    const boom = new Error("boom");
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: true },
      libWrapper: { register: vi.fn(() => { throw boom; }) }
    });
    expect(mode).toBe("manual");
    expect(deps.warn).toHaveBeenCalledWith(boom);
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });
});
