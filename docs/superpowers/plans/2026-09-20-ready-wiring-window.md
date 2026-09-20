# Closing the Ready-Time Wiring Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Session or campaign portal opened in the first second after login render correctly, by registering the companion's sheet classes at init, installing the shell shim before the core-feature imports, and holding any early MEJ open until the ready-time wiring has finished.

**Architecture:** One idempotent registration site in the adapter (`registerCompanionSheets`) fed by an init-time import (`registerSheetsEarly`); a setup-time gate wrap on `game.MonksEnhancedJournal.openJournalEntry` (`installReadyGate`, built on the existing `installWraps` and a pure `gatedCall`); and the native ready path reordered to shim → repair → core. Nothing in MEJ changes.

**Tech Stack:** Foundry VTT 13.351 / 14.368 client hooks (`init`, `setup`, `ready`), `DocumentSheetConfig.registerSheet` and its pre-ready queue, Monk's Enhanced Journal 13.06 / 14.01 / fork, libWrapper-or-manual wraps (`scripts/logic/mej-wraps.mjs`), vitest, Playwright e2e harness.

**Spec:** `docs/superpowers/specs/2026-09-20-ready-wiring-window-design.md`

Plan-level refinement of spec §5 (testability): the unit test for the registration site covers a new pure planner `planSheetRegistrations(...)` in `scripts/logic/sheet-registration.mjs` (the "what is missing" decision), and the adapter's `registerCompanionSheets` performs whatever the planner returns; the adapter module imports Foundry-touching hooks at load and cannot be imported by vitest. The e2e gates exercise the performing half.

## Global Constraints

- Branch `feat/native-shell-shim` in the worktree `.claude/worktrees/native-shell-shim`; every commit message ends with the `Co-Authored-By` / `Claude-Session` trailers in force for this session.
- Companion features never patch MEJ or Foundry: only companion files change.
- Absent mode (MEJ inactive) registers nothing and installs nothing, at every hook — spec §4.
- Sheet registrations go through `foundry.applications.apps.DocumentSheetConfig.registerSheet` (never by poking `CONFIG`), with exactly today's option objects — spec §3.1.
- The gate wraps `game.MonksEnhancedJournal.openJournalEntry` only, is installed at `setup` in api and native mode, is never uninstalled, and delegates with the same arguments and `this` — spec §3.3.
- Native ready order after the change: `wireNativeMode()` (shim), `ensureSheetRegistrations()`, `registerCore()` — spec §3.4. Api order unchanged.
- The shim's four wraps are untouched — spec §3.5.
- Fixture names in tests are `TT-` prefixed only; never named after real campaign content.
- Regression nets before the plan is complete: `npm run e2e:v13` (Foundry 13 full suite, world-b), the Foundry 14 api-mode full suite (`npx playwright test --trace off`, world-a), both stock gates green (11/11 with the new test), `npm test`, `npm run check:links`. On Foundry 13 the only permitted failures are the ones the sweep report already attributes (`06-player-collab:231` at most once; the `mej-13.06`/`platform` rows).

---

### Task 1: Pure gate logic, shared wrap environment, `installReadyGate`

**Files:**
- Create: `scripts/logic/ready-gate-logic.mjs`
- Create: `scripts/integrations/wrap-env.mjs`
- Create: `scripts/integrations/ready-gate.mjs`
- Modify: `scripts/integrations/shell-shim.mjs:17-27` (the private `env()`), `:136`, `:147` (its two call sites)
- Test: `test/ready-gate-logic.test.js`

**Interfaces:**
- Consumes: `installWraps(specs, env)` from `scripts/logic/mej-wraps.mjs` (returns `{installed: string[], failed: string|null, records}`); `MODULE_ID` from `scripts/constants.mjs`.
- Produces: `gatedCall(gate: Promise<unknown>, wrapped: Function, args: unknown[]): Promise<unknown>`; `wrapEnv(label: string): {libWrapperModule, libWrapper, moduleId, warn}`; `installReadyGate(readyWiring: Promise<unknown>): {installed: boolean}`. Task 3 calls `installReadyGate`.

- [ ] **Step 1: Write the failing test**

```js
// test/ready-gate-logic.test.js
import { describe, it, expect } from "vitest";
import { gatedCall } from "../scripts/logic/ready-gate-logic.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("gatedCall", () => {
  it("does not call wrapped until the gate resolves, then calls it once with the same args and returns its value", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    const wrapped = (...a) => { calls.push(a); return "opened"; };
    const p = gatedCall(gate, wrapped, ["doc", { newtab: true }]);
    await tick();
    expect(calls).toEqual([]);
    release();
    await expect(p).resolves.toBe("opened");
    expect(calls).toEqual([["doc", { newtab: true }]]);
  });

  it("delegates on the next microtask when the gate is already resolved", async () => {
    const calls = [];
    const p = gatedCall(Promise.resolve(), (...a) => { calls.push(a); return 1; }, []);
    expect(calls).toEqual([]);
    await expect(p).resolves.toBe(1);
    expect(calls).toEqual([[]]);
  });

  it("propagates wrapped's rejection", async () => {
    await expect(gatedCall(Promise.resolve(), async () => { throw new Error("mej said no"); }, [])).rejects.toThrow("mej said no");
  });

  it("never calls wrapped when the gate rejects", async () => {
    const calls = [];
    await expect(gatedCall(Promise.reject(new Error("wiring")), () => { calls.push(1); }, [])).rejects.toThrow("wiring");
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/ready-gate-logic.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/ready-gate-logic.mjs`.

- [ ] **Step 3: Write the pure logic**

```js
// scripts/logic/ready-gate-logic.mjs
// The body of the ready gate's wrapper (spec 2026-09-20-ready-wiring-window
// §3.3), free of Foundry so vitest can pin it: hold the call until the gate
// resolves, then delegate once with the caller's arguments and hand back
// whatever the wrapped function returns (MEJ's openJournalEntry is async on
// every supported build, so callers already await or truthy-test a promise).

/**
 * @param {Promise<unknown>} gate     resolves when the companion's ready-time wiring is done
 * @param {Function} wrapped          the original function, already bound to its `this`
 * @param {unknown[]} args            the caller's arguments, passed through unchanged
 * @returns {Promise<unknown>}
 */
export function gatedCall(gate, wrapped, args) {
  return gate.then(() => wrapped(...args));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/ready-gate-logic.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Extract the shared wrap environment**

Create `scripts/integrations/wrap-env.mjs`:

```js
// The `env` every companion wrap installer hands to installWraps
// (scripts/logic/mej-wraps.mjs): libWrapper when the lib-wrapper module is
// active, the manual prototype patch otherwise, and a warn() that prefixes
// the installer's name. Shared by the shell shim and the ready gate so both
// report the same way.
import { MODULE_ID } from "../constants.mjs";

/**
 * @param {string} label the installer's name for warn prefixes ("shell shim", "ready gate")
 */
export function wrapEnv(label) {
  return {
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    warn: (msg, err) => console.warn(`${MODULE_ID} | ${label}: ${msg}`, err ?? "")
  };
}
```

In `scripts/integrations/shell-shim.mjs` delete the private `env()` function (lines 19-26, the block starting `function env() {` and ending with its closing `}`), add `import { wrapEnv } from "./wrap-env.mjs";` next to the other imports at the top, and replace the two calls `installWraps(specs, env())` and `uninstallWraps(records, env())` with `installWraps(specs, wrapEnv("shell shim"))` and `uninstallWraps(records, wrapEnv("shell shim"))`. Run `node --check scripts/integrations/shell-shim.mjs` — expected: no output.

- [ ] **Step 6: Write `installReadyGate`**

```js
// scripts/integrations/ready-gate.mjs
// Hold every MEJ openJournalEntry call until the companion's ready-time
// wiring has finished (spec 2026-09-20-ready-wiring-window §3.3). Installed
// from the setup hook — MEJ assigns game.MonksEnhancedJournal in its init
// hook, so the static method exists by then — and never uninstalled: once
// readyWiring has resolved the wrapper costs one microtask and delegates.
// The gate closes what early registration and the shim-first ready order
// cannot: the last few tens of milliseconds between the ready hook and the
// shim, in which a click used to land in MEJ's JournalEntrySheet wrapper.
import { installWraps } from "../logic/mej-wraps.mjs";
import { gatedCall } from "../logic/ready-gate-logic.mjs";
import { wrapEnv } from "./wrap-env.mjs";
import { MODULE_ID } from "../constants.mjs";

/**
 * @param {Promise<unknown>} readyWiring the adapter's readyWiring promise (resolves in onReady's finally)
 * @returns {{installed: boolean}}
 */
export function installReadyGate(readyWiring) {
  const mej = game.MonksEnhancedJournal;
  if (typeof mej?.openJournalEntry !== "function") {
    console.warn(`${MODULE_ID} | ready gate not installed: MEJ has no openJournalEntry`);
    return { installed: false };
  }
  const result = installWraps([{
    name: "openJournalEntry", object: mej, key: "openJournalEntry",
    path: "game.MonksEnhancedJournal.openJournalEntry",
    wrapper(wrapped, ...args) { return gatedCall(readyWiring, wrapped, args); }
  }], wrapEnv("ready gate"));
  return { installed: result.installed.length === 1 };
}
```

Run `node --check scripts/integrations/ready-gate.mjs scripts/integrations/wrap-env.mjs` — expected: no output.

- [ ] **Step 7: Unit suite still green**

Run: `npm test`
Expected: all files pass (the shell-shim change is a pure refactor; `test/mej-wraps.test.js` still passes).

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/ready-gate-logic.mjs test/ready-gate-logic.test.js scripts/integrations/wrap-env.mjs scripts/integrations/ready-gate.mjs scripts/integrations/shell-shim.mjs
git commit -m "feat(integration): ready gate on MEJ's openJournalEntry, shared wrap environment"
```

---

### Task 2: One registration site, early registration at init, native ready order

**Files:**
- Modify: `scripts/logic/sheet-registration.mjs` (append `planSheetRegistrations`)
- Modify: `scripts/integrations/mej-adapter.mjs:30-31` (export `readyWiring`), `:160-206` (`wireApiMode`), `:255-306` (`ensureSheetRegistrations`), `:308-366` (`wireNativeMode`), `:407-432` (`wireForReady`), plus new `registerCompanionSheets`, `registerSheetsEarly`, `earlySheets`, `companionSheetClasses()`
- Modify: `scripts/campaign-companion.mjs:11` (import) and the end of the `Hooks.once("init")` handler (after `registerRecapRefresh();`)
- Test: `test/sheet-registration.test.js` (append)

**Interfaces:**
- Consumes: `missingSheetRegistrations`, `missingOwnRegistration` (existing, same file); `registerHubSheetClass`, `registerMediaSheetClass`, `registerTimelineSheetClass` (existing adapter exports).
- Produces: `planSheetRegistrations(pageSheetClasses, entrySheetClasses, {sessionType, hubType, campaignType, mediaTypes, ownerScope}) → {session, hub, campaign, media, timeline}` (true = register); `registerCompanionSheets(classes) → same shape (what it registered)`; `registerSheetsEarly(): void`; exported `readyWiring: Promise<unknown>` (Task 3 passes it to the gate).

- [ ] **Step 1: Write the failing test**

Append to `test/sheet-registration.test.js` (create it if absent, with the same two imports):

```js
import { describe, it, expect } from "vitest";
import { planSheetRegistrations } from "../scripts/logic/sheet-registration.mjs";

const TYPES = { sessionType: "mej-campaign-companion.session", hubType: "campaign-hub", campaignType: "mej-campaign-companion.campaign", mediaTypes: ["pdf", "video"], ownerScope: "mej-campaign-companion" };

describe("planSheetRegistrations", () => {
  it("registers everything on an empty registry", () => {
    expect(planSheetRegistrations({}, {}, TYPES)).toEqual({ session: true, hub: true, campaign: true, media: true, timeline: true });
  });

  it("registers nothing when every companion registration is present", () => {
    const pages = {
      "mej-campaign-companion.session": { "mej-campaign-companion.SessionSheet": {} },
      "campaign-hub": { "mej-campaign-companion.CampaignHubPage": {} },
      "mej-campaign-companion.campaign": { "mej-campaign-companion.CampaignHubPage": {} },
      pdf: { "core.JournalEntryPagePDFSheet": {}, "mej-campaign-companion.MediaPageSheet": {} },
      video: { "core.JournalEntryPageVideoSheet": {}, "mej-campaign-companion.MediaPageSheet": {} }
    };
    const entries = { base: { "core.JournalEntrySheet": {}, "mej-campaign-companion.TimelineJournalSheet": {} } };
    expect(planSheetRegistrations(pages, entries, TYPES)).toEqual({ session: false, hub: false, campaign: false, media: false, timeline: false });
  });

  it("registers only what is missing on a partial registry (core's own media and base entries do not count)", () => {
    const pages = {
      "mej-campaign-companion.session": { "mej-campaign-companion.SessionSheet": {} },
      pdf: { "core.JournalEntryPagePDFSheet": {} },
      video: { "core.JournalEntryPageVideoSheet": {}, "mej-campaign-companion.MediaPageSheet": {} }
    };
    const entries = { base: { "core.JournalEntrySheet": {} } };
    expect(planSheetRegistrations(pages, entries, TYPES)).toEqual({ session: false, hub: true, campaign: true, media: true, timeline: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/sheet-registration.test.js`
Expected: FAIL — `planSheetRegistrations` is not exported.

- [ ] **Step 3: Write the planner**

Append to `scripts/logic/sheet-registration.mjs`:

```js
/**
 * Everything the companion must (re)register, in one answer: the page-sheet
 * checks above plus the timeline redirect sheet on CONFIG.JournalEntry. The
 * adapter's single registration site (registerCompanionSheets) performs
 * exactly what this returns, so init-time registration, the mode wiring and
 * the ready-time repair can all call it without double-registering.
 * @param {object} pageSheetClasses  CONFIG.JournalEntryPage.sheetClasses (or a lookalike)
 * @param {object} entrySheetClasses CONFIG.JournalEntry.sheetClasses (or a lookalike)
 * @param {{sessionType:string, hubType:string, campaignType:string, mediaTypes:string[], ownerScope:string}} types
 * @returns {{session:boolean, hub:boolean, campaign:boolean, media:boolean, timeline:boolean}} true = register
 */
export function planSheetRegistrations(pageSheetClasses, entrySheetClasses, { sessionType, hubType, campaignType, mediaTypes, ownerScope }) {
  const missing = missingSheetRegistrations(pageSheetClasses, sessionType, hubType, campaignType, mediaTypes, ownerScope);
  missing.timeline = missingOwnRegistration(entrySheetClasses, "base", ownerScope);
  return missing;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/sheet-registration.test.js`
Expected: PASS (the three new tests plus any existing ones in the file).

- [ ] **Step 5: The adapter — single registration site and early import**

In `scripts/integrations/mej-adapter.mjs`:

(a) Change the import line `import { missingSheetRegistrations, missingOwnRegistration } from "../logic/sheet-registration.mjs";` to `import { planSheetRegistrations } from "../logic/sheet-registration.mjs";`.

(b) Replace

```js
let readyWired;
const readyWiring = new Promise((resolve) => { readyWired = resolve; });
```

with

```js
let readyWired;
/** Resolves when onReady() has finished wiring (success or failure). The ready gate (ready-gate.mjs) holds MEJ opens on it. */
export const readyWiring = new Promise((resolve) => { readyWired = resolve; });

// The sheet classes, imported once at init (registerSheetsEarly). Resolves to
// the class map, or to null when the import failed - every later consumer
// falls back to a fresh import then.
let earlySheets = null;
```

(c) Directly ABOVE the existing `/** Repair sheet registrations Foundry's pre-ready registerSheet queue may` doc comment, add:

```js
/**
 * The one place companion sheet classes are registered. Idempotent: performs
 * only what planSheetRegistrations() reports missing, so init-time
 * registration, the mode wiring and the ready-time repair can all call it.
 * Pre-ready calls queue in Foundry's one-time drain; post-ready calls apply
 * immediately (spec 2026-09-20-ready-wiring-window §3.1).
 * @param {{SessionSheet:Function, CampaignHubPage:Function, MediaPageSheet:Function, TimelineJournalSheet:Function}} classes
 * @returns {{session:boolean, hub:boolean, campaign:boolean, media:boolean, timeline:boolean}} what was registered
 */
export function registerCompanionSheets({ SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet }) {
  const missing = planSheetRegistrations(CONFIG.JournalEntryPage.sheetClasses, CONFIG.JournalEntry.sheetClasses, {
    sessionType: SESSION_DOCUMENT_TYPE, hubType: HUB_PAGE_ID, campaignType: CAMPAIGN_DOCUMENT_TYPE,
    mediaTypes: MEDIA_PAGE_TYPES, ownerScope: MODULE_ID
  });
  if (missing.session) {
    // Pure core Foundry - no MEJ involvement. The subtype itself comes from
    // module.json's documentTypes declaration, so this only says "when
    // Foundry opens a page of that type, use our sheet".
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, SessionSheet, {
      types: [SESSION_DOCUMENT_TYPE],
      makeDefault: true,
      label: `${I18N}.sheettype.session`
    });
  }
  if (missing.hub) registerHubSheetClass(CampaignHubPage);
  if (missing.campaign) {
    // Campaign portal pages: the portal's sheet IS the Hub - makeDefault /
    // canBeDefault so a core sidebar click opens it directly.
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
      types: [CAMPAIGN_DOCUMENT_TYPE],
      makeDefault: true,
      canBeDefault: true,
      canConfigure: false,
      label: `${I18N}.sheettype.campaign`
    });
  }
  if (missing.media) registerMediaSheetClass(MediaPageSheet);
  if (missing.timeline) registerTimelineSheetClass(TimelineJournalSheet);
  return missing;
}

/** The four sheet classes: from the init-time import when it succeeded, else imported now. */
async function companionSheetClasses() {
  const early = earlySheets ? await earlySheets : null;
  if (early) return early;
  const [{ SessionSheet }, { CampaignHubPage }, { MediaPageSheet }, { TimelineJournalSheet }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs"),
    import("../sheets/MediaPageSheet.mjs"),
    import("../sheets/TimelineJournalSheet.mjs")
  ]);
  return { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet };
}

/**
 * Called from the init hook when MEJ is active (spec §3.2). Starts the sheet
 * imports and registers the classes the moment they resolve - on a normal
 * boot well before Foundry's one-time pre-ready drain, so the registrations
 * exist when game.ready flips; if the imports resolve after the drain the
 * ready-time repair (ensureSheetRegistrations) picks them up as before. Not
 * awaited by the hook: Foundry does not await hook handlers. Dynamic, not
 * static, imports: these files statically import MEJ's EnhancedJournalSheet.js,
 * which is safe to load only after MEJ's own module has been evaluated - true
 * for every hook, never at our script's top level.
 */
export function registerSheetsEarly() {
  earlySheets = Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs"),
    import("../sheets/MediaPageSheet.mjs"),
    import("../sheets/TimelineJournalSheet.mjs")
  ]).then(([{ SessionSheet }, { CampaignHubPage }, { MediaPageSheet }, { TimelineJournalSheet }]) => {
    const classes = { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet };
    registerCompanionSheets(classes);
    return classes;
  }).catch((err) => {
    console.warn(`${MODULE_ID} | early sheet registration failed; the ready-time repair will retry`, err);
    return null;
  });
}
```

(d) Replace the whole body of `ensureSheetRegistrations()` (from `const missing = missingSheetRegistrations(` through the closing `}` of the function, i.e. everything after the doc comment) with:

```js
async function ensureSheetRegistrations() {
  const classes = await companionSheetClasses();
  const registered = registerCompanionSheets(classes);
  if (Object.values(registered).some(Boolean)) {
    console.log(`${MODULE_ID} | re-registering sheet classes Foundry dropped before ready`, registered);
  }
}
```

(e) In `wireApiMode(api)`: replace the `Promise.all([...])` import block (the `const [{ SessionSheet }, { CampaignHubPage }, { MediaPageSheet }] = await Promise.all([` statement and its three imports) with `const { SessionSheet, CampaignHubPage } = await companionSheetClasses();`, keep the two `api.registerSheetType({...})` calls and `api.registerShellPage({...})` unchanged, and delete the trailing `registerHubSheetClass(CampaignHubPage);` and `registerMediaSheetClass(MediaPageSheet);` lines together with the comment block above them (the one beginning `// Foundry's DocumentSheetV2 machinery needs an entry in`). Registration is now `registerCompanionSheets`' job (early, then the ready repair).

(f) In `wireNativeMode()`: replace the `Promise.all` import block with `const { SessionSheet, CampaignHubPage } = await companionSheetClasses();` and delete everything from the comment `// Pure core Foundry - no MEJ involvement.` down to and including `registerMediaSheetClass(MediaPageSheet);` (the two `registerSheet` calls, `registerHubSheetClass(CampaignHubPage);`, `registerMediaSheetClass(MediaPageSheet);` and their comments). Keep `hosting = "window";` and the shim block unchanged. Also remove the now-unused `MediaPageSheet` from the destructuring if your editor flags it.

(g) In `wireForReady()`, native branch: replace

```js
  await registerCore();
  await step("native-mode wiring", () => wireNativeMode());
  await step("sheet registration check", () => ensureSheetRegistrations());
  return mode;
```

with

```js
  // Shim first, core features second (spec 2026-09-20-ready-wiring-window
  // §3.4): registerCore() awaits a dozen sequential dynamic imports, and
  // the shim used to wait behind all of them - 430-924 ms after the ready
  // hook on 2026-09-20's measurement. The sheet classes are registered at
  // init (registerSheetsEarly) and repaired here if that import lost the
  // race with Foundry's pre-ready drain.
  await step("native-mode wiring", () => wireNativeMode());
  await step("sheet registration check", () => ensureSheetRegistrations());
  await registerCore();
  return mode;
```

Run `node --check scripts/integrations/mej-adapter.mjs` — expected: no output. Then `grep -n "registerSheet(JournalEntryPage" scripts/integrations/mej-adapter.mjs` — expected: exactly four hits, all inside `registerCompanionSheets`, `registerHubSheetClass`, `registerMediaSheetClass` (and `registerTimelineSheetClass` for `JournalEntry`).

- [ ] **Step 6: Call it from init**

In `scripts/campaign-companion.mjs`, extend the adapter import on line 11 to
`import { onHandshake, onReady, currentMode, wiringFailed, openHub, mejType, healSessionFlags, registerSheetsEarly } from "./integrations/mej-adapter.mjs";`
and, inside the `Hooks.once("init", () => { ... })` handler, directly after the line `registerRecapRefresh();`, add:

```js
  // Sheet classes at init, not ready (spec 2026-09-20-ready-wiring-window
  // §3.2): the imports start now and register the moment they resolve, so a
  // Session opened in the first second after login resolves to our sheet
  // instead of core's BaseSheet. Absent mode stays inert.
  if (game.modules.get("monks-enhanced-journal")?.active) registerSheetsEarly();
```

Run `node --check scripts/campaign-companion.mjs` — expected: no output.

- [ ] **Step 7: Unit suite and a live smoke on both generations**

Run: `npm test` — expected: all files pass.

Foundry 13 (server on world-b, port 30013 — global setup starts it if needed):
`FOUNDRY_TARGET=v13 npx playwright test tests/e2e/12-native-mode.spec.mjs tests/e2e/00-mej-api.spec.mjs --trace off --reporter=line`
Expected: every test passes or is skipped as before (12-native-mode's fork-only test skips on stock).

Foundry 14 (server on world-a, port 30000, fork-line MEJ), only after the Foundry 13 run has finished:
`npx playwright test tests/e2e/12-native-mode.spec.mjs tests/e2e/00-mej-api.spec.mjs tests/e2e/01-session.spec.mjs --trace off --reporter=line`
Expected: all pass (api-mode registration now comes from the early path plus the repair; `00-mej-api` asserts the session type still opens with its sheet).

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/sheet-registration.mjs test/sheet-registration.test.js scripts/integrations/mej-adapter.mjs scripts/campaign-companion.mjs
git commit -m "feat(adapter): one sheet-registration site, registered at init; native ready path installs the shim first

registerCompanionSheets() performs only what planSheetRegistrations()
reports missing, so the init-time import (registerSheetsEarly), both mode
wirings and the ready-time repair share one site. In native mode the ready
path now runs the shim before registerCore()'s dozen sequential imports
(430-924 ms after the ready hook on 2026-09-20's measurement)."
```

---

### Task 3: Gate at setup, e2e proof on both stock targets, regression nets, docs

**Files:**
- Modify: `scripts/campaign-companion.mjs` (new `Hooks.once("setup")` after the init handler; import)
- Modify: `tests/e2e/13-stock-smoke.spec.mjs` (the Hub-open race test at `:451`; a new test after "New Session creates the fixture…" at `:476` and before "Hub search finds…" at `:562`; the header comment's test list)
- Modify: `README.md` (native-mode paragraph), `CHANGELOG.md` (0.20.0 list), `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md` (follow-up 2; cause J addendum), `tests/e2e/README.md` (stock-gate test list if it enumerates the tests)
- Test: the two stock gates, `npm run e2e:v13`, the Foundry 14 api-mode suite

**Interfaces:**
- Consumes: `installReadyGate(readyWiring)` from `scripts/integrations/ready-gate.mjs` (Task 1); exported `readyWiring` from the adapter (Task 2).
- Produces: nothing for later tasks.

- [ ] **Step 1: Install the gate at setup**

In `scripts/campaign-companion.mjs` add `import { installReadyGate } from "./integrations/ready-gate.mjs";` beside the other integration imports, extend the adapter import with `readyWiring` (`..., registerSheetsEarly, readyWiring } from "./integrations/mej-adapter.mjs";`), and directly after the closing `});` of the `Hooks.once("init", ...)` handler add:

```js
// Every MEJ openJournalEntry call is held until onReady() has finished
// wiring (spec 2026-09-20-ready-wiring-window §3.3). Setup, not init: MEJ
// assigns game.MonksEnhancedJournal in its own init hook. Both modes: in
// api mode the wiring also completes at ready. Absent mode installs nothing.
Hooks.once("setup", () => {
  if (game.modules.get("monks-enhanced-journal")?.active) installReadyGate(readyWiring);
});
```

Run `node --check scripts/campaign-companion.mjs` — expected: no output.

- [ ] **Step 2: Write the failing e2e test (both stock targets run it)**

In `tests/e2e/13-stock-smoke.spec.mjs`, after the test "New Session creates the fixture and auto-opens it as the shell's SessionSheet" and before "Hub search finds the stock-created session", add:

```js
  // Spec 2026-09-20-ready-wiring-window: an open issued the instant
  // game.ready flips - before the companion's ready hook has installed the
  // shim - must be held by the ready gate and then land as the shell's
  // SessionSheet, never as MEJ's JournalEntrySheet wrapper. The init script
  // runs on every navigation login() performs; it fires once, on the /game
  // document, when the fixture is visible in game.journal.
  test("an open issued the instant the client is ready lands as the shell subsheet", async ({ page }) => {
    await page.addInitScript((fixture) => {
      const iv = setInterval(() => {
        const g = globalThis.game;
        if (!g?.ready) return;
        clearInterval(iv);
        const entry = g.journal?.find((e) => e.name === fixture);
        const MEJ = g.MonksEnhancedJournal;
        const shimAtCall = !!MEJ?.getDocumentTypes?.()?.session;
        const calledAt = performance.now();
        const record = { entryFound: !!entry, shimAtCall, calledAt, resolvedAt: null, error: null };
        globalThis.__earlyOpen = record;
        if (!entry) return;
        Promise.resolve(MEJ.openJournalEntry(entry))
          .then(() => { record.resolvedAt = performance.now(); })
          .catch((err) => { record.error = String(err); record.resolvedAt = performance.now(); });
      }, 5);
    }, FIXTURE);
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED] });
    await login(page, "Gamemaster");

    await page.waitForFunction(() => globalThis.__earlyOpen?.resolvedAt !== null, null, { timeout: 30_000 });
    const early = await page.evaluate(() => globalThis.__earlyOpen);
    expect(early.entryFound).toBe(true);
    expect(early.error).toBeNull();
    test.info().annotations.push({
      type: "early-open",
      description: `shim visible at call: ${early.shimAtCall}; held ${Math.round(early.resolvedAt - early.calledAt)} ms`
    });

    await page.waitForFunction(() => {
      const s = game.MonksEnhancedJournal?.journal?.subsheet;
      return s?.constructor?.name === "SessionSheet" && s._state === s.constructor.RENDER_STATES.RENDERED;
    }, null, { timeout: 15_000 });
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".journal-entry-pages")).toHaveCount(0);
    await expect(shell.locator(".editor-parent[data-editor-id='recap']")).toHaveCount(1);

    const companionErrors = errors.filter((t) => t.includes(MODULE_ID));
    expect(companionErrors).toEqual([]);
    await removeShellTabs(page);
  });
```

Also extend the Hub-open race test (`:451`) so it records boot timings: before its `await login(page, "Gamemaster");` line add

```js
    await page.addInitScript((id) => {
      const t = { start: performance.now() };
      globalThis.__bootTiming = t;
      let hooked = false;
      const iv = setInterval(() => {
        const H = globalThis.Hooks;
        if (H && !hooked) { hooked = true; H.once("ready", () => { t.readyHook = performance.now(); }); }
        const sc = globalThis.CONFIG?.JournalEntryPage?.sheetClasses?.[`${id}.session`];
        if (sc && Object.keys(sc).length && t.sheetRegistered === undefined) t.sheetRegistered = performance.now();
        try { if (globalThis.game?.MonksEnhancedJournal?.getDocumentTypes?.()?.session && t.shimVisible === undefined) t.shimVisible = performance.now(); } catch {}
        if (t.readyHook !== undefined && t.sheetRegistered !== undefined && t.shimVisible !== undefined) clearInterval(iv);
      }, 5);
    }, MODULE_ID);
```

and after its final `await page.waitForSelector(".mej-cc-hub-container", ...)` add

```js
    // Spec 2026-09-20-ready-wiring-window §5: the session sheet registration
    // is in CONFIG by the time the ready wiring resolves (registered at
    // init, or repaired at ready); the timings are the run report's record.
    const timing = await page.evaluate(async (p) => {
      await (await import(p)).readyWiring;
      const t = globalThis.__bootTiming;
      const rel = (k) => (t[k] === undefined || t.readyHook === undefined) ? null : Math.round(t[k] - t.readyHook);
      return { registered: t.sheetRegistered !== undefined, sheetAfterReadyHookMs: rel("sheetRegistered"), shimAfterReadyHookMs: rel("shimVisible") };
    }, ADAPTER);
    expect(timing.registered).toBe(true);
    test.info().annotations.push({
      type: "boot-timing",
      description: `ready hook → session sheet registered: ${timing.sheetAfterReadyHookMs} ms; → shim visible: ${timing.shimAfterReadyHookMs} ms (negative = before the ready hook)`
    });
```

Update the file's header comment (the paragraph beginning `// What the stock phase asserts since the native shell shim`) with one sentence naming the early-open test, and the numbered step 1 under "Stock gate on v13" in `tests/e2e/README.md` (its parenthetical list of what the stock phase covers) to add "an open issued the instant the client is ready".

- [ ] **Step 3: Run the Foundry 13 stock gate to see the new test fail before the gate, then pass**

First confirm the failing state WITHOUT Step 1's setup hook: `git stash push scripts/campaign-companion.mjs` then
`npm run e2e:stock:v13 -- --reporter=line -g "instant the client is ready"`
Expected: FAIL (the subsheet wait times out or the wrapper count is 1 — the exact symptom depends on whether the shim had landed; either is the failure this test exists for). Then `git stash pop` and run the whole gate:
`npm run e2e:stock:v13 -- --reporter=line`
Expected: 11 stock tests pass (+3 auth setup; 4 other-phase skipped). Then the cleanup phase:
`FOUNDRY_TARGET=v13 STOCK_PHASE=cleanup npx playwright test tests/e2e/13-stock-smoke.spec.mjs --reporter=line` — expected: pass.

- [ ] **Step 4: Foundry 14 stock gate at tag 14.01, then return to the fork**

Preconditions and mechanics are in `tests/e2e/README.md` "Stock-MEJ smoke test (manual pre-release gate)" (the MEJ module worktree at `~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal`; switch it with `/Users/danbularzik/.claude/jobs/7f6f9d70/tmp/sweep/switch-mej.sh 14.01`, which stops the Foundry 14 server, clears the pack skip-worktree flags, checks out the tag and relaunches world-a; back with `/Users/danbularzik/.claude/jobs/7f6f9d70/tmp/sweep/switch-mej.sh 9569984`; back up World A first exactly as that recipe says: `cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a ~/FoundryVTT-14/backups/world-a-pre-rww-gate-$(date +%Y%m%d)` while the server is stopped). Run `STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs --reporter=line` on the tag, then switch back and run `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs --reporter=line`.
Expected: stock 11/11; return 3/3.

- [ ] **Step 5: Regression nets**

Sequentially, never overlapping:
1. `npm run e2e:v13 -- --reporter=list,json` with `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/rww-v13.json`; summarise with `node tests/e2e/helpers/summarize-run.mjs test-results/rww-v13.json rww-v13`. Expected: no failure beyond the sweep report's attributed rows (`mej-13.06`, `platform`, and `06-player-collab:231` at most once).
2. `npx playwright test --trace off --reporter=list,json` with `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/rww-v14.json` on Foundry 14 (fork line); summarise. Expected: the 0.20.0 baseline — the only failure is `09-secrets:970`.
3. `npm test`; `npm run check:links`.

Any new failure: stop and report BLOCKED with the summary table.

- [ ] **Step 6: Docs**

`README.md`, the known-differences bullet that begins `- In native mode the companion hosts the Campaign Hub and Session sheets` (around line 78) and ends with `falls back to standalone windows.`: append to that bullet the sentence "The companion registers its sheets at init and holds an early open until its shell adaptation is in place, so clicking a Session in the first second after login no longer opens a broken or wrapped sheet."

`CHANGELOG.md`, 0.20.0 list, after the GM-notes Fixed line: `- **Fixed:** a Session or campaign portal opened in the first second after login could render as a broken or wrapped sheet; the companion now registers its sheets at init, installs the shell adaptation first, and holds an early open until it is ready.`

Sweep report `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md`: change the follow-up 2 opening line `2. **Native mode wires itself after `game.ready`, and the gap is user-visible.**` to `2. **Native mode wires itself after `game.ready`, and the gap is user-visible — closed 2026-09-20.**` and append to that item: "Spec `docs/superpowers/specs/2026-09-20-ready-wiring-window-design.md`: sheets registered at init, shim installed before `registerCore()`, and a setup-time gate holds MEJ opens until the ready wiring resolves. Before: ready hook → sheet registration 430–924 ms, → shim +20–35 ms (2026-09-20, four seats). After: <the `boot-timing` annotation values from Step 3's and Step 4's runs>." — fill in the real numbers from the annotations (the `list` reporter prints them). In cause J's addendum, append "Closed by follow-up 2's spec (the gate)."

- [ ] **Step 7: Commit**

```bash
git add scripts/campaign-companion.mjs tests/e2e/13-stock-smoke.spec.mjs tests/e2e/README.md README.md CHANGELOG.md docs/superpowers/triage/2026-09-19-v13-companion-sweep.md
git commit -m "feat(integration): hold early MEJ opens on the ready gate; stock gate proves an open at game.ready lands as the shell subsheet

The gate installs at setup on both modes and releases when onReady()'s
wiring resolves. New stock-gate test issues openJournalEntry the instant
game.ready flips and asserts a rendered SessionSheet subsheet with no
JournalEntrySheet wrapper; the Hub-open race test now records ready-hook →
registration and → shim timings and asserts the registration is present by
the time the wiring resolves. Gates: v13 stock 11/11, 14.01 stock 11/11,
return 3/3; full suites at baseline."
```
