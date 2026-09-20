# Closing the ready-time wiring window — design

Date: 2026-09-20. Status: approved in chat (approach 1, design sections 1–4),
for `writing-plans`. Parent: the 0.20.0 branch `feat/native-shell-shim`; this
is follow-up 2 of `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md`
(cause J's addendum records the second, shorter window).

## 1. Problem

Every sheet-class registration and the shell shim hang off the companion's
`ready` hook (`scripts/integrations/mej-adapter.mjs` `wireForReady()`), and in
native mode the ready path awaits `registerCore()` — about a dozen sequential
dynamic imports — *before* `wireNativeMode()` registers the sheets and
installs the shim. Measured on Foundry 13.351 + stock MEJ 13.06 (2026-09-20,
fresh seats, this machine): sheet registration 430–924 ms after the ready
hook, shim 20–35 ms after that; the sweep's module-heavy boot measured 1–3 s.
During that window:

- a Session opened by any path resolves to core's `BaseSheet` (no registration
  yet) and MEJ's v1/v2 test throws `sheet.getData is not a function`;
- once registered but before the shim, a Session or portal opened through MEJ
  fails the shell's demotion gate and renders inside MEJ's `JournalEntrySheet`
  wrapper (cause J).

The e2e harness now waits for both (0.20.0 follow-up wave), so the suite is
honest, but a GM or player who clicks a Session in the first second of a
native-mode client still meets it.

User decisions (2026-09-20): acceptance target 2 — shrink the window below
what a human can hit AND close what remains by construction (an early open is
deferred until the wiring completes); no "still starting" UI. Approach 1:
early registration plus a ready gate on MEJ's `openJournalEntry`.

## 2. Facts the design rests on

| fact | where |
|---|---|
| Foundry queues `DocumentSheetConfig.registerSheet` calls made before `game.ready` and drains the queue once, in `setupGame()` after the `setup` hook and before `ready` (`initializeSheets()`) | 13.351 `foundry.mjs:35585-35592`, `:169118`; 14.368 `:206408` (setup hook `:206384`) |
| A registration that lands after that drain but before `ready` is dropped; `ensureSheetRegistrations()` repairs it at ready | adapter `ensureSheetRegistrations`, onHandshake's comment |
| MEJ assigns `game.MonksEnhancedJournal` in its `init` hook; by the companion's `setup` hook the class and its static `openJournalEntry` exist | survey §5 "Timing"; MEJ 13.06 `monks-enhanced-journal.js:4323` |
| `MonksEnhancedJournal.openJournalEntry(doc, options)` is `static async` on 13.06 (`:2310`), 14.01 (`:2357`) and the fork (`:2519`); every caller either awaits it or tests its (truthy) promise | MEJ sources |
| The companion's sheet modules statically import MEJ's `EnhancedJournalSheet.js`; a *dynamic* import at `init` is safe because MEJ's module has been evaluated before any hook fires (only a top-level static import re-enters MEJ's chain) | `campaign-companion.mjs` header, `wireApiMode`'s comment |
| The companion's own `readyWiring` promise resolves in `onReady()`'s `finally`, wiring success or failure alike | adapter `:395-404` |
| `installWraps(specs, env)` installs a list of `{name, object, key, path?, wrapper}` wraps atomically, libWrapper when active, manual otherwise | `scripts/logic/mej-wraps.mjs` |
| Boot on this machine: init → ready ≈ 980 ms, setup → ready ≈ 210 ms | probe 2026-09-20 |

## 3. Design

### 3.1 One registration site: `registerCompanionSheets(classes)`

In `mej-adapter.mjs`, a single idempotent function replaces the four copies of
the `registerSheet` calls (init-time path below, `wireNativeMode`,
`wireApiMode`, `ensureSheetRegistrations`):

```js
/**
 * Register every companion sheet class that is not yet in CONFIG. Safe to
 * call any number of times, before or after ready (pre-ready calls queue in
 * Foundry's one-time drain; post-ready calls apply immediately).
 * @param {{SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet}} classes
 * @returns {{session:boolean, hub:boolean, campaign:boolean, media:boolean, timeline:boolean}} what was registered
 */
export function registerCompanionSheets({ SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet })
```

Body: compute `missing` exactly as `ensureSheetRegistrations()` does today
(`missingSheetRegistrations(...)` plus `missingOwnRegistration` for the
timeline), then perform only the missing registrations with the existing
option objects (session: `makeDefault`; campaign: `makeDefault`,
`canBeDefault`, `canConfigure: false`; hub via `registerHubSheetClass`; media
via `registerMediaSheetClass`; timeline via `registerTimelineSheetClass`).
Return the `missing` object it acted on.

`ensureSheetRegistrations()` becomes: import the four classes, call
`registerCompanionSheets`, log the returned object when anything was
registered (keeping today's "re-registering sheet classes Foundry dropped
before ready" line). `wireNativeMode()` and `wireApiMode()` no longer call
`registerSheet`/`registerHubSheetClass`/`registerMediaSheetClass` themselves;
`wireApiMode` keeps `api.registerSheetType` (×2) and `api.registerShellPage`.

### 3.2 Early registration at `init`

New exported `registerSheetsEarly()` in `mej-adapter.mjs`, called from
`campaign-companion.mjs`'s existing `Hooks.once("init")` handler, last in
that handler, guarded by `game.modules.get("monks-enhanced-journal")?.active`
(absent mode registers nothing, as today):

```js
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

Not awaited by the hook (Foundry does not await hook handlers). On a normal
boot the imports resolve well inside the ~750 ms between `init` and the
drain, so the registrations are in CONFIG when `ready` flips; if they resolve
after the drain, `ensureSheetRegistrations()` at ready repairs them exactly
as today. `earlySheets` is a module-level promise the ready path awaits so
the classes are imported once; `wireNativeMode`, `wireApiMode` and
`ensureSheetRegistrations` take their classes from it (falling back to a
fresh import when it resolved `null`).

### 3.3 The ready gate at `setup`

New module `scripts/integrations/ready-gate.mjs`:

```js
import { installWraps } from "../logic/mej-wraps.mjs";
import { MODULE_ID } from "../constants.mjs";

/**
 * Hold every MEJ openJournalEntry call until the companion's ready-time
 * wiring has finished, then delegate. Pass-through once the promise has
 * resolved (an already-resolved await costs one microtask).
 * @param {Promise<unknown>} readyWiring the adapter's readyWiring promise
 * @returns {{installed:boolean}}
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

`wrapEnv(label)` is the shim's private `env()` (`shell-shim.mjs:19-26`:
`{libWrapperModule, libWrapper, moduleId, warn}`) moved to a new shared
module `scripts/integrations/wrap-env.mjs` and parameterised by the label
used in its warn prefix (`shell shim` today; `ready gate` here);
`shell-shim.mjs` imports it instead of keeping its own copy. Pure gate logic
for the unit test lives in `scripts/logic/ready-gate-logic.mjs`:

```js
/** The wrapper body, free of Foundry: await the gate, then delegate. */
export function gatedCall(gate, wrapped, args) { return gate.then(() => wrapped(...args)); }
```

and `installReadyGate` uses it (imported alongside `wrapEnv`). `campaign-companion.mjs` gains
`Hooks.once("setup", () => { if (game.modules.get("monks-enhanced-journal")?.active) installReadyGate(readyWiring); })`
with `readyWiring` exported from the adapter (today it is module-private).

The gate is installed in api mode too: there the wiring also completes at
`ready` (`onReady` → `wireForReady`), so a pre-ready call from MEJ's own ready
hook (e.g. its open-on-load setting) simply waits for the companion's ready
hook to finish. Never installed in absent mode. The gate is never
uninstalled; after resolution it is a one-microtask pass-through.

### 3.4 Native ready path reorder

`wireForReady()` native branch becomes:

```js
await registerCore()          // moves BELOW
```
→
```js
await step("native-mode wiring", () => wireNativeMode());        // shim first
await step("sheet registration check", () => ensureSheetRegistrations());
await registerCore();
```

`wireNativeMode()` keeps: import (via `earlySheets`), `hosting = "window"`,
the shim install under `shellHostingWanted()`. It drops its registration
calls (§3.1). The api branch keeps its order (`ensureSheetRegistrations` then
return) — `registerCore` already ran at the handshake there.

### 3.5 Out of scope

- A "still starting" UI (target 3, not chosen).
- Gating the Hub button: `openHub()` already awaits `readyWiring`.
- Any change to the shim's four wraps or to MEJ.

## 4. Behaviour by mode

| mode | init | setup | ready |
|---|---|---|---|
| absent | nothing | nothing | as today (inert, error notification) |
| native | imports start; sheets registered when they resolve | gate installed | shim → repair → core; gate releases |
| api | same as native | gate installed; MEJ's handshake fires later in setup and `wireApiMode` registers the api types | repair; gate releases |
| native, shim fails | same | same | window hosting + console warning as today; gate releases (finally) |

## 5. Testing and acceptance

Unit (`test/sheet-registration-site.test.js`, `test/ready-gate-logic.test.js`):
- `registerCompanionSheets` with a stubbed `foundry.applications.apps.DocumentSheetConfig.registerSheet` and stubbed `CONFIG`: registers everything on an empty registry, nothing on a full one, only the missing entries on a partial one; returns the `missing` object.
- `gatedCall`: does not call `wrapped` until the gate resolves; calls it exactly once with the same arguments and returns its value; a rejected gate does not call it and rejects; an already-resolved gate delegates on the next microtask.

E2E (`tests/e2e/13-stock-smoke.spec.mjs`, both stock targets, and
`12-native-mode.spec.mjs` where it already covers the race):
- New stock-gate test "an open issued the instant the client is ready lands as the shell subsheet": an `addInitScript` polls for `game.ready === true` and immediately calls `game.MonksEnhancedJournal.openJournalEntry(<TT- fixture entry>)`; the test then asserts the shell's subsheet is `SessionSheet`, no `.journal-entry-pages` wrapper, no companion console errors, and records how long the call was held (annotation).
- The existing Hub-open race test records boot-timing annotations (ready hook → sheet registration, ready hook → shim visible, via the same init-script probe as the 2026-09-20 measurement) and asserts one ordering fact: the session sheet registration is present in CONFIG before the companion's ready wiring resolves.
- Regression nets: Foundry 13 full suite (`npm run e2e:v13`), Foundry 14 api-mode full suite; both stock gates 11/11 (10 + the new test); `npm test`; `npm run check:links`.

Acceptance numbers to record (not asserted): on this machine, ready hook →
shim visible under 100 ms on all seats.

## 6. Docs

- `README.md` native-mode paragraph: one sentence that the companion's sheets
  are registered at init and an early click waits for the shell adaptation
  instead of opening a broken sheet.
- `CHANGELOG.md` 0.20.0: `**Fixed:** a Session or campaign portal opened in
  the first second after login could render as a broken or wrapped sheet; the
  companion now registers its sheets at init, installs the shell adaptation
  first, and holds an early open until it is ready.`
- Sweep report: follow-up 2 closed with the before/after timings; cause J's
  addendum points here.

## 7. Amendments

A1 (final review, 2026-09-20): §3.3's gate holds only companion documents — a
module-prefixed page, an entry holding one, or an argument that is not a
document — via `needsReadyGate` (scripts/logic/ready-gate-logic.mjs); plain
MEJ documents pass straight through. Reason: the window only ever
mis-rendered companion content, and holding MEJ-only pages for the whole
ready wiring (571–911 ms measured) was a pure regression. Reverting to
hold-everything is a one-line change in the wrapper.
