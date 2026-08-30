// Guide screenshot capture — regenerates every image in docs/images/ used by
// docs/gm-guide.md and docs/player-guide.md. NOT a test of behavior; a
// deliberately-gated documentation tool, following 13-stock-smoke's gating
// pattern. A normal suite run (GUIDE_SHOTS unset) skips this file entirely.
//
// Run:  GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs
//
// Seeded demo content uses clean fantasy names (no TT- prefix — these names
// appear in published screenshots). Cleanup is by the guideDemo flag, swept
// at start AND end so a crashed run leaves nothing and reruns are idempotent.
//
// Task 2 (this file's seeding + GM captures) builds a small demo campaign —
// three Persons, a Place, a Quest, and a Session — and takes the 18
// GM-perspective screenshots the brief calls for. State is left in place
// after this file's tests finish (cleanup happens only in afterAll): Task 3
// appends player-perspective capture tests later in this same
// guideDescribe block and depends on this seeded world state still being
// there when it runs.
import { test, expect } from "@playwright/test";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { login, settle, MODULE_ID } from "./helpers/foundry.mjs";

// Gitignored (world state, not source) — see .gitignore. Written in
// beforeAll BEFORE any mutation, so a crashed run leaves the file behind
// holding the TRUE pre-run baseline; the next run's beforeAll restores from
// it instead of re-snapshotting the world's current (possibly already
// half-mutated, if it's re-run right after a crash) live settings. Deleted
// in afterAll only once that run's restore has actually completed cleanly —
// its mere presence is itself the crash signal for the run after next.
const SNAPSHOT_PATH = "tests/e2e/.guide-shots-snapshot.json";

const GATED = process.env.GUIDE_SHOTS === "1";
const guideDescribe = GATED ? test.describe : test.describe.skip;

const IMG_DIR = "docs/images";
// A small synthetic fantasy-themed fixture committed in this repo (generated
// via a one-off script against the vendored docx library — see its own
// header) — not the private, machine-absolute real-campaign document this
// pointed at before, which would have published a screenshot of someone's
// actual private campaign notes.
const DOCX_PATH = "tests/e2e/fixtures/guide-demo-import.docx";
// Every seeded demo document gets this ownership so a player client (Task 3)
// can see it; ownership levels are passed as plain numbers — CONST only
// exists inside the browser context, not in Node test scope (matches
// 11-auto-link-scope.spec.mjs's own comment on this).
const OBSERVER_OWNERSHIP = { default: 2 };

/**
 * Clear Foundry's "GAME PAUSED" overlay if it is up. `broadcast: true` is
 * load-bearing, not decoration: togglePause()'s default only patches the
 * CALLING client's in-memory game.data.paused, so a fresh client connecting
 * later (this file logs in fresh per test) would still read paused:true.
 *
 * Called defensively at the top of every capture test, not just once in
 * beforeAll against a snapshot: the overlay reappeared in prep-board.png on a
 * run whose beforeAll had recorded the world as UNpaused, i.e. the pause
 * arrived DURING the run. Whatever set it, a shot of the module's own UI must
 * not carry it. The pre-run pause state is still what afterAll restores.
 */
async function unpause(page) {
  await page.evaluate(() => {
    if (game.paused) game.togglePause(false, { broadcast: true });
  });
}

/** Screenshot a Locator (preferred: the app window element) or a Page. */
async function shot(target, name) {
  await target.screenshot({ path: `${IMG_DIR}/${name}.png` });
}

/**
 * Screenshot a padded rectangle around one element. A single graph node is a
 * ~40px <g>; a bare locator.screenshot() of it is unreadably small, and the
 * alternative (mutating the DOM to blow it up) would publish something the
 * product never renders. A page-level clip around the node's REAL geometry
 * is the honest close-up: same pixels the user sees, just cropped.
 */
async function shotAround(page, box, name, { pad = 70, padBottom = null, within = null } = {}) {
  let x1 = box.x - pad;
  let y1 = box.y - pad;
  let x2 = box.x + box.width + pad;
  let y2 = box.y + box.height + (padBottom ?? pad);
  // Clamped to the containing element when one is given, so a node that
  // settled near the edge of the graph pane can't drag the surrounding
  // window chrome (or the desktop behind it) into a shot that is meant to
  // show one node.
  if (within) {
    x1 = Math.max(x1, within.x);
    y1 = Math.max(y1, within.y);
    x2 = Math.min(x2, within.x + within.width);
    y2 = Math.min(y2, within.y + within.height);
  }
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  await page.screenshot({
    path: `${IMG_DIR}/${name}.png`,
    clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
  });
}

/** Delete every guideDemo-flagged JournalEntry, Actor and Folder (idempotent). */
async function sweepGuideDemo(page) {
  await page.evaluate(async (id) => {
    const doomedEntries = game.journal.filter((e) => e.getFlag(id, "guideDemo"));
    for (const e of doomedEntries) await e.delete();
    // Task 2 seeds two demo Actors (Session attendees) — not JournalEntry
    // documents, so the sweep above never sees them; they need their own
    // guideDemo-flag sweep or they'd survive every cleanup pass.
    const doomedActors = game.actors.filter((a) => a.getFlag(id, "guideDemo"));
    for (const a of doomedActors) await a.delete();
    // Task 5 seeds a real campaign Folder (createCampaign) — a third
    // document family neither sweep above touches. deleteSubfolders/
    // deleteContents makes the cascade reclaim anything still filed inside
    // it (the portal entry, the campaign's timeline journals) even if one
    // of their own flag writes never landed. Matched by FLAG only, never by
    // name — this world holds real, unrelated content.
    const doomedFolders = game.folders.filter((f) => f.getFlag(id, "guideDemo"));
    for (const f of doomedFolders) await f.delete({ deleteSubfolders: true, deleteContents: true });
  }, MODULE_ID);
}

/**
 * Create an MEJ-typed entry (person/place/quest/encounter). Pattern from
 * 07-knowledge.spec.mjs createPerson() and 01-session.spec.mjs:197.
 */
async function seedMejEntry(page, { name, mejType, text = "", flags = {}, ownership }) {
  return await page.evaluate(async ({ name, mejType, text, flags, ownership, id }) => {
    const entry = await JournalEntry.create({
      name,
      ownership: ownership ?? undefined,
      flags: { [id]: { guideDemo: true } },
      pages: [{
        name,
        type: `monks-enhanced-journal.${mejType}`,
        text: { content: text },
        flags: { "monks-enhanced-journal": { type: mejType }, [id]: flags }
      }]
    });
    return entry.id;
  }, { name, mejType, text, flags, ownership, id: MODULE_ID });
}

/** Open the journal sidebar and MEJ's "Create Entry" dialog, choose type
 * "Session", submit, and return the created entry's id once MEJ has
 * finished opening it. Copied verbatim from 01-session.spec.mjs:15 — the
 * task-2 brief calls for this exact helper, since it drives the same New
 * Entry dialog the GM guide itself tells users to use. */
async function createSessionViaDialog(page, name) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  // Scoped to the directory header: every FOLDER row in the journal sidebar
  // carries its own icon-only [data-action=createEntry] too, so the unscoped
  // selector is a strict-mode violation in a world that has campaign folders
  // (World A has real ones). Mirrors the same fix in 01-session.spec.mjs.
  await page.locator("#journal .directory-header [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="name"]').fill(name);
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  await expect(typeSelect.locator('option[value="session"]')).toHaveText("Session");
  await typeSelect.selectOption("session");
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 800);
  return page.evaluate((n) => game.journal.find((j) => j.name === n)?.id, name);
}

async function uuidOf(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).uuid, entryId);
}

/** Append raw HTML to an existing page's text.content (e.g. an enricher tag
 * or a plain-text name mention). */
async function appendPageContent(page, entryId, html) {
  await page.evaluate(async ({ id, html }) => {
    const p = game.journal.get(id).pages.contents[0];
    await p.update({ "text.content": (p.text.content ?? "") + html });
  }, { id: entryId, html });
}

/** Move/resize the MEJ shell window clear of Foundry's own right-hand
 * sidebar (which defaults to opening at x=1092 in this 1440-wide viewport —
 * the shell's own default position/size overlaps it), and collapse MEJ's
 * OWN embedded "quick browse" directory pane.
 *
 * Live investigation (review finding: 7 of 18 full-shell shots showed ~30%
 * of the frame filled with a native-looking journal-entries list) found the
 * sidebar-overlap theory in the original comment here was WRONG: after
 * setPosition() below, getBoundingClientRect() confirms the shell's right
 * edge (1070) and Foundry's real #sidebar's left edge (1092) never actually
 * overlap. The list bleeding into every shot is a *different*, always-
 * present element: apps/enhanced-journal.js's own `.journal-directory` pane
 * (a docked "quick browse" journal list MEJ embeds inside its own shell,
 * toggled by the `.sidebar-toggle` arrow button, confirmed live via
 * elementFromPoint() on the exact pixels the debris list appeared at — its
 * ancestor chain roots at `#MonksEnhancedJournal form`, not `#sidebar`).
 * It defaults to expanded and eats ~300px of the shell's own content width.
 * `collapseSidebar()` is a real MEJ API method (same one `.sidebar-toggle`'s
 * click handler calls) — idempotent to call every time (checked via
 * `_collapsed` first to avoid a redundant `game.settings.set` on MEJ's own
 * "start-collapsed" world setting, snapshotted/restored in before/afterAll
 * below since this is the one call in this file that mutates
 * monks-enhanced-journal's own settings, not this module's). */
async function positionShell(page) {
  await page.evaluate(() => {
    const app = game.MonksEnhancedJournal.journal;
    app?.setPosition({ left: 60, top: 40, width: 1010, height: 820 });
    if (app && !app._collapsed) app.collapseSidebar();
  });
  // A lingering hover tooltip (e.g. "Campaign Hub" over the nav icon,
  // triggered by Playwright's own click() synthetically moving the pointer
  // there first) can otherwise survive into the next screenshot — the
  // window resize above shifts the button out from under the real pointer
  // without firing a new pointerleave, so a synthetic mouse.move() alone
  // doesn't reliably clear it. Foundry's own TooltipManager does.
  await page.evaluate(() => game.tooltip?.deactivate());
  await page.mouse.move(400, 885);
}

/** Open a specific entry (not the Hub) in the MEJ shell. */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  await positionShell(page);
  return page.locator("#MonksEnhancedJournal");
}

/** Open any entry (so the MEJ shell exists) then click the Campaign Hub
 * toolbar button. Idempotent — 08-query-graph.spec.mjs's openHub() pattern:
 * re-clicking the sidebar journal tab while the shell is already open can
 * hang (it covers the sidebar button). */
async function openHub(page) {
  const alreadyOpen = await page.evaluate(() => !!document.querySelector("#MonksEnhancedJournal"));
  if (!alreadyOpen) {
    await page.locator('[data-tab="journal"][data-action="tab"]').click();
    await settle(page, 200);
    const anyEntryId = await page.evaluate(() => game.journal.contents[0]?.id);
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, anyEntryId);
    await settle(page, 400);
  }
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  await positionShell(page);
  return shell;
}

async function openHubTab(page, tab) {
  const shell = await openHub(page);
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 300);
  return shell;
}

/** Dispatch a synthetic native drop of a document onto `selector`, matching
 * Foundry's own DragDrop data format ({type, uuid} as text/plain JSON) —
 * exercises the real drop handler without needing OS-level pointer drag.
 * Copied from 01-session.spec.mjs's dropDocumentOnto(). */
async function dropDocumentOnto(page, selector, { type, uuid }) {
  await page.evaluate(({ selector, type, uuid }) => {
    const el = document.querySelector(selector);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type, uuid }));
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    el.dispatchEvent(new DragEvent("dragenter", opts));
    el.dispatchEvent(new DragEvent("dragover", opts));
    el.dispatchEvent(new DragEvent("drop", opts));
  }, { selector, type, uuid });
}

/** Stronger-than-toBeVisible() check for a relationship-graph node: a d3
 * -force node <g> can carry a real, non-empty bounding box (satisfying
 * toBeVisible()) while its actual position sits outside the SVG's own
 * clipped viewBox — never painted, but not "hidden" by any check
 * toBeVisible() runs — confirmed live as the root cause behind an earlier
 * graph-gm.png shipping an almost-empty canvas despite passing exactly that
 * assertion. Checks the node's geometry is fully within the graph app's own
 * frame and that it's drawn at non-zero opacity. */
async function assertNodeOnscreen(graphApp, nodeLocator) {
  await expect(nodeLocator).toBeVisible();
  const appBox = await graphApp.boundingBox();
  const nodeBox = await nodeLocator.boundingBox();
  expect(appBox, "graph app has no bounding box").toBeTruthy();
  expect(nodeBox, "node has no bounding box").toBeTruthy();
  const within =
    nodeBox.x >= appBox.x &&
    nodeBox.y >= appBox.y &&
    nodeBox.x + nodeBox.width <= appBox.x + appBox.width &&
    nodeBox.y + nodeBox.height <= appBox.y + appBox.height;
  expect(within, `node outside graph frame: node=${JSON.stringify(nodeBox)} app=${JSON.stringify(appBox)}`).toBe(true);
  // image nodes carry a second <circle> inside their <clipPath>; the ring is first
  const opacity = await nodeLocator.locator("circle").first().evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity, "node circle has zero opacity").toBeGreaterThan(0);
}

/**
 * Open the Hub's Graph tab at a large size and wait for a draw in which every
 * name in `names` is genuinely PAINTED inside the pane (assertNodeOnscreen,
 * not just toBeVisible). Returns the settled `.mej-cc-graph-pane` locator.
 *
 * Extracted from the player capture below so the GM's own Graph-tab shots
 * get the identical treatment; its full live-investigation notes stay at
 * that call site. The short version, both of which are properties of the
 * embedded pane rather than the retired standalone popup: the graph SVG
 * derives its viewBox AND d3-force's forceCenter() target from its own
 * clientWidth/clientHeight at draw time, so (1) enlarging the MEJ SHELL is
 * what grows the frame, and (2) the tab's <div> only reports a non-zero
 * clientWidth once it is the ACTIVE tab — changeTab() is a plain class
 * toggle with no re-render — so drawGraphPane() has to be re-triggered by an
 * explicit subsheet render AFTER the tab is active and the shell enlarged.
 */
async function settleGraphPane(page, shell, names) {
  await page.evaluate(() => {
    // 1060 wide, not the viewport's full 1440: Foundry's own right-hand
    // sidebar starts at x=1092 in this viewport, and the MEJ shell's window
    // frame has translucent margins, so a wider shell shows the sidebar's
    // buttons faintly THROUGH its own edge in a whole-shell shot. This is
    // still far larger than the pane's 800x540 fallback frame, which is what
    // the draw reliability below actually depends on.
    game.MonksEnhancedJournal.journal?.setPosition({ left: 20, top: 20, width: 1060, height: 840 });
  });
  await settle(page, 300);
  await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
  await settle(page, 200);
  // Whole-campaign mode, explicitly. The graph's mode/center live on the
  // module-level HUB_STATE, not on a fresh instance per render, so a
  // showGraphFor() call earlier in the SAME browser page (graph-gm.png's
  // ego/Focus shot) leaves the pane centered on that one entity — ego mode
  // filters to the center plus its direct neighbours, which is why a
  // later whole-campaign shot in the same page could otherwise be missing
  // most of the cast. Confirmed live: this is exactly what made the first
  // run's hub-graph shot drop "Mira Thornwood".
  await shell.locator('button[data-action="setGraphMode"][data-mode="all"]').click();
  await settle(page, 300);
  await page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.render({ parts: ["main"] }));
  await settle(page, 300);

  let graphApp = shell.locator(".mej-cc-graph-pane");
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    graphApp = shell.locator(".mej-cc-graph-pane");
    await expect(graphApp).toHaveCount(1);
    await expect.poll(() => graphApp.locator(".mej-cc-graph-node").count()).toBeGreaterThanOrEqual(2);
    await settle(page, 2500); // let the simulation's alpha decay toward rest
    try {
      for (const name of names) {
        await assertNodeOnscreen(graphApp, graphApp.locator(".mej-cc-graph-node", { hasText: name }));
      }
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      // Tab already active and shell already enlarged, so a plain re-render
      // of the Hub's "main" part is enough for a fresh, independently-
      // randomized simulation on the next try.
      await page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.render({ parts: ["main"] }));
      await settle(page, 300);
    }
  }
  if (lastError) throw lastError;
  return graphApp;
}

/**
 * Open the header bar's Tools menu, idempotently.
 *
 * toggleToolsMenu is a plain flip of HUB_STATE.toolsMenuOpen, and HUB_STATE is
 * module-level in the browser page rather than per-instance — so the menu is
 * still open after an action taken FROM it (opening the import wizard leaves
 * it open), and a second blind click on the summary would close it again
 * instead of opening it. Confirmed live: that is what made this file's export
 * capture, which follows the import capture in the same page, time out
 * waiting for a menu item that was never re-rendered. Drive off the button's
 * own aria-expanded, which the template renders from that same state.
 */
async function openToolsMenu(shell, page) {
  const summary = shell.locator(".mej-cc-tools-summary");
  if ((await summary.getAttribute("aria-expanded")) !== "true") {
    await summary.click();
    await settle(page, 300);
  }
  await expect(shell.locator(".mej-cc-tools-menu")).toHaveCount(1);
  return shell.locator(".mej-cc-tools-menu");
}

/** Select a value in the Hub's campaign picker and wait for the re-render. */
async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 500);
}

/**
 * Create a timeline through the picker's own "➕ New timeline…" action-option
 * (the exact route the GM guide teaches), flag the created journal, and
 * return its id. The change handler sets HUB_TIMELINE_SELECTION_SETTING to
 * the new timeline's id, which is how the id comes back out.
 */
async function newTimelineViaPicker(shell, page, name) {
  await shell.locator('select[name="timeline-select"]').selectOption("__newtl");
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 700);
  return page.evaluate(async (id) => {
    const tlId = game.settings.get("mej-campaign-companion", "hubTimelineSelection");
    if (tlId) await game.journal.get(tlId)?.setFlag(id, "guideDemo", true);
    return tlId;
  }, MODULE_ID);
}

/** The attributes <details> renders collapsed by default (07-knowledge.spec.mjs). */
async function ensureAttrsExpanded(panel) {
  const details = panel.locator(".mej-cc-knowledge-attrs");
  const isOpen = await details.evaluate((el) => el.open);
  if (!isOpen) await details.locator("summary").click();
}

/** Fill (or blank) the add/rename-timepoint dialog and return its locator.
 * `date`, when given, is {year, month, day, time} — mirrors
 * CampaignHubPage#promptTimepoint's own fields (02-hub-timeline.spec.mjs:92-112
 * pattern). When omitted, every date field is explicitly cleared: the dialog
 * pre-fills them from the current world time whenever a calendar is active,
 * so leaving them untouched would silently date every "manual" timepoint. */
async function fillTimepointDialog(page, { label, date }) {
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="label"]').fill(label);
  const yearInput = dialog.locator('input[name="year"]');
  if (await yearInput.count()) {
    if (date) {
      await yearInput.fill(String(date.year));
      await dialog.locator('select[name="month"]').selectOption(String(date.month));
      await dialog.locator('input[name="day"]').fill(String(date.day));
      await dialog.locator('input[name="time"]').fill(date.time);
    } else {
      await yearInput.fill("");
      await dialog.locator('select[name="month"]').selectOption("");
      await dialog.locator('input[name="day"]').fill("");
      await dialog.locator('input[name="time"]').fill("");
    }
  }
  return dialog;
}

/** Create one timepoint on the Hub's Timeline tab. When `date` is given, the
 * dialog itself — with the campaign-date fields visible — is the
 * campaign-date-picker.png shot (only available transiently, while it's open). */
async function addTimepoint(shell, page, label, date) {
  await shell.locator("button.mej-cc-add-timepoint").click();
  const dialog = await fillTimepointDialog(page, { label, date });
  if (date) await shot(dialog, "campaign-date-picker");
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 500);
}

// World settings the demo run mutates; snapshotted in beforeAll, restored in
// afterAll. timelineJournalId is reset to "" at start (02-hub-timeline's
// pattern, see its file-header comment): every timeline this run seeds is
// campaign-owned, so unregistering the world's legacy singleton for the
// duration is simply a guarantee that no Hub path can write a timepoint onto
// the real world timeline. Any journal the setting does end up naming is
// deleted before the restore.
const SETTINGS_TO_RESTORE = [
  "timelineJournalId",
  "savedQueries",
  "playerGroups",
  "retroLinkMode",
  "autoLink",
  // Task 5: createCampaign() seeds the auto-capture target when it creates
  // the world's FIRST campaign (data/campaign-store.mjs's own RULING), and
  // World A has none — so this run always writes it. Same snapshot/restore
  // discipline 14-campaigns.spec.mjs applies to it.
  "autoCaptureCampaign",
  // Client settings the campaign picker and the timeline picker persist on
  // every selection (spec §2 / D §3). This file drives both, so both are
  // world state this run changes. Restored for the GM seat here; the player
  // test snapshots and restores User 1's own copies itself, since a client
  // setting is per-user and a GM-side restore never touches theirs.
  "hubCampaignScope",
  "hubTimelineSelection"
];
let settingsSnapshot = {};
// Cross-module world state, snapshotted/restored alongside settingsSnapshot
// but NOT part of SETTINGS_TO_RESTORE (that loop only reads/writes this
// module's own settings namespace):
//   - "monks-enhanced-journal" "start-collapsed" — positionShell()'s
//     collapseSidebar() call (a real GM-only side effect of that MEJ API
//     method) flips this MEJ-owned world setting.
//   - game.paused — plain broadcast session state, not a game.settings key
//     at all, but still world state this run changes (unpaused below) and
//     must leave as it found it.
let mejStartCollapsedSnapshot = false;
let pausedSnapshot = false;

// Ids of the seeded demo documents, populated by the seed test and read by
// the capture tests that follow it (plain Node-side values — these persist
// across tests in this file regardless of each test's own fresh
// page/context, since only browser-side state resets between tests).
const demo = {};

// The Hub's two picker settings are CLIENT settings — stored per user, so
// the GM-side snapshot/restore in before/afterAll never touches User 1's
// copies. Opening the campaign portal as a player writes hubCampaignScope
// for that seat (CampaignHubPage scopes itself to the portal's campaign),
// which would otherwise be left pointing at a folder this run then deletes.
// Captured right after the player logs in, restored in the test's finally.
let playerPickerSnapshot = null;

async function restorePlayerPickers(page) {
  if (!playerPickerSnapshot) return;
  const snapshot = playerPickerSnapshot;
  playerPickerSnapshot = null;
  await page.evaluate(async (snap) => {
    for (const [k, v] of Object.entries(snap)) await game.settings.set("mej-campaign-companion", k, v);
  }, snapshot);
}

guideDescribe("guide screenshots", () => {
  test.beforeAll(async ({ browser }) => {
    mkdirSync(IMG_DIR, { recursive: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");

    // Crash-safety: a snapshot file left over from an earlier, crashed run
    // holds the TRUE pre-run baseline (written below before any mutation on
    // that run) — restore from it rather than re-snapshotting the world's
    // current live settings, which may already be this file's own
    // mutations if the crash happened mid-run. Only once that's read do we
    // move on to this run's own sweep/reset, exactly as a clean run would.
    if (existsSync(SNAPSHOT_PATH)) {
      const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
      settingsSnapshot = snap.settingsSnapshot;
      mejStartCollapsedSnapshot = snap.mejStartCollapsedSnapshot;
      pausedSnapshot = snap.pausedSnapshot;
    } else {
      settingsSnapshot = await page.evaluate((keys) => {
        const out = {};
        for (const k of keys) out[k] = game.settings.get("mej-campaign-companion", k);
        return out;
      }, SETTINGS_TO_RESTORE);
      // Snapshot MEJ's own "start-collapsed" world setting (positionShell()'s
      // collapseSidebar() call below flips it) and the current pause state —
      // read before any mutation below touches either.
      mejStartCollapsedSnapshot = await page.evaluate(() =>
        game.settings.get("monks-enhanced-journal", "start-collapsed")
      );
      pausedSnapshot = await page.evaluate(() => game.paused === true);
      // Written BEFORE the sweep/reset/unpause below runs, so a crash any
      // time after this point still leaves the real pre-run baseline on
      // disk for the next run's beforeAll to recover from.
      writeFileSync(SNAPSHOT_PATH, JSON.stringify({ settingsSnapshot, mejStartCollapsedSnapshot, pausedSnapshot }));
    }

    await sweepGuideDemo(page);
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
    });

    // A leftover `game.paused === true` from some other manual/test session
    // bled Foundry's "GAME PAUSED" overlay into prep-board.png (clearly) and
    // settings.png (faintly, through that window's own translucent
    // background) in a prior run. Unpausing here, at the very start of the
    // seed+capture flow, keeps every shot this file takes clean of it.
    // `broadcast: true` is load-bearing, not decoration: togglePause()'s
    // default (`broadcast: false`) only patches the CALLING client's own
    // in-memory game.data.paused - confirmed live, the exact bug behind
    // this fix's first attempt still shipping the overlay: a *fresh*
    // client connecting seconds later (this file's every subsequent test
    // logs in fresh) still read paused:true, because the unpause was never
    // actually sent to the server for it to hand to new connections.
    await unpause(page);
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await sweepGuideDemo(page);
    // Delete the fresh timeline journal this run created, then restore.
    await page.evaluate(async (snapshot) => {
      const id = game.settings.get("mej-campaign-companion", "timelineJournalId");
      if (id && id !== snapshot.timelineJournalId) await game.journal.get(id)?.delete();
      for (const [k, v] of Object.entries(snapshot))
        await game.settings.set("mej-campaign-companion", k, v);
    }, settingsSnapshot);
    await page.evaluate(
      async ({ collapsed, paused }) => {
        await game.settings.set("monks-enhanced-journal", "start-collapsed", collapsed);
        if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
      },
      { collapsed: mejStartCollapsedSnapshot, paused: pausedSnapshot }
    );
    // Defensive, for a run recovering from a snapshot file written before
    // autoCaptureCampaign joined SETTINGS_TO_RESTORE: never leave the
    // auto-capture target pointing at the demo campaign folder the sweep
    // above just deleted.
    await page.evaluate(async () => {
      const id = game.settings.get("mej-campaign-companion", "autoCaptureCampaign");
      if (id && !game.folders.get(id)) {
        await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", "");
      }
    });
    await context.close();
    // Only delete the snapshot file once the restore above has actually run
    // to completion — its presence is exactly what lets a crash between
    // this point and the next run's beforeAll still recover the right
    // baseline (which, by now, is a no-op restore of values already back in
    // place, but still correct to leave discoverable until we know we're done).
    if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH);
  });

  test("seed the demo campaign", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "Gamemaster");
    // The headless viewport's permanent "no hardware acceleration" warning
    // (KNOWN_LOW_RESOLUTION_WARNING) is a real, visible notification banner,
    // not just a console message — clear it so it doesn't sit across the
    // top of every screenshot this test takes.
    await page.evaluate(() => ui.notifications.clear());
    await unpause(page);

    // Defensive baseline regardless of whatever a prior spec run left behind
    // (11-auto-link-scope.spec.mjs's own afterEach, for one, restores
    // retroLinkMode to "confirm", not "off") — every entry this test creates
    // is either brand-new-named or already @UUID-linked at creation time, so
    // this is just hygiene, not load-bearing for the seeding below.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", false);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "off");
      // The Hub's two picker client settings persist across sessions, so a
      // previous run (or a manual browse) can leave this run's first Hub
      // render scoped to something other than "All campaigns"/"All timelines
      // in scope" — which changes which stack the Add-Timepoint helper below
      // finds. Both are in SETTINGS_TO_RESTORE, so this reset is undone at
      // afterAll like every other mutation here.
      await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
      await game.settings.set("mej-campaign-companion", "hubTimelineSelection", "");
    });

    // --- Place, Quest, Persons -------------------------------------------
    const flagonId = await seedMejEntry(page, {
      name: "The Gilded Flagon",
      mejType: "place",
      text: "<p>The Gilded Flagon is the busiest tavern on the harborfront, its taproom thick with pipe smoke and the low murmur of merchants trading rumors over dice. The innkeeper waters down the ale just enough that nobody complains twice.</p>",
      ownership: OBSERVER_OWNERSHIP
    });
    const flagonUuid = await uuidOf(page, flagonId);

    // The block secret (09-secrets.spec.mjs:18's HTML shape) lives here, not
    // on the Session page: the Session sheet never renders a
    // `.editor-display[data-key="text.content"]` region at all (its own
    // template only ever keys system.recap/system.gmNotes/playerRecaps), so
    // a block secret placed in a Session page's text.content would be inert
    // — the secrets-ui.mjs GM overlay hook that adds `.mej-cc-secret-audience`
    // only scans that exact data-key. Quest/Place/Person pages all render it
    // (MEJ's shared sheet-textentry.hbs partial), so the block secret is
    // seeded on the Quest entry instead — narratively apt, since the secret
    // is about the caravan incident itself.
    const caravanId = await seedMejEntry(page, {
      name: "The Missing Caravan",
      mejType: "quest",
      text: '<p>A merchant caravan bound for the eastern hills never reached its destination. The party has been hired to find out what happened to it — and to recover whatever cargo can still be saved.</p><section class="secret" id="guide-secret-1"><p>The caravan was never attacked — Aldric staged it.</p></section>',
      ownership: OBSERVER_OWNERSHIP
    });
    const caravanUuid = await uuidOf(page, caravanId);

    const miraId = await seedMejEntry(page, {
      name: "Mira Thornwood",
      mejType: "person",
      text: `<p>Mira Thornwood keeps a dye-and-cloth stall near the docks, trading in colors most weavers in town have never seen. She's quick with a smile and quicker to notice who's watching her — and she can usually be found at @UUID[JournalEntry.${flagonId}]{The Gilded Flagon} once the sun goes down.</p>`,
      flags: {
        tags: ["ally", "merchant"],
        attributes: [
          { id: "mira-attr-trust", key: "trustworthiness", value: "high", playerHidden: false },
          { id: "mira-attr-loyalty", key: "secret loyalty", value: "The Gilded Hand", playerHidden: true }
        ]
      },
      ownership: OBSERVER_OWNERSHIP
    });
    const aldricId = await seedMejEntry(page, {
      name: "Captain Aldric Vane",
      mejType: "person",
      text: `<p>Captain Aldric Vane commands the town watch's small garrison. Publicly, he's leading the search into @UUID[JournalEntry.${caravanId}]{The Missing Caravan} — though more than one guard has noticed his account of that night doesn't quite line up.</p>`,
      ownership: OBSERVER_OWNERSHIP
    });
    const serenaId = await seedMejEntry(page, {
      name: "Serena of the Vale",
      mejType: "person",
      text: "<p>Serena of the Vale is a traveling scholar cataloguing the old trade roads through the region. She arrived in town only days before the caravan vanished, and she's been asking a lot of very specific questions ever since.</p>",
      ownership: OBSERVER_OWNERSHIP
    });

    // Real portraits on two of the Persons. A graph node's <image href> is
    // the PAGE's own `src` (logic/graph-rows.mjs nodeImage()), falling back
    // to MEJ's per-type placeholder asset when it is empty — the live UI
    // audit only ever saw that fallback, because no entity in this world has
    // a picture. portrait-node.png is the shot of the first branch, so the
    // demo cast needs genuine images: Foundry core's own bundled people
    // icons, present on every install and safe to publish.
    await page.evaluate(async (pairs) => {
      for (const [id, src] of pairs) await game.journal.get(id).pages.contents[0].update({ src });
    }, [
      [miraId, "icons/environment/people/commoner.webp"],
      [aldricId, "icons/environment/people/infantry-armored.webp"]
    ]);

    // Relationship edges for the graph (flag shape from 08-query-graph.spec.mjs:200-205,
    // set on the PAGE, MEJ's own "relationships" flag namespace).
    await page.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: false }
      });
    }, { pid: miraId, relId: "guide-rel-mira-flagon", targetUuid: flagonUuid });
    await page.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: false }
      });
    }, { pid: aldricId, relId: "guide-rel-aldric-caravan", targetUuid: caravanUuid });

    // The rendered @CampaignQuery enricher shot (campaign-query-inline.png).
    await appendPageContent(page, flagonId, "<p>@CampaignQuery[type:person tag:ally]</p>");

    // --- Session -----------------------------------------------------------
    const sessionId = await createSessionViaDialog(page, "Session 12 — Shadows over Daggerford");
    await page.evaluate(async ({ sessionId, id }) => {
      await game.journal.get(sessionId).setFlag(id, "guideDemo", true);
    }, { sessionId, id: MODULE_ID });
    await page.evaluate(async (id) => {
      await game.journal.get(id).update({ ownership: { default: 2 } });
    }, sessionId);

    const user1Id = await page.evaluate(() => game.users.getName("User 1").id);

    // Session-tab fields, driven through the real UI (01-session.spec.mjs's
    // proven field selectors) — plain inputs/selects, low-risk to automate.
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 200);

    const numberInput = shell.locator('input[name="flags.mej-campaign-companion.session.sessionNumber"]');
    await numberInput.fill("12");
    await numberInput.blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.sessionNumber === 12,
      sessionId
    );

    const dateFields = { year: "1497", day: "14", hour: "19", minute: "0" };
    for (const [field, value] of Object.entries(dateFields)) {
      const input = shell.locator(`input[name="flags.mej-campaign-companion.session.campaignDate.${field}"]`);
      await input.fill(value);
    }
    await shell.locator('select[name="flags.mej-campaign-companion.session.campaignDate.month"]').selectOption("5");
    await shell.locator('input[name="flags.mej-campaign-companion.session.campaignDate.minute"]').blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.campaignDate?.year === 1497,
      sessionId
    );

    // Attendees, via the real attendees-list drop target (SessionSheet.mjs's
    // dropSelector) — two small demo Actors, guideDemo-flagged so the sweep
    // in sweepGuideDemo() (extended above) cleans them up too.
    const actorIds = await page.evaluate(async ({ id, names }) => {
      const ids = [];
      for (const name of names) {
        const actor = await Actor.create({ name, type: "npc", flags: { [id]: { guideDemo: true } } });
        ids.push(actor.id);
      }
      return ids;
    }, { id: MODULE_ID, names: ["Kestrel Ashgrove", "Doran Emberhollow"] });
    const actorUuids = await page.evaluate((ids) => ids.map((id) => game.actors.get(id).uuid), actorIds);
    for (const uuid of actorUuids) {
      await dropDocumentOnto(page, ".attendees-list", { type: "Actor", uuid });
      await settle(page, 400);
    }

    // Secret checklist (session.secrets — a separate mechanism from the
    // block secret above, SessionSheet.mjs's own addSecret/secret-text UI).
    for (const text of ["Where did the caravan really go?", "Who paid off the guards?"]) {
      const before = await page.evaluate(
        (id) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length,
        sessionId
      );
      await shell.locator('button[data-action="addSecret"]').click();
      await page.waitForFunction(
        ({ id, before }) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length === before + 1,
        { id: sessionId, before }
      );
      await settle(page, 200);
      const input = shell.locator("li.item input.secret-text").last();
      await input.fill(text);
      await input.blur();
      await settle(page, 400);
    }

    // GM recap + one player recap: set directly (system.recap / playerRecaps
    // are plain page flags/fields — logic/player-recap.mjs's reserved
    // shape), rather than driving the real ProseMirror editor via UI. A real
    // contenteditable ProseMirror element is significantly more fragile to
    // automate reliably (focus/selection state, custom-element internals)
    // than the plain <input>/<select> fields above, and recap content isn't
    // one of the brief's listed UI-is-the-subject exceptions (timepoints,
    // saved query, player group, audience dialog) — a deliberate deviation
    // from the brief's literal "through the sheet UI" wording for this one
    // field, noted in the task report. Done LAST, after every session-tab
    // field above: confirmed live that MEJ's shared <form> submits its
    // FULL current field set (every tab's fields, not just the one just
    // blurred) on each of those submits — setting recap/playerRecaps any
    // earlier got silently stomped back to empty by the next blur's
    // whole-form resubmit carrying the stale (pre-update) recap value still
    // sitting in the still-mounted, not-currently-active recap tab's DOM.
    await page.evaluate(async ({ sessionId, recap, user1Id, playerRecap }) => {
      const p = game.journal.get(sessionId).pages.contents[0];
      await p.update({ system: { recap } });
      await p.setFlag("mej-campaign-companion", "playerRecaps", { [user1Id]: playerRecap });
    }, {
      sessionId,
      // Kept short deliberately: the Session sheet's shared MEJ header
      // partial (sheet-detailed-header.hbs, via a generic Page Name/Type/
      // File Path/Page Category/Sort Order fields fallback the companion's
      // SessionSheet never overrides with session-specific fields) eats
      // most of the vertical space available at this window size, leaving
      // only ~180px for the whole description tab body — confirmed live,
      // reported as a concern rather than fixed here (a SessionSheet/MEJ
      // integration gap, out of this task's scope). Short text is the
      // practical way to keep both recaps actually visible in the shot.
      recap: "<p>The party found the caravan's last stop — a burned-out waystation. Vane's story about bandits doesn't add up.</p>",
      user1Id,
      playerRecap: "<p>Boot prints led away from where the \"bandits\" supposedly came from.</p>"
    });
    await settle(page, 300);

    // --- Campaign container -------------------------------------------------
    // Created BEFORE the Hub is ever opened, and that ordering is
    // load-bearing rather than stylistic. In a ZERO-campaign world the Hub's
    // All scope calls ensureTimelineJournal() with no campaign, which files a
    // BRAND NEW world timeline named "Campaign Timeline" — and World A
    // already owns a real, empty journal of exactly that name, so the Hub
    // then stacks two identically-titled timelines in one pane (confirmed
    // live; it shipped in a first pass of this shot). Creating the campaign
    // first means every timeline this run seeds is campaign-owned, the world
    // timeline is left alone, and the pane a reader sees is unambiguous.
    const campaign = await page.evaluate(async ({ id, name }) => {
      const { createCampaign, campaignPortal } =
        await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      const folder = await createCampaign(name, { ownershipDefault: "observer" });
      await folder.setFlag(id, "guideDemo", true);
      // createCampaign also creates the campaign's portal entry (spec C §1).
      // sweepGuideDemo()'s folder cascade would reclaim it either way; the
      // explicit flag makes it individually recoverable too.
      const portal = campaignPortal(folder);
      if (portal) await portal.setFlag(id, "guideDemo", true);
      return { campaignId: folder.id, portalId: portal?.id ?? null };
    }, { id: MODULE_ID, name: "The Vale Chronicles" });
    expect(campaign.campaignId).toBeTruthy();
    expect(campaign.portalId).toBeTruthy();

    // File the demo cast into it with the same production write the Hub's own
    // filing controls perform (CampaignHubPage.onFileAllShown ->
    // JournalEntry.updateDocuments with the chosen folder id; 14-campaigns
    // .spec.mjs:748-770 drives that button end-to-end). "Serena of the Vale"
    // is deliberately left out, so the Unfiled scope has a row of its own.
    await page.evaluate(async ({ ids, folder }) => {
      await JournalEntry.updateDocuments(ids.map((_id) => ({ _id, folder })));
    }, { ids: [flagonId, caravanId, miraId, aldricId, sessionId], folder: campaign.campaignId });

    // --- Hub: timeline, dashboards (saved query), secrets (player group) --
    // Scoped to the campaign: with no explicit timeline pick that branch
    // calls ensureTimelineJournal(campaign), which files the campaign's own
    // "<name> — Timeline" on the spot and renders it as the pane's single
    // stack — so the Add-Timepoint helper below is unambiguous.
    let timelineShell = await openHubTab(page, "timeline");
    await scopeHub(timelineShell, page, campaign.campaignId);
    timelineShell = await openHubTab(page, "timeline");
    const defaultTimelineId = await page.evaluate(async ({ id, campaignId }) => {
      const { defaultTimeline } =
        await import("/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs");
      const tl = defaultTimeline(game.folders.get(campaignId));
      // Flagged the moment it exists, not just at afterAll: if this run
      // crashes before then, the next run's start-of-run sweep only ever
      // finds guideDemo-FLAGGED documents, so without this the orphaned
      // timeline would survive every subsequent sweep forever.
      if (tl) await tl.setFlag(id, "guideDemo", true);
      return tl?.id ?? null;
    }, { id: MODULE_ID, campaignId: campaign.campaignId });
    expect(defaultTimelineId).toBeTruthy();

    await addTimepoint(timelineShell, page, "The Caravan Departs");
    await addTimepoint(timelineShell, page, "Mira's Warning");
    await addTimepoint(timelineShell, page, "The Ambush (staged)");
    await addTimepoint(timelineShell, page, "Session 12 Convenes", { year: "1497", month: "5", day: "14", time: "19:00" });

    // Attach the Quest entry to the first timepoint (same synthetic-drop
    // technique as 02-hub-timeline.spec.mjs). Looked up by the campaign's
    // DEFAULT timeline document rather than by name: this world can hold
    // more than one journal with a given timeline name at once, and
    // `game.journal.find(name === …)` picks whichever the collection
    // happens to order first, not necessarily the one the pane is showing.
    const firstTimepointId = await page.evaluate((timelineId) => {
      const tp = game.journal.get(timelineId)
        ?.getFlag("mej-campaign-companion", "timeline")?.timepoints
        ?.find((t) => t.label === "The Caravan Departs");
      return tp?.id;
    }, defaultTimelineId);
    await dropDocumentOnto(page, `li.mej-cc-timepoint[data-timepoint-id="${firstTimepointId}"]`, { type: "JournalEntry", uuid: caravanUuid });
    await settle(page, 500);

    // A SECOND campaign-owned timeline, so timeline-selector.png carries a
    // real ★ default AND a non-default selection — the only state in which
    // "Make default" renders at all (hub.hbs suppresses it for the default
    // and for world timelines, which is exactly why the live audit never
    // saw it).
    const sideTimelineId = await newTimelineViaPicker(timelineShell, page, "Side Quests");
    expect(sideTimelineId).toBeTruthy();
    await addTimepoint(timelineShell, page, "Rumours at the Docks");

    // Back to a neutral Hub for everything after this — driven through the
    // two pickers themselves, so the in-page state and the persisted client
    // settings agree (a bare settings write would leave HUB_STATE stale).
    await timelineShell.locator('select[name="timeline-select"]').selectOption("");
    await settle(page, 400);
    await scopeHub(timelineShell, page, "");

    const dashboardsShell = await openHubTab(page, "dashboards");
    await dashboardsShell.locator('button[data-action="addDashboard"]').click();
    const dashboardDialog = page.locator("dialog.application").last();
    await dashboardDialog.locator('input[name="name"]').fill("Allies");
    await dashboardDialog.locator('input[name="query"]').fill("type:person tag:ally");
    await dashboardDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    const secretsShell = await openHubTab(page, "secrets");
    await secretsShell.locator('button[data-action="addGroup"]').click();
    const groupDialog = page.locator("dialog.application").last();
    await groupDialog.locator('input[name="name"]').fill("Inner Circle");
    await groupDialog.locator(`input[name="member-${user1Id}"]`).check();
    await groupDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    Object.assign(demo, {
      flagonId, caravanId, miraId, aldricId, serenaId, sessionId,
      campaignId: campaign.campaignId, portalId: campaign.portalId,
      defaultTimelineId, sideTimelineId
    });
  });

  test("capture Hub, entry-sheet, and graph screenshots", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.notifications.clear());
    await unpause(page);

    const indexShell = await openHub(page);
    await settle(page, 300);
    // The header bar (.mej-cc-hub-header — it sits ABOVE the tab nav, inside
    // the Hub subsheet), shot in its default "All campaigns" state: picker,
    // New Session, Tools. The campaign-settings gear is deliberately absent
    // here — the template only renders it while the picker is scoped to a
    // campaign, and campaign-picker.png below is where that state is shown.
    await shot(indexShell.locator(".mej-cc-hub-header"), "hub-header");

    // This is the GUIDE'S LEAD IMAGE (reused again further down for the
    // mention-badge callout on "The Gilded Flagon"/"The Missing Caravan"),
    // so it needs demo rows leading the frame, not this world's other
    // test-spec debris (this world accumulates ~14 T-/TT-prefixed fixture
    // rows from other spec files that a plain scroll can't get out of the
    // way, since they interleave alphabetically all through the list —
    // confirmed live via a bare scroll-to-row attempt, review finding).
    // The Hub's own name-filter box (index-filter — the same control
    // gm-guide.md's own Index section teaches readers to use) is the
    // reliable fix: "the" matches both required demo rows ("The Gilded
    // Flagon", "The Missing Caravan" — both need to stay visible with
    // their mention-count badges for the second caption this same image
    // serves) and, empirically, nothing in this world's debris set.
    await indexShell.locator('input[name="index-filter"]').fill("the");
    await settle(page, 400);
    await expect(indexShell.locator(".mej-cc-index-row", { hasText: "The Gilded Flagon" })).toBeVisible();
    await expect(indexShell.locator(".mej-cc-index-row", { hasText: "The Missing Caravan" })).toBeVisible();
    await shot(indexShell, "hub-index");
    await indexShell.locator('input[name="index-filter"]').fill("");
    await settle(page, 300);

    const searchShell = await openHubTab(page, "search");
    await searchShell.locator(".mej-cc-search-input").fill("caravan");
    await settle(page, 400);
    await shot(searchShell, "hub-search");

    const dashboardsShell = await openHubTab(page, "dashboards");
    await settle(page, 300);
    await shot(dashboardsShell, "hub-dashboards");

    const secretsShell = await openHubTab(page, "secrets");
    // Campaign-scoped for the same reason hub-index.png is name-filtered
    // above: in All-campaigns scope this pane lists every secret in this
    // shared, never-wiped world — including the ones on documents this run
    // does not own — and a published screenshot must show this run's own
    // demo secrets only (the guide's caption counts three). Scope is put
    // back to neutral straight after.
    await scopeHub(secretsShell, page, demo.campaignId);
    await settle(page, 300);
    await expect(secretsShell.locator(".mej-cc-secret-row")).toHaveCount(3);
    await shot(secretsShell, "hub-secrets-tab");
    await scopeHub(secretsShell, page, "");

    // Ego/Focus mode centered on Aldric, opened the same way the entity-
    // header "open graph" button does (showGraphFor(uuid), imported
    // directly — the real header button is absent from the DOM on v14 for
    // an unrelated, already-documented MEJ-side bug; see the prep-board
    // shot below), rather than the Hub's plain "Whole campaign" button.
    // showGraphFor() scopes+centers the Hub's graph state AND opens the
    // Hub itself (apps/CampaignHubPage.mjs) — the graph is now a Hub tab,
    // not a standalone popup (retired apps/graph-app.mjs).
    //
    // Review finding: a whole-campaign-mode shot's toBeVisible() checks on
    // the two named nodes passed, yet the committed PNG showed an
    // almost-empty canvas — toBeVisible() only checks a non-empty bounding
    // box + non-hidden computed style, not whether the node's <g> actually
    // landed inside the SVG's own clipped viewBox. With this world's full
    // node cluster (every visible entry, not just this run's demo cast),
    // d3-force's forceCenter() can drift a node's *geometry* outside the
    // viewBox while its DOM element still reports a "visible" bounding box.
    // Ego mode structurally avoids this: buildGraph() filters to just the
    // center node + its direct neighbors (graph-data.mjs's `mode === "ego"`
    // branch) — Aldric's only relationship is to the Caravan, so this is a
    // 2-node, 1-edge graph that settles near forceCenter()'s target
    // regardless of how large the rest of the world's fixture set grows.
    const aldricUuid = await uuidOf(page, demo.aldricId);
    await page.evaluate(async (centerUuid) => {
      const { showGraphFor } = await import("/modules/mej-campaign-companion/scripts/apps/CampaignHubPage.mjs");
      await showGraphFor(centerUuid);
    }, aldricUuid);
    await settle(page, 500);
    const graphShell = page.locator("#MonksEnhancedJournal");
    const graphApp = graphShell.locator(".mej-cc-graph-pane");
    await expect(graphApp).toHaveCount(1);
    await expect.poll(() => graphApp.locator(".mej-cc-graph-node").count()).toBeGreaterThanOrEqual(2);
    await settle(page, 2500); // let the (now tiny) simulation's alpha decay toward rest
    // Belt-and-suspenders on top of the ego-mode structural fix: assert
    // each named node's actual painted geometry sits inside the graph app's
    // own frame (not just "has a bounding box" per toBeVisible()) and is
    // drawn at non-zero opacity, exactly the two properties the flaky
    // whole-campaign shot's toBeVisible()-only check missed.
    await assertNodeOnscreen(graphApp, graphApp.locator(".mej-cc-graph-node", { hasText: "Captain Aldric Vane" }));
    await assertNodeOnscreen(graphApp, graphApp.locator(".mej-cc-graph-node", { hasText: "The Missing Caravan" }));
    await shot(graphApp, "graph-gm");

    // --- Campaign scope: picker, Unfiled, timeline picker, Graph tab -------
    // Everything from here to the scope reset below runs with the Hub scoped
    // to "The Vale Chronicles". Besides being the subject of three of these
    // shots, campaign scope is also what makes the Graph-tab shots reliable
    // and publishable: #scopedEntries() narrows the pane to that campaign's
    // members, so the graph draws this run's own five-document demo cast
    // instead of every T-/TT- fixture other spec files have left in this
    // shared, never-wiped world.
    const campaignShell = await openHubTab(page, "index");
    await scopeHub(campaignShell, page, demo.campaignId);
    await expect(campaignShell.locator("button.mej-cc-edit-campaign")).toHaveCount(1);
    await expect(campaignShell.locator(".mej-cc-index-row", { hasText: "The Gilded Flagon" })).toBeVisible();
    await shot(campaignShell, "campaign-picker");

    // The Timeline pane, campaign-scoped and with no explicit timeline pick:
    // one stack (this campaign's default timeline), so the shot shows the
    // order buttons, the timepoints, an attached entry chip and Add
    // Timepoint without the reader having to work out which of several
    // stacks is which. All scope stacks every campaign's default plus every
    // world timeline, which in THIS world means the demo timeline beside
    // World A's own unrelated, empty one.
    const timelineShell = await openHubTab(page, "timeline");
    await expect(timelineShell.locator("li.mej-cc-timepoint")).toHaveCount(4);
    await shot(timelineShell, "hub-timeline");

    // Unfiled scope. The name filter is the same control hub-index.png above
    // uses, and for the same reason: this world's other fixtures are unfiled
    // too, and "Serena" is the one demo entry deliberately left out of the
    // campaign, so filtering to her leaves exactly the row this shot is
    // about — with its GM-only "File into campaign…" button and the
    // toolbar's Unfiled-only "File all shown into…" beside it.
    const unfiledShell = await openHubTab(page, "index");
    await scopeHub(unfiledShell, page, "unfiled");
    await unfiledShell.locator('input[name="index-filter"]').fill("Serena");
    await settle(page, 400);
    await expect(unfiledShell.locator(".mej-cc-index-row")).toHaveCount(1);
    await expect(unfiledShell.locator("button.mej-cc-file-all")).toHaveCount(1);
    await expect(unfiledShell.locator("button.mej-cc-row-file")).toHaveCount(1);
    await shot(unfiledShell, "campaign-unfiled");
    await unfiledShell.locator('input[name="index-filter"]').fill("");
    await settle(page, 300);

    // Timeline picker, with "Side Quests" (the campaign's NON-default
    // timeline) selected: the only state that renders the full management
    // trio, Make default included.
    await scopeHub(unfiledShell, page, demo.campaignId);
    const tlShell = await openHubTab(page, "timeline");
    await tlShell.locator('select[name="timeline-select"]').selectOption(demo.sideTimelineId);
    await settle(page, 600);
    await expect(tlShell.locator("button.mej-cc-timeline-default")).toHaveCount(1);
    await expect(tlShell.locator("button.mej-cc-timeline-rename")).toHaveCount(1);
    await expect(tlShell.locator("button.mej-cc-timeline-delete")).toHaveCount(1);
    // Cropped to the controls row itself, not the whole pane. The pane is a
    // full-height tab body and this campaign's non-default timeline carries
    // one timepoint, so a pane-sized shot was ~75% empty black frame (review
    // finding). `.mej-cc-timeline-controls` is exactly the picker plus the
    // management trio — the stacks are its siblings, not its children — so
    // its own box padded by 8px is the tight crop. Clamped to the pane so the
    // 8px can never reach past the tab body into the shell's chrome.
    const tlPane = tlShell.locator(".mej-cc-timeline");
    const tlControls = tlPane.locator(".mej-cc-timeline-controls");
    const tlControlsBox = await tlControls.boundingBox();
    expect(tlControlsBox, "timeline controls have no bounding box").toBeTruthy();
    // padBottom 4, not 8: the next sibling (the stack's order-button row)
    // begins 5px below the controls box, and a symmetric 8px would clip a
    // 3px sliver of its top edge into the frame.
    await shotAround(page, tlControlsBox, "timeline-selector", {
      pad: 8,
      padBottom: 4,
      within: await tlPane.boundingBox()
    });
    // Back to the scope's stacked default view before the Graph shots.
    await tlShell.locator('select[name="timeline-select"]').selectOption("");
    await settle(page, 400);

    // The Graph TAB in context (nav + header + pane) — the guide's "the graph
    // is its own pane" image. graph-gm.png above is the pane on its own, in
    // Focus mode; this is the whole Hub in Whole-campaign mode.
    const paneShell = await openHub(page);
    const campaignGraph = await settleGraphPane(page, paneShell, ["Mira Thornwood", "Captain Aldric Vane"]);
    await shot(paneShell, "hub-graph");

    // A single node, close up, with its real portrait — the seed set
    // Mira's page `src`, so nodeImage()'s first branch (the page's own
    // image) is what draws here, not MEJ's per-type placeholder. Asserted,
    // not assumed: the whole point of this shot is that it is NOT the
    // fallback the live UI audit was stuck with.
    const miraNode = campaignGraph.locator(".mej-cc-graph-node", { hasText: "Mira Thornwood" });
    await expect(miraNode.locator("image")).toHaveAttribute("href", "icons/environment/people/commoner.webp");
    const miraBox = await miraNode.boundingBox();
    expect(miraBox, "Mira's graph node has no bounding box").toBeTruthy();
    await shotAround(page, miraBox, "portrait-node", { within: await campaignGraph.boundingBox() });

    // Neutral scope again for the tests that follow (and for the world this
    // run borrows) — afterAll restores the setting outright either way.
    await scopeHub(paneShell, page, "");

    const sessionShell = await openEntry(page, demo.sessionId);
    await sessionShell.locator('a[data-action="tab"][data-tab="description"]').click();
    await settle(page, 300);
    await shot(sessionShell, "session-sheet-gm");
    await sessionShell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 300);
    await shot(sessionShell.locator(".secrets-section"), "session-checklist");

    const miraShell = await openEntry(page, demo.miraId);
    const miraPanel = miraShell.locator(".mej-cc-knowledge");
    await expect(miraPanel).toHaveCount(1);
    await ensureAttrsExpanded(miraPanel);
    await shot(miraPanel, "knowledge-tags-attributes");

    const flagonShell = await openEntry(page, demo.flagonId);
    const flagonPanel = flagonShell.locator(".mej-cc-knowledge");
    await expect(flagonPanel).toHaveCount(1);
    await shot(flagonPanel.locator(".mej-cc-knowledge-backlinks"), "knowledge-backlinks");
    // The @CampaignQuery enricher rendered on this same page.
    await expect(flagonShell.locator(".mej-cc-query-embed")).toHaveCount(1);
    await shot(flagonShell, "campaign-query-inline");
  });

  test("capture standalone dialogs and windows", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.notifications.clear());
    await unpause(page);

    // Settings window's module section — must show genuine defaults, not
    // whatever the seed test last left retroLinkMode/autoLink at (the seed
    // test sets retroLinkMode "off" for its own seeding hygiene, per its own
    // comment — "off" is not the documented default). Restore both to their
    // documented defaults (README's Settings table / gm-guide.md's Settings
    // reference: autoLink off, retroLinkMode "confirm") immediately before
    // this capture, not just at afterAll, so settings.png actually shows
    // what a fresh install looks like.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", false);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "confirm");
    });
    await page.evaluate(() => game.settings.sheet.render(true));
    await settle(page, 500);
    const settingsApp = page.locator("#settings-config");
    await expect(settingsApp).toBeVisible();
    await settingsApp.locator(`button[data-action="tab"][data-tab="${MODULE_ID}"]`).click();
    await settle(page, 300);
    await shot(settingsApp, "settings");
    // ApplicationV2 windows (unlike a native <dialog>) don't reliably close
    // on Escape here — use the window's own header close control instead.
    // force: true — a permanent "hardware acceleration" notification banner
    // (this headless test environment's own known quirk, unrelated to this
    // module) sits over part of the viewport and can intercept the plain
    // pointer-actionability check on a window's header close control.
    await settingsApp.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Prep board (openPrepBoard() called directly — MEJ's own header-button
    // injection for it is broken on v14, unrelated to this module; see
    // 10-secrets-hub.spec.mjs's doc comment).
    await page.evaluate(async (sessionId) => {
      const { openPrepBoard } = await import("/modules/mej-campaign-companion/scripts/apps/prep-board-app.mjs");
      const pageDoc = game.journal.get(sessionId).pages.contents[0];
      await openPrepBoard({ pageUuid: pageDoc.uuid });
    }, demo.sessionId);
    await settle(page, 500);
    const board = page.locator(".mej-cc-prep-board");
    await expect(board).toHaveCount(1);
    await shot(board, "prep-board");
    await board.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Secret-audience dialog on the block secret (Quest entry) — reveal to
    // the Inner Circle group seeded earlier, so Task 3's player captures can
    // show it revealed.
    const caravanShell = await openEntry(page, demo.caravanId);
    const audienceBtn = caravanShell.locator(".mej-cc-secret-audience");
    await expect(audienceBtn).toHaveCount(1);
    await audienceBtn.click();
    await settle(page, 300);
    const audienceDialog = page.locator("dialog.application").last();
    await expect(audienceDialog).toBeVisible();
    await shot(audienceDialog, "secret-audience-dialog");
    const groupId = await page.evaluate(() => {
      const groups = game.settings.get("mej-campaign-companion", "playerGroups") ?? [];
      return groups.find((g) => g.name === "Inner Circle")?.id;
    });
    if (groupId) await audienceDialog.locator(`input[name="group-${groupId}"]`).check();
    await audienceDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    // Docx import wizard, on the fixture used by 05-docx-import.spec.mjs —
    // opened and populated, but never actually imported (Escape-closed
    // afterward) so it doesn't add extra, unmanaged demo content.
    const importShell = await openHub(page);
    const importMenu = await openToolsMenu(importShell, page);
    await importMenu.locator('button[data-action="openImportWizard"]').click();
    await settle(page, 300);
    const wizard = page.locator(".mej-cc-import-wizard-app");
    await wizard.locator("input[type=file][name=file]").setInputFiles(DOCX_PATH);
    await wizard.locator(".mej-cc-import-review").waitFor({ timeout: 60_000 });
    await settle(page, 300);
    // "Import into" defaults to the world's first campaign, which in this
    // shared world is one this run does not own — its name would be
    // published in the shot. Pick the demo campaign explicitly.
    await wizard.locator('select[name="destination"]').selectOption(demo.campaignId);
    await settle(page, 300);
    await shot(wizard, "docx-import-wizard");
    // Not Escape-closed: this ApplicationV2 window doesn't reliably close on
    // it (confirmed live — its subtree kept intercepting pointer events for
    // the next Hub interaction). The header close control does.
    await wizard.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Export dialog, with "Include GM Content" visible — Escape-closed
    // rather than triggering a real download.
    const exportShell = await openHub(page);
    const exportMenu = await openToolsMenu(exportShell, page);
    await exportMenu.locator('button[data-action="openExportDialog"]').click();
    const exportDialog = page.locator("dialog.application").last();
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.locator('input[name="includeGM"]')).toHaveCount(1);
    await shot(exportDialog, "docx-export-dialog");
    await page.keyboard.press("Escape");
    await settle(page, 300);

    // Retroactive auto-link confirm dialog (11-auto-link-scope.spec.mjs's
    // selectors): a plain-text mention in an existing demo page, then a
    // freshly-created entity with that exact name triggers the confirm scan.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", true);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "confirm");
    });
    await appendPageContent(page, demo.serenaId,
      "<p>Serena mentioned a fence named Old Toby Rackett who might know where stolen goods pass through town.</p>");
    await settle(page, 300);
    await seedMejEntry(page, {
      name: "Old Toby Rackett",
      mejType: "person",
      text: "<p>A quiet fence who deals in things better left unlooked-at.</p>",
      ownership: OBSERVER_OWNERSHIP
    });
    const retroDialog = page.locator(".mej-cc-retro-link-dialog");
    await expect(retroDialog).toBeVisible({ timeout: 10_000 });
    await shot(retroDialog, "autolink-confirm");
    await retroDialog.locator('button[data-action="apply"]').click();
    await settle(page, 500);

    // Return these two settings to a safe baseline before Task 3's tests
    // run — afterAll restores the ORIGINAL pre-run snapshot regardless, but
    // this avoids leaving autoLink/retroLinkMode "hot" for whatever Task 3
    // does next in this same describe block.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", false);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "off");
    });
  });

  // Task 3: player-perspective captures. The two prerequisites the brief's
  // Step 1 preamble calls for are already satisfied by the tests above, not
  // repeated here: (1) the Quest entry ("The Missing Caravan") — where the
  // block secret actually lives, per this file's own CONTROLLER RULING
  // comment above (the Session sheet never renders a text.content region at
  // all) — was seeded with `ownership: OBSERVER_OWNERSHIP` (the same
  // `{ default: 2 }` shape as 07-knowledge.spec.mjs:159's `ownership: 2`
  // pattern) at creation time, same as the Session's own explicit
  // `ownership: { default: 2 }` update; (2) the block secret was already
  // revealed for real to the "Inner Circle" group (which contains User 1)
  // by the "capture standalone dialogs and windows" test's
  // secret-audience-dialog.png flow — that flow doesn't just open the
  // dialog for the screenshot, it checks the Inner Circle group and clicks
  // "ok", applying the reveal. Both grants die with their flagged entries
  // at afterAll's sweepGuideDemo() cleanup, same as every other demo
  // document — no separate settings were touched for either.
  test("capture player-perspective guide screenshots", async ({ page, browser }) => {
    // 180s, not the file's usual 120s: the graph-player enlarge-and-redraw
    // step plus its belt-and-suspenders retry loop below needs the extra
    // headroom on a bad run.
    test.setTimeout(180_000);

    // SessionSheet.mjs's _disableFields/subRender only re-enable the
    // player-recap pencil/editor when `game.users.some(u => u.isGM &&
    // u.active)` is true (mirroring EnhancedJournalSheet's own "notes" tab
    // precedent — verified live: with no GM connected the button renders
    // `disabled` and stays that way, which is exactly what a clean run of
    // this test hit as a real TimeoutError, not an ENOSPC artifact). This
    // spec's `login()` reuses one `page` across users sequentially, so
    // without a second, still-connected session nobody is ever "active" as
    // GM while User 1's page is up. 06-player-collab.spec.mjs's own
    // multi-context pattern is the fix: hold a second browser context
    // logged in as Gamemaster (idle — it never interacts) for the
    // lifetime of this test so `hasGM` is genuinely true, matching how a
    // real player would actually experience this feature (live, with a GM
    // online), not a test-harness artifact.
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");
    try {
      await capturePlayerShots(page);
    } finally {
      await restorePlayerPickers(page);
      await gmContext.close();
    }
  });
});

// Factored out of the test body above so the idle-GM-context setup/teardown
// (a try/finally around the whole capture sequence, so the GM socket is
// always released — even on assertion failure — and never leaks into the
// next test as "already connected", per the report's own record of that
// exact failure mode) reads clearly without indenting every capture line.
async function capturePlayerShots(page) {
  await login(page, "User 1");
  await page.evaluate(() => ui.notifications.clear());
  await unpause(page);
  playerPickerSnapshot = await page.evaluate(() => ({
    hubCampaignScope: game.settings.get("mej-campaign-companion", "hubCampaignScope"),
    hubTimelineSelection: game.settings.get("mej-campaign-companion", "hubTimelineSelection")
  }));

  // The campaign portal entry, opened the way a player actually meets it —
  // as an ordinary journal entry. Its page carries the module-declared
  // subtype mej-campaign-companion.campaign, whose registered sheet IS the
  // Hub (integrations/mej-adapter.mjs), and CampaignHubPage's own
  // isCampaignPage branch then scopes the Hub to the portal's campaign. So
  // this shot is both "the portal" and "what opening it does". Taken FIRST,
  // before the recap edit below leaves a permanently-dirty ProseMirror on
  // the shared MEJ shell (see the unsaved-changes note further down).
  const portalShell = await openEntry(page, demo.portalId);
  await expect(portalShell.locator(".mej-cc-hub-container")).toHaveCount(1);
  await expect(portalShell.locator('select[name="campaign-scope"]')).toHaveValue(demo.campaignId);
  await shot(portalShell, "portal");

  // Session sheet, description tab, as User 1 sees it. No extra filtering
  // needed to keep GM notes out of frame: templates/session.hbs gates its
  // entire gm-notes block behind `{{#if @root.isGM}}` on the SESSION tab
  // (a different tab from "description"), so this shot is structurally
  // GM-content-free for any non-GM viewer regardless of what's captured.
  // The recap section's pencil icon (editor-edit) is visible because
  // SessionSheet.mjs's onEditPlayerRecap has no isEditable/isOwner gate —
  // every user can edit their OWN recap, matching the brief's "recap
  // field editable" subject (the separate hasGM-active gate discussed
  // above is satisfied by the idle GM context opened at the top of this
  // test).
  const sessionShell = await openEntry(page, demo.sessionId);
  await sessionShell.locator('a[data-action="tab"][data-tab="description"]').click();
  await settle(page, 300);
  await shot(sessionShell, "session-sheet-player");

  // User 1's own recap field, mid-edit. Toggle the editPlayerRecap pencil
  // (same mechanism the GM recap's own editor-edit button uses, MEJ's
  // shared `.editor-parent.editing` show/hide CSS — confirmed live in
  // monks-journal-sheet.css:605-618), then click into the now-visible
  // <prose-mirror> and type an addition so the shot shows a real,
  // in-progress editing state (not just the toggle) — the seed test
  // already gave User 1's own recap flag real starting content via
  // playerRecaps, so this is genuinely editing existing text, not an
  // empty field.
  const recapSection = sessionShell.locator(".player-recap-self");
  await recapSection.locator('button[data-action="editPlayerRecap"]').click();
  await settle(page, 300);
  await expect(recapSection).toHaveClass(/editing/);
  const recapEditor = recapSection.locator("prose-mirror .editor-content, prose-mirror");
  await recapEditor.first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Someone should ask the harbor guard directly.");
  await settle(page, 300);
  await shot(sessionShell, "recap-editing");
  // Toggle back off before moving on — tidy state, not load-bearing.
  await recapSection.locator('button[data-action="editPlayerRecap"]').click();
  await settle(page, 300);

  // The revealed block secret, on the Quest entry (per this file's
  // CONTROLLER RULING). Selector matches 09-secrets.spec.mjs:116's
  // contentPreview()-scoped pattern (`.editor-display[data-key="text.content"]`)
  // — the same page also mounts a permanently-hidden, never-rendered raw
  // `<prose-mirror>` carrying the un-enriched text.content, present for
  // any user who can open the sheet independent of this module's secrets
  // layer; scoping to the enriched display container is what a real
  // user's screen shows and avoids double-counting that hidden element.
  // Shooting the whole shell (not just the secret box) shows the reveal
  // in context, matching campaign-query-inline.png's own pattern in the
  // GM capture test above.
  //
  // Live investigation (a real, reproducible failure on a clean run, not
  // the prior attempt's ENOSPC noise): the prose-mirror recap editor
  // above, once typed into, is PERMANENTLY dirty for the lifetime of that
  // element — core Foundry's ProseMirrorDirtyPlugin (common/prosemirror/
  // dirty-plugin.mjs) is a one-way latch (`apply() { return true; }`,
  // never reset), and HTMLProseMirrorElement.save() (client/applications/
  // elements/prosemirror-editor.mjs) only clears it by destroying/
  // recreating the editor when the element's OWN internal toggle mode is
  // active — which this section's pencil button doesn't drive (it just
  // toggles an external CSS class). So EnhancedJournalSheet.close()'s
  // checkForChanges()/DialogV2.confirm("You have unsaved changes...")
  // gate (sheets/EnhancedJournalSheet.js) fires the next time the shared
  // MEJ shell tries to switch documents — confirmed live via the
  // resulting dialog's own text — and nothing here was answering it, so
  // openEntry()'s fire-and-forget `openJournalEntry` call (MEJ core never
  // awaits its own internal `.open()` chain) returned immediately while
  // the actual document switch stayed silently blocked on that dialog.
  // Handling it (discard, matching a real user choosing not to lose an
  // in-progress edit vs. viewing another entry) is the correct fix, not
  // avoiding dirtiness — the recap-editing shot above is deliberately
  // left as a genuine in-progress edit, matching the brief.
  await openEntry(page, demo.caravanId);
  const unsavedDialog = page.locator('dialog.application:has-text("unsaved changes")');
  if (await unsavedDialog.count()) {
    await unsavedDialog.locator('button[data-action="yes"]').click();
    await settle(page, 500);
  }
  // A single-page entry like this Quest displays its one PAGE, not the
  // parent JournalEntry, once the switch lands — compare against
  // parent.id (falling back to the document's own id, in case a future
  // entry shape here ever gets opened at the entry level instead) rather
  // than assuming which shape .document is.
  await expect.poll(() => page.evaluate((id) => {
    const shown = game.MonksEnhancedJournal?.journal?.document;
    return (shown?.parent?.id ?? shown?.id) === id;
  }, demo.caravanId)).toBe(true);
  await positionShell(page);
  const caravanShell = page.locator("#MonksEnhancedJournal");
  const revealed = caravanShell.locator('.editor-display[data-key="text.content"] section.secret.mej-cc-revealed-to-you');
  await expect(revealed).toHaveCount(1);
  await shot(caravanShell, "revealed-secret-player");

  // The chat log whisper User 1 received on reveal. Scoped to
  // `.chat-message` elements carrying audience-dialog.mjs's own
  // `.mej-cc-reveal-whisper` wrapper (not the whole chat log); `.last()`
  // rather than an exact toHaveCount(1) — chat messages, unlike this
  // file's journal/actor demo content, are NOT guideDemo-flagged and so
  // are never swept by afterAll, and this whisper's exact secret text
  // (fixed by the seed above) is identical run over run, so repeated
  // runs of this file against this persistent, never-wiped world
  // (including any prior crashed attempt that got as far as the GM's own
  // reveal, per this task's own history) genuinely accumulate more than
  // one matching message over time — confirmed live (27 matches on this
  // environment's accumulated history). The most recent one is always
  // the one from THIS run's reveal.
  await page.locator('#sidebar button[data-action="tab"][data-tab="chat"]').click();
  await settle(page, 400);
  const whisperMsgs = page.locator(".chat-message:has(.mej-cc-reveal-whisper)");
  await expect.poll(() => whisperMsgs.count()).toBeGreaterThanOrEqual(1);
  await shot(whisperMsgs.last(), "reveal-whisper");

  // Relationship graph, whole-campaign mode ("all", the Hub's own Graph tab
  // — the same one 08-query-graph.spec.mjs's own GM-vs-player comparison
  // test uses), as User 1. Sparser than graph-gm.png (which shows ego/
  // Focus mode centered on Aldric, used there for reliability against a
  // much larger node cluster — see that shot's own comment above): graph-
  // data.mjs's buildGraph() only ever receives rows the caller has
  // already permission-filtered for the viewer (file header comment), so
  // this world's other test-spec debris that lacks player-level ownership
  // is invisible here even though a GM viewing the same "all" mode would
  // see it — genuinely fewer nodes for this viewer, not just a different
  // mode. assertNodeOnscreen() (defined above, shared with the GM
  // capture) is still used as a belt-and-suspenders check on the two
  // named nodes.
  // Sparser still since Task 5: opening the portal above scoped this seat's
  // Hub to "The Vale Chronicles", so the pane draws that campaign's members
  // rather than every visible entry in the world.
  //
  // The enlarge-then-redraw-then-verify mechanics this shot needs live in
  // settleGraphPane() above (shared with the GM's own Graph-tab shots);
  // its doc comment carries the full live-investigation record.
  const graphShell = await openHub(page);
  const graphApp = await settleGraphPane(page, graphShell, ["Captain Aldric Vane", "The Missing Caravan"]);
  await shot(graphApp, "graph-player");
}
