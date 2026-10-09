# Player Access Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a GM logs in and MEJ's "Allow players to use Enhanced Journal" is off, explain that Campaign Companion won't work properly for players and offer to turn it on; connected players are asked to reload when it is turned on.

**Architecture:** Pure decision functions in `scripts/logic/player-access.mjs` (vitest), a DialogV2 in `scripts/apps/player-access-dialog.mjs`, Foundry glue in `scripts/hooks/player-access.mjs`, wired from the companion's existing `ready` hook. Players detect the change through Foundry's own setting broadcast (`createSetting`/`updateSetting`), no socket action.

**Tech Stack:** Foundry VTT 13.351 / 14.368 client API (DialogV2, game.settings, Hooks), vitest 3, Playwright 1.62 e2e harness.

**Spec:** `docs/superpowers/specs/2026-10-08-player-access-check-design.md`

## Global Constraints

- Companion-side only. Never modify Monk's Enhanced Journal.
- Works on Foundry 13 + stock MEJ 13.06 (native mode, v13 World B) and Foundry 14 + MEJ 14.x (v14 World A).
- MEJ setting: `game.settings.get("monks-enhanced-journal", "allow-player")`, world scope, registered default `false`.
- New companion world setting key: `warnPlayerAccess`, Boolean, default `true`, `config: true`.
- All user-visible strings live in `lang/en.json` under `MEJCampaignCompanion.playerAccess.*` and `MEJCampaignCompanion.settings.warnPlayerAccess.*`; copy is verbatim from the spec.
- Nothing thrown out of the `ready` hook; failures toast (GM) and `console.error` with the `${MODULE_ID} |` prefix.
- Nobody is reloaded without clicking **Reload**.
- e2e test documents use the prefix `TT-Pac`; every e2e test restores `allow-player = true` and `warnPlayerAccess = true`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`.

## Review Focus

1. **Setting never saved before** (the default on a fresh world): enabling it *creates* the Setting document, so Foundry fires `createSetting`, not `updateSetting`. Players must still be prompted → Task 3 registers both hooks; unit test "undefined→true prompts" and e2e test 1 runs on a world where the record may not exist.
2. **Dialog dismissed with ✕/Escape after ticking the checkbox**: the GM expects the tick to stick → Task 2's dialog tracks the checkbox with a `change` listener; e2e test 2 dismisses via the close button, not "Not now".
3. **MEJ's `allow-player` unregistered** (renamed in a future MEJ): `game.settings.get` throws → Task 2 guards the read and skips with a warning; unit test `allowPlayer: undefined` → no offer.
4. **Two GMs online**: the second GM's client receives the same broadcast; it must not get a player reload prompt → `shouldPromptReload` rejects `isGM`; unit test.
5. **Setting turned off again**: on→off must not prompt anyone → unit test.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/logic/player-access.mjs` (create) | Pure decisions: offer the dialog? prompt a reload? which settings to write? |
| `test/player-access.test.js` (create) | vitest for the three pure functions |
| `scripts/apps/player-access-dialog.mjs` (create) | The GM DialogV2; resolves `{ enable, dontShowAgain }` |
| `scripts/hooks/player-access.mjs` (create) | `checkPlayerAccessOnLogin()`, `registerPlayerAccessReloadPrompt()` |
| `scripts/constants.mjs` (modify) | `WARN_PLAYER_ACCESS_SETTING`, `MEJ_ALLOW_PLAYER_KEY` |
| `scripts/campaign-companion.mjs` (modify) | register the setting at init; wire both hooks in `ready` |
| `lang/en.json` (modify) | all strings |
| `tests/e2e/29-player-access-check.spec.mjs` (create) | four e2e scenarios |
| `docs/gm-guide.md`, `CHANGELOG.md` (modify) | docs |

---

### Task 1: Pure decision logic

**Files:**
- Create: `scripts/logic/player-access.mjs`
- Test: `test/player-access.test.js`

**Interfaces:**
- Produces:
  - `shouldOfferPlayerAccess({ isGM: boolean, allowPlayer: boolean|undefined, warnEnabled: boolean }) → boolean`
  - `shouldPromptReload({ isGM: boolean, key: string, oldValue: unknown, newValue: unknown }) → boolean`
  - `playerAccessWrites({ enable: boolean, dontShowAgain: boolean }) → Array<{ namespace: string, key: string, value: boolean }>`
  - `MEJ_ALLOW_PLAYER_FULL_KEY = "monks-enhanced-journal.allow-player"`

- [ ] **Step 1: Write the failing tests**

`test/player-access.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  shouldOfferPlayerAccess, shouldPromptReload, playerAccessWrites, MEJ_ALLOW_PLAYER_FULL_KEY
} from "../scripts/logic/player-access.mjs";

describe("shouldOfferPlayerAccess (spec 2026-10-08 §When the check runs)", () => {
  const base = { isGM: true, allowPlayer: false, warnEnabled: true };
  it("offers to a GM when the setting is off and the warning is on", () => {
    expect(shouldOfferPlayerAccess(base)).toBe(true);
  });
  it("never offers to a player", () => {
    expect(shouldOfferPlayerAccess({ ...base, isGM: false })).toBe(false);
  });
  it("does not offer when the setting is already on", () => {
    expect(shouldOfferPlayerAccess({ ...base, allowPlayer: true })).toBe(false);
  });
  it("does not offer when MEJ's setting is unregistered", () => {
    expect(shouldOfferPlayerAccess({ ...base, allowPlayer: undefined })).toBe(false);
  });
  it("does not offer after 'Don't show this again'", () => {
    expect(shouldOfferPlayerAccess({ ...base, warnEnabled: false })).toBe(false);
  });
});

describe("shouldPromptReload (spec §Player reload prompt)", () => {
  const base = { isGM: false, key: MEJ_ALLOW_PLAYER_FULL_KEY, oldValue: false, newValue: true };
  it("prompts a player when the setting goes off -> on", () => {
    expect(shouldPromptReload(base)).toBe(true);
  });
  it("prompts when the setting record did not exist before (undefined -> on)", () => {
    expect(shouldPromptReload({ ...base, oldValue: undefined })).toBe(true);
  });
  it("never prompts a GM (second GM online)", () => {
    expect(shouldPromptReload({ ...base, isGM: true })).toBe(false);
  });
  it("ignores other settings", () => {
    expect(shouldPromptReload({ ...base, key: "monks-enhanced-journal.open-new-tab" })).toBe(false);
  });
  it("ignores on -> on", () => {
    expect(shouldPromptReload({ ...base, oldValue: true })).toBe(false);
  });
  it("ignores on -> off", () => {
    expect(shouldPromptReload({ ...base, oldValue: true, newValue: false })).toBe(false);
  });
});

describe("playerAccessWrites (spec §Results table)", () => {
  const allow = { namespace: "monks-enhanced-journal", key: "allow-player", value: true };
  const silence = { namespace: "mej-campaign-companion", key: "warnPlayerAccess", value: false };
  it("Enable, unticked: only allow-player", () => {
    expect(playerAccessWrites({ enable: true, dontShowAgain: false })).toEqual([allow]);
  });
  it("Enable, ticked: allow-player and the warning off", () => {
    expect(playerAccessWrites({ enable: true, dontShowAgain: true })).toEqual([allow, silence]);
  });
  it("Not now, unticked: nothing", () => {
    expect(playerAccessWrites({ enable: false, dontShowAgain: false })).toEqual([]);
  });
  it("Not now, ticked: only the warning off", () => {
    expect(playerAccessWrites({ enable: false, dontShowAgain: true })).toEqual([silence]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-access.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/logic/player-access.mjs"`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/player-access.mjs`:

```js
// Pure decisions for the GM player-access check (spec 2026-10-08
// player-access-check). No Foundry globals so vitest loads it directly; the
// Foundry glue lives in hooks/player-access.mjs.
//
// MEJ's openJournalEntry refuses every non-GM while its world setting
// "allow-player" is off (13.06 monks-enhanced-journal.js ~2311, same on
// 14.x), and that setting defaults to off - so players get Foundry's default
// journal editor and the companion does not work for them.
import { MODULE_ID, MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING, WARN_PLAYER_ACCESS_SETTING } from "../constants.mjs";

export const MEJ_ALLOW_PLAYER_FULL_KEY = `${MEJ_MODULE_ID}.${MEJ_ALLOW_PLAYER_SETTING}`;

/**
 * Whether this client should show the GM dialog. `allowPlayer` is undefined
 * when MEJ's setting is not registered - skip rather than guess.
 */
export function shouldOfferPlayerAccess({ isGM, allowPlayer, warnEnabled }) {
  return isGM === true && allowPlayer === false && warnEnabled === true;
}

/**
 * Whether a setting broadcast should ask this client to reload: players
 * only, MEJ's allow-player only, and only for a change to on. `oldValue` is
 * undefined when the setting record did not exist yet (createSetting).
 */
export function shouldPromptReload({ isGM, key, oldValue, newValue }) {
  return !isGM && key === MEJ_ALLOW_PLAYER_FULL_KEY && newValue === true && oldValue !== true;
}

/** The setting writes for a dialog result, in the order they are applied. */
export function playerAccessWrites({ enable, dontShowAgain }) {
  const writes = [];
  if (enable) writes.push({ namespace: MEJ_MODULE_ID, key: MEJ_ALLOW_PLAYER_SETTING, value: true });
  if (dontShowAgain) writes.push({ namespace: MODULE_ID, key: WARN_PLAYER_ACCESS_SETTING, value: false });
  return writes;
}
```

Add to `scripts/constants.mjs`, directly after the `ENTITY_FROM_SELECTION_*` block (line ~152). First check whether `MEJ_MODULE_ID` already exists (`grep -n "MEJ_MODULE_ID" scripts/constants.mjs`); add it only if missing:

```js
// GM player-access check (spec 2026-10-08). MEJ's world setting that lets
// non-GMs use its window at all; the companion's own "warn" toggle.
export const MEJ_MODULE_ID = "monks-enhanced-journal";
export const MEJ_ALLOW_PLAYER_SETTING = "allow-player";
export const WARN_PLAYER_ACCESS_SETTING = "warnPlayerAccess";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/player-access.test.js` → Expected: 15 passed.
Run: `npm test` → Expected: all files pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/player-access.mjs scripts/constants.mjs test/player-access.test.js
git commit -m "feat(player-access): pure decisions for the GM player-access check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GM login check — setting, strings, dialog, wiring

**Files:**
- Create: `scripts/apps/player-access-dialog.mjs`
- Create: `scripts/hooks/player-access.mjs`
- Modify: `scripts/campaign-companion.mjs` (imports at top; setting registration in the `init` hook beside `AUTO_LINK_SETTING` ~line 43; `ready` hook right after `registerSocketDispatcher();` ~line 315)
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `shouldOfferPlayerAccess`, `playerAccessWrites` (Task 1); `MEJ_MODULE_ID`, `MEJ_ALLOW_PLAYER_SETTING`, `WARN_PLAYER_ACCESS_SETTING`, `MODULE_ID`, `I18N` (constants).
- Produces:
  - `promptPlayerAccess() → Promise<{ enable: boolean, dontShowAgain: boolean }>`
  - `readAllowPlayer() → boolean|undefined` (exported from hooks/player-access.mjs; Task 3 uses it)
  - `checkPlayerAccessOnLogin() → Promise<void>`

- [ ] **Step 1: Add the strings**

In `lang/en.json`, inside `"MEJCampaignCompanion"`: add to the existing `"settings"` object

```json
"warnPlayerAccess": {
  "name": "Warn when Campaign Companion can't work for players",
  "hint": "When a GM logs in and Monk's Enhanced Journal's \"Allow players to use Enhanced Journal\" setting is off, explain that Campaign Companion won't work properly for players and offer to turn it on."
}
```

and a new top-level key inside `"MEJCampaignCompanion"`:

```json
"playerAccess": {
  "title": "Campaign Companion: players need Enhanced Journal access",
  "body1": "Campaign Companion won't work properly for your players while Monk's Enhanced Journal's <strong>\"Allow players to use Enhanced Journal\"</strong> setting is off.",
  "body2": "With it off, players can't use the Campaign Hub, Session sheets, the knowledge panel or campaign entries the way the companion expects. Anything they open or create opens in Foundry's default journal editor instead.",
  "body3": "Turn it on now to make Campaign Companion work for players?",
  "dontShowAgain": "Don't show this again",
  "enable": "Enable for players",
  "notNow": "Not now",
  "enabled": "Players can now use Campaign Companion. Connected players have been asked to reload.",
  "failed": "Campaign Companion could not change the player-access settings. See the console for details.",
  "reloadTitle": "Campaign Companion",
  "reloadBody": "Your GM has enabled Campaign Companion for players. Reload now to use it?",
  "reload": "Reload",
  "later": "Later"
}
```

Validate: `node -e 'JSON.parse(require("fs").readFileSync("lang/en.json","utf8"))'` → no output.

- [ ] **Step 2: Register the setting**

In `scripts/campaign-companion.mjs`, add `WARN_PLAYER_ACCESS_SETTING` to the existing `./constants.mjs` import list, and in the `init` hook immediately after the `AUTO_LINK_SETTING` registration block:

```js
  // GM player-access check (spec 2026-10-08): "Don't show this again" turns
  // this off; ticking it in settings brings the check back.
  game.settings.register(MODULE_ID, WARN_PLAYER_ACCESS_SETTING, {
    name: `${I18N}.settings.warnPlayerAccess.name`,
    hint: `${I18N}.settings.warnPlayerAccess.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
```

- [ ] **Step 3: Write the dialog**

`scripts/apps/player-access-dialog.mjs`:

```js
// GM dialog for the player-access check (spec 2026-10-08). Foundry-only
// (DialogV2, no MEJ imports). Resolves { enable, dontShowAgain }; closing
// the window counts as "Not now" but still honours a ticked checkbox, which
// is why the checkbox is tracked by a change listener rather than read from
// the button callback alone.
import { I18N } from "../constants.mjs";

export async function promptPlayerAccess() {
  const t = (k) => game.i18n.localize(`${I18N}.playerAccess.${k}`);
  let dontShowAgain = false;
  const content = `
    <p>${t("body1")}</p>
    <p>${foundry.utils.escapeHTML(t("body2"))}</p>
    <p>${foundry.utils.escapeHTML(t("body3"))}</p>
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" name="dontShowAgain"> ${foundry.utils.escapeHTML(t("dontShowAgain"))}</label>
    </div>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("title"), icon: "fa-solid fa-users" },
    classes: ["mej-campaign-companion-player-access"],
    content,
    buttons: [
      { action: "enable", label: t("enable"), icon: "fa-solid fa-check", default: true },
      { action: "notNow", label: t("notNow"), icon: "fa-solid fa-xmark" }
    ],
    render: (event, dialog) => {
      const box = (dialog.element ?? dialog).querySelector('input[name="dontShowAgain"]');
      box?.addEventListener("change", () => { dontShowAgain = box.checked; });
    },
    rejectClose: false
  });
  return { enable: choice === "enable", dontShowAgain };
}
```

`body1` carries a `<strong>` from the language file and is inserted unescaped on purpose; the other strings are escaped.

- [ ] **Step 4: Write the login check**

`scripts/hooks/player-access.mjs`:

```js
// GM player-access check (spec 2026-10-08 player-access-check). On a GM's
// login, when MEJ's "Allow players to use Enhanced Journal" is off, explain
// that Campaign Companion won't work properly for players and offer to turn
// it on. Decisions are pure (logic/player-access.mjs); this file only reads
// and writes Foundry state. Never throws out of the ready hook.
import { MODULE_ID, I18N, MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING, WARN_PLAYER_ACCESS_SETTING } from "../constants.mjs";
import { shouldOfferPlayerAccess, playerAccessWrites } from "../logic/player-access.mjs";

/** MEJ's allow-player value, or undefined when MEJ has not registered it. */
export function readAllowPlayer() {
  if (!game.settings.settings.has(`${MEJ_MODULE_ID}.${MEJ_ALLOW_PLAYER_SETTING}`)) return undefined;
  return game.settings.get(MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING) === true;
}

export async function checkPlayerAccessOnLogin() {
  try {
    const allowPlayer = readAllowPlayer();
    if (allowPlayer === undefined) {
      console.warn(`${MODULE_ID} | player-access check skipped: ${MEJ_MODULE_ID} has no "${MEJ_ALLOW_PLAYER_SETTING}" setting`);
      return;
    }
    const offer = shouldOfferPlayerAccess({
      isGM: game.user.isGM,
      allowPlayer,
      warnEnabled: game.settings.get(MODULE_ID, WARN_PLAYER_ACCESS_SETTING) === true
    });
    if (!offer) return;
    const { promptPlayerAccess } = await import("../apps/player-access-dialog.mjs");
    const result = await promptPlayerAccess();
    const writes = playerAccessWrites(result);
    try {
      for (const w of writes) await game.settings.set(w.namespace, w.key, w.value);
    } catch (err) {
      console.error(`${MODULE_ID} | player-access settings write failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.playerAccess.failed`));
      return;
    }
    if (result.enable) ui.notifications.info(game.i18n.localize(`${I18N}.playerAccess.enabled`));
  } catch (err) {
    console.error(`${MODULE_ID} | player-access check failed`, err);
  }
}
```

- [ ] **Step 5: Wire it into the ready hook**

In `scripts/campaign-companion.mjs` add the import beside the other hook imports:

```js
import { checkPlayerAccessOnLogin } from "./hooks/player-access.mjs";
```

and in the `ready` hook, directly after the line `registerSocketDispatcher();` (after `onReady()` and the MEJ-absent early return):

```js
  // GM player-access check (spec 2026-10-08): fire-and-forget so the dialog
  // never delays the migrations below.
  checkPlayerAccessOnLogin();
```

- [ ] **Step 6: Run unit tests**

Run: `npm test` → Expected: all pass.

- [ ] **Step 7: Manual smoke on v13 World B**

World B serves the main checkout, not this worktree, so point the module symlink at the worktree for the smoke and restore it after:

```bash
L=~/FoundryVTT/Data/Data/modules/mej-campaign-companion
readlink "$L"   # expect /Users/danbularzik/Claude/Projects/mej-campaign-companion
ln -sfn ~/Claude/Projects/mej-campaign-companion/.claude/worktrees/player-access-check "$L"
```

Then run the e2e spec from Task 4 if already written, otherwise: as GM in a Playwright session set `allow-player` false, reload, confirm the dialog shows with the exact title, tick nothing, click **Not now**, restore `allow-player` true. Restore the symlink afterwards:

```bash
ln -sfn ~/Claude/Projects/mej-campaign-companion "$L"
```

- [ ] **Step 8: Commit**

```bash
git add scripts/apps/player-access-dialog.mjs scripts/hooks/player-access.mjs scripts/campaign-companion.mjs lang/en.json
git commit -m "feat(player-access): offer to enable MEJ player access on GM login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Player reload prompt

**Files:**
- Modify: `scripts/hooks/player-access.mjs` (append)
- Modify: `scripts/campaign-companion.mjs` (ready hook, beside the Task 2 call)

**Interfaces:**
- Consumes: `shouldPromptReload`, `MEJ_ALLOW_PLAYER_FULL_KEY` (Task 1); `readAllowPlayer` (Task 2); strings `playerAccess.reloadTitle|reloadBody|reload|later` (Task 2).
- Produces: `registerPlayerAccessReloadPrompt() → void`

- [ ] **Step 1: Append the prompt to `scripts/hooks/player-access.mjs`**

Extend the logic import to `import { shouldOfferPlayerAccess, playerAccessWrites, shouldPromptReload, MEJ_ALLOW_PLAYER_FULL_KEY } from "../logic/player-access.mjs";` and append:

```js
/**
 * Players: when a GM turns MEJ's allow-player on, ask to reload (MEJ wires
 * its sidebar and context menus for players at load). World-setting changes
 * broadcast to every client; a setting saved for the first time arrives as
 * createSetting, later changes as updateSetting - listen to both. Neither
 * hook carries the previous value, so it is cached here.
 */
export function registerPlayerAccessReloadPrompt() {
  let last = readAllowPlayer();
  const onSetting = (setting) => {
    if (setting?.key !== MEJ_ALLOW_PLAYER_FULL_KEY) return;
    const oldValue = last;
    const newValue = readAllowPlayer();
    last = newValue;
    if (!shouldPromptReload({ isGM: game.user.isGM, key: setting.key, oldValue, newValue })) return;
    const t = (k) => game.i18n.localize(`${I18N}.playerAccess.${k}`);
    foundry.applications.api.DialogV2.confirm({
      window: { title: t("reloadTitle") },
      content: `<p>${foundry.utils.escapeHTML(t("reloadBody"))}</p>`,
      yes: { label: t("reload"), icon: "fa-solid fa-rotate-right" },
      no: { label: t("later") },
      rejectClose: false
    }).then((yes) => {
      if (!yes) return;
      if (typeof foundry.utils.debouncedReload === "function") foundry.utils.debouncedReload();
      else window.location.reload();
    }).catch((err) => console.error(`${MODULE_ID} | player-access reload prompt failed`, err));
  };
  Hooks.on("createSetting", onSetting);
  Hooks.on("updateSetting", onSetting);
}
```

- [ ] **Step 2: Wire it**

Change the Task 2 import in `scripts/campaign-companion.mjs` to

```js
import { checkPlayerAccessOnLogin, registerPlayerAccessReloadPrompt } from "./hooks/player-access.mjs";
```

and directly above `checkPlayerAccessOnLogin();` in the ready hook add:

```js
  registerPlayerAccessReloadPrompt();
```

- [ ] **Step 3: Run unit tests**

Run: `npm test` → Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/hooks/player-access.mjs scripts/campaign-companion.mjs
git commit -m "feat(player-access): ask connected players to reload when access is enabled

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: e2e spec 29

**Files:**
- Create: `tests/e2e/29-player-access-check.spec.mjs`

**Interfaces:**
- Consumes: harness helpers from `tests/e2e/helpers/foundry.mjs` — `login(page, userName)`, `reloadGame(page)`, `withGmPage(browser, fn)`, `cleanupAsGm(page, browser, fn)`, `deleteJournalsByPrefix(page, prefix)`, `cleanupStrandedTestFolders(page, { prefix })`, `ensureMejPlayerAccess(page)`, `settle(page, ms)`; companion `createCampaign(name)` from `/modules/mej-campaign-companion/scripts/data/campaign-store.mjs` (returns the campaign Folder).

- [ ] **Step 1: Write the spec**

`tests/e2e/29-player-access-check.spec.mjs`:

```js
// GM player-access check (spec 2026-10-08 player-access-check). MEJ's
// "allow-player" world setting defaults to off, and with it off MEJ opens
// every journal for a player in Foundry's default editor - the reported
// "new entity in a campaign folder opens outside MEJ" for players. The
// companion offers the GM to turn it on at login and asks connected players
// to reload. Every test restores allow-player = true and warnPlayerAccess =
// true (the global-setup baseline).
import { test, expect } from "@playwright/test";
import {
  login, reloadGame, withGmPage, cleanupAsGm, deleteJournalsByPrefix,
  cleanupStrandedTestFolders, ensureMejPlayerAccess, settle
} from "./helpers/foundry.mjs";

const PREFIX = "TT-Pac";
const TITLE = "Campaign Companion: players need Enhanced Journal access";

const setAccess = (page, { allow, warn }) => page.evaluate(async ({ allow, warn }) => {
  await game.settings.set("monks-enhanced-journal", "allow-player", allow);
  await game.settings.set("mej-campaign-companion", "warnPlayerAccess", warn);
}, { allow, warn });

const readAccess = (page) => page.evaluate(() => ({
  allow: game.settings.get("monks-enhanced-journal", "allow-player"),
  warn: game.settings.get("mej-campaign-companion", "warnPlayerAccess")
}));

const accessDialog = (page) => page.locator("dialog.application.mej-campaign-companion-player-access");

test.describe("29 player access check", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gm) => {
      await gm.evaluate(() => game.settings.set("mej-campaign-companion", "warnPlayerAccess", true));
      await ensureMejPlayerAccess(gm);
      await deleteJournalsByPrefix(gm, PREFIX);
      await cleanupStrandedTestFolders(gm, { prefix: PREFIX });
    });
  });

  test("GM enables player access; a connected player reloads and a new entity opens in MEJ", async ({ page, browser }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: false, warn: true });
    const folderId = await page.evaluate(async (name) => {
      const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      return (await createCampaign(name)).id;
    }, `${PREFIX} Campaign`);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const player = await playerContext.newPage();
      await login(player, "User 1");

      await reloadGame(page);
      const dialog = accessDialog(page);
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toContainText(TITLE);
      await dialog.locator('button[data-action="enable"]').click();
      await expect.poll(() => readAccess(page)).toEqual({ allow: true, warn: true });

      const prompt = player.locator("dialog.application", { hasText: "Your GM has enabled Campaign Companion for players" });
      await expect(prompt).toBeVisible({ timeout: 15_000 });
      await prompt.locator('button[data-action="yes"]').click();
      await player.waitForEvent("load", { timeout: 60_000 });
      await login(player, "User 1");

      const opened = await player.evaluate(async ({ name, folder }) => {
        await JournalEntry.create({ name, folder, flags: { "monks-enhanced-journal": { pagetype: "person" } } }, { renderSheet: true });
        await new Promise((r) => setTimeout(r, 2500));
        const rendered = [...foundry.applications.instances.values()].filter((a) => a.rendered && a.document);
        return {
          inShell: game.MonksEnhancedJournal.journal?.rendered === true
            && game.MonksEnhancedJournal.journal.document?.parent?.name === name,
          standalone: rendered.filter((a) => a.constructor.name !== "EnhancedJournal"
            && (a.document.name === name || a.document.parent?.name === name)).map((a) => a.constructor.name)
        };
      }, { name: `${PREFIX} Person`, folder: folderId });
      expect(opened).toEqual({ inShell: true, standalone: [] });
    } finally {
      await playerContext.close();
    }
  });

  test("'Don't show this again' with the window closed silences later logins", async ({ page }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: false, warn: true });
    await reloadGame(page);
    const dialog = accessDialog(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator('input[name="dontShowAgain"]').check();
    await dialog.locator('button[data-action="close"]').click();
    await expect.poll(() => readAccess(page)).toEqual({ allow: false, warn: false });

    await reloadGame(page);
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });

  test("a player login never shows the dialog", async ({ page, browser }) => {
    await withGmPage(browser, (gm) => setAccess(gm, { allow: false, warn: true }));
    await login(page, "User 1");
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });

  test("no dialog when player access is already on", async ({ page }) => {
    await login(page, "Gamemaster");
    await setAccess(page, { allow: true, warn: true });
    await reloadGame(page);
    await settle(page, 3000);
    await expect(accessDialog(page)).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Point the v14 and v13 installs at the worktree**

```bash
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do readlink "$L"; done
# both expected: /Users/danbularzik/Claude/Projects/mej-campaign-companion
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do ln -sfn ~/Claude/Projects/mej-campaign-companion/.claude/worktrees/player-access-check "$L"; done
```

If either `readlink` prints something else, stop and record it; restore to exactly that value in Step 5. Check free disk first: `df -h /System/Volumes/Data` — need ≥ 2 GB; if less, stop and report.

- [ ] **Step 3: Run on v14 World A**

Run: `npx playwright test tests/e2e/29-player-access-check.spec.mjs --trace off --reporter=line`
Expected: 4 passed (plus 3 setup).

If a test fails, read the failure, fix the product code or the spec (never weaken an assertion to pass), re-run.

- [ ] **Step 4: Run on v13 World B**

Run: `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/29-player-access-check.spec.mjs --trace off --reporter=line`
Expected: 4 passed.

Then the neighbouring regressions on both targets: `npx playwright test tests/e2e/13-stock-smoke.spec.mjs tests/e2e/06-player-collab.spec.mjs --trace off --reporter=line` and the same with `FOUNDRY_TARGET=v13` (v13 stock smoke needs `STOCK_PHASE=stock`). Expected: same pass/fail as on `main` (known pre-existing v13 failures are listed in memory: 02×3, 09 dup-section, 10 tracker dup-id).

- [ ] **Step 5: Restore the symlinks**

```bash
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do ln -sfn ~/Claude/Projects/mej-campaign-companion "$L"; readlink "$L"; done
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/29-player-access-check.spec.mjs
git commit -m "test(e2e): spec 29 player access check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/gm-guide.md` ("Installation & first-time setup" section, line ~17)
- Modify: `CHANGELOG.md` (top)

- [ ] **Step 1: GM guide**

At the end of the "## Installation & first-time setup" section of `docs/gm-guide.md`, add:

```markdown
**Player access.** Campaign Companion only works properly for players when Monk's Enhanced Journal's **"Allow players to use Enhanced Journal"** setting is on — with it off, players open every journal (including campaign entries and Sessions) in Foundry's default editor. MEJ ships with it off. When a GM logs in while it is off, Campaign Companion offers to turn it on; connected players are then asked to reload. Tick **Don't show this again** to stop the reminder; **Warn when Campaign Companion can't work for players** in the module settings brings it back.
```

- [ ] **Step 2: CHANGELOG**

Insert directly under `# Changelog`:

```markdown
## Unreleased

- **Added:** when a GM logs in and Monk's Enhanced Journal's "Allow players to use Enhanced Journal" setting is off, Campaign Companion explains that it won't work properly for players and offers to turn the setting on. Connected players are asked to reload once it is on. "Don't show this again" silences it; the new **Warn when Campaign Companion can't work for players** setting brings it back.
```

- [ ] **Step 3: Check links and commit**

Run: `npm run check:links` (if the script exists — `grep -n check:links package.json`) → Expected: OK.

```bash
git add docs/gm-guide.md CHANGELOG.md
git commit -m "docs: player access check in the GM guide and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
