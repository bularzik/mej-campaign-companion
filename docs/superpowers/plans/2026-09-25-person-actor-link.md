# Person ↔ Actor Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user link an MEJ Person page to a world Actor; while linked the Person's image follows the actor's, and at link time the actor's public biography seeds an empty description and its full biography seeds the linking user's empty private MEJ Notes. Also bring `README.md` up to date.

**Architecture:** One pure logic module (`scripts/logic/actor-link.mjs`) holds every decision. A sync hook module reacts to MEJ's own `flags["monks-enhanced-journal"].actor` changing (so MEJ's drag-drop and the companion picker share one path) and, on the active GM, to `updateActor` image changes. A UI module injects Link / Change / Unlink buttons into the Person header and a DialogV2 actor picker. No MEJ function is wrapped or patched.

**Tech Stack:** Foundry VTT v13/v14 ES modules (no build step), vitest units in `test/*.test.js`, Playwright e2e in `tests/e2e/*.spec.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-25-person-actor-link-design.md`

## Global Constraints

- Companion repo: `/Users/danbularzik/Claude/Projects/mej-campaign-companion`. Never edit anything under `monks-enhanced-journal` — companion features never patch MEJ.
- MEJ flag namespace: `"monks-enhanced-journal"`; link flag key: `actor`; MEJ's stored shape: `{ id, uuid, img, name, quantity: "1", type }`.
- Per-user MEJ notes key: `flags.monks-enhanced-journal.<userId>.notes`.
- Public biography paths, in order: `system.details.biography.public`, `system.details.publicNotes`.
- Full biography paths, in order: `system.details.biography.value`, `system.details.privateNotes`, `system.details.biography`, `system.biography`, `system.description.value`, `system.description`.
- Person pages only (`flags["monks-enhanced-journal"].type === "person"`). Shop/loot `actor` flags are ignored. Compendium links (flag has `pack`) are ignored by sync and never offered by the picker.
- No startup sweep of pre-existing links.
- i18n keys live under `MEJCampaignCompanion.actorLink.*` in `lang/en.json`.
- E2E on World A creates only `TT-` named documents (this spec's prefix: `TT-Pal`); every created actor/journal is deleted in cleanup. Radiant Citadel is never touched.
- Release version: `0.22.0`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A pre-existing compendium or legacy-string link being changed** — changing it must produce MEJ's exact flag shape with no stale `pack` left behind (Task 3 unlinks before relinking; Task 1 tests `linkedActorId` on string and `pack` forms).
2. **Sync re-entrancy** — the sync's own `page.update` fires `updateJournalEntryPage` again; it must not loop (Task 2 test: an update without the actor flag is a no-op).
3. **Another client's link change** — only the client that made the change writes, or two GMs would race (Task 2 test: foreign `userId` is a no-op).
4. **Actor image changes on a non-GM or non-active-GM client** — must not write (Task 2 test).
5. **Description that is only markup (`<p></p>`, `<p>&nbsp;</p>`)** — treated as empty so the seed still happens; an `<img>`-only description is not empty (Task 1 tests).

---

### Task 1: Pure actor-link logic

**Files:**
- Create: `scripts/logic/actor-link.mjs`
- Test: `test/actor-link.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all named exports of `scripts/logic/actor-link.mjs`):
  - `MEJ_FLAG: "monks-enhanced-journal"`
  - `PUBLIC_BIO_PATHS: readonly string[]`, `FULL_BIO_PATHS: readonly string[]`
  - `isEmptyHtml(html: unknown): boolean`
  - `actorBiography(actor: object, paths: string[]): string|null`
  - `isPersonPage(page: object): boolean`
  - `linkedActorId(page: object): string|null`
  - `linkChanged(changes: object): boolean`
  - `actorFlagFor(actor: object): { id, uuid, img, name, quantity: "1", type }`
  - `linkSyncUpdate(page: object, actor: object, userId: string): object|null`
  - `imageFollowPlan(actor: object, entries: Iterable<{id, pages: Iterable<page>}>): Array<{ entryId: string, updates: Array<{ _id: string, src: string }> }>`

- [ ] **Step 1: Write the failing tests**

Create `test/actor-link.test.js`:

```js
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
    for (const v of [null, undefined, 42, "", "   ", "<p></p>", "<p>&nbsp;</p>", "<p> &#160; </p>", "<p> </p>", "<div><br></div>"]) {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/actor-link.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/actor-link.mjs`.

- [ ] **Step 3: Implement the module**

Create `scripts/logic/actor-link.mjs`:

```js
// Person <-> Actor link (spec 2026-09-25): every decision the sync and the UI
// make, as pure functions over plain objects. No Foundry globals, so the
// whole behavior table is unit-tested here; hooks/actor-link.mjs and
// hooks/actor-link-ui.mjs only move data between these and Foundry.
//
// The link itself is MEJ's own flags["monks-enhanced-journal"].actor, the
// same value MEJ's addActor writes on an Actor drop - the companion builds on
// it and never patches MEJ.
export const MEJ_FLAG = "monks-enhanced-journal";

// Text a game system itself marks as player-facing. Only these ever reach the
// Person's (player-visible) description.
export const PUBLIC_BIO_PATHS = Object.freeze([
  "system.details.biography.public", // dnd5e
  "system.details.publicNotes"       // pf2e
]);

// The full biography - may hold GM-only text, so it only ever goes to the
// linking user's own MEJ Notes.
export const FULL_BIO_PATHS = Object.freeze([
  "system.details.biography.value", // dnd5e
  "system.details.privateNotes",    // pf2e
  "system.details.biography",       // string form, several systems
  "system.biography",
  "system.description.value",
  "system.description"
]);

const MEDIA_RE = /<(img|video|audio|iframe|embed|object)\b/i;

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** True for a non-string, or HTML with no text and no embedded media. */
export function isEmptyHtml(html) {
  if (typeof html !== "string") return true;
  if (MEDIA_RE.test(html)) return false;
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length === 0;
}

/** First path in `paths` holding a non-empty HTML string, else null. */
export function actorBiography(actor, paths) {
  if (!actor) return null;
  for (const path of paths) {
    const value = getPath(actor, path);
    if (typeof value === "string" && !isEmptyHtml(value)) return value;
  }
  return null;
}

export function isPersonPage(page) {
  return page?.flags?.[MEJ_FLAG]?.type === "person";
}

const WORLD_ACTOR_UUID = /^Actor\.([^.]+)$/;

/** The linked world actor's id, or null (absent flag, compendium link, non-world uuid). */
export function linkedActorId(page) {
  const link = page?.flags?.[MEJ_FLAG]?.actor;
  if (typeof link === "string") return WORLD_ACTOR_UUID.exec(link)?.[1] ?? null; // legacy uuid string
  if (!link || typeof link !== "object" || link.pack) return null;
  if (typeof link.id === "string" && link.id) return link.id;
  return typeof link.uuid === "string" ? (WORLD_ACTOR_UUID.exec(link.uuid)?.[1] ?? null) : null;
}

/** Does an update diff set, replace or remove MEJ's actor link? */
export function linkChanged(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (`flags.${MEJ_FLAG}.actor` in changes || `flags.${MEJ_FLAG}.-=actor` in changes) return true;
  const mej = changes.flags?.[MEJ_FLAG];
  return !!mej && typeof mej === "object" && ("actor" in mej || "-=actor" in mej);
}

/** MEJ's own link value for `actor` (EnhancedJournalSheet.getItemData's shape). */
export function actorFlagFor(actor) {
  return {
    id: actor.id, uuid: actor.uuid, img: actor.img, name: actor.name,
    quantity: "1", type: actor.flags?.[MEJ_FLAG]?.type
  };
}

/**
 * The page update for a new or changed link, or null when nothing changes:
 * image always follows; the public biography seeds an empty description;
 * the full biography seeds `userId`'s own empty MEJ Notes.
 */
export function linkSyncUpdate(page, actor, userId) {
  const update = {};
  if (typeof actor?.img === "string" && actor.img && actor.img !== page?.src) update.src = actor.img;
  if (isEmptyHtml(page?.text?.content)) {
    const publicBio = actorBiography(actor, PUBLIC_BIO_PATHS);
    if (publicBio) update["text.content"] = publicBio;
  }
  if (typeof userId === "string" && userId && isEmptyHtml(page?.flags?.[MEJ_FLAG]?.[userId]?.notes)) {
    const fullBio = actorBiography(actor, FULL_BIO_PATHS);
    if (fullBio) update[`flags.${MEJ_FLAG}.${userId}.notes`] = fullBio;
  }
  return Object.keys(update).length ? update : null;
}

/** Per-entry page updates that bring every Person linked to `actor` onto its current image. */
export function imageFollowPlan(actor, entries) {
  const plan = [];
  if (!actor?.id || typeof actor.img !== "string" || !actor.img) return plan;
  for (const entry of entries ?? []) {
    const updates = [];
    for (const page of entry.pages ?? []) {
      if (isPersonPage(page) && linkedActorId(page) === actor.id && page.src !== actor.img) {
        updates.push({ _id: page.id, src: actor.img });
      }
    }
    if (updates.length) plan.push({ entryId: entry.id, updates });
  }
  return plan;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/actor-link.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS (985 existing + the new ones).

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/actor-link.mjs test/actor-link.test.js
git commit -m "feat(actor-link): pure link, biography and image-follow logic

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sync hooks

**Files:**
- Create: `scripts/hooks/actor-link.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (inside `registerCore()`, after the `"portal rename sync"` step)
- Test: `test/actor-link-hooks.test.js`

**Interfaces:**
- Consumes (Task 1): `isPersonPage`, `linkChanged`, `linkedActorId`, `linkSyncUpdate`, `imageFollowPlan`.
- Produces: `onPageUpdate(page, changes, options, userId, env?)`, `onActorUpdate(actor, changes, options, userId, env?)`, `registerActorLink()`. `env` = `{ userId: string, isActiveGM: boolean, actors: { get(id) }, journal: Iterable<entry> & { get(id) } }`.

- [ ] **Step 1: Write the failing tests**

Create `test/actor-link-hooks.test.js`:

```js
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
    const unlinked = page({ link: undefined });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/actor-link-hooks.test.js`
Expected: FAIL — cannot resolve `../scripts/hooks/actor-link.mjs`.

- [ ] **Step 3: Implement the hook module**

Create `scripts/hooks/actor-link.mjs`:

```js
// Person <-> Actor link sync (spec 2026-09-25 §Architecture 2).
//  - Link sync: MEJ's actor flag changed on a Person, on the client that made
//    the change (it already has permission to update the page). Covers MEJ's
//    own Actor drop (addActor -> setFlag) and the companion picker alike.
//  - Image follow: an actor's img changed; the active GM brings every linked
//    Person onto it. No GM online = caught on the next change or a re-link.
// Observers only: a failure logs and never blocks the triggering update.
import { MODULE_ID } from "../constants.mjs";
import { isPersonPage, linkChanged, linkedActorId, linkSyncUpdate, imageFollowPlan } from "../logic/actor-link.mjs";

function foundryEnv() {
  return {
    userId: game.user.id,
    isActiveGM: game.user === game.users.activeGM,
    actors: game.actors,
    journal: game.journal
  };
}

export async function onPageUpdate(page, changes, options, userId, env = foundryEnv()) {
  if (userId !== env.userId) return;
  if (!isPersonPage(page) || !linkChanged(changes)) return;
  const actorId = linkedActorId(page);
  if (!actorId) return; // unlinked, or a compendium link
  const actor = env.actors.get(actorId);
  if (!actor) return;
  const update = linkSyncUpdate(page, actor, env.userId);
  if (update) await page.update(update);
}

export async function onActorUpdate(actor, changes, options, userId, env = foundryEnv()) {
  if (!env.isActiveGM || !changes || !("img" in changes)) return;
  for (const { entryId, updates } of imageFollowPlan(actor, env.journal)) {
    await env.journal.get(entryId)?.updateEmbeddedDocuments("JournalEntryPage", updates);
  }
}

export function registerActorLink() {
  const observe = (label, fn) => (...args) => {
    fn(...args).catch((err) => console.error(`${MODULE_ID} | actor link ${label} failed`, err));
  };
  Hooks.on("updateJournalEntryPage", observe("sync", (page, changes, options, userId) => onPageUpdate(page, changes, options, userId)));
  Hooks.on("updateActor", observe("image follow", (actor, changes, options, userId) => onActorUpdate(actor, changes, options, userId)));
}
```

Note: the registered handlers call with exactly four arguments so `env` takes its `foundryEnv()` default.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/actor-link-hooks.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into `registerCore()`**

In `scripts/integrations/mej-adapter.mjs`, directly after the block

```js
  await step("portal rename sync", async () => {
    const { registerPortalSync } = await import("../hooks/portal-sync.mjs");
    registerPortalSync();
  });
```

add:

```js
  await step("actor link sync", async () => {
    const { registerActorLink } = await import("../hooks/actor-link.mjs");
    registerActorLink();
  });
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS. If `test/sheet-registration.test.js` or another test pins the list of `registerCore` steps, update that expectation to include `"actor link sync"` in the same position.

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/actor-link.mjs test/actor-link-hooks.test.js scripts/integrations/mej-adapter.mjs
git commit -m "feat(actor-link): sync image and biography on link, follow actor image changes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Link / Change / Unlink controls and the actor picker

**Files:**
- Create: `scripts/apps/actor-picker-dialog.mjs`
- Create: `scripts/hooks/actor-link-ui.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (after the Task 2 step)
- Modify: `lang/en.json` (new `actorLink` object inside `MEJCampaignCompanion`)
- Modify: `styles/campaign-companion.css` (append)
- Test: `test/actor-picker.test.js`

**Interfaces:**
- Consumes (Task 1): `MEJ_FLAG`, `isPersonPage`, `linkedActorId`, `actorFlagFor`. Constants `MODULE_ID`, `I18N` from `scripts/constants.mjs`.
- Produces: `pickerRows(actors, canObserve, filter?) -> Array<{id, name, img}>`, `pickActor({ currentId }) -> Promise<Actor|null>`, `registerActorLinkUi()`. DOM: a `<span class="mej-cc-actor-link">` appended to the Person header's `h1.header-name`, holding buttons with `data-mej-cc-actor="link" | "change" | "unlink"`. Picker: a DialogV2 titled "Link Actor" containing `ul.mej-cc-actor-picker > li.mej-cc-actor-pick[data-actor-id]` and `input[name="filter"]`.

- [ ] **Step 1: Write the failing test**

Create `test/actor-picker.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
vi.mock("../scripts/constants.mjs", () => ({ I18N: "MEJCampaignCompanion" }));
import { pickerRows } from "../scripts/apps/actor-picker-dialog.mjs";

const actors = [
  { id: "b", name: "Boren", img: "b.png", seen: true },
  { id: "a", name: "aldric", img: "", seen: true },
  { id: "h", name: "Hidden", img: "h.png", seen: false }
];
const canObserve = (a) => a.seen;

describe("pickerRows", () => {
  it("lists observable actors sorted by name, with a fallback image", () => {
    expect(pickerRows(actors, canObserve)).toEqual([
      { id: "a", name: "aldric", img: "icons/svg/mystery-man.svg" },
      { id: "b", name: "Boren", img: "b.png" }
    ]);
  });
  it("filters case-insensitively on name", () => {
    expect(pickerRows(actors, canObserve, "  BOR ").map((r) => r.id)).toEqual(["b"]);
    expect(pickerRows(actors, canObserve, "hid")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/actor-picker.test.js`
Expected: FAIL — cannot resolve `../scripts/apps/actor-picker-dialog.mjs`.

- [ ] **Step 3: Implement the picker**

Create `scripts/apps/actor-picker-dialog.mjs`:

```js
// Actor picker for the Person <-> Actor link (spec 2026-09-25 §3): world
// actors the user can at least observe, filterable by name. A player cannot
// pick (and so copy the biography of) an actor they cannot see.
import { I18N } from "../constants.mjs";

const FALLBACK_IMG = "icons/svg/mystery-man.svg";

export function pickerRows(actors, canObserve, filter = "") {
  const q = String(filter).trim().toLocaleLowerCase();
  return [...actors]
    .filter((a) => canObserve(a))
    .filter((a) => !q || String(a.name ?? "").toLocaleLowerCase().includes(q))
    .map((a) => ({ id: a.id, name: String(a.name ?? ""), img: a.img || FALLBACK_IMG }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Resolves the chosen world Actor, or null on cancel / nothing to pick. */
export async function pickActor({ currentId = null } = {}) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  const rows = pickerRows(game.actors, (a) => a.testUserPermission(game.user, "OBSERVER"));
  if (!rows.length) {
    ui.notifications.info(L("noActors"));
    return null;
  }
  const items = rows.map((r) => `
    <li class="mej-cc-actor-pick${r.id === currentId ? " current" : ""}" data-actor-id="${esc(r.id)}"
        data-name="${esc(r.name.toLocaleLowerCase())}" tabindex="0">
      <img src="${esc(r.img)}" alt=""><span>${esc(r.name)}</span>
    </li>`).join("");
  const content = `
    <input type="search" name="filter" placeholder="${esc(L("filter"))}" autofocus>
    <ul class="mej-cc-actor-picker">${items}</ul>`;
  let picked = null;
  await foundry.applications.api.DialogV2.wait({
    window: { title: L("pickerTitle") },
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const choose = (li) => { picked = li.dataset.actorId; dialog.close(); };
      root.querySelectorAll(".mej-cc-actor-pick").forEach((li) => {
        li.addEventListener("click", () => choose(li));
        li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); choose(li); } });
      });
      root.querySelector("input[name='filter']")?.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLocaleLowerCase();
        root.querySelectorAll(".mej-cc-actor-pick").forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
      });
    }
  });
  return picked ? game.actors.get(picked) ?? null : null;
}
```

- [ ] **Step 4: Run the picker test to verify it passes**

Run: `npx vitest run test/actor-picker.test.js`
Expected: PASS.

- [ ] **Step 5: Implement the header controls**

Create `scripts/hooks/actor-link-ui.mjs`:

```js
// Link / Change / Unlink controls in the MEJ Person header (spec 2026-09-25
// §3). Same two render hooks as knowledge-ui.mjs; idempotent per render.
// Changing a link unsets the old flag first: setFlag merges objects, and a
// merged-in stale `pack` would turn the new link into a "compendium" one.
import { MODULE_ID, I18N } from "../constants.mjs";
import { MEJ_FLAG, isPersonPage, linkedActorId, actorFlagFor } from "../logic/actor-link.mjs";
import { pickActor } from "../apps/actor-picker-dialog.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

async function linkTo(page) {
  const actor = await pickActor({ currentId: linkedActorId(page) });
  if (!actor) return;
  if (page.getFlag(MEJ_FLAG, "actor") !== undefined) await page.unsetFlag(MEJ_FLAG, "actor");
  await page.setFlag(MEJ_FLAG, "actor", actorFlagFor(actor));
}

async function unlink(page) {
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: L("unlinkTitle") },
    content: `<p>${foundry.utils.escapeHTML(L("unlinkConfirm"))}</p>`,
    rejectClose: false
  });
  if (ok) await page.unsetFlag(MEJ_FLAG, "actor");
}

function button(kind, icon, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mej-cc-actor-btn";
  b.dataset.mejCcActor = kind;
  b.dataset.tooltip = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<i class="${icon}" inert></i>`;
  b.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick().catch((err) => console.error(`${MODULE_ID} | actor link ${kind} failed`, err));
  });
  return b;
}

export function injectActorControls(sheet, root) {
  const page = sheet?.document;
  if (!root || !(page instanceof JournalEntryPage) || !isPersonPage(page) || !sheet.isEditable) return;
  const h1 = root.querySelector(".journal-sheet-header .header-name");
  if (!h1) return;
  h1.querySelector(".mej-cc-actor-link")?.remove();
  const L = (k) => game.i18n.localize(`${I18N}.actorLink.${k}`);
  const wrap = document.createElement("span");
  wrap.className = "mej-cc-actor-link";
  if (page.getFlag(MEJ_FLAG, "actor") === undefined) {
    wrap.append(button("link", "fa-solid fa-user-plus", L("link"), () => linkTo(page)));
  } else {
    wrap.append(
      button("change", "fa-solid fa-user-pen", L("change"), () => linkTo(page)),
      button("unlink", "fa-solid fa-link-slash", L("unlink"), () => unlink(page))
    );
  }
  h1.append(wrap);
}

export function registerActorLinkUi() {
  const inject = (sheet, html) => {
    try { injectActorControls(sheet, asElement(html)); }
    catch (err) { console.error(`${MODULE_ID} | actor link controls failed`, err); }
  };
  Hooks.on("renderJournalPageSheet", inject);
  Hooks.on("renderEnhancedJournalSheet", inject);
}
```

- [ ] **Step 6: Wire the UI into `registerCore()`**

In `scripts/integrations/mej-adapter.mjs`, directly after the `"actor link sync"` step added in Task 2, add:

```js
  await step("actor link controls", async () => {
    const { registerActorLinkUi } = await import("../hooks/actor-link-ui.mjs");
    registerActorLinkUi();
  });
```

- [ ] **Step 7: Add the strings**

Add this object as a new key inside the top-level `"MEJCampaignCompanion"` object of `lang/en.json`, directly after the `"entityFromSelection"` object (keep the JSON valid — add the comma after the preceding `}`):

```json
    "actorLink": {
      "link": "Link Actor",
      "change": "Change linked actor",
      "unlink": "Unlink actor",
      "unlinkTitle": "Unlink Actor",
      "unlinkConfirm": "Remove the link to this actor? The image, description and notes stay as they are.",
      "pickerTitle": "Link Actor",
      "filter": "Filter actors…",
      "noActors": "There are no actors you can link."
    }
```

Verify: `node -e "const j=require('./lang/en.json');console.log(Object.keys(j.MEJCampaignCompanion.actorLink).length)"` prints `8`.

- [ ] **Step 8: Add the styles**

Append to `styles/campaign-companion.css`:

```css
/* Person <-> Actor link (spec 2026-09-25) */
.mej-cc-actor-link { display: inline-flex; gap: 2px; flex: 0 0 auto; align-items: center; }
.mej-cc-actor-link .mej-cc-actor-btn { flex: 0 0 auto; width: 28px; line-height: 24px; padding: 0; }
.mej-cc-actor-picker { list-style: none; margin: 6px 0 0; padding: 0; max-height: 360px; overflow-y: auto; }
.mej-cc-actor-pick { display: flex; align-items: center; gap: 8px; padding: 3px 6px; cursor: pointer; border-radius: 4px; }
.mej-cc-actor-pick img { width: 32px; height: 32px; object-fit: cover; border: none; flex: 0 0 32px; }
.mej-cc-actor-pick:hover, .mej-cc-actor-pick:focus { background: rgba(127, 127, 127, 0.2); outline: none; }
.mej-cc-actor-pick.current { font-weight: bold; }
```

- [ ] **Step 9: Run the full unit suite**

Run: `npm test`
Expected: PASS. (If a unit test validates `lang/en.json` key sets or the `registerCore` step list, update its expectation to include the new keys / steps.)

- [ ] **Step 10: Commit**

```bash
git add scripts/apps/actor-picker-dialog.mjs scripts/hooks/actor-link-ui.mjs scripts/integrations/mej-adapter.mjs lang/en.json styles/campaign-companion.css test/actor-picker.test.js
git commit -m "feat(actor-link): Link Actor, Change and Unlink controls with an actor picker

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: End-to-end spec

**Files:**
- Create: `tests/e2e/25-person-actor-link.spec.mjs`

**Interfaces:**
- Consumes: the DOM contract from Task 3 (`.mej-cc-actor-link button[data-mej-cc-actor=…]`, the "Link Actor" DialogV2, `li.mej-cc-actor-pick[data-actor-id]`, `input[name="filter"]`); the sync behavior from Task 2. Harness helpers from `tests/e2e/helpers/foundry.mjs`: `login`, `cleanupAsGm`, `trackConsoleErrors`, `assertNoConsoleErrors`, `settle`, `deleteJournalsByPrefix`, `deleteActorsByPrefix`, `KNOWN_MEJ_SESSION_ICON_404`. Users: `"Gamemaster"`, `"User 1"`.
- Produces: nothing downstream.

Both test worlds run dnd5e (World A 6.0.3, World B 5.3.3), so `type: "npc"` actors carry `system.details.biography.{value,public}`.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/25-person-actor-link.spec.mjs`:

```js
// Person <-> Actor link (spec 2026-09-25 §Testing). Everything this spec
// creates is named TT-Pal...${RUN} so global setup's crashed-run sweep
// (journals AND actors) reclaims it.
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, deleteActorsByPrefix, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const F = "monks-enhanced-journal";
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const RUN = Date.now();
const PREFIX = "TT-Pal";
const N = {
  person: `${PREFIX}Person${RUN}`,
  actor: `${PREFIX}Actor${RUN}`,
  hidden: `${PREFIX}Hidden${RUN}`
};
const IMG1 = "icons/svg/skull.svg";
const IMG2 = "icons/svg/sword.svg";
const PUBLIC_BIO = `<p>Public ${RUN}: a travelling bard.</p>`;
const FULL_BIO = `<p>Full ${RUN}: secretly the lost heir.</p>`;

async function createActor(page, name, { ownershipDefault = 0 } = {}) {
  return page.evaluate(async ({ name, img, pub, full, ownershipDefault }) => {
    const a = await Actor.create({
      name, type: "npc", img, ownership: { default: ownershipDefault },
      system: { details: { biography: { value: full, public: pub } } }
    });
    return { id: a.id, uuid: a.uuid };
  }, { name, img: IMG1, pub: PUBLIC_BIO, full: FULL_BIO, ownershipDefault });
}

async function createPerson(page, name, { content = "", ownershipDefault = 2, notes } = {}) {
  return page.evaluate(async ({ name, content, ownershipDefault, notes, F }) => {
    const flags = { [F]: { type: "person", relationships: [], attributes: {} } };
    if (notes) flags[F][game.user.id] = { notes };
    const e = await JournalEntry.create({
      name, ownership: { default: ownershipDefault },
      pages: [{ name, type: "text", flags, text: { content } }]
    });
    return { id: e.id };
  }, { name, content, ownershipDefault, notes, F });
}

const pageState = (page, entryId) => page.evaluate(({ entryId, F }) => {
  const p = game.journal.get(entryId)?.pages.contents[0];
  if (!p) return null;
  return {
    src: p.src ?? null,
    content: p.text?.content ?? "",
    link: p.getFlag(F, "actor") ?? null,
    myNotes: p.getFlag(F, game.user.id)?.notes ?? null
  };
}, { entryId, F });

async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(shell.locator(".journal-sheet-header .header-name").first()).toBeVisible({ timeout: 15_000 });
  return shell;
}

const control = (shell, kind) => shell.locator(`.mej-cc-actor-link button[data-mej-cc-actor='${kind}']`).first();
const picker = (page) => page.locator("dialog.application", { hasText: "Link Actor" });

async function pickInPicker(page, actorId, filterText) {
  const dlg = picker(page);
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  if (filterText) await dlg.locator("input[name='filter']").fill(filterText);
  await dlg.locator(`li.mej-cc-actor-pick[data-actor-id='${actorId}']`).click();
  await expect(dlg).toHaveCount(0, { timeout: 10_000 });
}

async function cleanup(gmPage) {
  await gmPage.evaluate(async () => {
    try {
      await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* nothing open */ }
  });
  await deleteJournalsByPrefix(gmPage, PREFIX);
  await deleteActorsByPrefix(gmPage, PREFIX);
}

test.describe("25 person to actor link", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("picker link: image, public bio into the description, full bio into the GM's own notes; player sees only the public text", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actor = await createActor(page, N.actor);
    const person = await createPerson(page, N.person);

    const shell = await openEntry(page, person.id);
    await control(shell, "link").click();
    await pickInPicker(page, actor.id, N.actor);

    await expect.poll(() => pageState(page, person.id), { timeout: 10_000 }).toMatchObject({
      src: IMG1, content: PUBLIC_BIO, myNotes: FULL_BIO, link: { id: actor.id, uuid: actor.uuid, quantity: "1" }
    });
    await expect(control(shell, "change")).toBeVisible({ timeout: 10_000 });
    await expect(control(shell, "unlink")).toBeVisible();

    const ctx = await browser.newContext(VIEWPORT);
    const player = await ctx.newPage();
    const perrs = trackConsoleErrors(player, { ignore: IGNORE });
    try {
      await login(player, "User 1");
      const seen = await pageState(player, person.id);
      expect(seen.content).toBe(PUBLIC_BIO);
      expect(seen.myNotes).toBeNull();
      const pshell = await openEntry(player, person.id);
      await expect(pshell).toContainText(`Public ${RUN}`);
      await expect(pshell).not.toContainText(`Full ${RUN}`);
      // Observer, not editor: no link controls for the player.
      await expect(pshell.locator(".mej-cc-actor-link")).toHaveCount(0);
      assertNoConsoleErrors(perrs);
    } finally {
      await ctx.close();
    }
    assertNoConsoleErrors(errors);
  });

  test("an existing description and notes are kept; the image still follows", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actor = await createActor(page, N.actor);
    const person = await createPerson(page, N.person, { content: "<p>Mine</p>", notes: "<p>My notes</p>" });

    const shell = await openEntry(page, person.id);
    await control(shell, "link").click();
    await pickInPicker(page, actor.id);

    await expect.poll(() => pageState(page, person.id), { timeout: 10_000 }).toMatchObject({
      src: IMG1, content: "<p>Mine</p>", myNotes: "<p>My notes</p>"
    });
    assertNoConsoleErrors(errors);
  });

  test("MEJ's own link path (setFlag with getItemData's shape) syncs the same way", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actor = await createActor(page, N.actor);
    const person = await createPerson(page, N.person);

    await page.evaluate(async ({ entryId, actorId, F }) => {
      const a = game.actors.get(actorId);
      const p = game.journal.get(entryId).pages.contents[0];
      await p.setFlag(F, "actor", { id: a.id, uuid: a.uuid, img: a.img, name: a.name, quantity: "1", type: a.flags[F]?.type });
    }, { entryId: person.id, actorId: actor.id, F });

    await expect.poll(() => pageState(page, person.id), { timeout: 10_000 }).toMatchObject({
      src: IMG1, content: PUBLIC_BIO, myNotes: FULL_BIO
    });
    assertNoConsoleErrors(errors);
  });

  test("changing the actor's image updates the linked person", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actor = await createActor(page, N.actor);
    const person = await createPerson(page, N.person);
    const shell = await openEntry(page, person.id);
    await control(shell, "link").click();
    await pickInPicker(page, actor.id);
    await expect.poll(async () => (await pageState(page, person.id)).src, { timeout: 10_000 }).toBe(IMG1);

    await page.evaluate(async ({ id, img }) => game.actors.get(id).update({ img }), { id: actor.id, img: IMG2 });
    await expect.poll(async () => (await pageState(page, person.id)).src, { timeout: 10_000 }).toBe(IMG2);
    assertNoConsoleErrors(errors);
  });

  test("unlink removes the flag and keeps image, description and notes", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actor = await createActor(page, N.actor);
    const person = await createPerson(page, N.person);
    const shell = await openEntry(page, person.id);
    await control(shell, "link").click();
    await pickInPicker(page, actor.id);
    await expect.poll(async () => (await pageState(page, person.id)).content, { timeout: 10_000 }).toBe(PUBLIC_BIO);

    await control(shell, "unlink").click();
    const confirm = page.locator("dialog.application", { hasText: "Unlink Actor" });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.locator("button[data-action='yes']").click();

    await expect.poll(() => pageState(page, person.id), { timeout: 10_000 }).toMatchObject({
      link: null, src: IMG1, content: PUBLIC_BIO, myNotes: FULL_BIO
    });
    await expect(control(shell, "link")).toBeVisible({ timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });

  test("a player's picker lists only actors they can observe", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    const visible = await createActor(page, N.actor, { ownershipDefault: 2 });
    const hidden = await createActor(page, N.hidden, { ownershipDefault: 0 });
    const person = await createPerson(page, N.person, { ownershipDefault: 3 });

    const ctx = await browser.newContext(VIEWPORT);
    const player = await ctx.newPage();
    const errors = trackConsoleErrors(player, { ignore: IGNORE });
    try {
      await login(player, "User 1");
      const shell = await openEntry(player, person.id);
      await control(shell, "link").click();
      const dlg = picker(player);
      await expect(dlg).toBeVisible({ timeout: 10_000 });
      await expect(dlg.locator(`li[data-actor-id='${visible.id}']`)).toHaveCount(1);
      await expect(dlg.locator(`li[data-actor-id='${hidden.id}']`)).toHaveCount(0);
      await dlg.locator("button[data-action='cancel']").click();
      await expect(dlg).toHaveCount(0, { timeout: 10_000 });
      assertNoConsoleErrors(errors);
    } finally {
      await ctx.close();
    }
  });
});
```

- [ ] **Step 2: Run it on World A (Foundry 14)**

Run: `npx playwright test tests/e2e/25-person-actor-link.spec.mjs`
Expected: 6 passed (plus the auth setup project). If a selector fails because MEJ's markup differs (e.g. the header `h1.header-name` or the confirm dialog's `yes` button), inspect it in the failing trace and adjust the selector in the spec only — do not change the product contract in Task 3 without also updating its task.

- [ ] **Step 3: Run it on World B (Foundry 13)**

Run: `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/25-person-actor-link.spec.mjs --trace off`
Expected: 6 passed.

- [ ] **Step 4: Re-run the neighbouring UI specs that share the header/render hooks**

Run: `npx playwright test tests/e2e/07-knowledge.spec.mjs tests/e2e/24-entity-from-selection.spec.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/25-person-actor-link.spec.mjs
git commit -m "test(e2e): person to actor link on Foundry 14 and 13

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Guides, screenshot, CHANGELOG and version

**Files:**
- Modify: `docs/gm-guide.md` (new `## Linking a Person to an actor` section directly after `## Creating an entity from selected text`; one line in `## What Campaign Companion adds` if that section lists features)
- Modify: `tests/e2e/guide-screenshots.spec.mjs` (new shot block after the `entity-from-selection-dialog` block)
- Create: `docs/images/actor-link-picker.png` (produced by the screenshot run)
- Modify: `CHANGELOG.md` (new top entry)
- Modify: `module.json` (`"version": "0.22.0"`, and the `download` URL if it embeds the version)

**Interfaces:**
- Consumes: Task 3's DOM contract and Task 4's creation helpers (copy them into the screenshot block; the screenshot spec does not import from other specs).

- [ ] **Step 1: Add the screenshot block**

In `tests/e2e/guide-screenshots.spec.mjs`, directly after the `finally { … }` that closes the `entity-from-selection-dialog` block, add a block in the same style (same `shot()` helper, same GM page):

```js
    // Person <-> Actor link picker (GM guide, "Linking a Person to an actor").
    {
      const PREFIX = "TT-PalShot";
      const personName = `${PREFIX}Mirela`;
      try {
        await page.evaluate(async ({ PREFIX }) => {
          for (const [name, img] of [["Mirela Vance", "icons/svg/mystery-man.svg"], ["Old Tom", "icons/svg/cowled.svg"], ["Captain Hesk", "icons/svg/skull.svg"]]) {
            await Actor.create({ name: `${PREFIX}${name}`, type: "npc", img });
          }
        }, { PREFIX });
        const personId = await page.evaluate(async (n) => (await JournalEntry.create({
          name: n, pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "person", relationships: [], attributes: {} } }, text: { content: "" } }]
        })).id, personName);
        await openEntry(page, personId);
        await page.locator("#MonksEnhancedJournal .mej-cc-actor-link button[data-mej-cc-actor='link']").first().click();
        const dialog = page.locator("dialog.application", { hasText: "Link Actor" });
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        await dialog.locator("input[name='filter']").fill(PREFIX);
        await settle(page, 300);
        await shot(dialog, "actor-link-picker");
        await page.keyboard.press("Escape");
        await settle(page, 300);
      } finally {
        await page.evaluate(async () => {
          try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
        }).catch(() => {});
        await deleteJournalsByPrefix(page, PREFIX);
        await deleteActorsByPrefix(page, PREFIX);
      }
    }
```

Add `deleteActorsByPrefix` to that file's import from `./helpers/foundry.mjs` if it is not already imported. If the enclosing block's variable names differ (e.g. `openEntry` is named differently in this file), use the file's own helper names.

- [ ] **Step 2: Capture the screenshot**

Run: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs -g "GM"` (use the GM-perspective test's title; list titles with `npx playwright test tests/e2e/guide-screenshots.spec.mjs --list`).
Expected: pass, and `docs/images/actor-link-picker.png` exists. Open it and confirm it shows the picker with the three `TT-PalShot` actors. Revert any other `docs/images/*.png` the run rewrote that are unrelated to this feature (`git checkout -- <file>`), unless they changed only because of this feature.

- [ ] **Step 3: Write the GM guide section**

Insert into `docs/gm-guide.md` directly after the `## Creating an entity from selected text` section:

```markdown
## Linking a Person to an actor

A Person entry can be linked to one of the world's actors. Open the Person and press the **Link Actor** button (the person-with-a-plus icon next to its name), then pick the actor. Only actors you can see are listed; type in the filter box to narrow the list.

![The Link Actor picker](images/actor-link-picker.png)

When you link:

- The Person's picture becomes the actor's picture, and it stays in step: change the actor's picture later and the Person follows (while a GM is connected).
- If the Person's description is empty, the actor's **public** biography is copied into it. Players who can open the Person see this text.
- If your own **Notes** on the Person are empty, the actor's **full** biography is copied there. Notes are private to you — MEJ shows each user only their own — so GM-only details stay out of what players see. Another GM sees their own Notes, not yours.

The copy happens once, when you link. Editing the actor's biography later doesn't change the Person. Systems that don't separate a public biography (anything other than dnd5e's and pf2e's public fields) copy the full biography to your Notes only and leave the description for you to write.

A linked Person shows two buttons instead: **Change linked actor** and **Unlink actor**. Unlinking keeps the picture, description and notes as they are. Dragging an actor onto a Person (Monk's Enhanced Journal's own way of linking) works the same as the picker. Persons you linked before this version start following their actor's picture the next time that picture changes, or when you re-link them.
```

If `## What Campaign Companion adds` is a bullet list of features, add one bullet: `- **Person ↔ actor link** — link a Person to an actor; its picture follows the actor's and its biography seeds the description and your notes.`

- [ ] **Step 4: CHANGELOG and version**

Add at the top of `CHANGELOG.md`, under `# Changelog`:

```markdown
## 0.22.0 (2026-09-25)

Link a Person to an actor.

- **Added:** a **Link Actor** button on Person entries, with a picker of the actors you can see, plus **Change linked actor** and **Unlink actor** once linked. Monk's Enhanced Journal's own drag-an-actor link goes through the same path.
- **Added:** a linked Person's picture follows the actor's picture, including later changes (applied by a connected GM).
- **Added:** when you link, the actor's public biography fills an empty Person description, and its full biography fills your own empty Notes on that Person, so GM-only text stays private.
- **Changed:** the README is reorganized by feature and brought up to date (settings table, features since 0.5.0, test counts).
```

In `module.json` set `"version": "0.22.0"`. Check `download`: if it contains a version string, update it to `0.22.0`; if it uses `releases/latest/download/…`, leave it.

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS (a manifest/version test, if any, should pass with 0.22.0).

- [ ] **Step 6: Commit**

```bash
git add docs/gm-guide.md docs/images/actor-link-picker.png tests/e2e/guide-screenshots.spec.mjs CHANGELOG.md module.json
git commit -m "docs: person to actor link guide section, picker screenshot, 0.22.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(The CHANGELOG's README line is made true by Task 6, which lands in the same PR.)

---

### Task 6: README update

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `CHANGELOG.md` (0.6.0 → 0.22.0), `scripts/campaign-companion.mjs` (`game.settings.register` calls, their `config`, `scope`, `default`, and `name`/`hint` keys resolved through `lang/en.json`), `scripts/constants.mjs` (setting-key constants), `module.json` (compatibility, relationships), `tests/e2e/*.spec.mjs` and `npm test` output (counts), `docs/gm-guide.md` / `docs/player-guide.md` (for pointers, not copying).

This task is a documentation rewrite. The rules, in order:

1. **Every claim must be checked against the code or the CHANGELOG** — no feature, setting or number is written from memory.
2. **Keep** the title, the intro paragraph (edit for accuracy), `## Documentation`, the `native`/`api` mode section, `## Requirements`, `## Installation`, `## Docx round-trip notes`, `## Player collaboration notes`, `## Error handling and troubleshooting`, `## Known issues`, `## Development`, `## License` — correcting anything the CHANGELOG shows is superseded.
3. **Replace** the version-organized feature sections (`## Features`, `### Knowledge layer (0.2.0)`, `### Secrets layer (0.3.0)`, `### Auto-link scoping (0.4.0)`) with one `## Features` section organized by area, in this order, each a short paragraph or bullet group of exact semantics (not a walkthrough):
   Sessions · Campaigns · Campaign Hub · Timeline and campaign dates · Search and dashboards · Knowledge (tags, attributes, backlinks, knowledge bar, relationship graph) · Secrets (with the existing trust-model and "Everyone is Foundry's own reveal" paragraphs kept) · Auto-link (with the existing scoping/ambiguity/caveat content kept) · Create Entity from Selection and campaign Contributors · Person ↔ actor link · Auto-capture · Docx import and export · Player collaboration.
4. **Settings table**: one row per `game.settings.register` call in `scripts/campaign-companion.mjs` (17 today). Columns stay `Setting | Config visible? | Default | Purpose`; add the scope to the Purpose text where it is client-scoped. Update the sentence above the table with the real counts (visible vs internal, world vs client).
5. **Development**: replace "21 Playwright spec files / 120 tests" with the live counts: spec files = `ls tests/e2e/*.spec.mjs | wc -l`; test count from `npx playwright test --list 2>/dev/null | tail -1`. Add the unit count from `npm test`. Mention `npm run e2e:v13`.
6. **Requirements**: check against `module.json`'s `compatibility` and `relationships`; keep the MEJ version floors that are still accurate.
7. Keep it a technical reference; user walkthroughs belong in the guides and are linked, not copied. Keep the existing tone: plain sentences, exact names in backticks.

- [ ] **Step 1: Gather the facts into a scratch file**

Run and save the output to `/tmp` or a scratch file you delete afterwards (not committed):

```bash
grep -n "game.settings.register" -A8 scripts/campaign-companion.mjs
grep -n "^## " CHANGELOG.md
node -e "const m=require('./module.json');console.log(JSON.stringify({version:m.version,compatibility:m.compatibility,relationships:m.relationships},null,1))"
ls tests/e2e/*.spec.mjs | wc -l
npm test 2>&1 | tail -5
```

For the Playwright test count, run `npx playwright test --list 2>/dev/null | tail -1` (listing does not need Foundry running; if it does in this harness, count `test(` occurrences in `tests/e2e/*.spec.mjs` instead and say "about").

- [ ] **Step 2: Rewrite the README**

Edit `README.md` per the rules above.

- [ ] **Step 3: Check it**

- Every setting key registered in `scripts/campaign-companion.mjs` appears exactly once in the table: `grep -o 'register(MODULE_ID, [A-Z_]*' scripts/campaign-companion.mjs | wc -l` equals the table's row count.
- Every relative link resolves: `grep -o '](docs/[^)#]*' README.md | cut -c3- | xargs ls` lists no missing file; in-page anchors (`#…`) match a heading.
- No leftover version-organized headings: `grep -n "^### .*([0-9]\+\.[0-9]\+\.[0-9]\+)" README.md` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): reorganize by feature and bring up to date for 0.22.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
