# Native-Mode Shell Hosting and Foundry 13 Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the Campaign Hub and Session sheet inside Monk's Enhanced Journal's shell on stock MEJ 13.06 and 14.01 without the extension API, fix the Foundry 13 defects found on 2026-09-19, run the full e2e suite on Foundry 13, and ship 0.20.0.

**Architecture:** Native mode keeps its name and resolution; it gains a shim of three companion-side wraps (MEJ's static `getDocumentTypes`, the shell's `findEntity`, the shell's static `onConfigureSheet`) installed at ready and uninstalled as a unit on any failure, in which case the existing standalone-window hosting is used. The Hub's placeholder document moves to its own module and answers `_getSheetClass`. Pure logic (wrap installer, type merge, shell-page ids, contrast maths, retro-link failure reporting) lives in `scripts/logic/` and is unit-tested; Foundry-facing wiring is verified by the stock-MEJ e2e gate on both builds.

**Tech Stack:** Foundry VTT 13.351 and 14.368, MEJ 13.06 / 14.01 (stock) and the fork line (api mode), libWrapper (optional, manual fallback), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-native-shell-shim-and-v13-sweep-design.md` (with amendments A1 and A2 recorded at its end). Survey of MEJ internals with line citations: `docs/superpowers/triage/2026-09-19-mej-shell-hosting-survey.md`.

## Global Constraints

- Never modify files under `monks-enhanced-journal`; MEJ defects become upstream issues or fork backlog items (spec §2).
- Wrap MEJ only through `scripts/logic/mej-wraps.mjs`; every wrap must be uninstallable and the shim must fall back to window hosting on any install failure (spec §4.1).
- 13.06's `addTab`/`open`/`activateTab` are synchronous, 14.01's are async: wrappers return exactly what the wrapped call returns (spec §4.1).
- Modes stay `api` / `native` / `absent`; api mode behaviour must not change (spec §3).
- e2e fixtures carry the `TT-` prefix and are cleaned up; world-b holds the user's campaign copy ("Radiant Citadel" by name) and must not lose it (spec §6.1).
- Recipes use absolute paths in `--dataPath=` (a `~` after `=` does not expand).
- Foundry 13 server: port 30013, world-b, node@22 at `/opt/homebrew/opt/node@22/bin/node`, app `~/FoundryVTT/FoundryVTT-Node-13.351`, data `~/FoundryVTT/Data`. Foundry 14 server: port 30000, world-a, app under `~/FoundryVTT-14`, data `~/FoundryVTT-14/Data`. Never confuse the two pids (`pgrep -f "main.js --dataPath=/Users/danbularzik/FoundryVTT/Data"` for v13).
- CHANGELOG house style: one-line intro, single-line bullets labelled `**Added:**` / `**Fixed:**` / `**Changed:**`, no test counts, no repo paths.
- PR bodies and comments carry no "Generated with Claude Code" line and no session link (user rule 2026-09-19). Commit messages keep the trailers the session reminder specifies.
- Release ceremony: release commit on the branch, merge PR with a merge commit, annotated tag on the merge commit, zip of `module.json README.md CHANGELOG.md LICENSE lang scripts styles templates vendor assets docs/gm-guide.md docs/player-guide.md docs/manual-test-checklist.md docs/images`, `gh release create <tag> --verify-tag` inside the repo, verify the `latest` manifest, restart World A, remove the worktree and branch.
- Work happens in the worktree `.claude/worktrees/native-shell-shim` on branch `feat/native-shell-shim` (already created, spec committed at 458be74).

---

## File structure

Create:
- `scripts/logic/mej-wraps.mjs` — generic install/uninstall of function wraps (libWrapper by path when available, manual patch otherwise), all-or-nothing.
- `scripts/logic/shell-shim-logic.mjs` — pure helpers: merged type map, shell-page id, placeholder detection.
- `scripts/logic/contrast.mjs` — CSS colour parsing and WCAG contrast ratio.
- `scripts/logic/retro-report.mjs` — pure message builder for failed retro-link writes.
- `scripts/apps/hub-shell-document.mjs` — `HubShellDocument` (moved from `hub-window.mjs`) plus the singleton and the sheet-class setter.
- `scripts/integrations/shell-shim.mjs` — builds the three wrap specs, installs them, exposes hosting state and the shell open path.
- `test/mej-wraps.test.js`, `test/shell-shim-logic.test.js`, `test/contrast.test.js`, `test/retro-report.test.js`.
- `docs/superpowers/triage/<date>-v13-companion-sweep.md` — sweep report.

Modify:
- `scripts/constants.mjs` — `SHELL_HOSTING_SETTING`.
- `scripts/campaign-companion.mjs` — register the client setting.
- `scripts/integrations/mej-adapter.mjs` — `currentHosting()`, `openHub()` shell path, `openSessionPage()`, native-mode heal, shim install in `wireNativeMode()`.
- `scripts/apps/hub-window.mjs` — import the document from its new module.
- `scripts/apps/CampaignHubPage.mjs` — `onNewSession` opens through the adapter.
- `scripts/hooks/retro-link.mjs` — collect failures with names, report them.
- `scripts/sheets/awaitable-render.mjs` — comment correction.
- `lang/en.json` — new strings.
- `tests/e2e/13-stock-smoke.spec.mjs`, `tests/e2e/helpers/foundry.mjs` (per-target auth dir), `package.json` (scripts), `tests/e2e/README.md`.
- `styles/campaign-companion.css` — only what the contrast check catches.
- `README.md`, `CHANGELOG.md`, `module.json`.

---

### Task 1: Make the existing v13 stock gate pass (Hub window on Foundry 13)

The v13 gate's Hub test fails today: `openHub()` → `openHubWindow()` → `CampaignHubPage.render` → Foundry 13's `DocumentSheetConfig.getSheetThemeForDocument` → `getSheetClassesForSubType` → `Object.values(undefined)` because `CONFIG.JournalEntryPage.sheetClasses["campaign-hub"]` is absent on 13.351 even though `registerHubSheetClass` ran. This task finds out why and fixes it. Nothing about the shim is needed here; the window path stays the fallback in every later task, so it must work first.

**Files:**
- Modify: `scripts/integrations/mej-adapter.mjs` (`registerHubSheetClass`, `ensureSheetRegistrations`) and/or `scripts/logic/sheet-registration.mjs`
- Test: `test/sheet-registration.test.js` (if the pure logic changes), `tests/e2e/13-stock-smoke.spec.mjs` (existing test "Hub opens from the scene-controls button with working tabs")

**Interfaces:**
- Consumes: `registerHubSheetClass(CampaignHubPage)`, `missingSheetRegistrations(sheetClasses, sessionType, hubType, campaignType, mediaTypes, ownerScope)`.
- Produces: nothing new; the v13 gate test passes.

- [ ] **Step 1: Reproduce with the gate**

Run (from the worktree root; the v13 server must be up on 30013 with world-b, or global setup starts it):
```bash
npm run e2e:stock:v13 -- --trace off 2>&1 | tail -40
```
Expected: "Hub opens from the scene-controls button with working tabs" FAILS with a timeout waiting for `[id^="CampaignHubPage-"]`, and the console shows `opening the campaign hub failed TypeError: Cannot convert undefined or null to object … getSheetClassesForSubType`. Record the failing test list in the ledger.

- [ ] **Step 2: Probe the registry on 13.351**

Write `tests/e2e/probes/hub-sheet-class-v13.mjs` (git-ignored directory is fine; if `tests/e2e/probes/` does not exist, create it and add it to `.gitignore`):
```js
import { chromium } from "playwright";
import { login, MODULE_ID } from "../helpers/foundry.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await login(page, "Gamemaster");
await page.waitForFunction(() => game?.ready === true, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const out = await page.evaluate(async (id) => {
  const before = Object.keys(CONFIG.JournalEntryPage.sheetClasses);
  const adapter = await import(`/modules/${id}/scripts/integrations/mej-adapter.mjs`);
  const { CampaignHubPage } = await import(`/modules/${id}/scripts/apps/CampaignHubPage.mjs`);
  let threw = null;
  try { adapter.registerHubSheetClass(CampaignHubPage); } catch (e) { threw = String(e); }
  const after = Object.keys(CONFIG.JournalEntryPage.sheetClasses);
  return {
    foundry: game.version, mode: adapter.currentMode(), before, after, threw,
    declared: Object.keys(game.documentTypes?.JournalEntryPage ?? {}),
    hubEntry: CONFIG.JournalEntryPage.sheetClasses["campaign-hub"] ?? null,
    registerSheetSource: foundry.applications.apps.DocumentSheetConfig.registerSheet.toString().slice(0, 1500)
  };
}, MODULE_ID);
console.log(JSON.stringify(out, null, 1));
await browser.close();
```
Run: `FOUNDRY_TARGET=v13 node tests/e2e/probes/hub-sheet-class-v13.mjs`
Expected: `before` lacks `campaign-hub`; `after` and `threw` tell you whether a post-ready call lands. Read `registerSheetSource`: on 13.351 look for a `types` filter against `game.documentTypes` or `CONFIG[documentName].typeLabels`. Write the finding into the ledger as `Ruling: <cause> — <evidence>`.

- [ ] **Step 3: Fix at the cause**

The fix depends on Step 2. The two expected outcomes and their fixes:

(a) 13.351's `registerSheet` drops types it does not know (the `after` list still lacks the key). Then register the placeholder against a type Foundry 13 accepts and make the placeholder carry it: in `scripts/apps/hub-window.mjs` give the document `type: CAMPAIGN_DOCUMENT_TYPE` (a module-declared subtype that IS registered with `CampaignHubPage` as default) instead of `HUB_PAGE_ID`, keep `HUB_PAGE_ID` as the sheet's `static get type()`, and delete `registerHubSheetClass`'s `HUB_PAGE_ID` registration only if the api-mode suite still passes without it (it should not: api mode uses `HUB_PAGE_ID` in the shell; keep the registration, it is harmless where it works). Update `missingSheetRegistrations`' hub check accordingly if the key changes, with the matching test in `test/sheet-registration.test.js`.

(b) The registration lands post-ready (`after` contains the key) but the pre-ready one was dropped and the repair never ran (`missingSheetRegistrations` reported `hub: false`). Then find why the repair did not run on v13 (`ensureSheetRegistrations` is awaited from `onReady`; check `wiringFailed()` and the console for "failed to register") and fix the ordering or the check.

Whatever the cause, the fix must leave the api-mode suite and the v14 native gate unchanged.

- [ ] **Step 4: Verify with the gate**

Run: `npm run e2e:stock:v13 -- --trace off 2>&1 | tail -40`
Expected: "Hub opens from the scene-controls button with working tabs" PASSES. Note any other failing test in the ledger (they are input to Task 5 and the sweep, not this task).
Run: `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add -A scripts test tests/e2e/probes .gitignore
git commit -m "fix(native): Hub window opens on Foundry 13 — <one-line cause>"
```

---

### Task 2: Generic wrap installer (`mej-wraps.mjs`)

**Files:**
- Create: `scripts/logic/mej-wraps.mjs`
- Test: `test/mej-wraps.test.js`

**Interfaces:**
- Produces:
  - `installWraps(specs, env) → { installed: string[], failed: string|null, records: object[] }` where `specs` is `Array<{ name, object, key, path?: string, wrapper: (wrapped, ...args) => any }>` and `env` is `{ libWrapperModule, libWrapper, moduleId, warn }`.
  - `uninstallWraps(records, env) → void` (reverse order; libWrapper records use `libWrapper.unregister(moduleId, path)`, manual records restore `object[key] = original`).
  - Wrapper calling convention on both branches: `wrapper.call(thisArg, wrappedBoundToThis, ...args)`.

- [ ] **Step 1: Write the failing tests**

`test/mej-wraps.test.js`:
```js
// test/mej-wraps.test.js
import { describe, it, expect, vi } from "vitest";
import { installWraps, uninstallWraps } from "../scripts/logic/mej-wraps.mjs";

const env = () => ({ libWrapperModule: { active: false }, libWrapper: null, moduleId: "mej-campaign-companion", warn: vi.fn() });

describe("installWraps (manual branch)", () => {
  it("wraps a method so the wrapper sees `this` and a bound original", () => {
    const obj = { n: 2, double(x) { return this.n * x; } };
    const res = installWraps([{ name: "double", object: obj, key: "double",
      wrapper(wrapped, x) { return wrapped(x) + 1; } }], env());
    expect(res.installed).toEqual(["double"]);
    expect(res.failed).toBeNull();
    expect(obj.double(5)).toBe(11);
  });

  it("returns a promise when the wrapped method is async and a value when it is not", async () => {
    const obj = { sync() { return 1; }, async asyncFn() { return 2; } };
    installWraps([
      { name: "sync", object: obj, key: "sync", wrapper(wrapped) { return wrapped(); } },
      { name: "async", object: obj, key: "asyncFn", wrapper(wrapped) { return wrapped(); } }
    ], env());
    expect(obj.sync()).toBe(1);
    const p = obj.asyncFn();
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe(2);
  });

  it("uninstalls everything already installed when a later target is missing", () => {
    const obj = { a() { return "a"; } };
    const original = obj.a;
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(wrapped) { return wrapped() + "!"; } },
      { name: "missing", object: obj, key: "nope", wrapper(wrapped) { return wrapped(); } }
    ], env());
    expect(res.installed).toEqual([]);
    expect(res.failed).toBe("missing");
    expect(obj.a).toBe(original);
  });

  it("uninstallWraps restores originals in reverse order", () => {
    const obj = { a() { return "a"; }, b() { return "b"; } };
    const [oa, ob] = [obj.a, obj.b];
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(w) { return w() + "1"; } },
      { name: "b", object: obj, key: "b", wrapper(w) { return w() + "2"; } }
    ], env());
    expect(obj.a()).toBe("a1");
    uninstallWraps(res.records, env());
    expect(obj.a).toBe(oa);
    expect(obj.b).toBe(ob);
  });
});

describe("installWraps (libWrapper branch)", () => {
  it("registers by path when libWrapper is active and a path is given", () => {
    const libWrapper = { register: vi.fn(), unregister: vi.fn() };
    const obj = { f() { return 1; } };
    const res = installWraps([{ name: "f", object: obj, key: "f", path: "game.X.f", wrapper(w) { return w(); } }],
      { ...env(), libWrapperModule: { active: true }, libWrapper });
    expect(libWrapper.register).toHaveBeenCalledWith("mej-campaign-companion", "game.X.f", expect.any(Function), "WRAPPER");
    expect(res.installed).toEqual(["f"]);
    uninstallWraps(res.records, { ...env(), libWrapperModule: { active: true }, libWrapper });
    expect(libWrapper.unregister).toHaveBeenCalledWith("mej-campaign-companion", "game.X.f");
  });

  it("falls back to the manual patch when libWrapper.register throws, and warns", () => {
    const libWrapper = { register: vi.fn(() => { throw new Error("nope"); }), unregister: vi.fn() };
    const e = { ...env(), libWrapperModule: { active: true }, libWrapper };
    const obj = { f() { return 1; } };
    const res = installWraps([{ name: "f", object: obj, key: "f", path: "game.X.f", wrapper(w) { return w() + 1; } }], e);
    expect(res.installed).toEqual(["f"]);
    expect(obj.f()).toBe(2);
    expect(e.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/mej-wraps.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/mej-wraps.mjs`.

- [ ] **Step 3: Implement**

`scripts/logic/mej-wraps.mjs`:
```js
// Generic, all-or-nothing installation of function wraps over another
// module's surface (Monk's Enhanced Journal). libWrapper is used when the
// lib-wrapper module is active AND the spec carries a globalThis-rooted
// path; everything else (and every libWrapper failure) takes the manual
// prototype patch, which keeps the original for uninstall. No Foundry
// globals: the caller supplies libWrapperModule/libWrapper/moduleId/warn.
//
// Wrapper convention on both branches, matching libWrapper's:
//   wrapper.call(thisArg, wrappedBoundToThis, ...args)
// and the wrapper's return value is returned as-is (a promise from an async
// original stays a promise; a plain value stays plain).

/**
 * @param {Array<{name:string, object:object, key:string, path?:string, wrapper:Function}>} specs
 * @param {{libWrapperModule?:{active?:boolean}, libWrapper?:object, moduleId:string, warn:(msg:string, err?:any)=>void}} env
 * @returns {{installed:string[], failed:string|null, records:object[]}}
 */
export function installWraps(specs, env) {
  const records = [];
  for (const spec of specs) {
    try {
      records.push(installOne(spec, env));
    } catch (err) {
      env.warn(`wrap "${spec.name}" could not be installed; uninstalling ${records.length} already installed`, err);
      uninstallWraps(records, env);
      return { installed: [], failed: spec.name, records: [] };
    }
  }
  return { installed: records.map((r) => r.name), failed: null, records };
}

function installOne(spec, env) {
  const { name, object, key, path, wrapper } = spec;
  if (typeof object?.[key] !== "function") {
    throw new Error(`target ${name} (${key}) is not a function`);
  }
  if (path && env.libWrapperModule?.active && env.libWrapper) {
    try {
      env.libWrapper.register(env.moduleId, path, wrapper, "WRAPPER");
      return { name, kind: "libwrapper", path };
    } catch (err) {
      env.warn(`libWrapper.register failed for ${path}; falling back to manual patch`, err);
    }
  }
  const original = object[key];
  object[key] = function (...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  return { name, kind: "manual", object, key, original };
}

/** Reverse-order uninstall of what installWraps returned. */
export function uninstallWraps(records, env) {
  for (const r of [...records].reverse()) {
    if (r.kind === "libwrapper") {
      try { env.libWrapper?.unregister(env.moduleId, r.path); } catch (err) { env.warn(`libWrapper.unregister failed for ${r.path}`, err); }
    } else {
      r.object[r.key] = r.original;
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/mej-wraps.test.js`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/mej-wraps.mjs test/mej-wraps.test.js
git commit -m "feat(logic): all-or-nothing wrap installer with libWrapper and manual branches"
```

---

### Task 3: Pure shim logic and the Hub placeholder module

**Files:**
- Create: `scripts/logic/shell-shim-logic.mjs`, `scripts/apps/hub-shell-document.mjs`
- Modify: `scripts/apps/hub-window.mjs` (import the class; delete the local copy)
- Test: `test/shell-shim-logic.test.js`

**Interfaces:**
- Produces (`shell-shim-logic.mjs`):
  - `shellPageId(hubPageId: string) → string` = `` `shellpage:${hubPageId}` ``
  - `withCompanionTypes(types: object, additions: object) → object` (new object, `types` untouched)
  - `isShellPageId(entityId: unknown, hubPageId: string) → boolean`
- Produces (`hub-shell-document.mjs`):
  - `class HubShellDocument` (as in hub-window today) with `get uuid()` = `shellPageId(HUB_PAGE_ID)`, `get id()` = `HUB_PAGE_ID`, `ownership = {}` set in the constructor, `_getSheetClass()` returning the class given to `setHubSheetClass`.
  - `setHubSheetClass(cls) → void`
  - `hubShellDocument() → HubShellDocument` singleton (constructed on first call with `{ name: localized hub title, type: HUB_PAGE_ID, flags: {}, content: "" }`).
- Consumed by Task 4 and by `hub-window.mjs`.

Note: Task 1 may have changed the placeholder's `type` to `CAMPAIGN_DOCUMENT_TYPE` (outcome (a)). If so, keep that decision here: the singleton's `type` is whatever Task 1 settled on, and `withCompanionTypes` in Task 4 adds that type's key too. Read Task 1's ledger ruling first.

- [ ] **Step 1: Write the failing tests**

`test/shell-shim-logic.test.js`:
```js
// test/shell-shim-logic.test.js
import { describe, it, expect } from "vitest";
import { shellPageId, withCompanionTypes, isShellPageId } from "../scripts/logic/shell-shim-logic.mjs";

describe("shellPageId / isShellPageId", () => {
  it("builds and recognises the shell-page id", () => {
    expect(shellPageId("campaign-hub")).toBe("shellpage:campaign-hub");
    expect(isShellPageId("shellpage:campaign-hub", "campaign-hub")).toBe(true);
    expect(isShellPageId("JournalEntry.abc.JournalEntryPage.def", "campaign-hub")).toBe(false);
    expect(isShellPageId(undefined, "campaign-hub")).toBe(false);
  });
});

describe("withCompanionTypes", () => {
  it("adds the companion types without mutating MEJ's map", () => {
    const mej = { person: "P", place: "L" };
    const merged = withCompanionTypes(mej, { session: "S", "campaign-hub": "H" });
    expect(merged).toEqual({ person: "P", place: "L", session: "S", "campaign-hub": "H" });
    expect(mej).toEqual({ person: "P", place: "L" });
  });
  it("tolerates a missing map", () => {
    expect(withCompanionTypes(undefined, { session: "S" })).toEqual({ session: "S" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/shell-shim-logic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure module**

`scripts/logic/shell-shim-logic.mjs`:
```js
// Pure helpers for the native-mode shell shim (spec 2026-09-19 §4). No
// Foundry globals.

/** The synthetic entity id MEJ's shell stores in a tab for the Hub. */
export function shellPageId(hubPageId) {
  return `shellpage:${hubPageId}`;
}

/** Is this tab entity id the Hub's shell page? */
export function isShellPageId(entityId, hubPageId) {
  return typeof entityId === "string" && entityId === shellPageId(hubPageId);
}

/**
 * MEJ's getDocumentTypes() map plus the companion's types. Returns a new
 * object; MEJ's own map is never mutated.
 * @param {object|undefined} types  MEJ's map (type key -> sheet class)
 * @param {object} additions        companion additions (type key -> sheet class)
 */
export function withCompanionTypes(types, additions) {
  return { ...(types ?? {}), ...additions };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/shell-shim-logic.test.js`
Expected: 3 passed.

- [ ] **Step 5: Move the placeholder document**

Create `scripts/apps/hub-shell-document.mjs` with the class from `scripts/apps/hub-window.mjs` lines 22-76 (constructor, `defineSchema`, `id`, `uuid`, `documentName`, `isOwner`, `permission`, `compendium`, `testUserPermission`) and these changes:
```js
import { MODULE_ID, HUB_PAGE_ID, I18N } from "../constants.mjs";
import { shellPageId } from "../logic/shell-shim-logic.mjs";

let hubSheetClass = null;
let singleton = null;

/** The sheet class the shell should construct for the Hub tab (CampaignHubPage). */
export function setHubSheetClass(cls) {
  hubSheetClass = cls;
}

export class HubShellDocument extends foundry.abstract.Document {
  constructor(options) {
    super(options);
    foundry.utils.mergeObject(this, options);
    this.apps = {};
    // MEJ's renderSubSheet writes ownership[userId] = OBSERVER when it is
    // asked to force-open a tab (apps/enhanced-journal.js, 13.06 :466-473).
    this.ownership = {};
  }

  // (defineSchema unchanged)

  get id() { return HUB_PAGE_ID; }

  // Unique, dotless, and impossible for a real document uuid to contain:
  // MEJ's open() matches tabs with `t.entityId?.includes(entity.id)` and
  // findEntity() treats ids with a "." as uuids (13.06 :866-887, :1274).
  get uuid() { return shellPageId(HUB_PAGE_ID); }

  get documentName() { return "JournalEntryPage"; }
  get isOwner() { return true; }
  get permission() { return CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER; }
  get compendium() { return null; }
  testUserPermission() { return true; }

  // The load-bearing member for shell hosting: MEJ's subsheet selector is
  // `this.document._getSheetClass ? this.document._getSheetClass() : null`
  // (13.06 apps/enhanced-journal.js:486, identical on 14.01).
  _getSheetClass() {
    return hubSheetClass;
  }
}

/** The one Hub placeholder this client uses, in both hosting paths. */
export function hubShellDocument() {
  singleton ??= new HubShellDocument({
    name: game.i18n.localize(`${I18N}.hub.title`),
    type: HUB_PAGE_ID,
    flags: {},
    content: ""
  });
  return singleton;
}
```
If Task 1 changed the window path's `type`, use that same value for `type:` above and note it in the file's comment.

In `scripts/apps/hub-window.mjs`: delete the class, import `{ hubShellDocument, setHubSheetClass }`, and in `openHubWindow()` replace the `new HubShellDocument({...})` block with:
```js
  const { CampaignHubPage } = await import("./CampaignHubPage.mjs");
  setHubSheetClass(CampaignHubPage);
  const document = hubShellDocument();
```

- [ ] **Step 6: Verify nothing else imported the class, run the suite**

Run: `grep -rn "HubShellDocument" scripts test` — only `hub-shell-document.mjs` and `hub-window.mjs` should reference it.
Run: `npm test` — green.
Run: `npm run e2e:stock:v13 -- --trace off 2>&1 | tail -20` — the Hub test from Task 1 still passes (window path now uses the singleton).

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/shell-shim-logic.mjs scripts/apps/hub-shell-document.mjs scripts/apps/hub-window.mjs test/shell-shim-logic.test.js
git commit -m "feat(native): shell-shim pure helpers; Hub placeholder document in its own module"
```

---

### Task 4: The shell shim and adapter wiring

**Files:**
- Create: `scripts/integrations/shell-shim.mjs`
- Modify: `scripts/constants.mjs`, `scripts/campaign-companion.mjs` (settings block), `scripts/integrations/mej-adapter.mjs` (`wireNativeMode`, `openHub`, `healSessionFlags`, new exports), `scripts/apps/CampaignHubPage.mjs:1075-1078` (`onNewSession`), `scripts/sheets/awaitable-render.mjs` (header comment), `lang/en.json`
- Test: none new at unit level (all pure parts are covered by Tasks 2-3); Task 5 adds the e2e coverage. `npm test` must stay green.

**Interfaces:**
- Consumes: `installWraps`/`uninstallWraps` (Task 2); `withCompanionTypes`, `isShellPageId`, `shellPageId` (Task 3); `hubShellDocument`, `setHubSheetClass` (Task 3).
- Produces (`shell-shim.mjs`):
  - `installShellShim({ SessionSheet, CampaignHubPage }) → { hosting: "shell"|"window", installed: string[], failed: string|null }`
  - `uninstallShellShim() → void`
  - `openHubInShell(options = {}) → Promise<void>`
- Produces (`mej-adapter.mjs`):
  - `currentHosting() → "shell"|"window"|null` (null until native mode is wired; `"shell"` is never reported in api or absent mode)
  - `openSessionPage(page) → Promise<void>`
- Produces (`constants.mjs`): `SHELL_HOSTING_SETTING = "shellHosting"` (client, boolean, default true, `config: false`).

- [ ] **Step 1: Constants and setting**

`scripts/constants.mjs`, after `FORCE_NATIVE_MODE_SETTING`:
```js
/** Client setting (hidden): host the Hub and Sessions in MEJ's shell in native mode. Off = standalone windows. Used by the stock gate's fallback test. */
export const SHELL_HOSTING_SETTING = "shellHosting";
```
`scripts/campaign-companion.mjs`, next to the `FORCE_NATIVE_MODE_SETTING` registration (add `SHELL_HOSTING_SETTING` to the constants import):
```js
  game.settings.register(MODULE_ID, SHELL_HOSTING_SETTING, {
    name: `${I18N}.settings.shellHosting.name`,
    hint: `${I18N}.settings.shellHosting.hint`,
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });
```
`lang/en.json` under `"settings"` (find the block that holds `forceNativeMode`):
```json
      "shellHosting": {
        "name": "Host the Campaign Hub and Sessions inside Monk's Enhanced Journal",
        "hint": "Native mode only. Off: the Hub and Session sheets open as standalone windows."
      }
```

- [ ] **Step 2: Write `shell-shim.mjs`**

```js
// Native-mode shell hosting on a stock Monk's Enhanced Journal (spec
// 2026-09-19 §4). Three wraps, installed as a unit; any failure uninstalls
// the lot and reports window hosting. Line numbers cite MEJ 13.06
// apps/enhanced-journal.js / monks-enhanced-journal.js; 14.01 is identical
// at the points used (docs/superpowers/triage/2026-09-19-mej-shell-hosting-survey.md).
import { EnhancedJournal } from "/modules/monks-enhanced-journal/apps/enhanced-journal.js";
import { MODULE_ID, HUB_PAGE_ID, SESSION_TYPE } from "../constants.mjs";
import { installWraps, uninstallWraps } from "../logic/mej-wraps.mjs";
import { withCompanionTypes, isShellPageId } from "../logic/shell-shim-logic.mjs";
import { hubShellDocument, setHubSheetClass } from "../apps/hub-shell-document.mjs";

let records = [];

function env() {
  return {
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    warn: (msg, err) => console.warn(`${MODULE_ID} | shell shim: ${msg}`, err ?? "")
  };
}

/**
 * Install the wraps. Returns the hosting the caller should use.
 * @returns {{hosting:"shell"|"window", installed:string[], failed:string|null}}
 */
export function installShellShim({ SessionSheet, CampaignHubPage }) {
  setHubSheetClass(CampaignHubPage);
  const mej = game.MonksEnhancedJournal;
  const hubDoc = () => hubShellDocument();
  const additions = { [SESSION_TYPE]: SessionSheet, [HUB_PAGE_ID]: CampaignHubPage };

  const specs = [
    {
      // Opens the shell's single-page demotion gate (:430-441) for session
      // entries, makes getMEJType recognise sessions, and stops fixType
      // (:4139-4141) unsetting the session flag.
      name: "getDocumentTypes", object: mej, key: "getDocumentTypes",
      path: "game.MonksEnhancedJournal.getDocumentTypes",
      wrapper(wrapped, ...args) { return withCompanionTypes(wrapped(...args), additions); }
    },
    {
      // Resolves the Hub's synthetic tab id (also after a reload, when the
      // shell re-resolves persisted tabs through findEntity, :866-887).
      name: "findEntity", object: EnhancedJournal.prototype, key: "findEntity",
      wrapper(wrapped, entityId, text) {
        if (isShellPageId(entityId, HUB_PAGE_ID)) return Promise.resolve(hubDoc());
        return wrapped(entityId, text);
      }
    },
    {
      // 14.01 builds core's DocumentSheetConfig for the shell's document and
      // it throws on a synthetic type; 13.06 opens MEJ's own dialog, which is
      // meaningless for the Hub. Same early return on both.
      name: "onConfigureSheet", object: EnhancedJournal, key: "onConfigureSheet",
      wrapper(wrapped, ...args) {
        if (this?.document === hubDoc()) return;
        return wrapped(...args);
      }
    }
  ];

  const result = installWraps(specs, env());
  records = result.records;
  if (result.failed) {
    console.warn(`${MODULE_ID} | shell hosting unavailable (wrap "${result.failed}" not installable); using standalone windows`);
    return { hosting: "window", installed: [], failed: result.failed };
  }
  console.log(`${MODULE_ID} | shell hosting installed: ${result.installed.join(", ")}`);
  return { hosting: "shell", installed: result.installed, failed: null };
}

export function uninstallShellShim() {
  uninstallWraps(records, env());
  records = [];
}

/**
 * Open the Hub as a shell tab: same incantation as MEJ's openJournalEntry
 * tail (13.06 monks-enhanced-journal.js:2390-2401) and the fork's
 * openShellPage. open() is sync on 13.06, async on 14.01 - await covers both.
 */
export async function openHubInShell(options = {}) {
  const MEJ = game.MonksEnhancedJournal;
  if (!MEJ.journal?.rendered) {
    MEJ.journal = await (new EnhancedJournal(options)).render(true, options);
  }
  await MEJ.journal.open(hubShellDocument(), options.newtab === true, options);
}
```
Check `EnhancedJournal.onConfigureSheet` exists as a static on both builds before relying on `this?.document`: on 13.06/14.01 it is `static onConfigureSheet(event)` called with the app as `this` through the header-control binding. If, when you test on 13.06, `this` is not the app, read `game.MonksEnhancedJournal.journal?.document` instead and note it in the ledger.

- [ ] **Step 3: Wire the adapter**

In `scripts/integrations/mej-adapter.mjs`:

Add state and exports near `currentMode()`:
```js
let hosting = null;

/** @returns {"shell"|"window"|null} native-mode hosting; null until native mode is wired. */
export function currentHosting() {
  return hosting;
}
```
Import `SHELL_HOSTING_SETTING` from constants. Add a helper next to `forceNative()`:
```js
function shellHostingWanted() {
  try {
    return game.settings.get(MODULE_ID, SHELL_HOSTING_SETTING) !== false;
  } catch (err) {
    return true;
  }
}
```
At the end of `wireNativeMode()` (after `registerMediaSheetClass(MediaPageSheet)`):
```js
  // Shell hosting (spec 2026-09-19 §4): wraps installed as a unit; window
  // hosting is the fallback whether the setting is off or a wrap failed.
  hosting = "window";
  if (shellHostingWanted()) {
    const { installShellShim } = await import("./shell-shim.mjs");
    const result = installShellShim({ SessionSheet, CampaignHubPage });
    hosting = result.hosting;
  }
```
Replace the native branch of `openHub()`:
```js
    if (hosting === "shell") {
      const { openHubInShell } = await import("./shell-shim.mjs");
      await openHubInShell();
      return;
    }
    const { openHubWindow } = await import("../apps/hub-window.mjs");
    await openHubWindow();
```
Add the session open path (exported; CampaignHubPage uses it in Step 4):
```js
/**
 * Open a Session page the way the current mode hosts it: MEJ's own open
 * path when a shell can host it (api mode, or native mode with shell
 * hosting), the page's standalone sheet otherwise.
 */
export async function openSessionPage(page) {
  if (mode === MODE_API || (mode === MODE_NATIVE && hosting === "shell")) {
    await game.MonksEnhancedJournal.openJournalEntry(page);
    return;
  }
  await page.sheet.render(true);
}
```
In `healSessionFlags()` replace `if (mode !== MODE_API) return 0;` with:
```js
  // Api mode, or native mode with shell hosting (wrap 1 keeps stock MEJ's
  // fixType from scrubbing the flag again). Window hosting: stock MEJ would
  // scrub it back on the next open, so re-stamping is pointless there.
  if (!(mode === MODE_API || (mode === MODE_NATIVE && hosting === "shell"))) return 0;
```
Confirm `campaign-companion.mjs` calls `healSessionFlags()` from ready in a way that does not gate on api mode itself (`grep -n healSessionFlags scripts/campaign-companion.mjs`); if it does, remove that gate.

- [ ] **Step 4: New Session opens through the adapter**

`scripts/apps/CampaignHubPage.mjs` `onNewSession`: replace `if (page) await page.sheet.render(true);` with `if (page) await openSessionPage(page);` and add `openSessionPage` to the file's import from `../integrations/mej-adapter.mjs` (check the file already imports from the adapter; if it imports nothing from it, add the import — the adapter does not import CampaignHubPage statically, so there is no cycle).

- [ ] **Step 5: Comment correction**

`scripts/sheets/awaitable-render.mjs` header: replace the sentence claiming later MEJ builds guard `_renderPageView` with `if (!sheet.element) return;` by: "No released MEJ build (13.06, 14.01, upstream PR #823) guards `_renderPageView`; only fork commit 08ffca5 does. `renderAwaitable` is therefore required on every stock build."

- [ ] **Step 6: Run everything that exists**

Run: `npm test` — green.
Run: `npm run check:links` — green.
Run: `npm run e2e:stock:v13 -- --trace off 2>&1 | tail -30` — the existing gate must still pass as far as it did after Task 1; expect the two tests that assert standalone hosting (`shellOpen === false`, `[id^="SessionSheet-"]` window) to now FAIL because hosting is shell. That is expected and is what Task 5 rewrites; record the exact list in the ledger. Any OTHER new failure is this task's bug.
Live check on 13.06 (manual or a probe): after `openHub()`, `game.MonksEnhancedJournal.journal.rendered === true` and `journal.subsheet.constructor.name === "CampaignHubPage"`; a sidebar click on a single-page session entry gives `journal.subsheet.constructor.name === "SessionSheet"` with no `.journal-entry-pages` element inside the shell.

- [ ] **Step 7: Commit**

```bash
git add scripts/integrations/shell-shim.mjs scripts/integrations/mej-adapter.mjs scripts/constants.mjs scripts/campaign-companion.mjs scripts/apps/CampaignHubPage.mjs scripts/sheets/awaitable-render.mjs lang/en.json
git commit -m "feat(native): host the Hub and Sessions in MEJ's shell on stock builds, with window fallback"
```

---

### Task 5: Contrast helper and the stock gate rewrite (both stock builds)

**Files:**
- Create: `scripts/logic/contrast.mjs`, `test/contrast.test.js`
- Modify: `tests/e2e/13-stock-smoke.spec.mjs`, `styles/campaign-companion.css` (only what the check catches)

**Interfaces:**
- Produces: `parseCssColor(str) → {r,g,b,a}|null`, `relativeLuminance({r,g,b}) → number`, `contrastRatio(fg, bg) → number` (both args are CSS colour strings or parsed objects).
- Consumes: `currentHosting()`, `openHub()`, `openSessionPage()` from the adapter; `SHELL_HOSTING_SETTING`.

- [ ] **Step 1: Contrast tests**

`test/contrast.test.js`:
```js
// test/contrast.test.js
import { describe, it, expect } from "vitest";
import { parseCssColor, contrastRatio } from "../scripts/logic/contrast.mjs";

describe("parseCssColor", () => {
  it("parses rgb and rgba", () => {
    expect(parseCssColor("rgb(34, 34, 34)")).toEqual({ r: 34, g: 34, b: 34, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
  it("returns null for anything else", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 1);
    expect(contrastRatio("rgb(90, 90, 90)", "rgb(90, 90, 90)")).toBeCloseTo(1, 5);
  });
  it("fails the defect pair and passes the api-mode pair", () => {
    // Observed 2026-09-19: session text inside MEJ's page wrapper on 13.06 (dark scheme).
    expect(contrastRatio("rgb(34, 34, 34)", "rgb(28, 27, 24)")).toBeLessThan(4.5);
    // Observed the same day on Foundry 14 api mode, dark scheme.
    expect(contrastRatio("rgb(221, 221, 221)", "rgb(28, 27, 24)")).toBeGreaterThan(4.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/contrast.test.js` — FAIL, module not found.

- [ ] **Step 3: Implement**

`scripts/logic/contrast.mjs`:
```js
// WCAG 2.x relative luminance and contrast ratio over CSS rgb()/rgba()
// strings (what getComputedStyle returns). No Foundry globals.

/** @returns {{r:number,g:number,b:number,a:number}|null} */
export function parseCssColor(str) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(str ?? "").trim());
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** @param {{r:number,g:number,b:number}} c */
export function relativeLuminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * Contrast ratio between two colours (strings or parsed objects), 1..21.
 * Unparseable input yields NaN so an assertion on it fails loudly.
 */
export function contrastRatio(fg, bg) {
  const a = typeof fg === "string" ? parseCssColor(fg) : fg;
  const b = typeof bg === "string" ? parseCssColor(bg) : bg;
  if (!a || !b) return NaN;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/contrast.test.js` — 4 passed.

- [ ] **Step 5: Rewrite the stock gate**

In `tests/e2e/13-stock-smoke.spec.mjs`, inside `stockDescribe`, make these changes. Add near the top:
```js
const CONTRAST = `/modules/${MODULE_ID}/scripts/logic/contrast.mjs`;

/** Contrast of an element's text against its nearest non-transparent ancestor background. */
async function textContrast(page, selector) {
  return page.evaluate(async ({ selector, contrastPath }) => {
    const { contrastRatio, parseCssColor } = await import(contrastPath);
    const el = document.querySelector(selector);
    if (!el) return { ratio: NaN, fg: null, bg: null };
    const fg = getComputedStyle(el).color;
    let n = el; let bg = null;
    while (n && n !== document.documentElement) {
      const c = parseCssColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { bg = getComputedStyle(n).backgroundColor; break; }
      n = n.parentElement;
    }
    return { ratio: contrastRatio(fg, bg), fg, bg };
  }, { selector, contrastPath });
}

/** Set the client colour scheme (client-scoped, so only this test browser sees it) and re-boot. */
async function setColorScheme(page, scheme) {
  await page.evaluate(async (scheme) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    cfg.colorScheme = { applications: scheme, interface: scheme };
    await game.settings.set("core", "uiConfig", cfg);
  }, scheme);
  await reloadGame(page);
  await settle(page, 2500);
}
```

Replace the test "Hub opens from the scene-controls button with working tabs" assertions block (from `await page.waitForSelector('[id^="CampaignHubPage-"]'…` to the end of the test) with:
```js
    const opened = await page.evaluate(async (p) => {
      const a = await import(p);
      const shell = game.MonksEnhancedJournal?.journal;
      const el = shell?.element?.querySelector(".mej-cc-hub") ?? document.querySelector('[id^="CampaignHubPage-"]');
      const navs = Array.from(el?.querySelectorAll("[data-tab]") ?? []).filter((n) => n.tagName !== "DIV");
      const current = el?.querySelector("div.tab.active")?.dataset?.tab ?? null;
      const target = navs.find((n) => n.dataset.tab !== current);
      target?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        hosting: a.currentHosting(),
        rendered: !!el,
        clicked: target?.dataset.tab ?? null,
        active: el?.querySelector("div.tab.active")?.dataset?.tab ?? null,
        shellOpen: !!shell?.rendered,
        subsheet: shell?.subsheet?.constructor?.name ?? null
      };
    }, ADAPTER);
    expect(opened.hosting).toBe("shell");
    expect(opened.rendered).toBe(true);
    expect(opened.clicked).not.toBeNull();
    expect(opened.active).toBe(opened.clicked);
    expect(opened.shellOpen).toBe(true);
    expect(opened.subsheet).toBe("CampaignHubPage");
```
(Keep the `waitForSelector` but change its selector to `.mej-cc-hub`.)

Replace the New Session test's expectations: after the click, wait for `.session-container` instead of `[id^="SessionSheet-"]`, and add to the evaluate's returned object `shellSubsheet: game.MonksEnhancedJournal?.journal?.subsheet?.constructor?.name ?? null` with `expect(result.shellSubsheet).toBe("SessionSheet");`. Replace `el = document.querySelector('[id^="SessionSheet-"]')` in the tabs check with `el = game.MonksEnhancedJournal.journal.element.querySelector(".session-container")`.

In "opening the session from the sidebar renders it without errors", after the `where` assertions add:
```js
    // Shell hosting: the SessionSheet IS the subsheet; MEJ's JournalEntry
    // page wrapper (the left-hand page index) must be absent.
    const host = await page.evaluate(() => ({
      subsheet: game.MonksEnhancedJournal?.journal?.subsheet?.constructor?.name ?? null,
      wrapper: !!game.MonksEnhancedJournal?.journal?.element?.querySelector(".journal-entry-pages")
    }));
    expect(host.subsheet).toBe("SessionSheet");
    expect(host.wrapper).toBe(false);
    const dark = await textContrast(page, ".session-container .editor-content, .session-container p");
    test.info().annotations.push({ type: "session-contrast-current-scheme", description: JSON.stringify(dark) });
    expect(dark.ratio).toBeGreaterThanOrEqual(4.5);
```

Add three new tests after it:
```js
  test("session and Hub text stay readable under both colour schemes", async ({ page }) => {
    await bootAsRealUser(page);
    for (const scheme of ["light", "dark"]) {
      await setColorScheme(page, scheme);
      const row = page.locator("#journal .directory-item", { hasText: FIXTURE }).first();
      await row.evaluate((el) => el.querySelector("a.entry-name").click());
      await expect(page.locator(".session-container").first()).toBeAttached({ timeout: 15_000 });
      const session = await textContrast(page, ".session-container .editor-content, .session-container p");
      await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
      await page.waitForSelector(".mej-cc-hub", { timeout: 15_000 });
      const hub = await textContrast(page, ".mej-cc-hub .mej-cc-index-row, .mej-cc-hub");
      test.info().annotations.push({ type: `contrast-${scheme}`, description: JSON.stringify({ session, hub }) });
      expect(session.ratio, `session text, ${scheme}`).toBeGreaterThanOrEqual(4.5);
      expect(hub.ratio, `hub text, ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
    await setColorScheme(page, "");
  });

  test("the Hub tab survives a reload", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    await page.waitForSelector(".mej-cc-hub", { timeout: 15_000 });
    await reloadGame(page);
    await settle(page, 3000);
    const after = await page.evaluate(() => {
      const shell = game.MonksEnhancedJournal?.journal;
      const tab = shell?.tabs?.find((t) => t.entityId === "shellpage:campaign-hub") ?? null;
      return { tab: !!tab, active: !!tab?.active, subsheet: shell?.subsheet?.constructor?.name ?? null, rendered: !!shell?.rendered };
    });
    test.info().annotations.push({ type: "hub-tab-after-reload", description: JSON.stringify(after) });
    expect(after.tab).toBe(true);
    if (after.rendered) expect(after.subsheet).toBe("CampaignHubPage");
  });

  test("with shell hosting off the standalone windows still work", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (id) => { await game.settings.set(id, "shellHosting", false); }, MODULE_ID);
    await reloadGame(page);
    await settle(page, 2500);
    try {
      const hosting = await page.evaluate(async (p) => (await import(p)).currentHosting(), ADAPTER);
      expect(hosting).toBe("window");
      await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
      await page.waitForSelector('[id^="CampaignHubPage-"]', { timeout: 15_000 });
      const shellOpen = await page.evaluate(() => !!game.MonksEnhancedJournal?.journal?.rendered);
      expect(shellOpen).toBe(false);
    } finally {
      await page.evaluate(async (id) => { await game.settings.set(id, "shellHosting", true); }, MODULE_ID);
    }
  });
```
Adjust the `.session-container p` selector if the fixture session has no paragraph yet (New Session creates an empty recap): if `ratio` is NaN because no element matched, type one line into the recap in the New Session test first (`page.locator(".session-container .editor-content").first().fill("Readable text")` after the sheet opens) so later tests have text to measure. Keep the test's rename step as is.

Update the file's header comment: the v13 gate now asserts shell hosting; the 14.01 gate procedure is unchanged.

- [ ] **Step 6: Run on 13.06, audit CSS only where the check fails**

Run: `npm run e2e:stock:v13 -- --trace off 2>&1 | tail -40`, then `npm run e2e:stock:v13:cleanup`.
Expected: all stock-phase tests pass. If a contrast assertion fails, read its annotation (fg/bg) and fix the responsible rule in `styles/campaign-companion.css` by replacing the hard-coded colour with the theme variable the stylesheet's `.theme-dark` block already uses (`--color-text-primary` with the existing fallback for text; `--color-cool-5` for dark surfaces). Change nothing the check does not catch.

- [ ] **Step 7: Run on 14.01 (native, shell hosting)**

Follow the worktree switch in `tests/e2e/README.md` ("Stock gate on v14"): stop Foundry 14, back up world-a, check out tag `14.01` in the MEJ module worktree (clear and re-set the pack skip-worktree flags), relaunch with `--dataPath=/Users/danbularzik/FoundryVTT-14/Data --world=world-a --port=30000`, then:
```bash
STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off 2>&1 | tail -40
```
Expected: all stock-phase tests pass, including New Session (the 0.19.3 known issue). If New Session still fails, diagnose (`page.evaluate` the console errors around `openJournalEntry(page)`) and fix within this task; record the cause in the ledger.
Then switch the worktree back to the fork line (`integration-14.08`), relaunch, and run `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off`.

- [ ] **Step 8: Api-mode regression net**

With the fork line back on World A:
```bash
npx playwright test --trace off --reporter=list,json 2>&1 | tail -5
node tests/e2e/helpers/summarize-run.mjs test-results/report.json "api-mode after shim"
```
(`PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/report.json` if the reporter needs it.) Expected: pass count at or above the 0.19.3 baseline (115 passed on run 1 of the 14.01 sweep, 13 known failures). Any new failure is this task's regression.

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/contrast.mjs test/contrast.test.js tests/e2e/13-stock-smoke.spec.mjs styles/campaign-companion.css
git commit -m "test(e2e): stock gate asserts shell hosting, contrast under both schemes, reload and fallback"
```

---

### Task 6: Retro-link failures name the journal and the cause

Today `processBurst` (`scripts/hooks/retro-link.mjs:400-425`) already catches each page write; the GM sees "Auto-link could not write N page(s) — see the browser console" only when nothing was written, and nothing at all when some pages were written and others failed. The import therefore completes already (spec amendment A2); this task makes the report useful.

**Files:**
- Create: `scripts/logic/retro-report.mjs`, `test/retro-report.test.js`
- Modify: `scripts/hooks/retro-link.mjs` (`processBurst` write loop, `notifyRetroResult`), `lang/en.json`

**Interfaces:**
- Produces: `retroFailureMessage(failures, format) → string` where `failures` is `Array<{ page: string, journal: string, reason: string }>` and `format(key, data)` is the i18n formatter; `describeError(err) → string` (first line of `err.message`, trimmed to 160 chars).

- [ ] **Step 1: Tests**

`test/retro-report.test.js`:
```js
// test/retro-report.test.js
import { describe, it, expect } from "vitest";
import { retroFailureMessage, describeError } from "../scripts/logic/retro-report.mjs";

const format = (key, data) => `${key}|${JSON.stringify(data)}`;

describe("describeError", () => {
  it("keeps the first line only and caps the length", () => {
    expect(describeError(new Error("type: \"campaign-record.place\" is not valid\n  at x"))).toBe("type: \"campaign-record.place\" is not valid");
    expect(describeError("x".repeat(500)).length).toBe(160);
    expect(describeError(null)).toBe("unknown error");
  });
});

describe("retroFailureMessage", () => {
  it("names each journal once with its reason", () => {
    const msg = retroFailureMessage([
      { page: "Intro", journal: "Radiant Citadel", reason: "campaign-record.place is not a valid type" },
      { page: "Arc 1", journal: "Radiant Citadel", reason: "campaign-record.place is not a valid type" },
      { page: "Notes", journal: "Other", reason: "boom" }
    ], format);
    expect(msg).toBe('MEJCampaignCompanion.retroLink.writeFailedDetail|{"count":3,"list":"Radiant Citadel (campaign-record.place is not a valid type); Other (boom)"}');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/retro-report.test.js` FAILS (module not found).

- [ ] **Step 3: Implement**

`scripts/logic/retro-report.mjs`:
```js
// Pure reporting for failed retro-link writes (spec 2026-09-19 §5.3, A2).
const I18N = "MEJCampaignCompanion";

/** First line of an error's message, capped, never empty. */
export function describeError(err) {
  const text = typeof err === "string" ? err : err?.message;
  const line = String(text ?? "").split("\n")[0].trim();
  return (line || "unknown error").slice(0, 160);
}

/**
 * One message naming each failed journal once with the reason.
 * @param {Array<{page:string, journal:string, reason:string}>} failures
 * @param {(key:string, data:object)=>string} format
 */
export function retroFailureMessage(failures, format) {
  const byJournal = new Map();
  for (const f of failures) if (!byJournal.has(f.journal)) byJournal.set(f.journal, f.reason);
  const list = [...byJournal].map(([journal, reason]) => `${journal} (${reason})`).join("; ");
  return format(`${I18N}.retroLink.writeFailedDetail`, { count: failures.length, list });
}
```
`scripts/hooks/retro-link.mjs`: in `processBurst`, change `let failed = 0;` to `const failed = [];`, and the loop's two failure sites to:
```js
        if (!pageDoc) { failed.push({ page: pageUuid, journal: pageUuid, reason: "page no longer exists" }); continue; }
        …
      } catch (err) {
        const pageDoc = await fromUuid(pageUuid).catch(() => null);
        failed.push({ page: pageDoc?.name ?? pageUuid, journal: pageDoc?.parent?.name ?? pageUuid, reason: describeError(err) });
        console.error(`${MODULE_ID} | retro-link write failed for ${pageUuid}`, err);
      }
```
(Resolve `pageDoc` once above the `try` instead of twice if you prefer; keep the semantics.) In `notifyRetroResult`, replace the `if (applied.length) {…return;}` and `if (failed) {…}` blocks with:
```js
  if (applied.length) {
    const linkedCount = new Set(applied.flatMap((r) => r.matches.map((m) => m.entityUuid))).size;
    const message = single
      ? game.i18n.format(`${I18N}.retroLink.summary`, { name: entities[0].name, count: applied.length })
      : game.i18n.format(`${I18N}.retroLink.summaryMany`, { entities: linkedCount, count: applied.length });
    ui.notifications.info(message);
    console.info(`${MODULE_ID} | auto-link`, detail);
    if (failed?.length) ui.notifications.warn(retroFailureMessage(failed, (k, d) => game.i18n.format(k, d)), { permanent: true });
    return;
  }
  if (failed?.length) {
    ui.notifications.error(retroFailureMessage(failed, (k, d) => game.i18n.format(k, d)), { permanent: true });
    console.error(`${MODULE_ID} | auto-link — ${failed.length} page write(s) failed`, { failed, ...detail });
    return;
  }
```
Import `retroFailureMessage, describeError` at the top. `lang/en.json` under `retroLink`, next to `writeFailed`:
```json
      "writeFailedDetail": "Auto-link could not update {count} page(s): {list}. The other pages were updated. See the browser console (F12) for details."
```
Keep `writeFailed` (other callers may use it; `grep -rn writeFailed scripts` and remove the key only if unused).

- [ ] **Step 4: Run** — `npx vitest run test/retro-report.test.js` (2 passed), then `npm test` green.

- [ ] **Step 5: Live check on 13.06** — with the legacy pages still present in world-b (do this BEFORE the sweep's cleanup), create a journal entry named after an entity the legacy journal mentions (e.g. `TT-RETRO Kirian`) and confirm the notification names "Radiant Citadel" with the `campaign-record.place` reason; delete the fixture.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/retro-report.mjs test/retro-report.test.js scripts/hooks/retro-link.mjs lang/en.json
git commit -m "fix(retro-link): name the journal and cause when a write fails; report partial failures"
```

---

### Task 7: Harness — full suite on Foundry 13

**Files:**
- Modify: `tests/e2e/helpers/foundry.mjs:26-31` (per-target auth dir), `package.json` (scripts), `tests/e2e/README.md`, `.gitignore` (if `.auth/<target>` needs it — `.auth/` is already ignored)
- Environment: the v13 module install becomes a symlink.

**Interfaces:**
- Produces: `npm run e2e:v13` (full suite), `npm run e2e:v13:stock` alias kept as `e2e:stock:v13`.

- [ ] **Step 1: Per-target auth state**

`tests/e2e/helpers/foundry.mjs`: change `AUTH_DIR` to include the target name so v13 and v14 cookies never overwrite each other:
```js
const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".auth", TARGET.name);
```
Check `tests/e2e/auth.setup.mjs` creates the directory (`fs.mkdirSync(AUTH_DIR, { recursive: true })` before writing; add it if missing) and that `test/e2e-target.test.js` does not pin the old path.

- [ ] **Step 2: Scripts**

`package.json`:
```json
    "e2e:v13": "FOUNDRY_TARGET=v13 playwright test --trace off",
```

- [ ] **Step 3: Symlink the v13 install (environment)**

```bash
cd /Users/danbularzik/FoundryVTT/Data/Data/modules
mv mej-campaign-companion /Users/danbularzik/FoundryVTT/backups/mej-campaign-companion-0.19.3-copy-$(date +%Y%m%d)
ln -s /Users/danbularzik/Claude/Projects/mej-campaign-companion mej-campaign-companion
ls -la mej-campaign-companion
```
(`mkdir -p /Users/danbularzik/FoundryVTT/backups` first.) The main checkout is what World A serves too; the sweep runs against the branch by pointing the symlink at the worktree during the run and back at main afterwards, exactly as `global-teardown.mjs` does for v14 (`pinSymlink(MAIN_CHECKOUT)`). Confirm `verifyDeployment` passes for v13: `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/00-*.spec.mjs --trace off` (or the first spec file) and read global setup's output.

- [ ] **Step 4: README recipe**

`tests/e2e/README.md`: add a section "Full suite on v13" with: the symlink arrangement, `npm run e2e:v13`, the world-b note (user campaign copy present; fixtures are `TT-`), the backup command, the hidden-page cleanup (see Task 8 step 1) and the absolute-path relaunch line for Foundry 13:
```bash
cd /Users/danbularzik/FoundryVTT/FoundryVTT-Node-13.351 && /opt/homebrew/opt/node@22/bin/node main.js --dataPath=/Users/danbularzik/FoundryVTT/Data --world=world-b --port=30013
```

- [ ] **Step 5: Verify and commit**

Run: `npm test` (the e2e-target test), `npm run check:links`.
```bash
git add tests/e2e/helpers/foundry.mjs tests/e2e/auth.setup.mjs package.json tests/e2e/README.md
git commit -m "test(harness): full e2e suite on Foundry 13 — per-target auth state, e2e:v13 script, recipe"
```

---

### Task 8: The v13 sweep

**Files:**
- Create: `docs/superpowers/triage/<date>-v13-companion-sweep.md`
- Modify: whatever the attributed `shim` / `companion` / `harness` rows require (each fix its own commit with a test)

**Interfaces:**
- Consumes: `npm run e2e:v13`, `node tests/e2e/helpers/summarize-run.mjs <report.json> [label]`.

- [ ] **Step 1: Back up world-b and remove the two hidden legacy pages**

```bash
mkdir -p /Users/danbularzik/FoundryVTT/backups
cp -R /Users/danbularzik/FoundryVTT/Data/Data/worlds/world-b /Users/danbularzik/FoundryVTT/backups/world-b-pre-v13-sweep-$(date +%Y-%m-%d)
```
Then, with the v13 server up, run a probe (`tests/e2e/probes/delete-legacy-pages.mjs`, same login pattern as Task 1's probe) that executes in-page:
```js
const entry = game.journal.get("35nbnYCykPtnCxC5");
const ids = [...entry.pages.invalidDocumentIds];          // expect ["5lWsbyRFL9snEuAa", "K2NpTyaFYRfOasAW"]
await entry.deleteEmbeddedDocuments("JournalEntryPage", ids);
return { deleted: ids, remaining: [...entry.pages.invalidDocumentIds] };
```
If `deleteEmbeddedDocuments` refuses invalid ids on 13.351, use `entry.pages.getInvalid(id).delete()` per id. Record the result in the report. Expected after a reload: no "Failed to initialize JournalEntryPage" errors at boot.

- [ ] **Step 2: Run 1**

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/v13-run1.json npm run e2e:v13 -- --reporter=list,json 2>&1 | tail -60
node tests/e2e/helpers/summarize-run.mjs test-results/v13-run1.json "v13 run 1" > docs/superpowers/triage/v13-run1.md
```
Copy the summary table into the report skeleton (Step 5) and keep the raw JSON outside the repo (`$CLAUDE_JOB_DIR/tmp/sweep-v13/`).

- [ ] **Step 3: Rerun failures once**

```bash
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/v13-run2.json FOUNDRY_TARGET=v13 npx playwright test --trace off --reporter=list,json --last-failed 2>&1 | tail -40
node tests/e2e/helpers/summarize-run.mjs test-results/v13-run2.json "v13 run 2 (rerun)"
```
A test that passes on rerun is `flake`.

- [ ] **Step 4: Attribute**

For every failure still present after the rerun, decide one class from: `platform` (Foundry 13.351 / dnd5e 5.3.3 API difference, e.g. a missing method or changed selector in core UI), `mej-13.06` (stock MEJ behaviour; reference the same spec passing on the fork line in api mode), `shim` (fails with shell hosting and passes with the `shellHosting` client setting off), `companion` (companion code path wrong on this stack regardless of hosting), `harness` (test assumption, fixture, timing). Method: read the failure's error and trace first; for `shim` vs `companion`, rerun that spec with shell hosting off (set the client setting in a probe or a `beforeAll`); for `mej-13.06`, check the MEJ 13.06 source at the throwing line. Record evidence per row.

- [ ] **Step 5: Report**

Write `docs/superpowers/triage/<date>-v13-companion-sweep.md` with these sections, mirroring `2026-09-19-mej-14.01-companion-sweep.md`: Stack (Foundry 13.351, dnd5e 5.3.3, MEJ 13.06, companion branch commit, hosting shell); Environment prep (backup path, deleted page ids); Run 1 / Run 2 summary tables; Attribution table with columns `spec | test | line | class | evidence | action | owner`; Verdict; Follow-ups (upstream issues to file, fork backlog, harness items).

- [ ] **Step 6: Fix the attributed rows**

One commit per fix, each with its own unit or e2e test, following TDD as in Tasks 2-6. Commit message prefix `fix(sweep-v13):`. Re-run the affected spec after each fix and update the report row's `action` to the commit hash. `platform` and `mej-13.06` rows get no code change here.

- [ ] **Step 7: Final runs and commit the report**

Run `npm run e2e:v13 -- --reporter=list,json` once more and record the final table in the report. Run `npm test`, `npm run check:links`.
```bash
git add docs/superpowers/triage/<date>-v13-companion-sweep.md
git commit -m "docs(triage): Foundry 13 companion sweep — runs, attribution, verdict"
```

---

### Task 9: Docs, manifest, changelog and release 0.20.0

**Files:**
- Modify: `README.md` (native-mode section, mode table Foundry 13 row, Requirements bullet, troubleshooting), `CHANGELOG.md`, `module.json` (version, MEJ `verified`), `tests/e2e/13-stock-smoke.spec.mjs` header (already done in Task 5), `docs/superpowers/triage/<date>-v13-companion-sweep.md` (final numbers)

- [ ] **Step 1: README**

- Native-mode section: replace the sentence describing standalone windows with: in native mode the companion hosts the Campaign Hub and Session sheets inside Monk's Enhanced Journal's own tabbed window by adapting three of MEJ's functions at start-up; if that adaptation cannot be installed (a future MEJ release renaming one of them), the companion logs `shell hosting unavailable` and falls back to standalone windows. Keep the api-mode description.
- Mode table, `native` on Foundry 13 row: "MEJ 13.06 carries no extension API, so Foundry 13 always runs this mode; the Hub and Sessions still open inside MEJ's shell."
- Remove the two "Known issue as of 2026-09-19" sentences (README.md:83 and the Requirements bullet) ONLY if Task 5 step 7 passed the 14.01 gate; otherwise leave them and skip the manifest change below.
- Troubleshooting: add the `shell hosting unavailable` warning and what it means.

- [ ] **Step 2: Manifest**

`module.json`: `"version": "0.20.0"`; in the MEJ relationship's `compatibility`, add `"verified": "14.01"` if the 14.01 gate passed (Task 5 step 7). Run `npm run check:links`.

- [ ] **Step 3: CHANGELOG**

Insert at the top of `CHANGELOG.md`:
```markdown
## 0.20.0 (<date>)

Shell hosting without the extension API, Foundry 13 fixes, and a Foundry 13 test sweep.

- **Added:** in native mode the Campaign Hub and Session sheets now open inside Monk's Enhanced Journal's tabbed window on stock MEJ 13.06 and 14.01, the same as with the extension API; if the adaptation cannot be installed the companion falls back to standalone windows and says so in the console.
- **Fixed:** the Campaign Hub button did nothing on Foundry 13.
- **Fixed:** Sessions opened from the sidebar on Foundry 13 rendered inside MEJ's page index with unreadable text.
- **Fixed:** when auto-link cannot update a journal after an import, the message now names the journal and the reason, and the import's other pages are still linked.
- **Changed:** the e2e suite runs in full against Foundry 13; the stock-MEJ gate checks shell hosting, text contrast under both colour schemes, tab persistence and the window fallback.
```
Add one `**Fixed:**` line per sweep fix that a user would notice (not harness-only changes). Keep bullets single-line.

- [ ] **Step 4: Release commit, PR, merge**

```bash
git add README.md CHANGELOG.md module.json
git commit -m "chore(release): 0.20.0 — changelog, version, manifest"
git push -u origin feat/native-shell-shim
gh pr create --base main --head feat/native-shell-shim --title "0.20.0: shell hosting in native mode, Foundry 13 fixes and sweep" --body-file <body.md>
```
The PR body: summary, the gates run (13.06 stock, 14.01 stock, api-mode suite counts), the sweep verdict, and a pointer to the report. No attribution line, no session link. Merge with a merge commit (`gh pr merge <n> --merge`), then on `main`:
```bash
git checkout main && git pull
git tag -a 0.20.0 -m "0.20.0" <merge-commit>
git push origin 0.20.0
git archive --format=zip -o /tmp/mej-cc-0.20.0/module.zip 0.20.0 module.json README.md CHANGELOG.md LICENSE lang scripts styles templates vendor assets docs/gm-guide.md docs/player-guide.md docs/manual-test-checklist.md docs/images
git show 0.20.0:module.json > /tmp/mej-cc-0.20.0/module.json
gh release create 0.20.0 --verify-tag --title "0.20.0" --notes-file <notes from the changelog section> /tmp/mej-cc-0.20.0/module.zip /tmp/mej-cc-0.20.0/module.json
curl -s https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json | grep '"version"'
```
(Use `$CLAUDE_JOB_DIR/tmp` instead of `/tmp` when running as a background job.) Restart World A on port 30000 (fork line, main checkout), confirm the module reports 0.20.0 in-game, then remove the worktree and branch:
```bash
git worktree remove .claude/worktrees/native-shell-shim
git branch -d feat/native-shell-shim
```

- [ ] **Step 5: Close out**

Update the memory file `mej-campaign-companion.md` with the release line, and the sweep report with the final release commit if it references "pending".

---

## Self-review

**Spec coverage.** §3 mode model → Task 4 (`currentHosting`, install from `wireNativeMode`). §4.1 wraps → Tasks 2-4 (three wraps; the spec's wrap 3 is withdrawn by amendment A1 because wrap 1 makes MEJ's own parent swap and tab matching correct, and the placeholder's unique uuid already satisfies `open`'s matching). §4.2 placeholder → Task 3. §4.3 opening → Task 4 (`openHubInShell`, `openSessionPage`, heal in native mode). §4.4 comment → Task 4 step 5. §5.1 Hub window on v13 → Task 1. §5.2 readability → Task 5. §5.3 import → Task 6 (reporting, per amendment A2). §6.1 harness → Task 7. §6.2 sweep → Task 8. §6.3 gates → Task 5 steps 6-8 and Task 8. §7 testing → Tasks 2, 3, 5, 6. §8 docs/release → Task 9. §9 risks → Task 4 fallback, Task 8 attribution.

**Placeholders.** Task 1 step 3 is conditional on a diagnosis by design, with both expected outcomes and their fixes spelled out. Task 8 step 6 is open-ended by nature (sweep fixes); each fix follows the TDD shape of Tasks 2-6.

**Type consistency.** `installWraps(specs, env)` / `uninstallWraps(records, env)` (Task 2) are what `shell-shim.mjs` (Task 4) calls. `withCompanionTypes`, `isShellPageId`, `shellPageId` (Task 3) match their uses in Task 4 and the reload test's literal `"shellpage:campaign-hub"` (Task 5). `hubShellDocument()` / `setHubSheetClass()` (Task 3) match Task 4. `currentHosting()`, `openHub()`, `openSessionPage()` (Task 4) match Task 5's tests and CampaignHubPage's call. `contrastRatio`/`parseCssColor` (Task 5) match `textContrast`. `retroFailureMessage`/`describeError` (Task 6) match their uses. `SHELL_HOSTING_SETTING = "shellHosting"` matches the string used in the e2e tests.
