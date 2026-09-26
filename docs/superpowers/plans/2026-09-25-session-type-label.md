# Session Type Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MEJ's New Entry dialog (and every other reader of Foundry's page-type labels) shows the companion's page types as "Session" and "Campaign" instead of the raw `TYPES.JournalEntryPage.mej-campaign-companion.*` keys.

**Architecture:** Foundry labels a module page subtype with the key `TYPES.JournalEntryPage.<module-id>.<subtype>` and expects the module's language file to define it; `lang/en.json` defines none. Add the two translations (no code change), prove they resolve, prove on both test worlds that the now-labelled dialog option creates a working Session, then update docs and cut 0.22.1.

**Tech Stack:** Foundry VTT v13/v14 module (plain ES modules), vitest units in `test/*.test.js`, Playwright e2e in `tests/e2e/*.spec.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-25-session-type-label-design.md`

## Global Constraints

- Companion repo: `/Users/danbularzik/Claude/Projects/mej-campaign-companion`. Never edit the MEJ repo.
- Translation keys (exact): `TYPES.JournalEntryPage.mej-campaign-companion.session` → `"Session"`, `TYPES.JournalEntryPage.mej-campaign-companion.campaign` → `"Campaign"`, written nested under a top-level `"TYPES"` object in `lang/en.json`.
- World A = Foundry 14.368 + the MEJ fork with the extension API (api mode). World B = Foundry 13.351 + stock MEJ 13.06 (native mode). Both run dnd5e.
- E2E creates only `TT-` named documents (this plan's prefix: `TT-Stl`), deleted in cleanup; never touch anything else on World A (never "Radiant Citadel").
- Guard: if choosing the Adventure Book "Session" option in MEJ's New Entry dialog does NOT create a working Session on either world, the implementer stops and reports BLOCKED with evidence — do not ship the label on a broken option, do not weaken the test.
- Release version: `0.22.1`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Api mode shows Session twice** (World A): MEJ's "Single Sheet" group already has a `session` option labelled "Session"; after this fix the "Adventure Book" group's `mej-campaign-companion.session` option also reads "Session". Both must create a working Session (Task 2 exercises the Adventure Book one; `01-session.spec.mjs` already covers the Single Sheet one).
2. **Campaign stays out of MEJ's dialog** — the new "Campaign" label must not make the campaign guard's removal fail (Task 2 re-runs `23-campaign-creation.spec.mjs`).
3. **A missing or misspelt nesting level** silently leaves the raw key — Task 1's unit test resolves the exact dotted keys.
4. **Merging a top-level `TYPES` object** must not disturb Foundry's own `TYPES.*` translations — the key set is additive (Task 1 asserts only the two new leaves exist under `mej-campaign-companion`).

---

### Task 1: Translations and unit test

**Files:**
- Modify: `lang/en.json`
- Test: `test/type-labels.test.js`

**Interfaces:**
- Produces: the two translation keys above.

- [ ] **Step 1: Write the failing test**

Create `test/type-labels.test.js`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Foundry's Localization expands each language file (expandObject) and
// resolves a label with getProperty(translations, key): a dotted walk.
const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

describe("page subtype labels", () => {
  it("resolve Foundry's module-subtype keys", () => {
    expect(lookup(en, "TYPES.JournalEntryPage.mej-campaign-companion.session")).toBe("Session");
    expect(lookup(en, "TYPES.JournalEntryPage.mej-campaign-companion.campaign")).toBe("Campaign");
  });
  it("add only the companion's two subtypes", () => {
    expect(Object.keys(en.TYPES)).toEqual(["JournalEntryPage"]);
    expect(Object.keys(en.TYPES.JournalEntryPage)).toEqual(["mej-campaign-companion"]);
    expect(Object.keys(en.TYPES.JournalEntryPage["mej-campaign-companion"]).sort()).toEqual(["campaign", "session"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/type-labels.test.js`
Expected: FAIL — `en.TYPES` is undefined.

- [ ] **Step 3: Add the translations**

In `lang/en.json`, add a second top-level key after the existing `"MEJCampaignCompanion"` object (add the comma after its closing `}`):

```json
  "TYPES": {
    "JournalEntryPage": {
      "mej-campaign-companion": {
        "session": "Session",
        "campaign": "Campaign"
      }
    }
  }
```

- [ ] **Step 4: Run it to verify it passes, then the full suite**

Run: `npx vitest run test/type-labels.test.js` → PASS. Then `npm test` → all pass (1020 + 2).

- [ ] **Step 5: Commit**

```bash
git add lang/en.json test/type-labels.test.js
git commit -m "fix(i18n): label the Session and Campaign page types

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1b: Stamp MEJ's type flag on Session pages created without it (spec amendment)

**Files:**
- Create: `scripts/logic/session-flag-stamp.mjs`, `scripts/hooks/session-flag-stamp.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (`registerCore()`, a new step after `"actor link controls"`)
- Test: `test/session-flag-stamp.test.js`

**Interfaces:**
- Produces: `sessionFlagPatch(data) -> { "flags.monks-enhanced-journal.type": "session" } | null`; `registerSessionFlagStamp()`.

- [ ] **Step 1: failing test** — `test/session-flag-stamp.test.js`:

```js
import { describe, it, expect } from "vitest";
import { sessionFlagPatch } from "../scripts/logic/session-flag-stamp.mjs";

const PATCH = { "flags.monks-enhanced-journal.type": "session" };
describe("sessionFlagPatch", () => {
  it("stamps a session page that has no MEJ type flag", () => {
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session" })).toEqual(PATCH);
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: {} })).toEqual(PATCH);
    expect(sessionFlagPatch({ type: "session" })).toEqual(PATCH);
  });
  it("never overwrites an existing MEJ type flag", () => {
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "session" } } })).toBeNull();
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "other" } } })).toBeNull();
  });
  it("ignores other page types and bad input", () => {
    for (const d of [{ type: "text" }, { type: "mej-campaign-companion.campaign" }, {}, null, undefined]) expect(sessionFlagPatch(d)).toBeNull();
  });
});
```

Run `npx vitest run test/session-flag-stamp.test.js` → FAIL (module missing).

- [ ] **Step 2: implement** — `scripts/logic/session-flag-stamp.mjs`:

```js
// Stock MEJ's New Entry dialog creates a Session page (type
// mej-campaign-companion.session) with no MEJ type flag, so MEJ opens it as a
// plain JournalEntrySheet. The companion's own creation paths set the flag
// (session-page-data.mjs); this is the patch for pages created any other way
// (spec 2026-09-25 session-type-label, amendment).
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

const MEJ = "monks-enhanced-journal";

export function sessionFlagPatch(data) {
  if (!data || (data.type !== SESSION_DOCUMENT_TYPE && data.type !== SESSION_TYPE)) return null;
  if (data.flags?.[MEJ]?.type !== undefined) return null;
  return { [`flags.${MEJ}.type`]: SESSION_TYPE };
}
```

`scripts/hooks/session-flag-stamp.mjs`:

```js
// Applies sessionFlagPatch to a page before it is written (see
// logic/session-flag-stamp.mjs). updateSource on the pending document is the
// preCreate-hook way to amend the create data.
import { MODULE_ID } from "../constants.mjs";
import { sessionFlagPatch } from "../logic/session-flag-stamp.mjs";

export function registerSessionFlagStamp() {
  Hooks.on("preCreateJournalEntryPage", (page, data) => {
    try {
      const patch = sessionFlagPatch(data);
      if (patch) page.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp failed`, err);
    }
  });
}
```

In `registerCore()` after the `"actor link controls"` step:

```js
  await step("session flag stamp", async () => {
    const { registerSessionFlagStamp } = await import("../hooks/session-flag-stamp.mjs");
    registerSessionFlagStamp();
  });
```

(`SESSION_TYPE` is `"session"` and `SESSION_DOCUMENT_TYPE` is `"mej-campaign-companion.session"` in `scripts/constants.mjs`; check before relying on it.)

- [ ] **Step 3:** `npx vitest run test/session-flag-stamp.test.js` → PASS; `npm test` → all pass.

- [ ] **Step 4: commit** — `fix(session): stamp MEJ's type flag on Session pages created without it` (Opus trailer).

---

### Task 2: End-to-end check on both worlds (includes the guard)

**Files:**
- Create: `tests/e2e/26-session-type-label.spec.mjs`

**Interfaces:**
- Consumes: Task 1's labels. Harness helpers from `tests/e2e/helpers/foundry.mjs`: `login`, `cleanupAsGm`, `trackConsoleErrors`, `assertNoConsoleErrors`, `settle`, `deleteJournalsByPrefix`, `KNOWN_MEJ_SESSION_ICON_404`.

MEJ's New Entry dialog is opened from the journal sidebar header's create button; its type select is `select[name="flags.monks-enhanced-journal.pagetype"]`. The Adventure Book option for the companion's type has the value `mej-campaign-companion.session`. A working Session (as `01-session.spec.mjs` asserts it) has `_source.type === "mej-campaign-companion.session"` and, once MEJ opens it, `game.MonksEnhancedJournal.journal.subsheet.constructor.name === "SessionSheet"`.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/26-session-type-label.spec.mjs`:

```js
// Session page-type label in MEJ's New Entry dialog (spec 2026-09-25
// session-type-label). The "Adventure Book" group lists Foundry's page
// types by CONFIG.JournalEntryPage.typeLabels; the companion's subtype used
// to show as its raw TYPES.* key. Also the guard: that option must create a
// working Session on both MEJ lines (fork/api on World A, stock 13.06 on
// World B).
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const PREFIX = "TT-Stl";
const RUN = Date.now();
const SESSION_TYPE = "mej-campaign-companion.session";

async function openNewEntryDialog(page) {
  await page.evaluate(async () => {
    try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
    await ui.journal.activate();
  });
  await settle(page, 300);
  await page.locator("#journal .directory-header [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  await expect(typeSelect).toBeVisible({ timeout: 10_000 });
  return { dialog, typeSelect };
}

test.describe("26 session type label", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gm) => {
      await gm.evaluate(async () => {
        try {
          await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]);
        } catch { /* nothing open */ }
      });
      await deleteJournalsByPrefix(gm, PREFIX);
    });
  });

  test("the dialog labels the Session type and shows no raw TYPES.* keys", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { typeSelect } = await openNewEntryDialog(page);
    await expect(typeSelect.locator(`option[value="${SESSION_TYPE}"]`)).toHaveText("Session");
    const texts = (await typeSelect.locator("option").allTextContents()).map((t) => t.trim());
    expect(texts.filter((t) => t.startsWith("TYPES."))).toEqual([]);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("choosing it creates a working Session", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${PREFIX}Session${RUN}`;
    const { dialog, typeSelect } = await openNewEntryDialog(page);
    await dialog.locator('input[name="name"]').fill(name);
    await typeSelect.selectOption(SESSION_TYPE);
    await dialog.locator('button[data-action="ok"]').click();

    await expect.poll(() => page.evaluate((n) => game.journal.find((j) => j.name === n)?.id ?? null, name), { timeout: 10_000 }).not.toBeNull();
    const entryId = await page.evaluate((n) => game.journal.find((j) => j.name === n).id, name);
    expect(await page.evaluate((id) => game.journal.get(id).pages.contents[0]?._source.type ?? null, entryId)).toBe(SESSION_TYPE);

    await page.evaluate(async (id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), entryId);
    await expect.poll(
      () => page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name ?? null),
      { timeout: 15_000 }
    ).toBe("SessionSheet");
    await expect(page.locator("#MonksEnhancedJournal .session-container").first()).toBeVisible({ timeout: 10_000 });
    assertNoConsoleErrors(errors);
  });
});
```

**Amendment:** the spec file as committed in Task 2 accepts either Session option value in test 1, skips test 2 where the Adventure Book option is absent (World A), and test 2 also asserts `flags["monks-enhanced-journal"].type === "session"` on the created page.

- [ ] **Step 2: Run it on World A (Foundry 14, api mode)**

Run: `npx playwright test tests/e2e/26-session-type-label.spec.mjs`
Expected: 2 passed (plus setup). If "choosing it creates a working Session" fails for a product reason (wrong page type, a non-Session sheet, errors) — not a selector/timing problem in the spec — STOP: report BLOCKED with the observed page type, subsheet name and console errors. This is the spec's guard.

- [ ] **Step 3: Run it on World B (Foundry 13, stock MEJ)**

Run: `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/26-session-type-label.spec.mjs --trace off`
Expected: 2 passed. Same guard rule as Step 2.

- [ ] **Step 4: Re-run the specs that touch the same dialog**

Run: `npx playwright test tests/e2e/01-session.spec.mjs tests/e2e/23-campaign-creation.spec.mjs`
Expected: all pass (01's dialog test skips only where it already skipped).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/26-session-type-label.spec.mjs
git commit -m "test(e2e): Session type label and creation from MEJ's New Entry dialog

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs, CHANGELOG and version

**Files:**
- Modify: `README.md` (the native-mode section's bullet about Session in MEJ's "New Entry" dialog)
- Modify: `docs/gm-guide.md` (the native-mode section's bullet, currently line ~342, beginning "**Session** appears in MEJ's own "New Entry" dialog only in API mode")
- Modify: `CHANGELOG.md`, `module.json`

**Interfaces:**
- Consumes: Task 2's result — both worlds create a working Session from the dialog.

- [ ] **Step 1: README**

Replace the README bullet that begins "Session appears in MEJ's own "New Entry" dialog only in `api` mode; on stock MEJ it may show up there as an unlocalized `TYPES.JournalEntryPage.…` entry instead — use the **New Session** button in the Campaign Hub either way." (keep the rest of that bullet — the Campaign sentence — unchanged) with:

```markdown
- Session appears in MEJ's own "New Entry" dialog in both modes: in the
  "Adventure Book" group everywhere, and additionally in "Single Sheet" in
  `api` mode. The **New Session** button in the Campaign Hub works too.
```

followed by the unchanged Campaign sentence(s) of the original bullet, re-wrapped as its own sentence in the same bullet.

- [ ] **Step 2: GM guide**

Replace the gm-guide bullet's first sentence ("**Session** appears in MEJ's own "New Entry" dialog only in API mode; on stock MEJ it may show up there as an unlocalized `TYPES.JournalEntryPage.…` entry instead — use the **New Session** button in the Hub's header bar either way.") with:

```markdown
- **Session** appears in MEJ's own "New Entry" dialog in both modes (under "Adventure Book"; with the extension API it is also under "Single Sheet"), and the **New Session** button in the Hub's header bar works too.
```

keeping the bullet's trailing "(**Campaign** is never a page type in either mode; use the sidebar's **New Campaign** button.)" unchanged.

- [ ] **Step 3: CHANGELOG and version**

Add at the top of `CHANGELOG.md`, under `# Changelog`:

```markdown
## 0.22.1 (2026-09-25)

Session label in the New Entry dialog.

- **Fixed:** Monk's Enhanced Journal's New Entry dialog listed the Session page type as `TYPES.JournalEntryPage.mej-campaign-companion.session`; it now reads "Session" (and the Campaign type is labelled "Campaign" wherever Foundry lists page types).
- **Changed:** the README and GM guide no longer describe that raw label; Session can be created from the New Entry dialog on stock MEJ as well as with the extension API.
```

In `module.json` set `"version": "0.22.1"`.

- [ ] **Step 4: Check**

Run: `grep -rn "unlocalized" README.md docs/gm-guide.md` → no hits about `TYPES.JournalEntryPage`. `npm run check:links` → OK. `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/gm-guide.md CHANGELOG.md module.json
git commit -m "docs: Session is labelled in MEJ's New Entry dialog; 0.22.1

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
