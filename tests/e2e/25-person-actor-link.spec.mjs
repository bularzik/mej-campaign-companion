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

    // registerCore() (mej-adapter.mjs) wires actor-link's sync hook
    // (registerActorLink) before actor-link's UI hook (registerActorLinkUi),
    // both later in its sequential await chain than login()'s
    // waitCompanionWired() waits for (that only confirms the Session sheet
    // CLASS is registered - a different, earlier-finishing part of the same
    // ready-time wiring). This test is the one path in the file that would
    // otherwise go straight from login() to a raw setFlag with no
    // intervening UI round trip, and can race ahead of that later wiring -
    // confirmed live: the flag write always lands, but occasionally zero
    // "updateJournalEntryPage" sync firings followed within 10s, because the
    // sync hook simply had not registered yet. Opening the entry and
    // waiting for the "link" control to render proves the UI hook (which
    // registers AFTER the sync hook) is wired, and so the sync hook is too -
    // a real readiness signal instead of a blind wait.
    const shell = await openEntry(page, person.id);
    await expect(control(shell, "link")).toBeVisible({ timeout: 10_000 });

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

  test("MEJ's own drop path stores the link but copies nothing when the linking player can't observe the actor", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    // LIMITED: below the OBSERVER floor the picker itself enforces, so this
    // link can only happen through MEJ's own drop path, which does no
    // permission check of its own (C1).
    const actor = await createActor(page, N.actor, { ownershipDefault: 1 });
    const person = await createPerson(page, N.person, { ownershipDefault: 3 });

    const ctx = await browser.newContext(VIEWPORT);
    const player = await ctx.newPage();
    const errors = trackConsoleErrors(player, { ignore: IGNORE });
    try {
      await login(player, "User 1");
      const before = await pageState(player, person.id);
      // Proves the sync hook is wired (same readiness signal as the
      // "MEJ's own link path" test above) before the direct setFlag below.
      const shell = await openEntry(player, person.id);
      await expect(control(shell, "link")).toBeVisible({ timeout: 10_000 });

      await player.evaluate(async ({ entryId, actorId, F }) => {
        const a = game.actors.get(actorId);
        const p = game.journal.get(entryId).pages.contents[0];
        await p.setFlag(F, "actor", { id: a.id, uuid: a.uuid, img: a.img, name: a.name, quantity: "1", type: a.flags[F]?.type });
      }, { entryId: person.id, actorId: actor.id, F });
      await settle(player, 1500);

      const after = await pageState(player, person.id);
      expect(after.link).toMatchObject({ id: actor.id, uuid: actor.uuid, quantity: "1" });
      expect(after.src).toBe(before.src);
      expect(after.content).toBe(before.content);
      expect(after.myNotes).toBeNull();
      assertNoConsoleErrors(errors);
    } finally {
      await ctx.close();
    }
  });
});
