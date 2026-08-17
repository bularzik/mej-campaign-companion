# Running Without the MEJ Extension API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mej-campaign-companion work on a stock Monk's Enhanced Journal install (no extension API) as well as on the API-enabled fork, transparently and with no data migration.

**Architecture:** A single adapter module (`scripts/integrations/mej-adapter.mjs`) resolves one of three modes (`api` / `native` / `absent`) and owns every mode-dependent decision. Everything that never needed the API moves into a mode-independent `registerCore()`. Session identity switches from MEJ's scrubbable type flag to the native Foundry subtype, with an API-mode sweep that re-stamps the flag after a round trip through stock MEJ. The Hub renders as its own window in native mode using a `BlankJournal`-shaped stub document.

**Tech Stack:** Foundry VTT v14 (ApplicationV2 / DocumentSheetV2, module-declared document subtypes), ES modules, vitest (unit), Playwright (e2e).

## Global Constraints

- Ships as **mej-campaign-companion 0.5.0** (`module.json` `version`).
- Work happens in the companion repo (`/Users/danbularzik/Claude/Projects/mej-campaign-companion`) on branch **`feature/mej-api-optional`**. Do not touch `main`; do not push to `main`.
- MEJ remains a **hard dependency**. "Without the API" ≠ "without MEJ". Never add a code path that runs with MEJ absent.
- **Never monkey-patch, libWrapper-wrap, or otherwise modify MEJ internals** (`getDocumentTypes`, `fixType`, the shell tab machinery). The whole point of this work is to avoid coupling to MEJ internals.
- **Never modify the MEJ repo** as part of this work.
- Mode names are exactly the strings `"api"`, `"native"`, `"absent"`.
- Native Session identity is exactly `page.type === "mej-campaign-companion.session"` (`SESSION_DOCUMENT_TYPE`). The MEJ flag `flags["monks-enhanced-journal"].type` is still **written** at creation but must never be **read** to decide whether something is a Session.
- Observer posture everywhere: every wiring step and the heal sweep are individually try/caught, log via `console.error` with the `${MODULE_ID} | ` prefix, and never block startup or a user action.
- Preserve the deferred-dynamic-import discipline documented at `campaign-companion.mjs:122-142`: `sheets/SessionSheet.mjs` and `apps/CampaignHubPage.mjs` (which statically import MEJ's `EnhancedJournalSheet.js`) must **never** be imported at module top level — only inside the handshake handler or at `ready`.
- Pure logic modules (`scripts/logic/*.mjs`) must not touch Foundry globals (`game`, `ui`, `CONFIG`, `Hooks`); globals live in `scripts/hooks/`, `scripts/apps/`, and `scripts/integrations/`.
- Unit tests are vitest under `test/`, run with `npm test`. E2e are Playwright under `tests/e2e/`, run with `npm run test:e2e`.
- All 476 existing unit tests and all 39 existing e2e tests must still pass at the end of every task.
- Every user-facing string goes through `lang/en.json` under the `MEJCampaignCompanion` root; no hardcoded English in templates or JS.

---

### Task 1: Pure mode resolution

**Files:**
- Create: `scripts/logic/mej-mode.mjs`
- Test: `test/mej-mode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `MODE_API = "api"`, `MODE_NATIVE = "native"`, `MODE_ABSENT = "absent"`, and `resolveMode({ handshakeFired, mejActive, forceNative })` → one of those three strings.

- [ ] **Step 1: Write the failing test**

Create `test/mej-mode.test.js`:

```js
// test/mej-mode.test.js
import { describe, it, expect } from "vitest";
import { resolveMode, MODE_API, MODE_NATIVE, MODE_ABSENT } from "../scripts/logic/mej-mode.mjs";

describe("resolveMode", () => {
  it("is absent whenever MEJ is not active, regardless of anything else", () => {
    expect(resolveMode({ handshakeFired: false, mejActive: false, forceNative: false })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: true, mejActive: false, forceNative: false })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: false, mejActive: false, forceNative: true })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: true, mejActive: false, forceNative: true })).toBe(MODE_ABSENT);
  });

  it("is api when the handshake fired and nothing forces native", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true, forceNative: false })).toBe(MODE_API);
  });

  it("is native when MEJ is active but the handshake never fired", () => {
    expect(resolveMode({ handshakeFired: false, mejActive: true, forceNative: false })).toBe(MODE_NATIVE);
  });

  it("forceNative overrides a received API", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true, forceNative: true })).toBe(MODE_NATIVE);
    expect(resolveMode({ handshakeFired: false, mejActive: true, forceNative: true })).toBe(MODE_NATIVE);
  });

  it("defaults forceNative to false when omitted", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true })).toBe(MODE_API);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- mej-mode`
Expected: FAIL — cannot resolve `../scripts/logic/mej-mode.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/mej-mode.mjs`:

```js
// Pure resolution of which Monk's Enhanced Journal this client is talking to.
// No Foundry globals - the caller supplies the three facts.
//
//  - api:    MEJ fired setupMonksEnhancedJournal, so the extension API exists
//            and the Session sheet / Hub integrate into MEJ's shell.
//  - native: MEJ is installed but has no extension API (stock upstream), or
//            the user forced native mode. Core features run; the Session
//            sheet and Hub become standalone windows.
//  - absent: MEJ is not active at all. The companion stays inert - MEJ is a
//            hard dependency, "without the API" is not "without MEJ".
export const MODE_API = "api";
export const MODE_NATIVE = "native";
export const MODE_ABSENT = "absent";

/**
 * @param {object} facts
 * @param {boolean} facts.handshakeFired  did setupMonksEnhancedJournal fire?
 * @param {boolean} facts.mejActive       is the MEJ module active?
 * @param {boolean} [facts.forceNative]   forceNativeMode client setting
 * @returns {"api"|"native"|"absent"}
 */
export function resolveMode({ handshakeFired, mejActive, forceNative = false }) {
  if (!mejActive) return MODE_ABSENT;
  if (forceNative) return MODE_NATIVE;
  return handshakeFired ? MODE_API : MODE_NATIVE;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- mej-mode`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/mej-mode.mjs test/mej-mode.test.js
git commit -m "feat: pure MEJ mode resolution (api/native/absent)"
```

---

### Task 2: Pure Session type identity

**Files:**
- Create: `scripts/logic/mej-type.mjs`
- Test: `test/mej-type.test.js`

**Interfaces:**
- Consumes: `SESSION_TYPE` (`"session"`) and `SESSION_DOCUMENT_TYPE` (`"mej-campaign-companion.session"`) from `scripts/constants.mjs`.
- Produces: `isSessionDoc(doc)` → boolean; `mejTypeWith(doc, getMEJType)` → short type key string or `false`.

**Context the implementer needs:** stock MEJ's `getMEJType` validates the flag against its own type registry, which has no `session` key, so it returns `false` for every Session page on stock. `mejTypeWith` short-circuits that case using the native subtype, which nothing can scrub. It must keep `getMEJType`'s exact contract: accepts a `JournalEntry` **or** a `JournalEntryPage`, returns the short key or `false`. MEJ only treats a `JournalEntry` as typed when it has exactly one page (see `MonksEnhancedJournal.getMEJType`), so mirror that.

- [ ] **Step 1: Write the failing test**

Create `test/mej-type.test.js`:

```js
// test/mej-type.test.js
import { describe, it, expect } from "vitest";
import { isSessionDoc, mejTypeWith } from "../scripts/logic/mej-type.mjs";

const sessionPage = { type: "mej-campaign-companion.session" };
const textPage = { type: "text" };
const entryWith = (...pages) => ({ pages: { contents: pages } });

describe("isSessionDoc", () => {
  it("is true for a page carrying the native session subtype", () => {
    expect(isSessionDoc(sessionPage)).toBe(true);
  });

  it("is false for a plain text page", () => {
    expect(isSessionDoc(textPage)).toBe(false);
  });

  it("is true for a single-page entry whose only page is a session", () => {
    expect(isSessionDoc(entryWith(sessionPage))).toBe(true);
  });

  it("is false for a multi-page entry, matching MEJ's single-page rule", () => {
    expect(isSessionDoc(entryWith(sessionPage, textPage))).toBe(false);
  });

  it("is false for an entry with no pages, null, and undefined", () => {
    expect(isSessionDoc(entryWith())).toBe(false);
    expect(isSessionDoc(null)).toBe(false);
    expect(isSessionDoc(undefined)).toBe(false);
  });
});

describe("mejTypeWith", () => {
  it("reports a session even when the injected getMEJType says false (stock MEJ)", () => {
    expect(mejTypeWith(sessionPage, () => false)).toBe("session");
  });

  it("delegates to getMEJType for MEJ's own built-in types", () => {
    expect(mejTypeWith(textPage, () => "person")).toBe("person");
  });

  it("returns false when the document is neither a session nor MEJ-typed", () => {
    expect(mejTypeWith(textPage, () => false)).toBe(false);
  });

  it("returns false rather than throwing when getMEJType is missing", () => {
    expect(mejTypeWith(textPage, undefined)).toBe(false);
  });

  it("normalizes a getMEJType undefined return to false", () => {
    expect(mejTypeWith(textPage, () => undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- mej-type`
Expected: FAIL — cannot resolve `../scripts/logic/mej-type.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/mej-type.mjs`:

```js
// Session identity, independent of Monk's Enhanced Journal's type registry.
//
// The companion used to ask game.MonksEnhancedJournal.getMEJType(doc) whether
// a document was one of "ours". That works for MEJ's built-in types, but not
// for our own Session type on a STOCK MEJ install: getMEJType validates the
// monks-enhanced-journal.type flag against MEJ's registry, which only knows
// about "session" when the extension API registered it. On stock it returns
// false for every Session page - silently, with no error - so sessions would
// vanish from search, auto-link, the Hub index, export and the graph.
//
// The native page type (SESSION_DOCUMENT_TYPE, a Foundry module-declared
// subtype from module.json) is owned by Foundry itself: no MEJ build can
// scrub it, and it means the same thing in both modes. It is the truth here.
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

/**
 * Is this document one of our Session pages (or the single-page entry
 * wrapping one)? Mirrors getMEJType's contract: page OR entry, and an entry
 * only counts when it has exactly one page (MEJ's own rule).
 * @param {object|null|undefined} doc
 * @returns {boolean}
 */
export function isSessionDoc(doc) {
  if (!doc) return false;
  if (doc.type === SESSION_DOCUMENT_TYPE) return true;
  const pages = doc.pages?.contents;
  if (!Array.isArray(pages) || pages.length !== 1) return false;
  return pages[0]?.type === SESSION_DOCUMENT_TYPE;
}

/**
 * Drop-in replacement for game.MonksEnhancedJournal.getMEJType, with Session
 * pages resolved from the native subtype first.
 * @param {object|null|undefined} doc
 * @param {((doc: object) => string|false|undefined)|undefined} getMEJType
 * @returns {string|false} short MEJ type key, or false
 */
export function mejTypeWith(doc, getMEJType) {
  if (isSessionDoc(doc)) return SESSION_TYPE;
  return getMEJType?.(doc) || false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- mej-type`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/mej-type.mjs test/mej-type.test.js
git commit -m "feat: native-subtype Session identity independent of MEJ's registry"
```

---

### Task 3: Adapter seam and bootstrap split

**Files:**
- Create: `scripts/integrations/mej-adapter.mjs`
- Modify: `scripts/constants.mjs` (add `FORCE_NATIVE_MODE_SETTING`)
- Modify: `scripts/campaign-companion.mjs` (register the setting; hand the handshake and `ready` to the adapter; route both Hub entry points through `openHub()`)
- Modify: `lang/en.json` (add `errors.mej-missing`; remove `errors.mej-api-missing`)

**Interfaces:**
- Consumes: `resolveMode`, `MODE_API`, `MODE_NATIVE`, `MODE_ABSENT` (Task 1); `mejTypeWith` (Task 2).
- Produces, all from `scripts/integrations/mej-adapter.mjs`:
  - `mejType(doc)` → short type key or `false` (Task 4 rewires 16 call sites to this)
  - `onHandshake(api)` → `Promise<void>`
  - `onReady()` → `Promise<"api"|"native"|"absent">`
  - `currentMode()` → `"api"|"native"|"absent"|null`
  - `wiringFailed()` → boolean
  - `openHub()` → `Promise<void>`
  - `registerCore()` → `Promise<void>`

**Context the implementer needs:**

1. `wireNativeMode()` is a **stub in this task** — it must exist and be called, but its body is filled in by Tasks 5 and 6. Give it the body shown below (a single `console.log`) and nothing more.
2. Ordering fact you may rely on: this module's `<script type="module">` tag is emitted **before** MEJ's (Foundry sorts by module id, and `mej-campaign-companion` < `monks-enhanced-journal`), so our `Hooks.once("init")` handler is registered first and runs first. Our settings therefore exist before MEJ's `init` fires the handshake. The `try/catch` in `forceNative()` is belt-and-braces for the day that ordering changes; do not remove it.
3. Do not move the existing `preCreateJournalEntry` ownership hook, the `getDocumentSheetHeaderButtons` hook, or the settings registrations out of `campaign-companion.mjs`.
4. The adapter's import list includes `SESSION_DOCUMENT_TYPE`, which nothing uses **until Task 5** fills in `wireNativeMode`. Import it now anyway; it is not dead code.

- [ ] **Step 1: Add the setting constant**

In `scripts/constants.mjs`, immediately after the `RETRO_LINK_PENDING_FLAG` block, add:

```js
/** Client setting (hidden): pretend the MEJ extension API is absent, for testing native mode. */
export const FORCE_NATIVE_MODE_SETTING = "forceNativeMode";
```

- [ ] **Step 2: Write the adapter**

Create `scripts/integrations/mej-adapter.mjs`:

```js
// The one module that knows which Monk's Enhanced Journal we are talking to.
//
// Everything mode-dependent lives here. The rest of the module is written
// once and runs identically on a stock MEJ install and on a build carrying
// the extension API - see docs/superpowers/specs/2026-08-17-mej-api-optional-design.md.
import {
  MODULE_ID, HUB_PAGE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE,
  FORCE_NATIVE_MODE_SETTING, I18N
} from "../constants.mjs";
import { resolveMode, MODE_API, MODE_NATIVE, MODE_ABSENT } from "../logic/mej-mode.mjs";
import { mejTypeWith } from "../logic/mej-type.mjs";
import { initSearchHooks } from "../search/live-index.mjs";
import { registerAutoLink } from "../hooks/auto-link.mjs";
import { registerRetroLink } from "../hooks/retro-link.mjs";
import { registerAutoCapture } from "../hooks/auto-capture.mjs";

let handshakeFired = false;
let mode = null;
let coreRegistered = false;
let wiringThrew = false;

/** @returns {"api"|"native"|"absent"|null} null until resolution happens. */
export function currentMode() {
  return mode;
}

/** True when a wiring step threw - the ready hook surfaces this to the GM. */
export function wiringFailed() {
  return wiringThrew;
}

/**
 * Drop-in for game.MonksEnhancedJournal.getMEJType that also recognises our
 * own Session pages by their native subtype (stock MEJ's registry does not).
 * @param {object} doc a JournalEntry or JournalEntryPage
 * @returns {string|false}
 */
export function mejType(doc) {
  return mejTypeWith(doc, (d) => game.MonksEnhancedJournal?.getMEJType?.(d));
}

function forceNative() {
  // Defensive: if module script order ever changed such that this is read
  // before our own init registered the setting, treat it as off rather than
  // throwing out of MEJ's handshake.
  try {
    return !!game.settings.get(MODULE_ID, FORCE_NATIVE_MODE_SETTING);
  } catch (err) {
    return false;
  }
}

/**
 * Everything that needs only Foundry hooks and MEJ's presence - i.e. all of
 * the module except the Session sheet and the Hub. Idempotent: whichever
 * mode path wins calls it exactly once.
 */
export async function registerCore() {
  if (coreRegistered) return;
  coreRegistered = true;

  initSearchHooks();
  registerAutoLink();
  registerRetroLink();
  registerAutoCapture();

  const { registerKnowledgePanel } = await import("../hooks/knowledge-ui.mjs");
  registerKnowledgePanel();

  const { registerQueryEnricher } = await import("../hooks/query-enricher.mjs");
  registerQueryEnricher();

  const { registerSecretsUi } = await import("../hooks/secrets-ui.mjs");
  registerSecretsUi();

  const { registerRelationshipsUi } = await import("../hooks/relationships-ui.mjs");
  registerRelationshipsUi();
}

/** Shell-integrated Session sheet + Hub tab, via MEJ's extension API. */
async function wireApiMode(api) {
  // Deferred imports: these two files statically import MEJ's
  // EnhancedJournalSheet.js, and our script tag runs BEFORE MEJ's. Importing
  // them at top level would re-enter MEJ's own import chain mid-evaluation
  // and take both modules down - see campaign-companion.mjs's header comment.
  const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs")
  ]);

  api.registerSheetType({
    key: SESSION_TYPE,
    moduleId: MODULE_ID,
    sheetClass: SessionSheet,
    label: `${I18N}.sheettype.session`,
    icon: "fa-dice-d20",
    relationships: ["person", "place", "quest", "encounter", "event", "organization", "loot", "shop", "poi"]
  });

  api.registerShellPage({
    id: HUB_PAGE_ID,
    label: `${I18N}.hub.title`,
    icon: "fa-timeline",
    appClass: CampaignHubPage
  });

  // Foundry's DocumentSheetV2 machinery needs an entry in
  // CONFIG.JournalEntryPage.sheetClasses for the Hub's synthetic type or
  // getSheetThemeForDocument throws while constructing the sheet. See the
  // long comment this replaced in campaign-companion.mjs for why poking
  // CONFIG directly does not stick.
  registerHubSheetClass(CampaignHubPage);
}

/**
 * Shared by both modes: the Hub's synthetic page type must resolve in
 * CONFIG.JournalEntryPage.sheetClasses. Route through the real
 * DocumentSheetConfig.registerSheet so it survives the rebuild Foundry does
 * when game.ready flips.
 */
export function registerHubSheetClass(CampaignHubPage) {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
    types: [HUB_PAGE_ID],
    makeDefault: false,
    canBeDefault: false,
    canConfigure: false,
    label: `${I18N}.hub.title`
  });
}

/** Standalone Session sheet + Hub window, for a stock MEJ install. */
async function wireNativeMode() {
  console.log(`${MODULE_ID} | native mode wiring (Session sheet and Hub window)`);
}

/** Called from MEJ's setupMonksEnhancedJournal hook. */
export async function onHandshake(api) {
  handshakeFired = true;
  // forceNativeMode: ignore the API entirely and let the ready path wire
  // native mode, so native mode is testable on an API-carrying build.
  if (forceNative()) return;

  mode = MODE_API;
  try {
    await registerCore();
    await wireApiMode(api);
    console.log(`${MODULE_ID} | mode: ${mode}`);
  } catch (err) {
    wiringThrew = true;
    console.error(`${MODULE_ID} | api-mode wiring failed`, err);
  }
}

/**
 * Called from the ready hook. Resolves the mode if the handshake never got
 * there first, and wires whatever that mode needs.
 * @returns {Promise<"api"|"native"|"absent">}
 */
export async function onReady() {
  if (mode === MODE_API) return mode;

  const mejActive = !!game.modules.get("monks-enhanced-journal")?.active;
  mode = resolveMode({ handshakeFired, mejActive, forceNative: forceNative() });
  console.log(`${MODULE_ID} | mode: ${mode}`);
  if (mode === MODE_ABSENT) return mode;

  try {
    await registerCore();
    await wireNativeMode();
  } catch (err) {
    wiringThrew = true;
    console.error(`${MODULE_ID} | native-mode wiring failed`, err);
  }
  return mode;
}

/** Open the Campaign Hub: a shell tab in api mode, a window in native mode. */
export async function openHub() {
  try {
    if (mode === MODE_API) {
      await game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID);
      return;
    }
    const { openHubWindow } = await import("../apps/hub-window.mjs");
    await openHubWindow();
  } catch (err) {
    console.error(`${MODULE_ID} | opening the campaign hub failed`, err);
  }
}
```

- [ ] **Step 3: Register the forceNativeMode setting**

In `scripts/campaign-companion.mjs`, add `FORCE_NATIVE_MODE_SETTING` to the import list from `./constants.mjs`, and inside the existing `Hooks.once("init", ...)` block — after the `PLAYER_GROUPS_SETTING` registration — add:

```js
  // Hidden client setting: pretend the extension API is absent. This is how
  // native mode gets exercised on a build that HAS the API (the e2e world),
  // and doubles as an escape hatch if shell integration ever misbehaves.
  game.settings.register(MODULE_ID, FORCE_NATIVE_MODE_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
```

- [ ] **Step 4: Hand the handshake to the adapter**

In `scripts/campaign-companion.mjs`, delete the entire `Hooks.on("setupMonksEnhancedJournal", async (api) => { ... });` block (currently lines 109-251, including the `apiReceived` / `apiSetupThrew` module-level `let` declarations at lines 13-18 and their comment) and replace the hook with:

```js
Hooks.on("setupMonksEnhancedJournal", (api) => onHandshake(api));
```

Add to the imports at the top of the file:

```js
import { onHandshake, onReady, currentMode, wiringFailed, openHub } from "./integrations/mej-adapter.mjs";
import { MODE_ABSENT, MODE_API } from "./logic/mej-mode.mjs";
```

Remove the now-unused imports `initSearchHooks`, `registerAutoLink`, `registerRetroLink`, and `registerAutoCapture` from `campaign-companion.mjs` — they moved into the adapter. Keep `registerSocketDispatcher` and `shouldOwnSessionEntry`.

- [ ] **Step 5: Route both Hub entry points through the adapter**

In `scripts/campaign-companion.mjs`, in the `activateControls` hook, replace:

```js
    callback: () => game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)
```

with:

```js
    callback: () => openHub()
```

and in the `getSceneControlButtons` hook, replace:

```js
    onChange: () => game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)
```

with:

```js
    onChange: () => openHub()
```

- [ ] **Step 6: Rewrite the ready hook**

In `scripts/campaign-companion.mjs`, replace the whole `Hooks.once("ready", ...)` block with:

```js
Hooks.once("ready", async () => {
  const mode = await onReady();

  // Native mode is a SUPPORTED configuration, not an error - it gets no
  // warning. Only a missing MEJ, or a wiring step that actually threw,
  // is worth interrupting the GM for.
  if (mode === MODE_ABSENT || wiringFailed()) {
    const key = wiringFailed() ? "init-failed" : "mej-missing";
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.${key}`), { permanent: true });
    if (mode === MODE_ABSENT) return;
  }

  // Single shared socket listener for the whole module (media relay +
  // player recap relay) - see hooks/socket.mjs's header comment.
  registerSocketDispatcher();
});
```

- [ ] **Step 7: Update the error strings**

In `lang/en.json`, inside `MEJCampaignCompanion.errors`, delete the `"mej-api-missing"` entry and add:

```json
      "mej-missing": "Campaign Companion requires Monk's Enhanced Journal. The module is disabled.",
```

so `errors` contains exactly `mej-missing` and `init-failed`.

- [ ] **Step 8: Verify nothing regressed**

Run: `npm test`
Expected: PASS — the whole suite green, including the 15 tests added by Tasks 1-2. (Assert "no failures", not a total count: the baseline moves as tasks land.)

Run: `grep -rn "apiReceived\|apiSetupThrew\|mej-api-missing" scripts/ lang/`
Expected: no output (all references removed).

Run: `grep -n "openShellPage" scripts/campaign-companion.mjs`
Expected: no output (both entry points now call `openHub()`).

- [ ] **Step 9: Commit**

```bash
git add scripts/integrations/mej-adapter.mjs scripts/constants.mjs scripts/campaign-companion.mjs lang/en.json
git commit -m "refactor: adapter seam resolving api/native/absent MEJ modes

Core registrations no longer live inside the extension-API handshake, so
they run on a stock MEJ install too. Hub entry points route through the
adapter's openHub()."
```

---

### Task 4: Route every type check through the adapter

**Files:**
- Modify: `scripts/campaign-companion.mjs:272,284`
- Modify: `scripts/hooks/relationships-ui.mjs:30`
- Modify: `scripts/hooks/secrets-ui.mjs:23`
- Modify: `scripts/hooks/knowledge-ui.mjs:25`
- Modify: `scripts/hooks/auto-link.mjs:26`
- Modify: `scripts/hooks/retro-link.mjs:24,36`
- Modify: `scripts/search/live-index.mjs:33`
- Modify: `scripts/apps/graph-app.mjs:42`
- Modify: `scripts/apps/export-dialog.mjs:101`
- Modify: `scripts/apps/CampaignHubPage.mjs:202,322,479,508`
- Modify: `scripts/apps/import-wizard.mjs:227`

**Interfaces:**
- Consumes: `mejType(doc)` from `scripts/integrations/mej-adapter.mjs` (Task 3).
- Produces: no new exports. After this task no file outside the adapter calls `game.MonksEnhancedJournal.getMEJType` directly.

**Context the implementer needs:** this is the change that makes Session pages first-class on stock MEJ. `mejType` has exactly `getMEJType`'s contract (page or single-page entry in, short key or `false` out), so every replacement is mechanical. Two consumers — `buildIndexSource` in `scripts/logic/hub-index.mjs` and `eligibleEntries` in `scripts/logic/doc-export-snapshot.mjs` — take the function as an injected parameter; **do not edit those pure modules**, only what their callers inject.

- [ ] **Step 1: Replace every call site**

In each file listed above, add the import (adjusting the relative path per directory — `../integrations/mej-adapter.mjs` from `hooks/`, `apps/`, `search/`, and `sheets/`; `./integrations/mej-adapter.mjs` from `campaign-companion.mjs`):

```js
import { mejType } from "../integrations/mej-adapter.mjs";
```

then replace each occurrence, dropping the optional-call punctuation that guarded MEJ's global:

| Before | After |
|---|---|
| `game.MonksEnhancedJournal?.getMEJType?.(doc)` | `mejType(doc)` |
| `game.MonksEnhancedJournal.getMEJType(entry)` | `mejType(entry)` |
| `game.MonksEnhancedJournal.getMEJType(page)` | `mejType(page)` |
| `game.MonksEnhancedJournal.getMEJType(e)` | `mejType(e)` |
| `game.MonksEnhancedJournal.getMEJType` (bare reference, `CampaignHubPage.mjs:202`) | `mejType` |
| `game.MonksEnhancedJournal.getMEJType(entry)` inside `export-dialog.mjs:101`'s arrow | `mejType(entry)` |

`CampaignHubPage.mjs:508`'s comparison becomes `mejType(p) === "session"` — it already compares against the short key, which `mejType` returns for native Session pages in both modes.

- [ ] **Step 2: Verify no direct calls remain**

Run: `grep -rn "getMEJType" scripts/ --include="*.mjs" | grep -v "logic/mej-type.mjs" | grep -v "integrations/mej-adapter.mjs" | grep -v "^\s*//" | grep -v "\* "`
Expected: no output — every remaining mention is a comment, the pure module, or the adapter.

- [ ] **Step 3: Add a regression test for the stock-MEJ case**

Append to `test/mej-type.test.js`:

```js
describe("stock-MEJ regression: a Session must not read as untyped", () => {
  // Stock MEJ's getMEJType validates the monks-enhanced-journal.type flag
  // against its own registry, which has no "session" key, so it returns
  // false even when the flag is present. Every consumer that gates on the
  // type would drop the page. mejTypeWith must not.
  const stockGetMEJType = () => false;
  const sessionPageWithFlag = {
    type: "mej-campaign-companion.session",
    flags: { "monks-enhanced-journal": { type: "session" } }
  };
  const scrubbedSessionPage = { type: "mej-campaign-companion.session", flags: {} };

  it("survives stock MEJ returning false", () => {
    expect(mejTypeWith(sessionPageWithFlag, stockGetMEJType)).toBe("session");
  });

  it("survives stock MEJ having scrubbed the flag entirely", () => {
    expect(mejTypeWith(scrubbedSessionPage, stockGetMEJType)).toBe("session");
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — whole suite green, including the 2 tests just added.

- [ ] **Step 5: Commit**

```bash
git add scripts/ test/mej-type.test.js
git commit -m "fix: resolve Session identity via native subtype at every call site

Stock MEJ's getMEJType returns false for Session pages (its registry has no
session key), which would silently drop them from search, auto-link, the Hub
index, export and the graph."
```

---

### Task 5: Native-mode Session sheet registration

**Files:**
- Modify: `scripts/integrations/mej-adapter.mjs` (fill in `wireNativeMode`)

**Interfaces:**
- Consumes: `registerHubSheetClass(CampaignHubPage)` and the `wireNativeMode()` stub from Task 3.
- Produces: no new exports. After this task, on a stock MEJ install, opening a Session page from the journal directory renders `SessionSheet`.

**Context the implementer needs:** `SessionSheet` itself needs **no change**. Verified against MEJ source: `EnhancedJournalSheet._onRender` (`sheets/EnhancedJournalSheet.js:702-703`) already ends with `await this.activateListeners(this.trueElement)` and `await this.subRender(context, options)`, and `trueElement` (`:158-162`) returns `this.element` when no `enhancedjournal` is set. The subtype `mej-campaign-companion.session` is already declared in `module.json` under `documentTypes.JournalEntryPage.session`, so Foundry registers the real type regardless of MEJ.

- [ ] **Step 1: Fill in wireNativeMode**

In `scripts/integrations/mej-adapter.mjs`, replace the `wireNativeMode` stub body with:

```js
/** Standalone Session sheet + Hub window, for a stock MEJ install. */
async function wireNativeMode() {
  // Same deferred-import discipline as api mode: these files statically
  // import MEJ's EnhancedJournalSheet.js.
  const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs")
  ]);

  // Pure core Foundry - no MEJ involvement. The subtype itself comes from
  // module.json's documentTypes declaration, so this only says "when Foundry
  // opens a page of that type, use our sheet". SessionSheet needs no changes
  // to work outside MEJ's shell: EnhancedJournalSheet._onRender already calls
  // activateListeners/subRender, and trueElement falls back to this.element.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, SessionSheet, {
    types: [SESSION_DOCUMENT_TYPE],
    makeDefault: true,
    label: `${I18N}.sheettype.session`
  });

  // The Hub's synthetic type needs its sheetClasses entry in this mode too -
  // getSheetThemeForDocument does the same lookup however the sheet is hosted.
  registerHubSheetClass(CampaignHubPage);
}
```

- [ ] **Step 2: Verify the registration is well-formed**

Run: `npm test`
Expected: PASS — whole suite green. No unit test covers Foundry registration; this run only guards against a syntax or import error.

Run: `node --input-type=module -e "import('./scripts/integrations/mej-adapter.mjs').then(() => console.log('import ok')).catch((e) => { console.log('EXPECTED: fails only on Foundry globals ->', e.message); })"`
Expected: either `import ok` or a message about a Foundry global — **not** a syntax error or an unresolved-specifier error.

- [ ] **Step 3: Commit**

```bash
git add scripts/integrations/mej-adapter.mjs
git commit -m "feat: register SessionSheet through core Foundry in native mode"
```

---

### Task 6: The Hub window

**Files:**
- Create: `scripts/apps/hub-window.mjs`

**Interfaces:**
- Consumes: `CampaignHubPage` from `scripts/apps/CampaignHubPage.mjs`; `openHub()` in the adapter already dynamic-imports this module and calls `openHubWindow()`.
- Produces: `openHubWindow()` → `Promise<CampaignHubPage>` — renders the Hub as its own window, or brings the existing one to the front.

**Context the implementer needs — this design is verified live, do not improvise:**

On 2026-08-17 this exact construction was probed in the running World A (GM client) and rendered the complete Hub standalone: all five tabs, 15 index rows, 49 `data-action` controls, and clicking the Timeline tab switched the active tab — proving listeners bound through the inherited `_onRender`. Therefore:

- Use a plain `render(true)`. Do **not** hand-drive `_configureRenderOptions` / `_prepareContext` / `_renderHTML` / `_replaceHTML` — that is what MEJ's shell must do, and it is unnecessary here.
- Do **not** pass an `enhancedjournal` option. Leaving it undefined is what makes `trueElement` resolve to the window's own element.
- MEJ's `BlankJournal` is module-private (not exported), so the stub below reproduces its shape. Every member is load-bearing: `id`/`uuid`/`documentName` for the sheet's DOM attributes, `isOwner` for `editable`, `compendium` because `foundry.abstract.Document#compendium` is abstract and throws, `testUserPermission` because the schema has no `ownership` field (so the inherited implementation always returns NONE and non-GMs would be refused), and `apps` because `DocumentSheetV2._onFirstRender` writes to it.
- The Hub keeps all its state on the module-level `HUB_STATE` in `CampaignHubPage.mjs`, so a fresh stub per open loses nothing.
- Styling needs no work: the template's outer `<div class="mej-cc-hub">` is stripped by Foundry's `root: true` part handling in **both** modes (verified — MEJ's shell subsheet has the same first child, `.flexcol.journal-subsheet`), so the window is already at parity with the shell.

- [ ] **Step 1: Write the module**

Create `scripts/apps/hub-window.mjs`:

```js
// The Campaign Hub as its own window, for native mode (a stock MEJ install
// with no extension API, so no shell page to host the Hub as a tab).
//
// In api mode the Hub's document is MEJ's own ephemeral BlankJournal
// placeholder. That class is module-private, so this file reproduces its
// shape - see the spec's "Campaign Hub" section for the live verification
// that CampaignHubPage renders correctly against it through a plain
// render(true).
import { MODULE_ID, HUB_PAGE_ID, I18N } from "../constants.mjs";

/**
 * Stand-in for MEJ's private BlankJournal. Every member matters:
 *  - id/uuid/documentName: the sheet stamps these onto its root element.
 *  - isOwner: DocumentSheetV2 derives `editable` from it.
 *  - compendium: foundry.abstract.Document#compendium is abstract and throws;
 *    a real non-compendium document reports null.
 *  - testUserPermission: the schema has no ownership field, so the inherited
 *    implementation always resolves NONE and non-GM viewers would be refused.
 *  - apps: DocumentSheetV2._onFirstRender writes itself into it.
 */
class HubShellDocument extends foundry.abstract.Document {
  constructor(options) {
    super(options);
    foundry.utils.mergeObject(this, options);
    this.apps = {};
  }

  static defineSchema() {
    return {
      name: new foundry.data.fields.StringField({ required: false, blank: true }),
      type: new foundry.data.fields.StringField({ required: true, blank: true, initial: HUB_PAGE_ID }),
      content: new foundry.data.fields.StringField({ required: false, blank: true }),
      options: new foundry.data.fields.SchemaField({
        hidebuttons: new foundry.data.fields.BooleanField({ initial: true }),
        position: new foundry.data.fields.ObjectField(),
        window: new foundry.data.fields.ObjectField()
      }),
      flags: new foundry.data.fields.DocumentFlagsField()
    };
  }

  get id() {
    return `${MODULE_ID}-hub`;
  }

  get uuid() {
    return `${MODULE_ID}-hub`;
  }

  get documentName() {
    return "JournalEntryPage";
  }

  get isOwner() {
    return true;
  }

  get compendium() {
    return null;
  }

  testUserPermission() {
    return true;
  }
}

let hubWindow = null;

/**
 * Open the Campaign Hub in its own window, or focus the open one.
 * @returns {Promise<object>} the rendered CampaignHubPage instance
 */
export async function openHubWindow() {
  if (hubWindow?.rendered) {
    hubWindow.bringToFront();
    return hubWindow;
  }

  const { CampaignHubPage } = await import("./CampaignHubPage.mjs");
  const document = new HubShellDocument({
    name: game.i18n.localize(`${I18N}.hub.title`),
    type: HUB_PAGE_ID,
    flags: {},
    content: ""
  });

  // No `enhancedjournal` option on purpose: EnhancedJournalSheet#trueElement
  // returns this.enhancedjournal ? this.enhancedjournal.subsheetElement :
  // this.element, so leaving it unset points the sheet's own listeners at
  // this window's element.
  hubWindow = new CampaignHubPage({ document, editable: true });
  await hubWindow.render(true);
  return hubWindow;
}
```

- [ ] **Step 2: Verify the module parses and exports correctly**

Run: `node --input-type=module -e "import('./scripts/apps/hub-window.mjs').then((m) => console.log('exports:', Object.keys(m))).catch((e) => console.log('EXPECTED: Foundry global ->', e.message))"`
Expected: either `exports: [ 'openHubWindow' ]` or a message naming a Foundry global (`foundry is not defined`) — **not** a syntax error.

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: PASS — whole suite green.

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/hub-window.mjs
git commit -m "feat: Campaign Hub as a standalone window for native mode"
```

---

### Task 7: API-mode flag self-heal

**Files:**
- Create: `scripts/logic/session-flag-heal.mjs`
- Create: `test/session-flag-heal.test.js`
- Modify: `scripts/integrations/mej-adapter.mjs` (export `healSessionFlags`, call it from `onReady` in api mode)

**Interfaces:**
- Consumes: `MODE_API` and the adapter's `currentMode()` (Task 3); `isSessionDoc` (Task 2).
- Produces: `planFlagHeal(pages)` → `string[]` of uuids needing a re-stamp (pure); `healSessionFlags()` → `Promise<number>` (count re-stamped) from the adapter.

**Context the implementer needs:** stock MEJ's `fixType` takes an `unsetFlag` branch for any type its registry does not know, so a GM opening a Session page on stock strips `flags["monks-enhanced-journal"].type`. Nothing in the companion reads that flag any more (Task 4), but **api-mode MEJ needs it** to route the page into its shell. So after a world moves stock → fork, the active GM re-stamps it. GM-only (players cannot write documents they do not own), api-mode-only, and silent — this is maintenance, not news.

- [ ] **Step 1: Write the failing test**

Create `test/session-flag-heal.test.js`:

```js
// test/session-flag-heal.test.js
import { describe, it, expect } from "vitest";
import { planFlagHeal } from "../scripts/logic/session-flag-heal.mjs";

const page = (uuid, flagType) => ({ uuid, flagType });

describe("planFlagHeal", () => {
  it("selects only pages whose MEJ type flag is missing", () => {
    expect(planFlagHeal([
      page("a", "session"),
      page("b", undefined),
      page("c", "session")
    ])).toEqual(["b"]);
  });

  it("selects pages whose flag holds the wrong value", () => {
    expect(planFlagHeal([page("a", "person"), page("b", "session")])).toEqual(["a"]);
  });

  it("is empty when every page is already stamped", () => {
    expect(planFlagHeal([page("a", "session"), page("b", "session")])).toEqual([]);
  });

  it("handles empty and missing input without throwing", () => {
    expect(planFlagHeal([])).toEqual([]);
    expect(planFlagHeal(undefined)).toEqual([]);
    expect(planFlagHeal(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- session-flag-heal`
Expected: FAIL — cannot resolve `../scripts/logic/session-flag-heal.mjs`.

- [ ] **Step 3: Write the pure planner**

Create `scripts/logic/session-flag-heal.mjs`:

```js
// Which Session pages need their monks-enhanced-journal.type flag re-stamped?
//
// Stock MEJ scrubs that flag: its fixType() unsets any type its registry does
// not recognise, and a stock registry has no "session". Nothing in this
// module reads the flag any more (identity comes from the native subtype),
// but MEJ's own shell routing needs it - so after a world moves from a stock
// install back to an API-carrying one, the GM re-stamps what was scrubbed.
import { SESSION_TYPE } from "../constants.mjs";

/**
 * @param {{uuid: string, flagType: string|undefined}[]} pages Session pages,
 *        each with the current value of flags["monks-enhanced-journal"].type
 * @returns {string[]} uuids of pages to re-stamp
 */
export function planFlagHeal(pages) {
  return (pages ?? [])
    .filter((page) => page?.flagType !== SESSION_TYPE)
    .map((page) => page.uuid);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- session-flag-heal`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the sweep into the adapter**

In `scripts/integrations/mej-adapter.mjs`, add to the imports:

```js
import { isSessionDoc } from "../logic/mej-type.mjs";
import { planFlagHeal } from "../logic/session-flag-heal.mjs";
```

(`mejTypeWith` is already imported from `../logic/mej-type.mjs` — extend that existing import rather than adding a second one.)

Then add this exported function after `openHub`:

```js
/**
 * Re-stamp the MEJ type flag on Session pages that lost it to a stock MEJ
 * install (its fixType unsets flags for types its registry does not know).
 * API mode only, active GM only, silent. Returns how many pages were fixed.
 * @returns {Promise<number>}
 */
export async function healSessionFlags() {
  if (mode !== MODE_API) return 0;
  if (game.users.activeGM !== game.user) return 0;

  try {
    const sessionPages = [];
    for (const entry of game.journal.contents) {
      for (const page of entry.pages.contents) {
        if (!isSessionDoc(page)) continue;
        sessionPages.push({
          uuid: page.uuid,
          flagType: page.getFlag("monks-enhanced-journal", "type")
        });
      }
    }

    const uuids = planFlagHeal(sessionPages);
    for (const uuid of uuids) {
      const page = await fromUuid(uuid);
      await page?.setFlag("monks-enhanced-journal", "type", SESSION_TYPE);
    }
    if (uuids.length) {
      console.log(`${MODULE_ID} | re-stamped the MEJ type flag on ${uuids.length} session page(s)`);
    }
    return uuids.length;
  } catch (err) {
    console.error(`${MODULE_ID} | session flag heal failed`, err);
    return 0;
  }
}
```

Note `isSessionDoc(page)` is used here rather than `mejType(page)` deliberately: the sweep must find Session pages **by their native subtype only**, since the flag it is repairing is exactly what may be missing.

- [ ] **Step 6: Call the sweep from the ready hook**

In `scripts/campaign-companion.mjs`, extend the import from the adapter to include `healSessionFlags`, and add it as the last statement inside the `ready` hook, after `registerSocketDispatcher()`:

```js
  // A world that spent time on a stock MEJ install comes back with the MEJ
  // type flag scrubbed off its Session pages; put it back so MEJ's shell
  // routes them again. No-op in native mode and for non-active-GM clients.
  await healSessionFlags();
```

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS — whole suite green, including the 4 heal-planner tests.

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/session-flag-heal.mjs test/session-flag-heal.test.js scripts/integrations/mej-adapter.mjs scripts/campaign-companion.mjs
git commit -m "feat: re-stamp MEJ type flags scrubbed by a stock install"
```

---

### Task 8: "New Session" button in the Hub

**Files:**
- Modify: `templates/hub.hbs` (add a button beside the existing Import/Export controls, lines 49-59)
- Modify: `scripts/apps/CampaignHubPage.mjs` (add the `newSession` action and its handler)
- Modify: `lang/en.json` (add `hub.newSession`)

**Interfaces:**
- Consumes: `buildSessionPageData(name, html, campaignDate, sessionNumber)` from `scripts/logic/session-page-data.mjs` — returns page data carrying the native `SESSION_DOCUMENT_TYPE`, the companion's `session` flags, and the MEJ type flag.
- Produces: no new exports.

**Context the implementer needs:** in native mode MEJ's New Entry dialog cannot create Sessions (its type registry has no `session`), so the Hub becomes the creation path. The button is shown in **both** modes for UI uniformity, and it must go through the same `JournalEntry.create` path the import wizard uses so the existing `preCreateJournalEntry` ownership hook still applies `playersWriteSessions`. GM-only, like the neighbouring Import/Export buttons (`{{#if isGM}}`).

- [ ] **Step 1: Add the button to the template**

In `templates/hub.hbs`, inside the existing `{{#if isGM}}` block that holds the import and export buttons, add as the first button in that block (immediately after the `{{#if isGM}}` line at line 51):

```hbs
                            <button type="button" class="mej-cc-new-session" data-action="newSession"
                                    data-tooltip="{{localize 'MEJCampaignCompanion.hub.newSession'}}">
                                <i class="fa-solid fa-dice-d20"></i> {{localize 'MEJCampaignCompanion.hub.newSession'}}
                            </button>
```

- [ ] **Step 2: Add the string**

In `lang/en.json`, inside `MEJCampaignCompanion.hub`, add:

```json
      "newSession": "New Session",
```

- [ ] **Step 3: Register the action**

In `scripts/apps/CampaignHubPage.mjs`, add to `static DEFAULT_OPTIONS.actions` (alongside `openImportWizard`):

```js
      newSession: CampaignHubPage.onNewSession,
```

and add the import near the other logic imports:

```js
import { buildSessionPageData } from "../logic/session-page-data.mjs";
```

- [ ] **Step 4: Implement the handler**

In `scripts/apps/CampaignHubPage.mjs`, add this static method next to the other action handlers (e.g. just above `onOpenImportWizard`):

```js
  /**
   * Create an empty Session entry and open it. This is the creation path in
   * native mode, where MEJ's own New Entry dialog cannot offer the Session
   * type (its registry only knows about it when the extension API is
   * present). Routed through JournalEntry.create like every other companion
   * creation path, so the preCreateJournalEntry ownership hook still applies
   * the playersWriteSessions setting.
   */
  static async onNewSession() {
    try {
      const name = game.i18n.localize(`${I18N}.hub.newSession`);
      const entry = await JournalEntry.create({
        name,
        pages: [buildSessionPageData(name, "", null, null)]
      });
      const page = entry?.pages?.contents?.[0];
      if (page) await page.sheet.render(true);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | creating a session failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.errors.init-failed`));
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — whole suite green.

- [ ] **Step 6: Commit**

```bash
git add templates/hub.hbs lang/en.json scripts/apps/CampaignHubPage.mjs
git commit -m "feat: create Sessions from the Hub, the native-mode creation path"
```

---

### Task 9: Native-mode e2e, docs, and the 0.5.0 release metadata

**Files:**
- Create: `tests/e2e/12-native-mode.spec.mjs`
- Modify: `module.json` (version → `0.5.0`)
- Modify: `README.md` (new "Running without the MEJ extension API" section; settings table)
- Modify: `CHANGELOG.md` (0.5.0 entry)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: no code exports.

**Context the implementer needs:** the e2e world runs the API-carrying MEJ fork, so native mode is reached by setting the hidden `forceNativeMode` client setting and reloading. Follow the conventions in the existing specs (`tests/e2e/11-auto-link-scope.spec.mjs` is the closest model): run-unique fixture names, create fixtures through the browser context, and restore every setting you change in a cleanup step so later runs and the other 39 tests are unaffected. **Always restore `forceNativeMode` to `false`** — leaving it on would silently put every later spec in native mode.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/12-native-mode.spec.mjs`:

```js
// Native mode: the companion running as if MEJ had no extension API.
// forceNativeMode makes the adapter ignore the API this world's MEJ fork
// does provide, so the fallback surfaces are exercisable here.
import { test, expect } from "@playwright/test";

const RUN = Date.now().toString(36).slice(-5);

async function setForceNative(page, value) {
  await page.evaluate(async (v) => {
    await game.settings.set("mej-campaign-companion", "forceNativeMode", v);
  }, value);
  await page.reload();
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
}

test.describe("native mode (no extension API)", () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await page.evaluate(async (run) => {
      await game.settings.set("mej-campaign-companion", "forceNativeMode", false);
      const doomed = game.journal.filter((j) => j.name.includes(`TT${run}`));
      for (const entry of doomed) await entry.delete();
    }, RUN);
    await page.close();
  });

  test("resolves native mode and still registers core features", async ({ page }) => {
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await setForceNative(page, true);

    const state = await page.evaluate(async () => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");
      return {
        mode: adapter.currentMode(),
        wiringFailed: adapter.wiringFailed(),
        // The Session sheet must be registered through core Foundry.
        sessionSheetRegistered: Object.keys(
          CONFIG.JournalEntryPage.sheetClasses["mej-campaign-companion.session"] ?? {}
        ).some((k) => k.startsWith("mej-campaign-companion")),
        // Core features are wired by hooks, not by the API.
        hasSearchHook: Hooks.events.createJournalEntryPage?.length > 0
      };
    });

    expect(state.mode).toBe("native");
    expect(state.wiringFailed).toBe(false);
    expect(state.sessionSheetRegistered).toBe(true);
    expect(state.hasSearchHook).toBe(true);
  });

  test("opens the Hub as a standalone window with working tabs", async ({ page }) => {
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await setForceNative(page, true);

    const opened = await page.evaluate(async () => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");
      await adapter.openHub();
      await new Promise((r) => setTimeout(r, 800));
      const el = document.querySelector('[id^="CampaignHubPage-"]');
      const tabs = el ? el.querySelectorAll("[data-tab]") : [];
      // Clicking a tab proves activateListeners bound outside MEJ's shell.
      const timeline = Array.from(tabs).find((n) => n.dataset.tab === "timeline" && n.tagName !== "SECTION");
      timeline?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        rendered: !!el,
        tabCount: tabs.length,
        activeTab: el?.querySelector("section.tab.active")?.dataset?.tab ?? null,
        // No MEJ shell tab was created for the hub in this mode.
        shellOpen: !!game.MonksEnhancedJournal.journal?.rendered
      };
    });

    expect(opened.rendered).toBe(true);
    expect(opened.tabCount).toBeGreaterThan(0);
    expect(opened.activeTab).toBe("timeline");
    expect(opened.shellOpen).toBe(false);
  });

  test("a Session page is first-class: native sheet and indexed by type", async ({ page }) => {
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await setForceNative(page, true);

    const result = await page.evaluate(async (run) => {
      const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      const name = `TT${run} native session`;
      const entry = await JournalEntry.create({ name, pages: [buildSessionPageData(name, "", null, null)] });
      const pageDoc = entry.pages.contents[0];

      // Stock MEJ would report false here; the adapter must still say session.
      const stockAnswer = game.MonksEnhancedJournal.getMEJType(pageDoc);
      const adapterAnswer = adapter.mejType(pageDoc);

      await pageDoc.sheet.render(true);
      await new Promise((r) => setTimeout(r, 800));
      const sheetEl = document.querySelector('[id^="SessionSheet-"]');
      const rendered = !!sheetEl;
      await pageDoc.sheet.close();

      return { stockAnswer, adapterAnswer, rendered, nativeType: pageDoc.type };
    }, RUN);

    expect(result.nativeType).toBe("mej-campaign-companion.session");
    expect(result.adapterAnswer).toBe("session");
    expect(result.rendered).toBe(true);
  });

  test("api mode still resolves when forceNativeMode is off", async ({ page }) => {
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await setForceNative(page, false);

    const mode = await page.evaluate(async () => {
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");
      return adapter.currentMode();
    });
    expect(mode).toBe("api");
  });

  test("api mode re-stamps a MEJ type flag a stock install scrubbed", async ({ page }) => {
    await page.goto("/game");
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
    await setForceNative(page, false);

    // Create a session, then strip its MEJ type flag the way stock MEJ's
    // fixType() would, and confirm the sweep puts it back.
    const result = await page.evaluate(async (run) => {
      const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
      const adapter = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");

      const name = `TT${run} heal session`;
      const entry = await JournalEntry.create({ name, pages: [buildSessionPageData(name, "", null, null)] });
      const pageDoc = entry.pages.contents[0];

      await pageDoc.unsetFlag("monks-enhanced-journal", "type");
      const scrubbed = pageDoc.getFlag("monks-enhanced-journal", "type") ?? null;

      const healed = await adapter.healSessionFlags();
      const restored = pageDoc.getFlag("monks-enhanced-journal", "type") ?? null;

      return { scrubbed, healed, restored };
    }, RUN);

    expect(result.scrubbed).toBe(null);
    expect(result.healed).toBeGreaterThanOrEqual(1);
    expect(result.restored).toBe("session");
  });
});
```

- [ ] **Step 2: Run the new spec**

Run: `npm run test:e2e -- 12-native-mode`
Expected: PASS (5 tests).

- [ ] **Step 3: Run the whole e2e suite**

Run: `npm run test:e2e`
Expected: PASS — 44 tests (39 existing + 5 new). If an existing spec fails, check first that `forceNativeMode` was restored to `false`: leaving it on puts every later spec in native mode.

- [ ] **Step 4: Bump the version**

In `module.json`, set:

```json
  "version": "0.5.0",
```

Leave the `download` URL pointing at the previous release — by this project's convention it is patched only in the published release asset, never in the repo.

- [ ] **Step 5: Document it in the README**

In `README.md`, add this section immediately after the auto-link scoping section:

```markdown
## Running without the MEJ extension API (0.5.0)

The companion works against a stock Monk's Enhanced Journal install as well as
a build carrying the extension API. It resolves one of three modes at startup:

| Mode | When | What you get |
|------|------|--------------|
| `api` | MEJ fires `setupMonksEnhancedJournal` | Everything, with the Session sheet and Campaign Hub inside MEJ's tabbed shell |
| `native` | MEJ is installed without the extension API | Everything, with the Session sheet and Hub as standalone windows |
| `absent` | MEJ is not active | The module stays inert — MEJ is a hard dependency |

Native mode is a supported configuration, not a degraded fallback, and it is
not announced with a warning. What differs:

- Session does not appear in MEJ's own "New Entry" dialog — create sessions
  with the **New Session** button in the Campaign Hub.
- Session pages cannot be MEJ *relationship* targets (MEJ's picker only
  enumerates its own registry). Companion relationships are unaffected.
- The Hub opens as its own window rather than a shell tab.
- The "open graph" and "prep board" header buttons are absent; both remain
  reachable — the graph from the Hub toolbar, the prep board from the button
  on the Session sheet itself.

Sessions are identified by their native Foundry page type
(`mej-campaign-companion.session`), never by MEJ's type flag, so they stay
first-class in search, auto-linking, the Hub index, export and the graph in
both modes. A stock MEJ install strips the module's `monks-enhanced-journal`
type flag from Session pages; if the world later runs an API-carrying build
again, the GM's client silently re-stamps it, so worlds can move between
builds with no migration.
```

Also update the settings table in that README: it currently lists 8 settings (5 visible, 3 internal). `forceNativeMode` is a hidden **client** setting, bringing it to 9 total (5 visible, 4 internal). Add the row:

```markdown
| `forceNativeMode` | client | hidden | Ignore the MEJ extension API and use native mode (testing / escape hatch) |
```

- [ ] **Step 6: Add the changelog entry**

At the top of `CHANGELOG.md`, add:

```markdown
## 0.5.0

- Works on a stock Monk's Enhanced Journal install: the module no longer needs
  the `setupMonksEnhancedJournal` extension API. A new adapter resolves
  `api` / `native` / `absent` mode, and everything that never needed the API
  (search, auto-linking, retroactive linking, encounter and media capture, the
  knowledge panel, the query enricher, secrets and relationship reveals) now
  registers in every mode.
- Session pages are identified by their native Foundry subtype rather than
  MEJ's type flag. On a stock install that flag is scrubbed and MEJ reports
  Sessions as untyped, which previously would have dropped them from search,
  auto-linking, the Hub index, export and the graph.
- Native mode: the Session sheet registers through core Foundry and the
  Campaign Hub opens as its own window. New **New Session** button in the Hub.
- Worlds can move between a stock and an API-carrying MEJ build with no
  migration: the GM's client re-stamps type flags a stock install scrubbed.
- New hidden client setting `forceNativeMode` to exercise native mode on a
  build that does have the API.
```

- [ ] **Step 7: Final verification**

Run: `npm test`
Expected: PASS — whole unit suite green.

Run: `npm run test:e2e`
Expected: PASS — 44 e2e tests.

Run: `git status --short`
Expected: clean except the files this task touched.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/12-native-mode.spec.mjs module.json README.md CHANGELOG.md
git commit -m "test: native-mode e2e coverage; docs and 0.5.0 metadata"
```

---

## Notes for the executing agent

- **Do not** add a journal-directory button, a native shell-tab emulation, or
  any libWrapper patch. Those were considered and explicitly rejected in the
  spec's Non-goals.
- The riskiest piece (Task 6) was verified live before this plan was written;
  if the Hub window does not render, the deviation is in the stub document's
  shape — compare it member by member against MEJ's `BlankJournal`
  (`apps/enhanced-journal.js:15-82`) rather than switching to a
  manually-driven render.
- Task 3 leaves `wireNativeMode` deliberately stubbed; Tasks 5 and 6 complete
  it. A reviewer seeing the stub in Task 3 should not treat it as a defect.
- **Release gate (human-run, before publishing 0.5.0):** the e2e suite reaches
  native mode through `forceNativeMode` on a world whose MEJ *does* carry the
  API, so it cannot prove behavior against a genuinely stock MEJ. Before
  cutting the release, point the test world's `monks-enhanced-journal` symlink
  at a stock upstream checkout, reload, and confirm four things by hand: the
  resolved mode is `native` with no error notification, the Hub opens from the
  scene-controls button, a Session page opens from the journal directory with
  working controls, and a Session created there still appears in Hub search.
  Then swap the symlink back and confirm the flag heal restored the MEJ type
  flags (a fork-side reload plus one Hub search for the same Session).
