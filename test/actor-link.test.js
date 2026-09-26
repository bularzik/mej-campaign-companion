import { describe, it, expect } from "vitest";
import {
  MEJ_FLAG, PUBLIC_BIO_PATHS, FULL_BIO_PATHS, isEmptyHtml, actorBiography, isPersonPage,
  linkedActorId, linkChanged, actorFlagFor, linkSyncUpdate, imageFollowPlan
} from "../scripts/logic/actor-link.mjs";

const dnd5eActor = (over = {}) => ({
  id: "act1", uuid: "Actor.act1", name: "Elara", img: "a/elara.webp",
  flags: {},
  system: { details: { biography: { value: "<p>Full: secret past</p>", public: "<p>Public: a bard</p>" } } },
  ...over
});
const personPage = ({ src = null, content = "", actor, notes, userId = "u1", type = "person" } = {}) => {
  const mej = { type };
  if (actor !== undefined) mej.actor = actor;
  if (notes !== undefined) mej[userId] = { notes };
  return { id: "pg1", src, text: { content }, flags: { [MEJ_FLAG]: mej } };
};

describe("isEmptyHtml", () => {
  it("treats absent, non-string, blank and markup-only as empty", () => {
    for (const v of [null, undefined, 42, "", "   ", "<p></p>", "<p>&nbsp;</p>", "<p> &#160; </p>", "<p> </p>", "<div><br></div>"]) {
      expect(isEmptyHtml(v)).toBe(true);
    }
  });
  it("treats text and embedded media as content", () => {
    expect(isEmptyHtml("<p>x</p>")).toBe(false);
    expect(isEmptyHtml("<p><img src='a.png'></p>")).toBe(false);
    expect(isEmptyHtml("<video src='a.mp4'></video>")).toBe(false);
  });
});

describe("biography path lists", () => {
  it("are the spec's lists, in order", () => {
    expect(PUBLIC_BIO_PATHS).toEqual(["system.details.biography.public", "system.details.publicNotes"]);
    expect(FULL_BIO_PATHS).toEqual([
      "system.details.biography.value", "system.details.privateNotes", "system.details.biography",
      "system.biography", "system.description.value", "system.description"
    ]);
  });
});

describe("actorBiography", () => {
  it("returns the first non-empty string in path order", () => {
    expect(actorBiography(dnd5eActor(), FULL_BIO_PATHS)).toBe("<p>Full: secret past</p>");
    expect(actorBiography(dnd5eActor(), PUBLIC_BIO_PATHS)).toBe("<p>Public: a bard</p>");
  });
  it("skips empty-HTML and non-string values", () => {
    const a = { system: { details: { biography: { value: "<p></p>" }, privateNotes: 7 }, biography: "<p>Generic</p>" } };
    expect(actorBiography(a, FULL_BIO_PATHS)).toBe("<p>Generic</p>");
  });
  it("returns null when nothing matches (no public field in this system)", () => {
    expect(actorBiography({ system: { biography: "<p>x</p>" } }, PUBLIC_BIO_PATHS)).toBeNull();
    expect(actorBiography(null, FULL_BIO_PATHS)).toBeNull();
  });
  it("reads pf2e's public and private notes", () => {
    const pf2 = { system: { details: { publicNotes: "<p>Pub</p>", privateNotes: "<p>Priv</p>" } } };
    expect(actorBiography(pf2, PUBLIC_BIO_PATHS)).toBe("<p>Pub</p>");
    expect(actorBiography(pf2, FULL_BIO_PATHS)).toBe("<p>Priv</p>");
  });
});

describe("isPersonPage", () => {
  it("matches only MEJ person pages", () => {
    expect(isPersonPage(personPage())).toBe(true);
    expect(isPersonPage(personPage({ type: "shop" }))).toBe(false);
    expect(isPersonPage({})).toBe(false);
    expect(isPersonPage(null)).toBe(false);
  });
});

describe("linkedActorId", () => {
  it("reads id, a uuid-only object, and a legacy string uuid", () => {
    expect(linkedActorId(personPage({ actor: { id: "a1", uuid: "Actor.a1" } }))).toBe("a1");
    expect(linkedActorId(personPage({ actor: { uuid: "Actor.a2" } }))).toBe("a2");
    expect(linkedActorId(personPage({ actor: "Actor.a3" }))).toBe("a3");
  });
  it("ignores compendium links, odd uuids and an absent flag", () => {
    expect(linkedActorId(personPage({ actor: { id: "a1", uuid: "Compendium.x.y.Actor.a1", pack: "x.y" } }))).toBeNull();
    expect(linkedActorId(personPage({ actor: { uuid: "Scene.s.Token.t.Actor.a" } }))).toBeNull();
    expect(linkedActorId(personPage())).toBeNull();
  });
  it("ignores a compendium uuid even when id is set and pack is absent (MEJ's v13/v14 compendium drop shape)", () => {
    expect(linkedActorId(personPage({ actor: { id: "a1", uuid: "Compendium.x.y.Actor.a1" } }))).toBeNull();
  });
});

describe("linkChanged", () => {
  it("detects set, replace and removal in nested and dotted forms", () => {
    expect(linkChanged({ flags: { [MEJ_FLAG]: { actor: { id: "a" } } } })).toBe(true);
    expect(linkChanged({ flags: { [MEJ_FLAG]: { "-=actor": null } } })).toBe(true);
    expect(linkChanged({ [`flags.${MEJ_FLAG}.actor`]: { id: "a" } })).toBe(true);
    expect(linkChanged({ [`flags.${MEJ_FLAG}.-=actor`]: null })).toBe(true);
  });
  it("ignores unrelated changes (including the sync's own write)", () => {
    expect(linkChanged({ src: "x", text: { content: "y" } })).toBe(false);
    expect(linkChanged({ flags: { [MEJ_FLAG]: { u1: { notes: "n" } } } })).toBe(false);
    expect(linkChanged(null)).toBe(false);
  });
});

describe("actorFlagFor", () => {
  it("builds MEJ's getItemData shape", () => {
    const a = dnd5eActor({ flags: { [MEJ_FLAG]: { type: "npc" } } });
    expect(actorFlagFor(a)).toEqual({ id: "act1", uuid: "Actor.act1", img: "a/elara.webp", name: "Elara", quantity: "1", type: "npc" });
    expect(actorFlagFor(dnd5eActor()).type).toBeUndefined();
  });
});

describe("linkSyncUpdate", () => {
  it("empty description and notes: image, public bio, full bio into the linking user's notes", () => {
    expect(linkSyncUpdate(personPage(), dnd5eActor(), "u1")).toEqual({
      src: "a/elara.webp",
      "text.content": "<p>Public: a bard</p>",
      [`flags.${MEJ_FLAG}.u1.notes`]: "<p>Full: secret past</p>"
    });
  });
  it("keeps a non-empty description and non-empty notes", () => {
    const page = personPage({ content: "<p>Mine</p>", notes: "<p>My notes</p>" });
    expect(linkSyncUpdate(page, dnd5eActor(), "u1")).toEqual({ src: "a/elara.webp" });
  });
  it("writes notes for the given user only, reading that user's existing notes", () => {
    const page = personPage({ content: "<p>Mine</p>", notes: "<p>u1 notes</p>", userId: "u1" });
    expect(linkSyncUpdate(page, dnd5eActor(), "u2")).toEqual({
      src: "a/elara.webp", [`flags.${MEJ_FLAG}.u2.notes`]: "<p>Full: secret past</p>"
    });
  });
  it("system with no public field: notes only, description untouched", () => {
    const actor = { id: "x", img: "i.png", system: { biography: "<p>Everything</p>" } };
    expect(linkSyncUpdate(personPage(), actor, "u1")).toEqual({ src: "i.png", [`flags.${MEJ_FLAG}.u1.notes`]: "<p>Everything</p>" });
  });
  it("returns null when nothing would change", () => {
    const page = personPage({ src: "a/elara.webp", content: "<p>Mine</p>", notes: "<p>n</p>" });
    expect(linkSyncUpdate(page, dnd5eActor(), "u1")).toBeNull();
  });
  it("never writes an empty image", () => {
    expect(linkSyncUpdate(personPage({ content: "<p>x</p>", notes: "<p>n</p>" }), dnd5eActor({ img: "" }), "u1")).toBeNull();
  });
});

describe("imageFollowPlan", () => {
  const entry = (id, pages) => ({ id, pages });
  it("groups updates per entry for linked person pages whose src differs", () => {
    const actor = dnd5eActor({ img: "new.webp" });
    const linked = { ...personPage({ src: "old.webp", actor: { id: "act1" } }), id: "p1" };
    const same = { ...personPage({ src: "new.webp", actor: { id: "act1" } }), id: "p2" };
    const other = { ...personPage({ src: "old.webp", actor: { id: "zzz" } }), id: "p3" };
    const shop = { ...personPage({ src: "old.webp", actor: { id: "act1" }, type: "shop" }), id: "p4" };
    const plan = imageFollowPlan(actor, [entry("e1", [linked, same, other, shop]), entry("e2", [other])]);
    expect(plan).toEqual([{ entryId: "e1", updates: [{ _id: "p1", src: "new.webp" }] }]);
  });
  it("returns nothing for an actor with no image or id", () => {
    expect(imageFollowPlan({ id: "act1", img: "" }, [])).toEqual([]);
    expect(imageFollowPlan(null, [])).toEqual([]);
  });
});
