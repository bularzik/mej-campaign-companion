// Player connections (spec 2026-10-09 §8, e2e 1-9), on v13 and v14, as User 1
// with a GM connected, plus the plan's Review Focus checks: the block is
// actually on screen (not clipped under MEJ's own list) and a Place gets the
// tab. Content on a non-default sheet tab is display:none until its nav link
// is clicked, so every block assertion goes through openRelTab().
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, ensureMejPlayerAccess, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const MOD_URL = "/modules/mej-campaign-companion/scripts";
const PREFIX = "TT-Pc";
const RUN = Date.now();
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
let seq = 0;
const tagged = (name) => `${PREFIX}${name}${RUN}t${seq}`;

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

/** A MEJ entry of `type`, OBSERVER by default; returns { id, uuid, name }. */
async function createEntry(gm, name, type, { ownership = 2 } = {}) {
  return gm.evaluate(async ({ name, type, ownership }) => {
    const e = await JournalEntry.create({
      name, ownership: { default: ownership },
      pages: [{ name, type: "text", text: { content: `<p>${name}</p>` }, flags: { "monks-enhanced-journal": { type } } }]
    });
    return { id: e.id, uuid: e.uuid, name: e.name };
  }, { name, type, ownership });
}

async function openEntry(page, id) {
  // A GM-created entry reaches each client asynchronously.
  await page.waitForFunction((id) => !!game.journal.get(id), id, { timeout: 15_000 });
  await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, id);
  await settle(page, 600);
}
async function closeShell(page) {
  await page.evaluate(async () => {
    try { await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* none open */ }
  });
  await settle(page, 300);
}
const relTabLink = (page) => page.locator(
  '#MonksEnhancedJournal nav.tabs a[data-tab="relationships"], #MonksEnhancedJournal nav.sheet-tabs a[data-tab="relationships"]').first();
const block = (page) => page.locator('#MonksEnhancedJournal .tab.active[data-tab="relationships"] .mej-cc-player-connections');
const row = (page, cid) => block(page).locator(`li.mej-cc-pc-row[data-connection-id="${cid}"]`);
const notesRow = (page, cid) => block(page).locator(`li.mej-cc-pc-notes-row[data-connection-id="${cid}"]`);
const noteBy = (page, writerId) => block(page).locator(`li.mej-cc-pc-note[data-writer-id="${writerId}"]`);
const pcDialog = (page) => page.locator("dialog.application:has(.mej-cc-pc-dialog)");
const toast = (page, text) => page.locator("#notifications .notification", { hasText: text });
/** Positive anchor before any "no tab" assertion: the shell shows this entry's sheet. */
const sheetName = (page) => page.locator('#MonksEnhancedJournal .monks-journal-sheet input[name="name"]:visible').first();
const tagOf = (locator) => locator.evaluate((el) => ({ tag: el.tagName, href: el.getAttribute("href"), type: el.getAttribute("type") }));
const widthOf = (locator) => locator.evaluate((el) => el.getBoundingClientRect().width);

async function openRelTab(page, id) {
  await openEntry(page, id);
  await relTabLink(page).click();
  await settle(page, 400);
}

const pcFlag = (page, entryId) => page.evaluate(({ id, MOD }) =>
  foundry.utils.deepClone(game.journal.get(id)?.pages.contents[0]?.flags?.[MOD]?.playerConnections ?? {}), { id: entryId, MOD });
const relay = (page, request) => page.evaluate(async ({ url, request }) =>
  (await import(url)).requestConnectionOp(request), { url: `${MOD_URL}/hooks/player-connections-relay.mjs`, request });
const playerEdges = (page, uuids) => page.evaluate(async ({ url, uuids }) => {
  const { prepareGraphContext } = await import(url);
  const entries = uuids.map((u) => fromUuidSync(u)).filter(Boolean);
  const { graph } = prepareGraphContext(entries, { graphMode: "all", graphCenterUuid: null, graphBacklinks: false, graphPlayerConnections: true });
  return graph.edges.filter((e) => e.kind === "player");
}, { url: `${MOD_URL}/apps/hub-graph-pane.mjs`, uuids });
const userIds = (page) => page.evaluate(() => ({ u1: game.users.getName("User 1").id, u2: game.users.getName("User 2").id }));
const setEnabled = (gm, value) => gm.evaluate(({ MOD, value }) => game.settings.set(MOD, "playerConnectionsEnabled", value), { MOD, value });

async function confirmYes(page) {
  const yes = page.locator('dialog.application button[data-action="yes"]').last();
  await expect(yes).toBeVisible({ timeout: 10_000 });
  await yes.click();
}

/**
 * Review Focus 3: hit-testable, i.e. not clipped by MEJ's overflow-hidden tab.
 * The block is its own scroll container (a short sheet body leaves it ~100px
 * at the default shell size), so the element is first scrolled into view
 * within the block only - what a user's wheel does - never by scrolling MEJ's
 * overflow-hidden ancestors, which would hide exactly the clipping this checks.
 * Resolves "ok", or a description of what covers the point instead.
 */
const onScreen = (locator) => locator.evaluate((el) => {
  const scroller = el.closest(".mej-cc-player-connections");
  // Scrollable containers between the element and the block, innermost first
  // (MEJ's own .item-list scrolls inside the block).
  for (let n = el.parentElement; scroller && n && scroller.contains(n); n = n.parentElement) {
    if (!["auto", "scroll"].includes(getComputedStyle(n).overflowY) || n.scrollHeight <= n.clientHeight) continue;
    const er = el.getBoundingClientRect();
    const nr = n.getBoundingClientRect();
    if (er.top < nr.top || er.bottom > nr.bottom) n.scrollTop += er.top - nr.top - 4;
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return `zero size ${r.width}x${r.height}`;
  const x = r.left + Math.min(r.width / 2, 40);
  const y = r.top + Math.min(r.height / 2, 10);
  const hit = document.elementFromPoint(x, y);
  if (hit && el.contains(hit)) return "ok";
  const describe = (n) => n ? `${n.tagName}${n.id ? `#${n.id}` : ""}.${[...n.classList].join(".")}` : "nothing";
  const box = (n) => { const b = n?.getBoundingClientRect(); return b ? `${describe(n)}[${Math.round(b.top)}-${Math.round(b.bottom)}]` : "none"; };
  const chain = [];
  for (let n = el.parentElement; n && n.id !== "MonksEnhancedJournal" && chain.length < 8; n = n.parentElement) chain.push(box(n));
  return `(${Math.round(x)},${Math.round(y)}) hits ${describe(hit)} in ${describe(hit?.parentElement)}; el [${Math.round(r.top)}-${Math.round(r.bottom)}]`
    + `; scroller ${scroller?.scrollTop}/${scroller?.scrollHeight}/${scroller?.clientHeight}; ${chain.join(" < ")}`;
});

async function addViaDialog(page, { target, fromLabel, toLabel = "", fromSecret = "", shared = true }) {
  await block(page).locator(".mej-cc-pc-add").click();
  const d = pcDialog(page);
  await expect(d).toBeVisible({ timeout: 10_000 });
  await d.locator("input[name='filter']").fill(target.name);
  await d.locator(`li.mej-cc-pc-target[data-uuid="${target.uuid}"]`).click();
  await d.locator("input[name='fromLabel']").fill(fromLabel);
  if (fromSecret) await d.locator("input[name='fromSecret']").fill(fromSecret);
  if (toLabel) await d.locator("input[name='toLabel']").fill(toLabel);
  await d.locator("input[name='shared']").setChecked(shared);
  await d.locator("button.mej-cc-pc-save").click();
}

async function dropOn(page, data) {
  await block(page).evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify(data));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, data);
}

async function cleanup(gm) {
  await closeShell(gm);
  await deleteJournalsByPrefix(gm, PREFIX);
  await cleanupStrandedTestFolders(gm, { prefix: PREFIX });
  await gm.evaluate((MOD) => game.settings.set(MOD, "playerConnectionsEnabled", true), MOD);
}

async function closeSeats(...seats) {
  for (const seat of seats) await seat?.context.close().catch(() => {});
}

test.describe("33 player connections", () => {
  test.beforeEach(() => { seq += 1; });
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("add, both ends, reveal, notes, private, GM moderation (e2e 1-4, 8)", async ({ browser }) => {
    test.setTimeout(300_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      await ensureMejPlayerAccess(gm.page);
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ids = await userIds(gm.page);

      // 1. Add via the dialog with both side labels and a secret.
      await openRelTab(u1.page, ilva.id);
      await expect(block(u1.page)).toBeVisible();
      await addViaDialog(u1.page, { target: mara, fromLabel: "Sister of", toLabel: "Brother of", fromSecret: "owes her a debt" });
      await expect(pcDialog(u1.page)).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(async () => Object.keys(await pcFlag(gm.page, ilva.id)).length, { timeout: 15_000 }).toBe(1);
      const [cid] = Object.keys(await pcFlag(gm.page, ilva.id));
      const stored = (await pcFlag(gm.page, ilva.id))[cid];
      expect(stored).toMatchObject({ id: cid, to: mara.uuid, authorId: ids.u1, shared: true });
      expect(stored.sides.from.notes[ids.u1]).toMatchObject({ label: "Sister of", secret: "owes her a debt", revealed: false });
      expect(stored.sides.to.notes[ids.u1]).toMatchObject({ label: "Brother of" });

      await openRelTab(u1.page, ilva.id);
      await expect(row(u1.page, cid).locator("input.mej-cc-pc-label-input")).toHaveValue("Sister of", { timeout: 15_000 });
      // MEJ lays rows out as display:contents grid items: hit-test the row's name link.
      expect(await onScreen(row(u1.page, cid).locator(".mej-cc-pc-open"))).toBe("ok");
      // DOM contract: the name is a focusable anchor, the controls are real buttons.
      expect(await tagOf(row(u1.page, cid).locator(".mej-cc-pc-open"))).toMatchObject({ tag: "A", href: "#" });
      for (const sel of [".mej-cc-pc-share", ".mej-cc-pc-delete", ".mej-cc-pc-reveal"]) {
        expect(await tagOf(row(u1.page, cid).locator(sel)), sel).toMatchObject({ tag: "BUTTON", type: "button" });
      }
      expect(await tagOf(block(u1.page).locator(".mej-cc-pc-add"))).toMatchObject({ tag: "BUTTON", type: "button" });
      // Foundry styles every <button> full-width: the controls must stay small.
      const blockWidth = await widthOf(block(u1.page));
      for (const control of [row(u1.page, cid).locator(".mej-cc-pc-share"), row(u1.page, cid).locator(".mej-cc-pc-delete"),
        block(u1.page).locator(".mej-cc-pc-add")]) {
        const w = await widthOf(control);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThan(Math.min(160, blockWidth / 3));
      }
      await openRelTab(u1.page, mara.id);
      await expect(row(u1.page, cid)).toContainText(`← ${ilva.name}`);
      await expect(row(u1.page, cid).locator("input.mej-cc-pc-label-input")).toHaveValue("Brother of");

      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, cid)).toContainText("Sister of");
      await expect(row(u2.page, cid)).toContainText("User 1");
      await expect(block(u2.page)).not.toContainText("owes her a debt");
      await expect(row(u2.page, cid).locator("input")).toHaveCount(0);
      expect(await playerEdges(u2.page, [ilva.uuid, mara.uuid])).toHaveLength(1);

      // 2. User 1 reveals the secret: User 2 now sees it.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-reveal").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.from.notes[ids.u1].revealed, { timeout: 15_000 }).toBe(true);
      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, cid)).toContainText("owes her a debt", { timeout: 15_000 });

      // 3. User 2 adds a note on the "to" side; only User 2 can edit it.
      await openRelTab(u2.page, mara.id);
      await notesRow(u2.page, cid).locator(".mej-cc-pc-add-note").click();
      const draft = notesRow(u2.page, cid).locator("li.mej-cc-pc-note.new input.mej-cc-pc-label-input");
      await draft.fill("half-sister, actually");
      await draft.press("Tab");
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.to.notes[ids.u2]?.label, { timeout: 15_000 })
        .toBe("half-sister, actually");
      await openRelTab(u1.page, mara.id);
      await expect(noteBy(u1.page, ids.u2)).toContainText("half-sister, actually");
      await expect(noteBy(u1.page, ids.u2).locator("input")).toHaveCount(0);
      await openRelTab(u2.page, mara.id);
      await expect(noteBy(u2.page, ids.u2).locator("input.mej-cc-pc-label-input")).toHaveValue("half-sister, actually");

      // 4. Private: gone for User 2 on both ends and in the graph; GM keeps it with the author.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-share").click();
      await confirmYes(u1.page); // User 2's note exists, so the toggle confirms first
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].shared, { timeout: 15_000 }).toBe(false);
      for (const id of [ilva.id, mara.id]) {
        await openRelTab(u2.page, id);
        await expect(row(u2.page, cid)).toHaveCount(0);
      }
      expect(await playerEdges(u2.page, [ilva.uuid, mara.uuid])).toEqual([]);
      await openRelTab(gm.page, ilva.id);
      await expect(row(gm.page, cid)).toContainText("User 1");
      // Shared again (no confirmation this way): User 2's note comes back.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-share").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].shared, { timeout: 15_000 }).toBe(true);
      await openRelTab(u2.page, mara.id);
      await expect(noteBy(u2.page, ids.u2)).toHaveCount(1);

      // 8. GM deletes User 2's note, then the connection.
      await openRelTab(gm.page, mara.id);
      await noteBy(gm.page, ids.u2).locator(".mej-cc-pc-note-delete").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.to.notes[ids.u2] ?? null, { timeout: 15_000 }).toBeNull();
      for (const seat of [u1, u2]) {
        await openRelTab(seat.page, mara.id);
        await expect(noteBy(seat.page, ids.u2)).toHaveCount(0);
      }
      await openRelTab(gm.page, ilva.id);
      await row(gm.page, cid).locator(".mej-cc-pc-delete").click();
      await confirmYes(gm.page);
      await expect.poll(async () => Object.keys(await pcFlag(gm.page, ilva.id)), { timeout: 15_000 }).toEqual([]);
      for (const seat of [u1, u2]) {
        for (const id of [ilva.id, mara.id]) {
          await openRelTab(seat.page, id);
          await expect(row(seat.page, cid)).toHaveCount(0);
        }
      }
      for (const seat of [gm, u1, u2]) assertNoConsoleErrors(seat.errors);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("dropping an entry on the block opens the dialog with it filled in (e2e 5)", async ({ browser }) => {
    test.setTimeout(120_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ledger = await createEntry(gm.page, tagged("Ledger"), "list");
      await openRelTab(u1.page, ilva.id);
      await dropOn(u1.page, { type: "JournalEntry", uuid: mara.uuid });
      const d = pcDialog(u1.page);
      await expect(d).toBeVisible({ timeout: 10_000 });
      await expect(d.locator("input[name='target']")).toHaveValue(mara.uuid);
      await expect(d.locator(`li.mej-cc-pc-target.selected[data-uuid="${mara.uuid}"]`)).toHaveCount(1);
      await d.locator('button[data-action="cancel"]').click();
      await expect(d).toHaveCount(0);

      await dropOn(u1.page, { type: "Actor", uuid: "Actor.nope" });
      await expect(toast(u1.page, "Only journal entries can be connected.")).toHaveCount(1, { timeout: 10_000 });
      await dropOn(u1.page, { type: "JournalEntry", uuid: ledger.uuid });
      await expect(toast(u1.page, "can't be connected from here")).toHaveCount(1, { timeout: 10_000 });
      await expect(pcDialog(u1.page)).toHaveCount(0);
      assertNoConsoleErrors(u1.errors);
    } finally {
      await closeSeats(u1, gm);
    }
  });

  test("Relationships tab visibility for players (e2e 6, Review Focus 1)", async ({ browser }) => {
    test.setTimeout(240_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    try {
      const locked = await createEntry(gm.page, tagged("Locked"), "person");
      const bare = await createEntry(gm.page, tagged("Bare"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const src = await createEntry(gm.page, tagged("Src"), "person");
      const inbound = await createEntry(gm.page, tagged("Inbound"), "person");
      // Only a hidden GM row: the raw flag is non-empty, so stock MEJ would show an empty tab.
      await gm.page.evaluate(({ id, uuid }) => game.journal.get(id).pages.contents[0].setFlag("monks-enhanced-journal", "relationships",
        { r1: { id: "r1", uuid, hidden: true, relationship: "secret ally" } }), { id: locked.id, uuid: mara.uuid });
      // `inbound`'s only connection is incoming (stored on `src`), and it has no GM rows.
      const add = await relay(u1.page, { op: "add", fromUuid: src.uuid, payload: { to: inbound.uuid, shared: true,
        fromNote: { label: "Watches over", secret: "" }, toNote: { label: "Watched by", secret: "" } } });
      expect(add).toMatchObject({ ok: true });
      expect(await gm.page.evaluate((id) => game.journal.get(id).pages.contents[0].getFlag("monks-enhanced-journal", "relationships") ?? null, inbound.id)).toBeNull();

      // Setting off: nobody can add, so the tab shows only for rows the player sees.
      await setEnabled(gm.page, false);
      for (const entry of [locked, bare]) {
        await closeShell(u1.page);
        await openEntry(u1.page, entry.id);
        await expect(sheetName(u1.page)).toHaveValue(entry.name);
        await expect(relTabLink(u1.page)).toHaveCount(0);
      }
      await closeShell(u1.page);
      await openEntry(u1.page, inbound.id);
      await expect(sheetName(u1.page)).toHaveValue(inbound.name);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(row(u1.page, add.connectionId)).toContainText(`← ${src.name}`);
      // The "to" end shows the to-side note.
      await expect(row(u1.page, add.connectionId)).toContainText("Watched by");
      expect(await onScreen(row(u1.page, add.connectionId).locator(".mej-cc-pc-open"))).toBe("ok");
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toHaveCount(0);

      await setEnabled(gm.page, true);
      await closeShell(u1.page);
      await openEntry(u1.page, locked.id);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toBeVisible();
      await expect(block(u1.page)).not.toContainText("secret ally");

      // An OBSERVER person with no MEJ relationships flag at all: restored, and its content renders.
      await closeShell(u1.page);
      await openEntry(u1.page, bare.id);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(block(u1.page)).toBeVisible();
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toBeVisible();
      await expect(block(u1.page).locator(".mej-cc-pc-empty")).toBeVisible();
      expect(await onScreen(block(u1.page).locator(".mej-cc-pc-add"))).toBe("ok");

      // LIMITED: MEJ never opens a sheet for a LIMITED player (openJournalEntry warns
      // instead), so there is no tab to assert on - assert that gate itself.
      const glimpse = await createEntry(gm.page, tagged("Glimpse"), "person", { ownership: 1 });
      await closeShell(u1.page);
      await openEntry(u1.page, glimpse.id);
      await expect(toast(u1.page, "You do not have permission to view")).not.toHaveCount(0, { timeout: 10_000 });
      expect(await u1.page.evaluate((id) => [...foundry.applications.instances.values()]
        .filter((a) => a.rendered && (a.document?.id === id || a.document?.parent?.id === id)).map((a) => a.constructor.name), glimpse.id)).toEqual([]);

      // A Place whose only GM rows are a person row: MEJ's PlaceSheet removes the
      // relationships tab again after the base class (it shows the row on Townsfolk).
      const town = await createEntry(gm.page, tagged("Town"), "place");
      await gm.page.evaluate(({ id, uuid }) => game.journal.get(id).pages.contents[0].setFlag("monks-enhanced-journal", "relationships",
        { t1: { id: "t1", uuid, type: "person", hidden: false, relationship: "mayor" } }), { id: town.id, uuid: mara.uuid });
      await closeShell(u1.page);
      await openEntry(u1.page, town.id);
      await expect(sheetName(u1.page)).toHaveValue(town.name);
      await expect(u1.page.locator('#MonksEnhancedJournal nav.sheet-tabs a[data-tab="townsfolk"]')).toHaveCount(1);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toBeVisible();
      expect(await onScreen(block(u1.page).locator(".mej-cc-pc-add"))).toBe("ok");
      assertNoConsoleErrors(u1.errors);
    } finally {
      await closeSeats(u1, gm);
    }
  });

  test("rejections: duplicate, type not allowed, editing someone else's note (e2e 7)", async ({ browser }) => {
    test.setTimeout(120_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ledger = await createEntry(gm.page, tagged("Ledger"), "list");
      const ids = await userIds(gm.page);
      const addMara = { op: "add", fromUuid: ilva.uuid, payload: { to: mara.uuid, shared: true, fromNote: { label: "Sister of", secret: "" } } };
      const first = await relay(u1.page, addMara);
      expect(first).toMatchObject({ ok: true });
      expect(await relay(u1.page, addMara)).toEqual({ ok: false, reason: "duplicate" });
      expect(await relay(u1.page, { ...addMara, payload: { ...addMara.payload, to: ledger.uuid } }))
        .toEqual({ ok: false, reason: "type-not-allowed" });
      expect(await relay(u2.page, { op: "deleteNote", fromUuid: ilva.uuid, connectionId: first.connectionId, side: "from", payload: { noteUserId: ids.u1 } }))
        .toEqual({ ok: false, reason: "not-author" });
      expect(await relay(u2.page, { op: "setShared", fromUuid: ilva.uuid, connectionId: first.connectionId, side: "from", payload: { shared: false } }))
        .toEqual({ ok: false, reason: "not-author" });
      const stored = (await pcFlag(gm.page, ilva.id))[first.connectionId];
      expect(stored.shared).toBe(true);
      expect(stored.sides.from.notes[ids.u1].label).toBe("Sister of");
      // In the UI, User 2 gets no field for User 1's label.
      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, first.connectionId).locator("input")).toHaveCount(0);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("typing in a field survives a re-render caused by another client's write", async ({ browser }) => {
    test.setTimeout(150_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ids = await userIds(gm.page);
      const add = await relay(u1.page, { op: "add", fromUuid: ilva.uuid, payload: { to: mara.uuid, shared: true, fromNote: { label: "Sister of", secret: "" } } });
      expect(add).toMatchObject({ ok: true });
      const cid = add.connectionId;

      await openRelTab(u1.page, ilva.id);
      const input = row(u1.page, cid).locator("input.mej-cc-pc-label-input");
      await expect(input).toHaveValue("Sister of");
      await u1.page.evaluate(() => {
        window.__pcRenders = 0;
        Hooks.on("renderJournalPageSheet", () => { window.__pcRenders += 1; });
      });
      // Typed, not committed: no change event yet, focus stays in the field.
      await input.click();
      await input.fill("Sister of, and rival");
      await expect(input).toBeFocused();

      // User 2 saves a different note on the same connection: Ilva's page updates and re-renders.
      expect(await relay(u2.page, { op: "setNote", fromUuid: ilva.uuid, connectionId: cid, side: "from", payload: { label: "rivals, really", secret: "" } }))
        .toMatchObject({ ok: true });
      await expect.poll(() => u1.page.evaluate(() => window.__pcRenders), { timeout: 15_000 }).toBeGreaterThan(0);
      await expect.poll(async () => (await pcFlag(u1.page, ilva.id))[cid].sides.from.notes[ids.u2]?.label, { timeout: 15_000 }).toBe("rivals, really");
      await settle(u1.page, 500);
      await expect(input).toHaveValue("Sister of, and rival");
      await expect(input).toBeFocused();

      // Leaving the field commits it, and the block catches up with User 2's note.
      await input.evaluate((el) => el.blur());
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.from.notes[ids.u1].label, { timeout: 15_000 })
        .toBe("Sister of, and rival");
      await expect(noteBy(u1.page, ids.u2)).toContainText("rivals, really", { timeout: 15_000 });
      await expect(row(u1.page, cid).locator("input.mej-cc-pc-label-input")).toHaveValue("Sister of, and rival");
      for (const seat of [gm, u1, u2]) assertNoConsoleErrors(seat.errors);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("graph: a dotted player edge titled with author and labels, never the secret; the toggle hides it", async ({ browser }) => {
    test.setTimeout(150_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const fromLabel = `Oathsworn ${RUN}`;
      const add = await relay(u1.page, { op: "add", fromUuid: ilva.uuid, payload: {
        to: mara.uuid, shared: true,
        fromNote: { label: fromLabel, secret: "buried the crown" },
        toNote: { label: "Sworn back", secret: "never forgave her" }
      } });
      expect(add).toMatchObject({ ok: true });

      const page = u2.page;
      await openEntry(page, ilva.id);
      await page.evaluate(async (url) => (await import(url)).openHub(), `${MOD_URL}/integrations/mej-adapter.mjs`);
      const shell = page.locator("#MonksEnhancedJournal");
      await expect(shell.locator(".mej-cc-hub-container")).toHaveCount(1, { timeout: 15_000 });
      const scope = shell.locator('select[name="campaign-scope"]');
      if (await scope.count()) {
        await scope.selectOption("");
        await settle(page, 500);
      }
      await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
      await settle(page, 600);
      const allMode = shell.locator('button[data-action="setGraphMode"][data-mode="all"]');
      if (await allMode.count()) await allMode.click();
      await settle(page, 600);
      const pane = shell.locator(".mej-cc-graph-pane");
      const ours = () => pane.evaluate((el, label) => [...el.querySelectorAll("line.mej-cc-graph-edge.player")]
        .map((line) => ({ title: line.querySelector("title")?.textContent ?? "", dash: getComputedStyle(line).strokeDasharray }))
        .filter((e) => e.title.includes(label)), fromLabel);
      await expect.poll(async () => (await ours()).length, { timeout: 20_000 }).toBe(1);
      const [edge] = await ours();
      expect(edge.title).toContain("User 1");
      expect(edge.title).toContain(fromLabel);
      expect(edge.title).toContain("Sworn back");
      expect(edge.title).not.toContain("buried the crown");
      expect(edge.title).not.toContain("never forgave her");
      expect(edge.dash).not.toBe("none");
      await expect(pane.locator(".mej-cc-graph-node", { hasText: ilva.name })).toHaveCount(1);
      await expect(pane.locator(".mej-cc-graph-node", { hasText: mara.name })).toHaveCount(1);

      const toggle = shell.locator('input[data-action-change="toggleGraphPlayerConnections"]');
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect.poll(() => pane.locator("line.mej-cc-graph-edge.player").count(), { timeout: 15_000 }).toBe(0);
      await expect(pane.locator(".mej-cc-graph-node", { hasText: ilva.name })).toHaveCount(1);
      await shell.locator('input[data-action-change="toggleGraphPlayerConnections"]').check();
      await expect.poll(async () => (await ours()).length, { timeout: 15_000 }).toBe(1);
      for (const seat of [u1, u2]) assertNoConsoleErrors(seat.errors);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("no GM connected: toast, dialog stays open, nothing written (e2e 9)", async ({ browser }) => {
    test.setTimeout(150_000);
    const gm = await newSeat(browser, "Gamemaster");
    const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
    const mara = await createEntry(gm.page, tagged("Mara"), "person");
    await gm.context.close();
    const u1 = await newSeat(browser, "User 1");
    try {
      await u1.page.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });
      await openRelTab(u1.page, ilva.id);
      await addViaDialog(u1.page, { target: mara, fromLabel: "Sister of" });
      await expect(toast(u1.page, "A GM must be connected to save connections.")).toHaveCount(1, { timeout: 10_000 });
      await expect(pcDialog(u1.page)).toHaveCount(1);
      await expect(pcDialog(u1.page).locator("input[name='fromLabel']")).toHaveValue("Sister of");
      expect(await pcFlag(u1.page, ilva.id)).toEqual({});
    } finally {
      await closeSeats(u1);
    }
  });
});
