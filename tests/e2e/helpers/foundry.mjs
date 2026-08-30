import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { lockStatus, UNLOCK_HINT } from "./env-lock.mjs";

export const BASE_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
export const TEST_WORLD = process.env.FOUNDRY_TEST_WORLD ?? "world-a";
export const MODULE_ID = "mej-campaign-companion";
export const MEJ_MODULE_ID = "monks-enhanced-journal";

// Test documents this suite creates are prefixed "TT-" (matches the MEJ
// Playwright harness convention at monks-enhanced-journal/test/) so cleanup
// stays greppable and doesn't collide with the "TT-"/"Baseline Test"/etc.
// fixtures already living in world-a from prior MEJ test rounds.
export const TT_PREFIX = "TT-";

// Phase 3 (storageState login reuse, ported from campaign-record): one saved
// session file per test-world user. The "setup" Playwright project
// (tests/e2e/auth.setup.mjs) populates these once per run; login() below
// fast-paths from them. Git-ignored (tests/e2e/.auth/) since cookies are
// host-local and short-lived.
const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".auth");
export const AUTH_STATE_FILES = {
  Gamemaster: path.join(AUTH_DIR, "gm.json"),
  "User 1": path.join(AUTH_DIR, "user1.json"),
  "User 2": path.join(AUTH_DIR, "user2.json")
};

const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "/Users/danbularzik/FoundryVTT-14/FoundryVTT-Node-14.365";
const FOUNDRY_DATA = process.env.FOUNDRY_DATA ?? "/Users/danbularzik/FoundryVTT-14/Data";
const FOUNDRY_NODE = process.env.FOUNDRY_NODE ?? "/opt/homebrew/bin/node";
const PID_FILE = path.join(FOUNDRY_DATA, ".pid");

async function serverStatus() {
  try {
    const res = await fetch(`${BASE_URL}/api/status`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch {
    return null;
  }
}

/** Refuse server mutations while a live foreign session holds the env lock. */
function assertEnvOwned(action) {
  const { held, info, alive } = lockStatus();
  if (held && info && alive && info.pid !== process.pid) {
    throw new Error(
      `Refusing to ${action}: Foundry e2e environment is locked by pid ${info.pid} ` +
      `(worktree ${info.worktree}). ${UNLOCK_HINT}`
    );
  }
}

function stopServer() {
  assertEnvOwned("stop the Foundry server");
  try {
    const port = new URL(BASE_URL).port || "30000";
    // -sTCP:LISTEN: only the server's listening socket. A bare `-ti :port`
    // also lists CLIENT sockets on the port — including this very process's
    // keep-alive connection from the status probe (killing the test runner
    // with SIGTERM mid-setup) and any user browser tab attached to Foundry.
    const pids = execFileSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8"
    }).trim();
    for (const pid of pids.split("\n").filter((p) => /^\d+$/.test(p))) {
      process.kill(Number(pid));
    }
  } catch {
    /* nothing listening */
  }
  if (fs.existsSync(PID_FILE)) fs.rmSync(PID_FILE);
}

function startServer(worldId) {
  assertEnvOwned("start the Foundry server");
  const log = fs.openSync(path.join(FOUNDRY_DATA, "Logs", "stdout.log"), "a");
  const child = spawn(
    FOUNDRY_NODE,
    ["main.js", `--dataPath=${FOUNDRY_DATA}`, `--world=${worldId}`],
    { cwd: FOUNDRY_APP, detached: true, stdio: ["ignore", log, log] }
  );
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
}

/** Ensure the Foundry server is running with the test world active. */
export async function ensureTestWorld() {
  let status = await serverStatus();
  if (status?.active && status.world === TEST_WORLD) return status;
  stopServer();
  await new Promise((r) => setTimeout(r, 2000));
  startServer(TEST_WORLD);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await serverStatus();
    if (status?.active && status.world === TEST_WORLD) return status;
  }
  throw new Error(`Foundry did not come up with world "${TEST_WORLD}" on ${BASE_URL}`);
}

/**
 * The condition a logged-in page must satisfy before login() hands it back.
 *
 * `game.ready` alone is NOT enough, and the difference is a real race that
 * cost the round-5 flake triage two failures of 09-secrets:357
 * ("page.evaluate: Resulting promise was garbage collected" on the FIRST
 * evaluate after login). Foundry core, client/game.mjs Game.getData:
 *
 *     if ( !socket.session.userId ) {
 *       socket.disconnect();
 *       window.location.href = getRoute("join");
 *     }
 *     return new Promise(resolve => socket.emit("world", resolve));
 *
 * Note the missing `return` before the redirect: a document whose socket
 * session has no bound userId navigates itself to /join AND carries on
 * booting the world, so it can reach `game.ready === true` moments before
 * the navigation commits. /join with a live session bounces straight back
 * to /game, which is the second `/game` navigation (and the second "Vended
 * World data to User" line in the server log) that a cookie fast-path login
 * produces every single time - measured: nav 2 lands ~250ms before the
 * ready wait resolves. Whenever `game.ready` is observed on that doomed
 * FIRST document, login() returns onto a page that is about to be replaced
 * and the caller's next evaluate dies with its execution context.
 *
 * `game.socket.session.userId` is precisely the flag core tests: a document
 * that has it is a document core will not redirect. Waiting on it is
 * waiting for the real condition, not for time.
 *
 * Binding the session BEFORE the first /game navigation was tried first and
 * does not work at this seam: `POST /join` with the saved cookie answers
 * `{"status":"success","redirect":"/game"}` and the very next /game load
 * still makes two navigations; the same POST without a userId answers 401
 * `JOIN.ErrorUserDoesNotExist` and unbinds the session outright.
 */
const SESSION_BOUND = () =>
  globalThis.game?.ready === true && !!globalThis.game?.socket?.session?.userId;

/**
 * Try to authenticate `page` as `userName` from a saved storageState cookie
 * (written by the "setup" Playwright project) instead of the interactive
 * /join flow. Returns true on success (page is left on /game, ready).
 */
async function loginFromSavedState(page, userName) {
  const file = AUTH_STATE_FILES[userName];
  if (!file || !fs.existsSync(file)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    await page.context().addCookies(state.cookies ?? []);
    await page.goto(`${BASE_URL}/game`);
    // SESSION_BOUND, not a bare game.ready - see its comment above.
    await page.waitForFunction(SESSION_BOUND, null, { timeout: 15_000 });
    const actualUser = await page.evaluate(() => game.user?.name);
    if (actualUser !== userName) {
      throw new Error(`landed as "${actualUser}", expected "${userName}"`);
    }
    return true;
  } catch (err) {
    console.warn(
      `login() fast-path miss for "${userName}" (${err.message}) — falling back to interactive /join.`
    );
    return false;
  }
}

/** Log a page in as the named user (no passwords in the test worlds). */
export async function login(page, userName) {
  if (await loginFromSavedState(page, userName)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE_URL}/join`);
    // Foundry ≤14.365 renders a user <select>; 14.367+ renders a free-text
    // username <input> instead (matched against user names server-side).
    const userField = page.locator('select[name="userid"], input[name="username"]');
    await userField.waitFor({ timeout: 15_000 });
    const tagName = await userField.evaluate((el) => el.tagName);
    if (tagName === "SELECT") {
      const select = page.locator('select[name="userid"]');
      const disabled = await select
        .locator("option", { hasText: userName })
        .first()
        .isDisabled()
        .catch(() => false);
      if (disabled) {
        throw new Error(
          `User "${userName}" is already connected to the test world — close other sessions (browsers, stray test runners) and retry.`
        );
      }
      await select.selectOption({ label: userName });
    } else {
      await userField.fill(userName);
    }
    await page.locator('button[name="join"], form#join-game-form button[type="submit"]').first().click();
    try {
      await page.waitForURL("**/game", { timeout: 30_000 });
      break;
    } catch (error) {
      // Cold server boots occasionally swallow the first join; retry once.
      if (attempt === 1) throw error;
    }
  }
  await page.waitForFunction(SESSION_BOUND, null, { timeout: 60_000 });
}

/**
 * Run `fn(page)` against a *fresh*, logged-in-as-Gamemaster page in its own
 * browser context, then close that context. For cleanup in specs whose
 * tests use `browser` to open their own multi-client contexts rather than
 * the default `page` fixture: a `test.afterEach(async ({ page }) => ...)`
 * hook still gets Playwright's default (never-navigated, never-logged-in)
 * `page` fixture regardless of what the test itself used, so
 * `page.evaluate(() => game...)` against it throws "game is not defined" —
 * silently, if the caller wraps it in `.catch(() => {})` as earlier drafts
 * of this suite did, meaning cleanup for those specs never actually ran and
 * state leaked between tests (confirmed live: a leftover
 * playersWriteSessions=true from one test changing the next test's
 * ownership scenario; a leftover timepoint from one test being picked up as
 * "newest" by the next). Route afterEach cleanup through this instead.
 */
export async function withGmPage(browser, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await fn(page);
  } finally {
    await context.close();
  }
}

/**
 * Cleanup helper for afterEach hooks in specs that mix the default `page`
 * fixture with tests that open their own `browser` contexts: reuses `page`
 * directly when the test itself already left it as a live, ready Gamemaster
 * session (true for every test using `page` — cheaper, and avoids a genuine
 * bug confirmed live: opening a *second* simultaneous Gamemaster session via
 * withGmPage() while the test's own `page` is still connected as the same
 * user — Playwright doesn't tear down `page` until after all hooks for that
 * test complete — silently produced a socket/session conflict where
 * deleteDocuments() calls from the second session appeared to succeed
 * (no thrown error, deletedCount > 0 in the response) but never actually
 * stuck: a "Campaign Timeline" journal reliably survived cleanup on the very
 * next check, every time, only when done this way). Falls back to
 * withGmPage() (a genuine fresh session) only when `page` isn't already a
 * live GM session — true for tests that used `browser` instead, where the
 * default `page` fixture never navigated anywhere.
 */
export async function cleanupAsGm(page, browser, fn) {
  const alreadyGm = await page.evaluate(() => {
    try {
      return globalThis.game?.ready === true && game.user?.isGM === true;
    } catch {
      return false;
    }
  }).catch(() => false);
  if (alreadyGm) {
    await fn(page);
    return;
  }
  await withGmPage(browser, fn);
}

/** As a logged-in GM page: enable a module by id if needed (reloads on change). */
export async function ensureModuleEnabled(page, moduleId = MODULE_ID) {
  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (active) return;
  await page.evaluate(async (id) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, moduleId);
  await page.goto(`${BASE_URL}/game`);
  // SESSION_BOUND, not a bare game.ready: this is a fresh /game document and
  // carries the same self-redirect hazard login() documents.
  await page.waitForFunction(SESSION_BOUND, null, { timeout: 60_000 });
  const nowActive = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (!nowActive) throw new Error(`module "${moduleId}" could not be enabled in the test world`);
}

/** As a logged-in GM page: disable a module by id if active (reloads on change). */
export async function ensureModuleDisabled(page, moduleId = MODULE_ID) {
  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (!active) return;
  await page.evaluate(async (id) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = false;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, moduleId);
  await page.goto(`${BASE_URL}/game`);
  // SESSION_BOUND, not a bare game.ready: this is a fresh /game document and
  // carries the same self-redirect hazard login() documents.
  await page.waitForFunction(SESSION_BOUND, null, { timeout: 60_000 });
  const nowActive = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (nowActive) throw new Error(`module "${moduleId}" could not be disabled in the test world`);
}

/** Delete all journal entries (and thus their pages) whose name starts with the prefix. */
export async function deleteJournalsByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.journal.filter((e) => e.name.startsWith(p)).map((e) => e.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Delete all actors whose name starts with the prefix (crashed-run artifacts). */
export async function deleteActorsByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.actors.filter((a) => a.name.startsWith(p)).map((a) => a.id);
    if (ids.length) await Actor.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Delete all scenes whose name starts with the prefix (crashed-run artifacts). */
export async function deleteScenesByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.scenes.filter((s) => s.name.startsWith(p)).map((s) => s.id);
    if (ids.length) await Scene.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Ids of every timeline journal that exists RIGHT NOW. Call in beforeAll/beforeEach. */
export async function timelineJournalIds(page) {
  return page.evaluate(
    (id) => game.journal.filter((e) => !!e.getFlag(id, "timeline")).map((e) => e.id),
    MODULE_ID
  );
}

/**
 * Delete every timeline journal created since `preexisting` was taken, provided
 * it carries no non-TT timepoints.
 *
 * Identity is the module's own flag, never the name. The old name-keyed helper
 * was wrong in both directions. It OVER-deleted: "Campaign Timeline" is the
 * default name of the world singleton AND a perfectly plausible name for a
 * user's real journal - which is the situation in World A today (a
 * pre-existing, empty one), and an empty user journal defeats the
 * "no non-TT timepoints => safe" heuristic that was the only guard. And it
 * UNDER-deleted: campaign-owned timelines are named "<Campaign> — Timeline"
 * (data/timeline-journal.mjs:85) and never matched the filter, so every one a
 * spec induced leaked unless its campaign folder was deleted with deleteContents.
 *
 * Registration cannot happen at creation time inside a spec, because the specs
 * do not create these - the module does, from a GM Hub render
 * (ensureTimelineJournal). So invert it: register what already existed, delete
 * only what appeared. The ledger is Node-side, so it survives page.reload(),
 * new contexts, and the per-worker restarts Playwright does after a failure.
 *
 * Take the snapshot BEFORE anything opens a GM Hub - a snapshot taken after
 * would bless a journal the run itself created.
 */
export async function cleanupTimelineJournals(page, preexisting = [], { prefix = TT_PREFIX } = {}) {
  await page.evaluate(async ({ id, TT, keep }) => {
    const keepSet = new Set(keep);
    const doomed = game.journal.filter((e) => !!e.getFlag(id, "timeline") && !keepSet.has(e.id));
    for (const j of doomed) {
      const tps = j.getFlag(id, "timeline")?.timepoints ?? [];
      const real = tps.filter((t) => !t.label?.startsWith(TT));
      if (real.length) {
        if (real.length !== tps.length) await j.setFlag(id, "timeline", { timepoints: real });
        continue;
      }
      const deletedId = j.id;
      await JournalEntry.implementation.deleteDocuments([deletedId]);
      // Both settings can be left dangling at a deleted id; the old helper
      // cleared only the first.
      if (game.settings.get(id, "timelineJournalId") === deletedId) await game.settings.set(id, "timelineJournalId", "");
      if (game.settings.get(id, "hubTimelineSelection") === deletedId) await game.settings.set(id, "hubTimelineSelection", "");
    }
  }, { id: MODULE_ID, TT: prefix, keep: preexisting });
}

/**
 * The id of the world timeline journal, resolved the way the module itself
 * resolves it - through the `timelineJournalId` world setting (see
 * data/timeline-journal.mjs's getTimelineJournal), never by the "Campaign
 * Timeline" NAME.
 *
 * Name lookup is not safe here: a world can hold several journals with that
 * exact name (see cleanupTimelineJournals's note on ensureTimelineJournal's
 * create-then-set window), and `game.journal.find(name)` then returns
 * whichever of them the collection happens to iterate first - i.e. whichever
 * random document id sorts first, not the one the module writes timepoints
 * to. That is precisely how run 3 of the round-5 flake baseline failed: the
 * find() returned an empty orphan, so `timeline.timepoints[0]` was undefined
 * ("Cannot set properties of undefined (setting 'links')").
 *
 * Throws rather than returning null, so a caller can never go on to assert
 * against a silently missing journal.
 */
export async function worldTimelineJournalId(page, { timeout = 15_000 } = {}) {
  // Polled, not read once: ensureTimelineJournal() creates the journal and
  // only THEN writes the setting, so a caller arriving right behind a GM Hub
  // render can land inside that window and read "" from a world that is about
  // to have one. Waiting for the setting to resolve is waiting for the same
  // window this helper's comment describes; the throw below still fires if it
  // never closes, so a genuinely missing journal stays loud.
  try {
    const handle = await page.waitForFunction(() => {
      const id = game.settings.get("mej-campaign-companion", "timelineJournalId");
      return id && game.journal.get(id) ? id : false;
    }, null, { timeout });
    return await handle.jsonValue();
  } catch {
    const seen = await page.evaluate(() => ({
      setting: game.settings.get("mej-campaign-companion", "timelineJournalId"),
      named: game.journal.filter((e) => e.name === "Campaign Timeline").map((e) => e.id)
    })).catch(() => null);
    const detail = seen ? JSON.stringify(seen) : "(diagnosis evaluate also failed)";
    throw new Error(`no world timeline journal after ${timeout}ms: ${detail}`);
  }
}

/**
 * Click a locator exactly as `locator.click()` does - same actionability
 * checks, same auto-scroll, same retry loop - but, if it times out, add a
 * live diagnosis of WHAT was covering the target.
 *
 * Round 5's 09-secrets:83 failure (baseline run 5) is a mute version of this:
 * 15s of retries on `.mej-cc-secret-audience`, the element "visible, enabled
 * and stable" every time, with `div.sheet-container`, `section.place` and
 * `nav.sheet-tabs a[data-tab="notes"]` taking the pointer events in turn -
 * MEJ sheet chrome over the button. Playwright's own log names the
 * intercepting element but nothing about the target's own state (is it inside
 * a scrolled-away editor? on an inactive tab? visibility:hidden?), which is
 * what the next occurrence needs.
 *
 * Deliberately NOT a pre-click gate. A gate that scrolls once and then polls
 * `document.elementFromPoint` is strictly weaker than Playwright's click,
 * which re-resolves and re-scrolls on every retry: an earlier draft of this
 * helper did exactly that and turned a healthy transient into a hard failure
 * of a test that had never flaked (09-secrets:438). Diagnose, never gate.
 */
export async function clickWithHitDiagnostics(locator, page, { timeout = 15_000 } = {}) {
  try {
    await locator.click({ timeout });
  } catch (err) {
    const handle = await locator.elementHandle({ timeout: 1_000 }).catch(() => null);
    if (!handle) throw err;
    // Derived from the locator actually passed in, not a hardcoded selector -
    // an earlier version of this helper counted `.mej-cc-secret-audience`
    // unconditionally, which would misreport for any other caller.
    const matches = await locator.count().catch(() => null);
    const diag = await page.evaluate((el) => {
      const describe = (n) => n ? `<${n.tagName.toLowerCase()} class="${n.className}">` : "null";
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const chain = [];
      for (let n = top; n && chain.length < 4; n = n.parentElement) chain.push(describe(n));
      const cs = getComputedStyle(el);
      const pane = el.closest("[data-tab]");
      const scroller = el.closest(".scrollable, .editor-display, .content");
      return {
        target: describe(el),
        box: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        connected: el.isConnected,
        visibility: cs.visibility, display: cs.display, pointerEvents: cs.pointerEvents,
        ownTabPane: pane ? `${pane.dataset.tab} class="${pane.className}"` : null,
        scroller: scroller ? `${describe(scroller)} scrollTop=${scroller.scrollTop} clientH=${scroller.clientHeight} scrollH=${scroller.scrollHeight}` : null,
        topmost: describe(top),
        topmostChain: chain
      };
    }, handle).catch((e) => ({ diagnosisFailed: e.message }));
    throw new Error(`${err.message}\n  hit diagnosis: ${JSON.stringify({ ...diag, matches })}`);
  }
}

/** Delete any leftover combats (crashed-run artifacts from auto-capture specs). */
export async function deleteAllCombats(page) {
  await page.evaluate(async () => {
    const ids = game.combats.map((c) => c.id);
    if (ids.length) await Combat.implementation.deleteDocuments(ids);
  });
}

/**
 * Bounded settle for asserting a change did NOT happen: a no-op has no
 * observable completion signal to await, so we wait out the round-trip window.
 */
export async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
}

// Known, cosmetic MEJ-side gap (see task-14-report.md) — TWO distinct MEJ
// bugs independently produce the identical-looking 404, confirmed live by
// re-testing after the deeper one was fixed:
//   1. (fixed in MEJ, commit f24cbac on feat/extension-api) preCreateJournalEntry
//      (monks-enhanced-journal.js, was ~4556-4566) stamped
//      `flags.img = assets/${type}.png` into every entry's *persisted* data
//      for any type in getDocumentTypes(), with no external-type guard - this
//      was the report's original diagnosis gap: the task-14-report.md first
//      draft attributed the 404 entirely to bug #2 below and missed this one,
//      which is the more serious of the two (it writes a wrong value into
//      stored document data, not just a transient render guess). Same guard
//      pattern as the `_onCreate` site's existing `!externalType` check
//      (monks-enhanced-journal.js:1063, fix 1437846) now applied here too.
//   2. (still present, unfixed, out of scope - MEJ-side) The sidebar/tab
//      icon-render fallback (monks-enhanced-journal.js ~line 5292) guesses
//      `assets/${pagetype}.png` for any type present in getDocumentTypes()
//      with no explicit img *at render time*, independent of whatever flag
//      value (if any) is actually stored - so even a freshly-created Session
//      page with bug #1 now fixed (confirmed live: its persisted
//      flags["monks-enhanced-journal"].img is `undefined`, not a bad path)
//      still 404s the moment its icon renders, from this second, separate
//      site. Non-blocking (a missing icon image, not a functional break) -
//      filtered here rather than fixed, since it's MEJ-side, not
//      companion-side, and outside this task's authorized fix list.
export const KNOWN_MEJ_SESSION_ICON_404 = /assets\/session\.png/;

// The headless viewport (1280x720, set for canvas-off perf per the harness
// convention) is below Foundry's own recommended-minimum check — logged as
// a console error on every world load regardless of anything under test.
export const KNOWN_LOW_RESOLUTION_WARNING = /requires a screen resolution of/;

// Expected noise, not a bug: Foundry's own core JournalEntryPage schema
// validation (documentTypes merging is live per client "setup", not frozen
// at server boot) rejects a companion-namespaced page's type the moment the
// companion module goes inactive — logged as "Failed to initialize
// JournalEntryPage ... is not a valid type" on every subsequent reload while
// disabled. This is exactly the scenario 00-mej-api.spec.mjs's fixType guard
// test deliberately creates; the underlying stored data (and MEJ's own
// interop flag) is untouched, it's just inaccessible via normal .get() while
// the module is off (see {invalid: true} reads in that spec).
export const EXPECTED_INVALID_TYPE_WHILE_DISABLED = /is not a valid type for the JournalEntryPage Document class/;

// Historical MEJ-side bug, now FIXED upstream — kept only so an old MEJ build
// (pre-ec97385) still gets a recognizable ignore pattern instead of a
// confusing spec failure, and as a landmark for what to look for if this class
// of render-abort ever resurfaces. There were actually TWO distinct causes
// behind non-GM Hub search renders failing, not one — both now fixed, both on
// the MEJ side, neither a companion bug:
//   (a) `BlankJournal.compendium` render-abort. The base
//       `foundry.abstract.Document#compendium` getter is `@abstract` and
//       unconditionally throws "A subclass of Document must implement this
//       getter" (the regex below). `BlankJournal` — the synthetic
//       placeholder document behind any `registerShellPage` tab, the Hub
//       included — extended `Document` directly and never overrode it, so
//       `EnhancedJournal.renderSubSheet`'s non-GM permission re-check (which
//       reads `testing.compendium`) crashed outright on any re-render where
//       `options.force`/`this.tempOwnership` weren't set (e.g. the debounced
//       Hub search input, which re-renders on every keystroke). Fixed by
//       MEJ commit `ec97385` (`get compendium() { return null; }`).
//   (b) `BlankJournal.testUserPermission` always-NONE. Once (a) stopped
//       throwing, that same permission re-check fell through to actually
//       *evaluating* `testing.testUserPermission(game.user, "OBSERVER")` —
//       and `BlankJournal` had no override for it either, so it inherited
//       `Document#testUserPermission`'s default, which resolves via
//       `this.ownership` (a field `BlankJournal`'s schema never defines) and
//       therefore always returns NONE. Result: every non-GM client failed
//       that check on every non-forced render (not a throw this time — a
//       clean, silent "no permission" outcome), and `EnhancedJournal`
//       replaced the shell page with its permission-denied placeholder —
//       search results never painted for a player, root cause distinct from
//       (a) and NOT identified at the time (a) was fixed. Fixed by adding a
//       `testUserPermission` override to `BlankJournal` that returns `true`
//       for any registered shell-page type (see enhanced-journal.js, beside
//       the `isOwner`/`_getSheetClass` overrides).
// With both fixed, 03-search.spec.mjs's openHubSearch() no longer needs the
// `game.MonksEnhancedJournal.journal.tempOwnership = true` workaround it used
// to set after opening the Hub - removed, and the spec passes as a real
// non-GM client without it (verified live).
export const KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG = /A subclass of Document must implement this getter/;

/** Collect console errors on a page; call assertNoConsoleErrors() at spec end. */
export function trackConsoleErrors(page, { ignore = [] } = {}) {
  const allIgnore = [KNOWN_LOW_RESOLUTION_WARNING, ...ignore];
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A failed-resource-load console message's text is just the generic
    // "Failed to load resource: the server responded with a status of ###"
    // — the actual URL only lives on msg.location().url, so ignore patterns
    // matching a resource path (like KNOWN_MEJ_SESSION_ICON_404) need that
    // checked too, not just the message text.
    const location = msg.location()?.url ?? "";
    if (allIgnore.some((re) => re.test(text) || re.test(location))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = String(err);
    if (allIgnore.some((re) => re.test(text))) return;
    errors.push(text);
  });
  return errors;
}

export function assertNoConsoleErrors(errors) {
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
}
