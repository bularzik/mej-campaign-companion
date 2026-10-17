# Sessions in Campaigns, Player Campaign Picker, Knowledge Side Rail (0.28.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Session page ends up inside a campaign folder (a silent "New Campaign" fallback holds the loose ones), players' Hub shows only their campaigns, the knowledge panel becomes a collapsible right-hand rail, owning players get the attendee drag hint, `/note` keeps literal tags on Foundry 13, and the result ships as 0.28.0.

**Architecture:** Pure decision modules under `scripts/logic/` (vitest-loadable, no Foundry imports) with thin Foundry glue in `scripts/hooks/` and `scripts/apps/CampaignHubPage.mjs`, the module's existing split. One new hook module (`hooks/session-filing.mjs`) owns the fallback campaign and the filing of folderless session entries; the timepoint hook awaits it so a filed session's timepoint lands on the fallback campaign's timeline. The knowledge rail is a DOM wrap the companion inserts only when a panel mounts, so MEJ's layout on pages without a panel is untouched. Nothing patches MEJ.

**Tech Stack:** Foundry VTT 14.368 (World A, port 30000) and 14.369 (World B, port 30001) with fork MEJ 9569984 in api mode; Foundry 13.351 World B (port 30013) with stock MEJ 13.06 in native mode. Vitest unit tests in `test/*.test.js` (`npx vitest run`). Playwright e2e in `tests/e2e/` (`npx playwright test tests/e2e/<spec> --trace off`; v13: `FOUNDRY_TARGET=v13 …`). Handlebars templates, plain CSS with `--mej-cc-*` tokens.

**Spec:** `docs/superpowers/specs/2026-10-16-sessions-in-campaigns-player-picker-knowledge-rail-design.md` (same branch). Decision numbers below (§1a … §6) are that document's.

## Global Constraints

- Foundry 13.351 and 14.368/14.369; stock MEJ 13.06 (native mode) and the fork line in api mode. The v13 stock smoke gate (`npm run e2e:stock:v13`) must pass before release.
- Companion CSS is scoped under `.monks-enhanced-journal` and uses the `--mej-cc-*` tokens; 4.5:1 on all 16 MEJ backgrounds in both schemes (spec 29 is the floor; update selectors, never thresholds).
- The companion never patches MEJ. Companion-side wraps and DOM insertion only.
- Test documents are `TT-` prefixed and swept by the spec that creates them. Live e2e runs are time-boxed (one spec at a time, at most ~10 minutes each), never two Playwright invocations at once, always `--trace off`. Never touch module symlinks, the e2e lock file or the Foundry server by hand; never delete the owner's Radiant Citadel folder or timeline.
- Session detection compares the stored subtype (`storedPageType()` from `scripts/logic/mej-type.mjs`); MEJ's `fixType()` rewrites the in-memory `type` to `session`.
- Fallback campaign name: English **"New Campaign"**, i18n key `MEJCampaignCompanion.campaign.fallbackName`; created with `createCampaign(name, { ownershipDefault: "observer" })`; reused while a root campaign folder of exactly that name exists.
- Only **folderless** session entries are filed. A session in any folder, campaign or plain, is never moved.
- Filing writes exactly `{ folder, "ownership.default" }`; explicit per-user ownership is never touched. The level is the campaign's session-aware level (`campaignSessionTargetLevel`).
- Start Session keeps today's behaviour: dismissing its campaign prompt aborts (§1h). Only New Session falls back (§1a).
- No Claude attribution in PR bodies or comments; no `git add -A`.
- No data migration / no `dataVersion` bump (pre-1.0).

## Review Focus

Inputs the spec implies but that the main happy paths don't exercise. Each line names its test and the task that owns it.

1. **Two folderless sessions created in one burst** (an import, a double click) must share ONE "New Campaign", never two. Test: spec 37 test "two folderless sessions created together share one fallback campaign" (Task 7); unit `pickFallbackCampaign` reuse (Task 3).
2. **A player's remembered scope names a campaign they can no longer see** (GM hid it) → the Hub opens on the first visible campaign, never on "" and never on the stale id. Test: `playerScopeId` stale case (Task 9); spec 38 test 2 (Task 10).
3. **A narrow sheet** (popped-out window ~560 px) → the rail takes at most 40% and never overlaps the text column. Test: spec 39 test 2 geometry assertions (Task 11).
4. **`/note` text containing tag-like words** on Foundry 13 (`/note the <div> tag`, `/note <b>bold</b>`) stays literal; Foundry 14's `<p>` wrapper, even with leading whitespace, is still unwrapped. Test: `chatMessageText` cases (Task 1).
5. **A folderless session with explicit per-user ownership** (a GM gave one player OWNER by hand) is filed with its default raised but that user's explicit level kept. Test: spec 37 test 2 (Task 7); unit `filingUpdate` touches two keys only (Task 3).

---

## File map

New:
- `scripts/logic/session-filing.mjs` — pure: `shouldFileSession`, `holdsSessionPage`, `pickFallbackCampaign`, `filingUpdate`.
- `scripts/hooks/session-filing.mjs` — Foundry glue: `ensureFallbackCampaign`, `ensureSessionFiled`, `sweepUnfiledSessions`, `registerSessionFiling`.
- `test/session-filing.test.js`, `test/timeline-journal-ensure.test.js`, `test/hub-session-actions.test.js`.
- `tests/e2e/helpers/hub.mjs` — `openHub`, `openHubViaToolbar`, `scopeHub` moved out of specs 14/02.
- `tests/e2e/37-sessions-in-campaigns.spec.mjs`, `tests/e2e/38-player-campaign-picker.spec.mjs`, `tests/e2e/39-knowledge-rail.spec.mjs`.

Modified: `scripts/logic/note-command.mjs`, `scripts/logic/hub-player-view.mjs`, `scripts/data/timeline-journal.mjs`, `scripts/data/campaign-store.mjs`, `scripts/hooks/session-timepoint.mjs`, `scripts/hooks/auto-capture.mjs`, `scripts/hooks/knowledge-ui.mjs`, `scripts/apps/CampaignHubPage.mjs`, `scripts/apps/import-wizard.mjs`, `scripts/integrations/mej-adapter.mjs`, `scripts/campaign-companion.mjs`, `templates/session.hbs`, `templates/knowledge-panel.hbs`, `styles/campaign-companion.css`, `lang/en.json`, `test/note-command.test.js`, `test/session-template-gates.test.js`, `test/hub-player-view.test.js`, `test/sweep-rules.test.js` (create if absent), `tests/e2e/helpers/foundry.mjs`, `tests/e2e/helpers/sweep-rules.mjs`, `tests/e2e/global-setup.mjs`, specs 01, 02, 05, 06, 07, 09, 10, 14, 16, 21, 34, `tests/e2e/README.md`, `README.md`, `CHANGELOG.md`, `module.json`.

---

### Task 1: `/note` treats a message as HTML only when it starts with a block wrapper (§5)

**Files:**
- Modify: `scripts/logic/note-command.mjs:3,23-36`
- Test: `test/note-command.test.js`

**Interfaces:**
- Produces: `chatMessageText(message)` unchanged signature; new rule: HTML only when the trimmed message starts with `<p` or `<div` (case-insensitive).

- [ ] **Step 1: Write the failing tests**

Add to the `describe("chatMessageText", …)` block in `test/note-command.test.js`:

```js
  // Foundry 13's textarea sends plain text; a player typing a literal tag-like
  // word must keep it (spec 2026-10-16 §5). Foundry 14's prose-mirror box
  // always wraps the message in a block element, which is the only HTML cue.
  it("treats a message as HTML only when it starts with a block wrapper", () => {
    expect(chatMessageText("/note the <div> tag")).toBe("/note the <div> tag");
    expect(chatMessageText("/note <b>bold</b> stays")).toBe("/note <b>bold</b> stays");
    expect(chatMessageText("  <p>/note a</p>")).toBe("/note a");
    expect(chatMessageText("<div>/note a<br>b</div>")).toBe("/note a\nb");
    expect(chatMessageText("<P>/note caps</P>")).toBe("/note caps");
  });
```

And to `describe("parseNoteCommand", …)`:

```js
  it("keeps literal tag text in a plain-text note (Foundry 13)", () => {
    expect(parseNoteCommand("/note the <div> tag")).toEqual({ text: "the <div> tag" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/note-command.test.js`
Expected: FAIL — `"/note the <div> tag"` currently comes back as `"/note the  tag"`.

- [ ] **Step 3: Implement the start-of-message rule**

In `scripts/logic/note-command.mjs` replace line 3 (`const TAG = …`) with:

```js
// Foundry 14's prose-mirror chat box wraps every message in a block element
// (`<p>…</p>`); Foundry 13's textarea never does. That wrapper is the only
// reliable HTML cue - a tag-like word inside plain text is the player's text.
const BLOCK_START = /^\s*<(?:p|div)\b/i;
```

Replace the doc comment and first guard of `chatMessageText`:

```js
/**
 * The text of a chat message as Foundry's ChatLog.parse reads it. A message
 * that starts with a block wrapper (`<p`, `<div`) is Foundry 14's serialized
 * HTML: `<br>` and paragraph boundaries become newlines, other tags are
 * dropped, entities decoded. Anything else is plain text, returned trimmed
 * with any literal `<…>` kept (spec 2026-10-16 §5).
 */
export function chatMessageText(message) {
  if (typeof message !== "string") return "";
  if (!BLOCK_START.test(message)) return message.trim();
```

The rest of the function is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/note-command.test.js`
Expected: PASS (all cases, including the existing Foundry 14 HTML cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/note-command.mjs test/note-command.test.js
git commit -m "fix(/note): treat a chat message as HTML only when it starts with a block wrapper"
```

---

### Task 2: Attendee drag hint for anyone who can edit; spec 34 owner/non-owner split (§4)

**Files:**
- Modify: `templates/session.hbs:121`
- Modify: `test/session-template-gates.test.js:8-11`
- Modify: `tests/e2e/34-player-hub.spec.mjs` (seed, afterAll, test 3)

**Interfaces:**
- Consumes: `MEJCampaignCompanion.session.dragActorHint` = "Drag an Actor here to add them as an attendee.", `…session.noAttendees` = "No attendees recorded yet." (lang/en.json:175-176).

- [ ] **Step 1: Write the failing unit test**

Replace the first `it` in `test/session-template-gates.test.js` (lines 8-11) with:

```js
  it("the attendee drag hint renders for anyone who can edit — GM or owning player (spec 2026-10-16 §4)", () => {
    const attendees = between('<div class="attendees-section">', '<div class="secrets-section">');
    expect(attendees).toMatch(/\{\{#if @root\.editable\}\}\s*<li class="instruction">\{\{localize 'MEJCampaignCompanion\.session\.dragActorHint'\}\}<\/li>/);
    expect(attendees).not.toContain("(and @root.editable @root.isGM)");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/session-template-gates.test.js`
Expected: FAIL on the new regex (template still has the `and` gate).

- [ ] **Step 3: Revert the template gate**

In `templates/session.hbs` line 121 change `{{#if (and @root.editable @root.isGM)}}` to `{{#if @root.editable}}`. Leave the `{{else}}` branch ("noAttendees") and the remove control (already `editable`-gated) as they are.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run test/session-template-gates.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite spec 34 test 3 as an owner/non-owner pair**

In `tests/e2e/34-player-hub.spec.mjs`:

Add a second session name after `SESSION`:

```js
const SESSION_RO = `${TT_PREFIX}PH View-only Session ${RUN}`;
```

Extend `seed()` so it also creates a session User 1 can only view. Replace the body of `seed` with:

```js
  return page.evaluate(async ({ campaignName, sessionName, roName }) => {
    const { createCampaign, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
    const folder = await createCampaign(campaignName, { ownershipDefault: "observer" });
    const pageData = buildSessionPageData(sessionName, "<p>We met the duke.</p>", { year: 1497, month: 5, day: 14 }, 12);
    // Explicit default 2 inside an observer campaign: the preCreate ownership
    // hook raises the default to OWNER, so User 1 OWNS this session (that is
    // the product rule for campaign sessions; spec 2026-10-15 item 8).
    const session = await JournalEntry.create({ name: sessionName, folder: folder.id, ownership: { default: 2 }, pages: [pageData] });
    // A view-only session: default NONE (below observer, so the hook does not
    // raise it) with an explicit OBSERVER grant for User 1 alone.
    const user1 = game.users.getName("User 1");
    const ro = await JournalEntry.create({
      name: roName, folder: folder.id,
      ownership: { default: 0, [user1.id]: 2 },
      pages: [buildSessionPageData(roName, "<p>Read only.</p>", null, 13)]
    });
    return { folderId: folder.id, portalId: campaignPortal(folder)?.id ?? null, sessionId: session.id, roSessionId: ro.id };
  }, { campaignName: CAMPAIGN, sessionName: SESSION, roName: SESSION_RO });
```

Replace test 3 with two tests:

```js
  async function openSessionTab(page, sessionId) {
    await login(page, "User 1");
    await page.locator('[data-tab="journal"][data-action="tab"]').click();
    await settle(page, 200);
    await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, sessionId);
    await settle(page, 600);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 300);
    return shell;
  }

  test("3a. an owning player sees the attendee drag hint and no Secrets block", async ({ page }) => {
    const shell = await openSessionTab(page, ids.sessionId);
    await expect(shell.locator(".secrets-section")).toHaveCount(0);
    const hint = await page.evaluate(() => game.i18n.localize("MEJCampaignCompanion.session.dragActorHint"));
    await expect(shell.locator(".attendees-list .instruction")).toHaveText(hint);
  });

  test("3b. a view-only player sees 'No attendees recorded yet.' and no Secrets block", async ({ page }) => {
    const shell = await openSessionTab(page, ids.roSessionId);
    await expect(shell.locator(".secrets-section")).toHaveCount(0);
    await expect(shell.locator(".attendees-list .instruction")).toHaveText("No attendees recorded yet.");
  });
```

Both sessions are TT- named inside a TT- campaign; the existing `afterAll` (`deleteJournalsByPrefix` + `cleanupStrandedTestFolders`) already reclaims them.

- [ ] **Step 6: Run spec 34 live (World A, GM + User 1)**

Run: `npx playwright test tests/e2e/34-player-hub.spec.mjs --trace off`
Expected: 6 passed (tests 1, 2, 3a, 3b, 4, 5). If 3a fails because User 1 is not an owner, check the created session's `ownership.default` is 3 (the preCreate hook); if 3b fails because the Secrets block shows, confirm `ownership.default` is 0 and only `user1.id` is 2.

- [ ] **Step 7: Commit**

```bash
git add templates/session.hbs test/session-template-gates.test.js tests/e2e/34-player-hub.spec.mjs
git commit -m "feat(session): show the attendee drag hint to anyone who can edit; spec 34 owner/view-only split"
```

---

### Task 3: Pure filing rules and the fallback-campaign name (§1b, §1c)

**Files:**
- Create: `scripts/logic/session-filing.mjs`
- Modify: `lang/en.json` (`campaign` block, after `"noCampaignFolder"`)
- Test: `test/session-filing.test.js`

**Interfaces:**
- Produces: `shouldFileSession(entry): boolean`, `holdsSessionPage(entry): boolean`, `pickFallbackCampaign(campaigns, name): Folder|null`, `filingUpdate(campaignId, level): {folder, "ownership.default"}`; i18n `MEJCampaignCompanion.campaign.fallbackName` = `"New Campaign"`.
- Consumes: `storedPageType` (`scripts/logic/mej-type.mjs`), `SESSION_DOCUMENT_TYPE` (`scripts/constants.mjs`), `campaignSessionTargetLevel` (`scripts/logic/session-ownership.mjs:77`).

- [ ] **Step 1: Write the failing tests**

Create `test/session-filing.test.js`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldFileSession, holdsSessionPage, pickFallbackCampaign, filingUpdate } from "../scripts/logic/session-filing.mjs";
import { campaignSessionTargetLevel } from "../scripts/logic/session-ownership.mjs";

const SESSION = "mej-campaign-companion.session";
// MEJ's fixType() leaves `type` as the bare key; `_source.type` keeps the subtype.
const sessionPage = (overrides = {}) => ({ type: "session", _source: { type: SESSION }, ...overrides });
const textPage = () => ({ type: "text", _source: { type: "text" } });
const entry = ({ folder = null, pages = [sessionPage()] } = {}) => ({ documentName: "JournalEntry", folder, pages: { contents: pages } });

describe("shouldFileSession (spec 2026-10-16 §1b)", () => {
  it("files a folderless entry holding a session page, even after MEJ rewrote the in-memory type", () => {
    expect(shouldFileSession(entry())).toBe(true);
  });
  it("leaves an entry in ANY folder alone — plain or campaign", () => {
    expect(shouldFileSession(entry({ folder: { id: "f1", flags: {} } }))).toBe(false);
    expect(shouldFileSession(entry({ folder: { id: "c1", flags: { "mej-campaign-companion": { campaign: {} } } } }))).toBe(false);
  });
  it("ignores folderless non-session entries, pages and nulls", () => {
    expect(shouldFileSession(entry({ pages: [textPage()] }))).toBe(false);
    expect(shouldFileSession({ documentName: "JournalEntryPage", parent: entry() })).toBe(false);
    expect(shouldFileSession(null)).toBe(false);
  });
  it("files a multi-page entry whole when one page is a session", () => {
    expect(shouldFileSession(entry({ pages: [textPage(), sessionPage()] }))).toBe(true);
  });
  it("holdsSessionPage accepts creation-shaped data with a plain pages array", () => {
    expect(holdsSessionPage({ pages: [{ type: SESSION }] })).toBe(true);
    expect(holdsSessionPage({ pages: [{ type: "text" }] })).toBe(false);
  });
});

describe("pickFallbackCampaign (spec §1c reuse rule)", () => {
  const root = { id: "a", name: "New Campaign", folder: null };
  it("reuses the root campaign with exactly that name", () => {
    expect(pickFallbackCampaign([{ id: "x", name: "Alpha", folder: null }, root], "New Campaign")).toBe(root);
  });
  it("never matches a renamed, differently-cased or nested folder, nor an empty list", () => {
    expect(pickFallbackCampaign([{ id: "b", name: "New Campaign (old)", folder: null }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([{ id: "c", name: "new campaign", folder: null }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([{ id: "d", name: "New Campaign", folder: { id: "p" } }], "New Campaign")).toBeNull();
    expect(pickFallbackCampaign([], "New Campaign")).toBeNull();
  });
  it("ships the English name the spec fixes", () => {
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    expect(lang.MEJCampaignCompanion.campaign.fallbackName).toBe("New Campaign");
  });
});

describe("filing ownership (spec §1b)", () => {
  const opts = { sessionType: "session", sessionDocumentType: SESSION, observerLevel: 2, ownerLevel: 3 };
  it("a session filed into an observer campaign becomes player-owned (the session-aware level)", () => {
    expect(campaignSessionTargetLevel(entry(), 2, opts)).toBe(3);
  });
  it("a session filed into a GM-only campaign takes the baseline", () => {
    expect(campaignSessionTargetLevel(entry(), 0, opts)).toBe(0);
  });
  it("the filing update touches folder and default ownership only — explicit per-user ownership is untouched", () => {
    expect(filingUpdate("c1", 3)).toEqual({ folder: "c1", "ownership.default": 3 });
    expect(Object.keys(filingUpdate("c1", 3))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/session-filing.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure module and the i18n key**

Create `scripts/logic/session-filing.mjs`:

```js
// Pure rules for "a session always lives in a campaign" (spec 2026-10-16
// sessions-in-campaigns §1). No Foundry imports so vitest loads it directly;
// hooks/session-filing.mjs wires them to Foundry.
import { SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { storedPageType } from "./mej-type.mjs";

/** Pages of an entry, from a live collection (`pages.contents`) or creation-shaped data (plain array). */
function pagesOf(entry) {
  return Array.isArray(entry?.pages) ? entry.pages : (entry?.pages?.contents ?? []);
}

/** Whether the entry holds at least one Session page, by stored subtype (MEJ rewrites the in-memory type). */
export function holdsSessionPage(entry) {
  return pagesOf(entry).some((p) => storedPageType(p) === SESSION_DOCUMENT_TYPE);
}

/**
 * Whether the filing hook moves this entry: a FOLDERLESS JournalEntry holding
 * a session page. An entry in any folder - campaign or plain ("Archive",
 * "One-shots") - is left where the GM put it (§1b). Multi-page entries are
 * filed whole.
 */
export function shouldFileSession(entry) {
  if (!entry || entry.documentName !== "JournalEntry") return false;
  if (entry.folder) return false;
  return holdsSessionPage(entry);
}

/**
 * The root campaign folder named exactly `name`, or null. This reuse rule is
 * what stops "New Campaign" folders piling up (§1c): the GM renames the
 * folder like any other, and the next fallback creates a fresh one.
 */
export function pickFallbackCampaign(campaigns, name) {
  return (campaigns ?? []).find((c) => c?.name === name && !c?.folder) ?? null;
}

/** The single update that files an entry: folder plus default ownership only; explicit per-user ownership is untouched (§1b). */
export function filingUpdate(campaignId, level) {
  return { folder: campaignId, "ownership.default": level };
}
```

In `lang/en.json`, inside the `"campaign": { … }` block, after the `"noCampaignFolder"` line, add:

```json
      "noCampaignFolder": "This page isn't inside a campaign folder — use New Campaign in the journal sidebar.",
      "fallbackName": "New Campaign"
```

(i.e. add a comma after the existing `noCampaignFolder` value and the new line.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/session-filing.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/session-filing.mjs test/session-filing.test.js lang/en.json
git commit -m "feat(sessions): pure filing rules and the \"New Campaign\" fallback name"
```

---

### Task 4: `ensureTimelineJournal(null)` never creates a world timeline (§1e)

**Files:**
- Modify: `scripts/data/timeline-journal.mjs:82-98`
- Modify: `scripts/apps/CampaignHubPage.mjs:435-438`
- Test: `test/timeline-journal-ensure.test.js`

**Interfaces:**
- Produces: `ensureTimelineJournal(campaign = null)`: with a campaign, unchanged (find or GM-create `${campaign.name} — Timeline`); with none, returns `getTimelineJournal()` (the legacy `timelineJournalId` singleton) or null and never writes.

- [ ] **Step 1: Write the failing test**

Create `test/timeline-journal-ensure.test.js`. The data module reads Foundry globals only at call time, so stub them:

```js
import { describe, it, expect, beforeEach, vi } from "vitest";

const settings = new Map();
const journals = new Map();

beforeEach(() => {
  settings.clear();
  journals.clear();
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.game = {
    user: { isGM: true },
    settings: {
      get: (mod, key) => settings.get(key) ?? "",
      set: vi.fn(async (mod, key, value) => { settings.set(key, value); })
    },
    journal: { get: (id) => journals.get(id) ?? null, contents: [] }
  };
  globalThis.JournalEntry = { create: vi.fn(async (data) => ({ id: "created", ...data })) };
});

describe("ensureTimelineJournal with no campaign (spec 2026-10-16 §1e)", () => {
  it("returns null and creates nothing when the world has no legacy timeline", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    expect(await ensureTimelineJournal(null)).toBeNull();
    expect(await ensureTimelineJournal()).toBeNull();
    expect(JournalEntry.create).not.toHaveBeenCalled();
    expect(game.settings.set).not.toHaveBeenCalled();
  });
  it("still hands back the legacy singleton the timelineJournalId setting names", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    const legacy = { id: "L1", name: "Campaign Timeline" };
    settings.set("timelineJournalId", "L1");
    journals.set("L1", legacy);
    expect(await ensureTimelineJournal(null)).toBe(legacy);
    expect(JournalEntry.create).not.toHaveBeenCalled();
  });
  it("still creates a campaign's own timeline for a GM", async () => {
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    const campaign = {
      id: "c1", name: "Alpha", folder: null, contents: [],
      flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } },
      getFlag: () => null
    };
    const created = await ensureTimelineJournal(campaign);
    expect(JournalEntry.create).toHaveBeenCalledTimes(1);
    expect(created.name).toBe("Alpha — Timeline");
    expect(created.folder).toBe("c1");
  });
  it("a non-GM gets null, never a create", async () => {
    globalThis.game.user.isGM = false;
    const { ensureTimelineJournal } = await import("../scripts/data/timeline-journal.mjs");
    expect(await ensureTimelineJournal({ id: "c1", name: "Alpha", contents: [], flags: {}, getFlag: () => null })).toBeNull();
    expect(JournalEntry.create).not.toHaveBeenCalled();
  });
});
```

If importing `timeline-journal.mjs` fails because a transitive import touches a Foundry global at module scope, stub that global in `beforeEach` too; never mock the module under test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/timeline-journal-ensure.test.js`
Expected: the first test FAILS — `ensureTimelineJournal(null)` calls `JournalEntry.create` and `game.settings.set`.

- [ ] **Step 3: Stop creating the world timeline**

Replace lines 82-98 of `scripts/data/timeline-journal.mjs` with:

```js
/**
 * Find or create the scope's default timeline journal. Creation needs a GM
 * AND a campaign: with no campaign this returns the legacy world singleton
 * (`timelineJournalId`, kept so worlds that already have one keep showing it)
 * or null. The companion never creates a root "Campaign Timeline" any more -
 * campaign-less sessions were the only reason it existed, and sessions now
 * always live in a campaign (spec 2026-10-16 §1e).
 */
export async function ensureTimelineJournal(campaign = null) {
  const journal = resolveTimelineJournal(campaign);
  if (journal || !campaign || !game.user.isGM) return journal;
  return createTimeline({ campaign, name: `${campaign.name} — Timeline` });
}
```

In `scripts/apps/CampaignHubPage.mjs` lines 435-438 replace:

```js
      if (!getCampaigns().length) {
        // Pre-adoption world: legacy singleton behavior, unchanged.
        const journal = isGM ? await ensureTimelineJournal() : getTimelineJournal();
```

with:

```js
      if (!getCampaigns().length) {
        // Pre-adoption world: the legacy singleton if the world has one, else
        // the empty state. Never created here (spec 2026-10-16 §1e): the empty
        // state's Add Timepoint files into the fallback campaign instead.
        const journal = getTimelineJournal();
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run test/timeline-journal-ensure.test.js && npx vitest run`
Expected: PASS; the full suite stays green.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/timeline-journal.mjs scripts/apps/CampaignHubPage.mjs test/timeline-journal-ensure.test.js
git commit -m "feat(timeline): never auto-create a world timeline; no campaign means legacy singleton or null"
```

---

### Task 5: The filing hook, the fallback campaign, the ready-time sweep, and timepoints that follow (§1b, §1c, §1d, §1f)

**Files:**
- Create: `scripts/hooks/session-filing.mjs`
- Modify: `scripts/data/campaign-store.mjs:190-197` (export a public wrapper)
- Modify: `scripts/hooks/session-timepoint.mjs:5-19`
- Modify: `scripts/integrations/mej-adapter.mjs:199` (register next to `registerSessionTimepoint()`)
- Modify: `scripts/campaign-companion.mjs` (ready hook, after `await healSessionFlags();`)

**Interfaces:**
- Consumes: Task 3's `shouldFileSession`, `pickFallbackCampaign`, `filingUpdate`; `getCampaigns`, `createCampaign`, `baselineOwnership` (`campaign-store.mjs`); `campaignOf` (`logic/campaigns.mjs`).
- Produces: `ensureFallbackCampaign(): Promise<Folder|null>` (GM only, serialized), `ensureSessionFiled(entry): Promise<Folder|null>` (resolves to the campaign the entry is in after filing, null for a plain-folder session or a non-GM caller), `sweepUnfiledSessions(): Promise<number>`, `registerSessionFiling()`; `sessionTargetLevel(entry, campaign): number` exported from `campaign-store.mjs`.

- [ ] **Step 1: Export the session-aware level from the store**

In `scripts/data/campaign-store.mjs`, directly after the private `sessionAwareLevel` function (ends at line 197), add:

```js
/** Public form of sessionAwareLevel for callers holding the campaign: the default ownership a member of `campaign` should carry. */
export function sessionTargetLevel(entry, campaign) {
  return sessionAwareLevel(entry, baselineOwnership(campaign));
}
```

- [ ] **Step 2: Write the hook module**

Create `scripts/hooks/session-filing.mjs`:

```js
// Sessions always live in a campaign (spec 2026-10-16 §1). The active GM's
// client files every FOLDERLESS entry holding a Session page into the
// fallback campaign - "New Campaign", reused while a root campaign of that
// exact name exists - on create (§1b) and once per GM load for the sessions
// that already exist (§1f). Decisions are pure (logic/session-filing.mjs);
// this file reads Foundry state and writes through the store. Silent by
// design: no dialog, no warning (§1i).
import { MODULE_ID, I18N } from "../constants.mjs";
import { shouldFileSession, pickFallbackCampaign, filingUpdate } from "../logic/session-filing.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { getCampaigns, createCampaign, sessionTargetLevel } from "../data/campaign-store.mjs";

// One fallback resolution at a time: two sessions created in the same burst
// (an import, a double click) must share ONE "New Campaign", never race two
// Folder.create calls into a pile of them (spec anti-goal).
let fallbackChain = Promise.resolve();

/**
 * GM-only. The fallback campaign: the root campaign named exactly "New
 * Campaign" when one exists, else a new one (folder + portal + timeline via
 * createCampaign, observer baseline). Null for a non-GM or a failed create.
 */
export function ensureFallbackCampaign() {
  if (!game.user.isGM) return Promise.resolve(null);
  const run = fallbackChain.then(async () => {
    const name = game.i18n.localize(`${I18N}.campaign.fallbackName`);
    return pickFallbackCampaign(getCampaigns(), name) ?? await createCampaign(name, { ownershipDefault: "observer" });
  }).catch((err) => {
    console.error(`${MODULE_ID} | fallback campaign failed`, err);
    return null;
  });
  fallbackChain = run;
  return run;
}

// Per-entry in-flight filing: the entry create hook, the page create hook and
// the timepoint hook's own call all await the same move.
const inflight = new Map();

/**
 * Active-GM only. Resolve the campaign this entry ends up in. A folderless
 * session entry is filed into the fallback campaign - default ownership set
 * to that campaign's session-aware level, explicit per-user ownership left
 * alone (§1b) - and anything else stays where it is. Resolves to the entry's
 * campaign afterwards (null for a session the GM keeps in a plain folder, or
 * on any other client). hooks/session-timepoint.mjs awaits this before it
 * picks a timeline, so a filed session's timepoint lands on the fallback
 * campaign's timeline, never on a world one (§1d).
 */
export function ensureSessionFiled(entry) {
  if (!entry || game.user !== game.users.activeGM || !shouldFileSession(entry)) {
    return Promise.resolve(entry ? campaignOf(entry) : null);
  }
  if (inflight.has(entry.id)) return inflight.get(entry.id);
  const run = (async () => {
    const campaign = await ensureFallbackCampaign();
    if (!campaign) return null;
    // Re-check: a second arrival may find the move already landed.
    if (!shouldFileSession(entry)) return campaignOf(entry);
    await entry.update(filingUpdate(campaign.id, sessionTargetLevel(entry, campaign)));
    return campaign;
  })().catch((err) => {
    console.error(`${MODULE_ID} | filing session ${entry.uuid} failed`, err);
    return null;
  }).finally(() => inflight.delete(entry.id));
  inflight.set(entry.id, run);
  return run;
}

/** Active-GM only, once per load (§1f): file every folderless session entry already in the world. Idempotent; a clean world does nothing. */
export async function sweepUnfiledSessions() {
  if (game.user !== game.users.activeGM) return 0;
  let filed = 0;
  for (const entry of game.journal.contents.filter((e) => shouldFileSession(e))) {
    if (await ensureSessionFiled(entry)) filed++;
  }
  if (filed) console.log(`${MODULE_ID} | filed ${filed} unfiled session(s) into the fallback campaign`);
  return filed;
}

function guard(task, what) {
  task.catch((err) => console.error(`${MODULE_ID} | session filing: ${what} failed`, err));
}

export function registerSessionFiling() {
  // Pages created with their entry fire only createJournalEntry; a page added
  // to an existing entry (MEJ's New Entry _onCreate patch) fires
  // createJournalEntryPage. Both route to the same idempotent filing.
  Hooks.on("createJournalEntry", (entry) => guard(ensureSessionFiled(entry), "create"));
  Hooks.on("createJournalEntryPage", (page) => guard(ensureSessionFiled(page?.parent), "create"));
}
```

- [ ] **Step 3: Make the timepoint hook wait for filing**

In `scripts/hooks/session-timepoint.mjs` add the import after line 5:

```js
import { ensureSessionFiled } from "./session-filing.mjs";
```

Replace lines 13-15 (`createSessionTimepoint` head) with:

```js
async function createSessionTimepoint(page) {
  if (!wantsSessionTimepoint(page._source, MODULE_ID)) return;
  // A folderless session is filed into the fallback campaign first, so its
  // timepoint lands on that campaign's timeline, never on a world timeline
  // (spec 2026-10-16 §1d). A session the GM keeps in a plain folder resolves
  // to no campaign: no world timeline is created for it (§1e).
  const campaign = (await ensureSessionFiled(page.parent)) ?? campaignOf(page);
  const journal = await ensureTimelineJournal(campaign);
```

- [ ] **Step 4: Register the hook and the sweep**

In `scripts/integrations/mej-adapter.mjs`, next to line 199 `registerSessionTimepoint();`, add `registerSessionFiling();` with the matching import (`import { registerSessionFiling } from "../hooks/session-filing.mjs";` beside the existing `registerSessionTimepoint` import). Register filing BEFORE the timepoint hook so the two create hooks run filing first.

In `scripts/campaign-companion.mjs`, directly after `await healSessionFlags();` in the ready hook, add:

```js
  // Spec 2026-10-16 §1f: sessions always live in a campaign. Once per GM load
  // the active GM files the folderless sessions that already exist (into the
  // "New Campaign" fallback, same rule as the create hook). Idempotent; not a
  // dataVersion migration - no schema changes, so no version gate.
  if (game.user === game.users.activeGM) {
    const { sweepUnfiledSessions } = await import("./hooks/session-filing.mjs");
    await sweepUnfiledSessions().catch((err) => console.error(`${MODULE_ID} | unfiled session sweep failed`, err));
  }
```

- [ ] **Step 5: Unit suite and a smoke check**

Run: `npx vitest run`
Expected: PASS. Then a live smoke on World A (GM): `npx playwright test tests/e2e/32-session-timepoint.spec.mjs --trace off` — expected: all pass (its sessions are created inside a campaign; the filing hook must not interfere). If "New Campaign" appeared in World A during this smoke, note it in the report; Task 7 adds the reclaim sweep.

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/session-filing.mjs scripts/data/campaign-store.mjs scripts/hooks/session-timepoint.mjs scripts/integrations/mej-adapter.mjs scripts/campaign-companion.mjs
git commit -m "feat(sessions): file folderless sessions into a \"New Campaign\" fallback; timepoints follow; ready-time sweep"
```

---

### Task 6: Hub New Session falls back; Start Session still aborts; Add Timepoint, auto-capture and import use the fallback (§1a, §1e, §1h, §1i)

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs:1274-1313, 1599-1620, 1849-1860`
- Modify: `scripts/hooks/auto-capture.mjs:44, 107-117`
- Modify: `scripts/apps/import-wizard.mjs:26, 681-684`
- Test: `test/hub-session-actions.test.js`

**Interfaces:**
- Consumes: `ensureFallbackCampaign` (Task 5).
- Produces: `promptCampaignChoice(title, { alwaysPrompt, silent })` — `silent: true` suppresses the zero-campaign warning.

- [ ] **Step 1: Write the failing source-shape test**

Create `test/hub-session-actions.test.js` (the Hub is an ApplicationV2 subclass and not vitest-loadable; this pins the two behaviours the spec fixes, the way `session-template-gates.test.js` pins template gates):

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/apps/CampaignHubPage.mjs", import.meta.url), "utf8");
const method = (name) => {
  const start = src.indexOf(`static async ${name}(`);
  const end = src.indexOf("\n  static ", start + 1);
  return src.slice(start, end);
};

describe("Hub session actions (spec 2026-10-16 §1a, §1h)", () => {
  it("New Session never creates a loose session: a dismissed prompt falls back to the fallback campaign, silently", () => {
    const body = method("onNewSession");
    expect(body).toContain("?? await ensureFallbackCampaign()");
    expect(body).toContain("silent: true");
    expect(body).not.toMatch(/destination\s*=\s*campaign\s*\?/);
  });
  it("Start Session aborts when its prompt is dismissed and never falls back", () => {
    const body = method("onStartSession");
    expect(body).toContain("if (!campaign) return;");
    expect(body).not.toContain("ensureFallbackCampaign");
  });
  it("Add Timepoint with no campaign in scope files into the fallback campaign", () => {
    expect(method("onAddTimepoint")).toContain("?? await ensureFallbackCampaign()");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/hub-session-actions.test.js`
Expected: FAIL (no `ensureFallbackCampaign` in the Hub yet).

- [ ] **Step 3: Hub changes**

Add the import near the other hook imports at the top of `scripts/apps/CampaignHubPage.mjs`:

```js
import { ensureFallbackCampaign } from "../hooks/session-filing.mjs";
```

Replace `onNewSession` (lines 1274-1299) with:

```js
  static async onNewSession() {
    if (!game.user.isGM) return;
    try {
      const name = game.i18n.localize(`${I18N}.hub.newSession`);
      const { campaign: scoped } = this.#scope();
      // RULING (kept): always prompt when the scope doesn't imply a campaign
      // (Unfiled/All) - the GM may want an existing one. Dismissing the
      // prompt, or a world with no campaigns, means "make me one": the
      // session is created inside the fallback campaign, never loose
      // (spec 2026-10-16 §1a/§1c). The zero-campaign warning is skipped
      // because the fallback answers it (§1i).
      const campaign = scoped
        ?? await CampaignHubPage.promptCampaignChoice(name, { alwaysPrompt: true, silent: true })
        ?? await ensureFallbackCampaign();
      if (!campaign) throw new Error("no campaign available for the new session");
      const entry = await JournalEntry.create({
        name,
        folder: campaign.id,
        ownership: { default: baselineOwnership(campaign) },
        pages: [buildSessionPageData(name, "", null, null)]
      });
      const page = entry?.pages?.contents?.[0];
      if (page) await openSessionPage(page);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | creating a session failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.hub.newSessionFailed`));
    }
  }
```

In `onStartSession` (line 1305) keep `if (!campaign) return;` and add above it:

```js
    // Owner's decision (spec 2026-10-16 §1h): dismissing the prompt aborts.
    // Only New Session falls back to a created campaign.
```

Replace `promptCampaignChoice`'s signature and the `none` branch (lines 1610-1620):

```js
  static async promptCampaignChoice(title, { alwaysPrompt = false, silent = false } = {}) {
    const campaigns = getCampaigns();
    // Two different outcomes used to share one silent `null`: "the GM
    // cancelled" and "there was no dialog to show". Every caller returns on
    // null, so filing/capture controls did nothing at all in a world with no
    // campaigns yet. Say so - unless the caller has its own answer for a
    // campaign-less world (`silent`: onNewSession's fallback campaign, §1i).
    const plan = campaignChoicePlan(campaigns, { alwaysPrompt });
    if (plan.kind === "none") {
      if (!silent) ui.notifications.warn(game.i18n.localize(plan.warnKey));
      return null;
    }
```

Extend the doc comment above it with one line: `silent` suppresses the zero-campaign warning for a caller that falls back instead.

In `onAddTimepoint` (lines 1857-1859) replace:

```js
    const journal = journalId
      ? game.journal.get(journalId)
      : await ensureTimelineJournal(stackCampaign ?? this.#scope().campaign ?? null);
```

with:

```js
    // No campaign in scope (All in a zero-campaign world, or the legacy
    // pre-adoption pane): the fallback campaign holds the timepoint, since a
    // world timeline is never created (spec 2026-10-16 §1e).
    const journal = journalId
      ? game.journal.get(journalId)
      : await ensureTimelineJournal(stackCampaign ?? this.#scope().campaign ?? await ensureFallbackCampaign());
```

- [ ] **Step 4: Auto-capture and import wizard**

`scripts/hooks/auto-capture.mjs`: add `import { ensureFallbackCampaign } from "./session-filing.mjs";` after line 44, and replace line 113:

```js
  // No target campaign (a world with none yet): the fallback campaign holds
  // the capture - a world timeline is never created (spec 2026-10-16 §1e).
  const journal = await ensureTimelineJournal(campaign ?? await ensureFallbackCampaign());
```

`scripts/apps/import-wizard.mjs`: add `import { ensureFallbackCampaign } from "../hooks/session-filing.mjs";` after line 26, and replace line 684:

```js
            // Importing with no campaign chosen: timepoints go to the fallback
            // campaign's timeline (spec 2026-10-16 §1e; a world timeline is never created).
            timeline ??= await ensureTimelineJournal(campaign ?? await ensureFallbackCampaign());
```

- [ ] **Step 5: Run the unit suite**

Run: `npx vitest run`
Expected: PASS, including `test/hub-session-actions.test.js` (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs scripts/hooks/auto-capture.mjs scripts/apps/import-wizard.mjs test/hub-session-actions.test.js
git commit -m "feat(hub): New Session falls back to the \"New Campaign\" campaign; Add Timepoint, auto-capture and import use it too"
```

---

### Task 7: e2e for sessions in campaigns — helpers, fallback reclaim, spec 37, spec 14 test 6, spec 02 conversion

**Files:**
- Modify: `tests/e2e/helpers/foundry.mjs` (new helpers), `tests/e2e/helpers/sweep-rules.mjs` (new rule)
- Test: `test/sweep-rules.test.js` (create if it does not exist; otherwise append)
- Create: `tests/e2e/helpers/hub.mjs`
- Create: `tests/e2e/37-sessions-in-campaigns.spec.mjs`
- Modify: `tests/e2e/global-setup.mjs:81-86`, `tests/e2e/14-campaigns.spec.mjs:26-60, 659-697`, `tests/e2e/02-hub-timeline.spec.mjs:28-66, 119-128, 155-290`

**Interfaces:**
- Produces (helpers/foundry.mjs): `createTtCampaign(page, name, { ownershipDefault })` → `{ folderId, timelineId, portalId }`; `createTtPlainFolder(page, name)` → folder id; `fallbackCampaignId(page)` → id|null; `cleanupFallbackCampaign(page, { prefix })` → deleted name|null; `hideOtherCampaignsFrom(gmPage, keepIds)` → restore list; `restoreHidden(gmPage, list)`.
- Produces (helpers/sweep-rules.mjs): `fallbackCampaignReclaimable(members, prefix)`.
- Produces (helpers/hub.mjs): `openHub(page)`, `scopeHub(shell, page, value)` (moved verbatim from `14-campaigns.spec.mjs:26-60`), `openHubViaToolbar(page)` (moved verbatim from `02-hub-timeline.spec.mjs:10-27`). Both specs import them from the helper.

- [ ] **Step 1: Failing unit test for the reclaim rule**

In `test/sweep-rules.test.js` (create with the usual vitest imports if absent) add:

```js
import { fallbackCampaignReclaimable } from "../tests/e2e/helpers/sweep-rules.mjs";

describe("fallbackCampaignReclaimable", () => {
  const portal = { name: "New Campaign", portal: true, timeline: false, timepointLabels: [] };
  const tl = (labels) => ({ name: "New Campaign — Timeline", portal: false, timeline: true, timepointLabels: labels });
  it("reclaims a fallback that holds only TT- sessions and TT- timepoints, or nothing at all", () => {
    expect(fallbackCampaignReclaimable([portal, tl(["TT-S1"]), { name: "TT-S1", portal: false, timeline: false }])).toBe(true);
    expect(fallbackCampaignReclaimable([portal, tl([])])).toBe(true);
    expect(fallbackCampaignReclaimable([])).toBe(true);
  });
  it("keeps a fallback with any real member or any real timepoint", () => {
    expect(fallbackCampaignReclaimable([portal, tl([]), { name: "Session 12", portal: false, timeline: false }])).toBe(false);
    expect(fallbackCampaignReclaimable([portal, tl(["TT-S1", "The Vault"])])).toBe(false);
  });
});
```

Run: `npx vitest run test/sweep-rules.test.js` — expected FAIL (export missing).

- [ ] **Step 2: The rule and the helpers**

Append to `tests/e2e/helpers/sweep-rules.mjs`:

```js
/**
 * Whether a fallback "New Campaign" is the suite's own leftover: every member
 * that is not its portal or a timeline is TT- named (or there are none), and
 * every timepoint on its timelines is TT- labelled (or there are none). Any
 * real content keeps the folder. `members` rows: { name, portal, timeline, timepointLabels }.
 */
export function fallbackCampaignReclaimable(members, prefix = TT_PREFIX) {
  return (members ?? []).every((m) => {
    if (m.portal) return true;
    if (m.timeline) return (m.timepointLabels ?? []).every((l) => typeof l === "string" && l.startsWith(prefix));
    return typeof m.name === "string" && m.name.startsWith(prefix);
  });
}
```

Append to `tests/e2e/helpers/foundry.mjs` (import `fallbackCampaignReclaimable` from `./sweep-rules.mjs` alongside the existing sweep-rule imports):

```js
/**
 * As a GM page: a whole TT- campaign (folder + portal + timeline, all TT-
 * named) through the module's own createCampaign, so a spec that needs a
 * session INSIDE a campaign gets the structure production code expects.
 * Delete with deleteFoldersById; the TT- sweeps reclaim a stranded one.
 */
export async function createTtCampaign(page, name, { ownershipDefault = "observer" } = {}) {
  return page.evaluate(async ({ n, own }) => {
    const { createCampaign, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const { campaignTimelineJournal } = await import("/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs");
    const folder = await createCampaign(n, { ownershipDefault: own });
    return { folderId: folder.id, timelineId: campaignTimelineJournal(folder)?.id ?? null, portalId: campaignPortal(folder)?.id ?? null };
  }, { n: name, own: ownershipDefault });
}

/**
 * As a GM page: a plain (non-campaign) TT- folder. Since 0.28.0 a FOLDERLESS
 * session is filed into the "New Campaign" fallback by the GM client; a
 * session in a plain folder is left alone, so specs whose assertions depend
 * on a session's own ownership or location put it here.
 */
export async function createTtPlainFolder(page, name) {
  return page.evaluate(async (n) => (await Folder.create({ name: n, type: "JournalEntry" })).id, name);
}

/** The id of the root campaign folder named exactly "New Campaign" (the 0.28.0 fallback campaign), or null. */
export async function fallbackCampaignId(page) {
  return page.evaluate(() => {
    const name = game.i18n.localize("MEJCampaignCompanion.campaign.fallbackName");
    return game.folders.find((f) => f.type === "JournalEntry" && !f.folder && f.name === name && !!f.getFlag("mej-campaign-companion", "campaign"))?.id ?? null;
  });
}

/**
 * Reclaim a fallback "New Campaign" the suite's own sessions caused (specs
 * that create folderless TT- sessions make the GM client create one). Deleted
 * only when fallbackCampaignReclaimable says every member outside the portal
 * and timelines is TT- named and every timepoint is TT- labelled; a "New
 * Campaign" holding real content is left alone. Clears autoCaptureCampaign
 * if it pointed at the deleted folder. Returns the deleted name or null.
 */
export async function cleanupFallbackCampaign(page, { prefix = TT_PREFIX } = {}) {
  const snapshot = await page.evaluate(async () => {
    const M = "mej-campaign-companion";
    const { campaignOf, isCampaignPortal, isTimelineJournal } = await import(`/modules/${M}/scripts/logic/campaigns.mjs`);
    const name = game.i18n.localize("MEJCampaignCompanion.campaign.fallbackName");
    const folder = game.folders.find((f) => f.type === "JournalEntry" && !f.folder && f.name === name && !!f.getFlag(M, "campaign"));
    if (!folder) return null;
    const members = game.journal.filter((e) => campaignOf(e)?.id === folder.id).map((e) => ({
      name: e.name,
      portal: isCampaignPortal(e),
      timeline: isTimelineJournal(e),
      timepointLabels: (e.getFlag(M, "timeline")?.timepoints ?? []).map((t) => t.label ?? "")
    }));
    return { id: folder.id, members };
  });
  if (!snapshot || !fallbackCampaignReclaimable(snapshot.members, prefix)) return null;
  return page.evaluate(async (id) => {
    const M = "mej-campaign-companion";
    const f = game.folders.get(id);
    if (!f) return null;
    const name = f.name;
    await f.delete({ deleteSubfolders: true, deleteContents: true });
    if (game.settings.get(M, "autoCaptureCampaign") === id) await game.settings.set(M, "autoCaptureCampaign", "");
    return name;
  }, snapshot.id);
}

/**
 * As a GM page: hide every member and the portal of every campaign NOT in
 * `keepIds` from players (ownership.default -> NONE), so a player seat sees
 * exactly the kept campaigns. Returns the restore list for restoreHidden.
 * Lifted from 34-player-hub.spec.mjs's beforeAll.
 */
export async function hideOtherCampaignsFrom(gmPage, keepIds) {
  const result = await gmPage.evaluate(async (keep) => {
    const { getCampaigns, campaignPortal, campaignEntries } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const out = [];
    let error = null;
    try {
      for (const c of getCampaigns()) {
        if (keep.includes(c.id)) continue;
        for (const d of [...campaignEntries(c), campaignPortal(c)].filter(Boolean)) {
          out.push({ id: d.id, def: d.ownership?.default ?? 0 });
          await d.update({ "ownership.default": 0 });
        }
      }
    } catch (e) { error = String(e); }
    return { out, error };
  }, keepIds);
  if (result.error) {
    // Restore what was hidden before surfacing the failure.
    await restoreHidden(gmPage, result.out);
    throw new Error(result.error);
  }
  return result.out;
}

/** Undo hideOtherCampaignsFrom. */
export async function restoreHidden(gmPage, hidden) {
  await gmPage.evaluate(async (list) => {
    for (const h of list ?? []) await game.journal.get(h.id)?.update({ "ownership.default": h.def });
  }, hidden ?? []);
}
```

Refactor `tests/e2e/34-player-hub.spec.mjs`'s `beforeAll`/`afterAll` to call `hideOtherCampaignsFrom(gm, [ids.folderId])` / `restoreHidden(gm, ids.hidden)` instead of the inline code (same behaviour).

Create `tests/e2e/helpers/hub.mjs` holding `openHub`, `scopeHub` (moved verbatim from `14-campaigns.spec.mjs:26-60`) and `openHubViaToolbar` (moved verbatim from `02-hub-timeline.spec.mjs:10-27`), exported; update both specs to import them (delete the local copies). Add the `openHub`/`scopeHub` imports to spec 37 and (Task 10) spec 38.

In `tests/e2e/global-setup.mjs`, after the `cleanupStrandedTestFolders(page)` line (:85), add:

```js
      // 0.28.0: specs that create folderless TT- sessions make the GM client
      // file them into a "New Campaign" fallback campaign. Reclaim it when it
      // holds nothing but the suite's leftovers (fallbackCampaignReclaimable).
      if (process.env.STOCK_PHASE !== "return") await cleanupFallbackCampaign(page);
```

(and add `cleanupFallbackCampaign` to the import list.)

Run: `npx vitest run test/sweep-rules.test.js` — expected PASS.

- [ ] **Step 3: Spec 37**

Create `tests/e2e/37-sessions-in-campaigns.spec.mjs`:

```js
// Sessions always live in a campaign (spec 2026-10-16 §1). GM seat, World A.
// The "New Campaign" fallback may legitimately exist in the world before this
// spec runs; each test records whether it did and deletes it only if the test
// created it. All sessions and folders here are TT- named.
import { test, expect } from "@playwright/test";
import {
  login, settle, reloadGame, TT_PREFIX, trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404,
  unfiledBootstrapEntryId, createTtPlainFolder, deleteFoldersById, deleteJournalsByPrefix,
  fallbackCampaignId, cleanupFallbackCampaign
} from "./helpers/foundry.mjs";
import { openHub, scopeHub } from "./helpers/hub.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const MOD = "/modules/mej-campaign-companion/scripts";

/** Create a session entry via the API; `folder` null = folderless. */
async function createSession(page, name, { folder = null, ownership = null } = {}) {
  return page.evaluate(async ({ n, f, own, mod }) => {
    const { buildSessionPageData } = await import(`${mod}/logic/session-page-data.mjs`);
    const entry = await JournalEntry.create({
      name: n, ...(f ? { folder: f } : {}), ...(own ? { ownership: own } : {}),
      pages: [buildSessionPageData(n, "<p>Filing test.</p>", null, null)]
    });
    return entry.id;
  }, { n: name, f: folder, own: ownership, mod: MOD });
}

const folderOf = (page, id) => page.evaluate((i) => game.journal.get(i)?.folder?.id ?? null, id);
const worldState = (page) => page.evaluate(() => ({
  timelineSetting: game.settings.get("mej-campaign-companion", "timelineJournalId"),
  rootTimelines: game.journal.filter((e) => !e.folder && !!e.getFlag("mej-campaign-companion", "timeline")).map((e) => e.id).sort()
}));

test.describe("37 sessions in campaigns", () => {
  let before;
  let fallbackExistedBefore;

  test.beforeEach(async ({ page }) => {
    await login(page, "Gamemaster");
    before = await worldState(page);
    fallbackExistedBefore = !!(await fallbackCampaignId(page));
    // Make the shell bootstrap entry exist so Unfiled scope is offered.
    await unfiledBootstrapEntryId(page);
  });

  test.afterEach(async ({ page }) => {
    // No world timeline may appear and the legacy setting may not change (§1e).
    const after = await worldState(page);
    expect(after.timelineSetting).toBe(before.timelineSetting);
    expect(after.rootTimelines).toEqual(before.rootTimelines);
    await deleteJournalsByPrefix(page);
    if (!fallbackExistedBefore) await cleanupFallbackCampaign(page);
  });

  test("1. Hub New Session with the campaign prompt dismissed files the session into \"New Campaign\" with a timepoint on that campaign's timeline", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const sessionName = await page.evaluate(() => game.i18n.localize("MEJCampaignCompanion.hub.newSession"));
    const beforeIds = await page.evaluate((n) => game.journal.filter((j) => j.name === n).map((j) => j.id), sessionName);
    let createdId = null;
    try {
      const shell = await openHub(page);
      await scopeHub(shell, page, "unfiled");
      await shell.locator("button.mej-cc-new-session").click();
      const dialog = page.locator("dialog.application").last();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('select[name="campaign"]')).toHaveCount(1);
      await page.keyboard.press("Escape");
      await settle(page, 1200);

      const created = await page.evaluate(({ n, beforeIds }) => {
        const e = game.journal.find((j) => j.name === n && !beforeIds.includes(j.id));
        if (!e) return null;
        const page0 = e.pages.contents[0];
        return { id: e.id, folder: e.folder?.id ?? null, folderName: e.folder?.name ?? null, timelineId: page0.getFlag("mej-campaign-companion", "session")?.timelineId ?? null, timepointId: page0.getFlag("mej-campaign-companion", "session")?.timepointId ?? null, uuid: page0.uuid };
      }, { n: sessionName, beforeIds });
      expect(created).toBeTruthy();
      createdId = created.id;
      const fallback = await fallbackCampaignId(page);
      expect(fallback).toBeTruthy();
      expect(created.folder).toBe(fallback);
      expect(created.folderName).toBe("New Campaign");
      // The timepoint sits on the fallback campaign's own timeline (§1d).
      const campaignTimeline = await page.evaluate(async ({ id, mod }) => {
        const { campaignTimelineJournal } = await import(`${mod}/data/timeline-journal.mjs`);
        return campaignTimelineJournal(game.folders.get(id))?.id ?? null;
      }, { id: fallback, mod: MOD });
      expect(created.timelineId).toBe(campaignTimeline);
      const linked = await page.evaluate(({ tl, tp, uuid }) => {
        const t = game.journal.get(tl)?.getFlag("mej-campaign-companion", "timeline")?.timepoints?.find((x) => x.id === tp);
        return !!t?.links?.some((l) => l.uuid === uuid);
      }, { tl: created.timelineId, tp: created.timepointId, uuid: created.uuid });
      expect(linked).toBe(true);
      assertNoConsoleErrors(errors);
    } finally {
      if (createdId) await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, createdId).catch(() => {});
    }
  });

  test("2. a folderless session created through the API is filed by the GM client: default ownership raised to the session-aware level, explicit per-user ownership kept", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const user1 = await page.evaluate(() => game.users.getName("User 1").id);
    const id = await createSession(page, `${TT_PREFIX}SIC Loose ${RUN}`, { ownership: { default: 2, [user1]: 1 } });
    await expect.poll(() => folderOf(page, id), { timeout: 10_000 }).not.toBeNull();
    const fallback = await fallbackCampaignId(page);
    expect(await folderOf(page, id)).toBe(fallback);
    const own = await page.evaluate((i) => game.journal.get(i).ownership, id);
    expect(own.default).toBe(3);      // observer campaign -> sessions are player-owned
    expect(own[user1]).toBe(1);       // the explicit grant is untouched
    assertNoConsoleErrors(errors);
  });

  test("3. two folderless sessions created together share one fallback campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const ids = await page.evaluate(async ({ prefix, run, mod }) => {
      const { buildSessionPageData } = await import(`${mod}/logic/session-page-data.mjs`);
      const make = (n) => JournalEntry.create({ name: n, pages: [buildSessionPageData(n, "", null, null)] });
      const [a, b] = await Promise.all([make(`${prefix}SIC Burst A ${run}`), make(`${prefix}SIC Burst B ${run}`)]);
      return [a.id, b.id];
    }, { prefix: TT_PREFIX, run: RUN, mod: MOD });
    for (const id of ids) await expect.poll(() => folderOf(page, id), { timeout: 10_000 }).not.toBeNull();
    const folders = await page.evaluate((list) => list.map((i) => game.journal.get(i).folder.id), ids);
    expect(folders[0]).toBe(folders[1]);
    const count = await page.evaluate(() => game.folders.filter((f) => f.type === "JournalEntry" && !f.folder && f.name === "New Campaign").length);
    expect(count).toBe(1);
    assertNoConsoleErrors(errors);
  });

  test("4. a session created inside a plain TT- folder is not moved", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const plain = await createTtPlainFolder(page, `${TT_PREFIX}SIC Plain ${RUN}`);
    try {
      const id = await createSession(page, `${TT_PREFIX}SIC Kept ${RUN}`, { folder: plain });
      await settle(page, 2000);
      expect(await folderOf(page, id)).toBe(plain);
      assertNoConsoleErrors(errors);
    } finally {
      await deleteFoldersById(page, [plain]);
    }
  });

  test("5. the ready-time sweep files a folderless session left over from an earlier load", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const plain = await createTtPlainFolder(page, `${TT_PREFIX}SIC Sweep ${RUN}`);
    const id = await createSession(page, `${TT_PREFIX}SIC Stranded ${RUN}`, { folder: plain });
    // Only CREATE is hooked: moving the entry out of its folder leaves it
    // folderless, exactly the state a pre-0.28.0 world is in.
    await page.evaluate(async (i) => { await game.journal.get(i).update({ folder: null }); }, id);
    await deleteFoldersById(page, [plain]);
    expect(await folderOf(page, id)).toBeNull();
    await reloadGame(page);
    await expect.poll(() => folderOf(page, id), { timeout: 20_000 }).not.toBeNull();
    expect(await folderOf(page, id)).toBe(await fallbackCampaignId(page));
    assertNoConsoleErrors(errors);
  });

  test("6. Start Session with its campaign prompt dismissed starts nothing", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const countSessions = () => page.evaluate(() => game.journal.filter((e) => e.pages.some((p) => p._source?.type === "mej-campaign-companion.session")).length);
    const n0 = await countSessions();
    const shell = await openHub(page);
    await scopeHub(shell, page, "unfiled");
    const start = shell.locator('[data-action="startSession"]');
    await expect(start).toHaveCount(1);
    await start.click();
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await settle(page, 1000);
    expect(await countSessions()).toBe(n0);
    expect(!!(await fallbackCampaignId(page))).toBe(fallbackExistedBefore);
    assertNoConsoleErrors(errors);
  });
});
```

If the Start button is not rendered in Unfiled scope (the Tonight strip may need a campaign), scope to "" (All) instead for test 6 and note it in the spec header; the assertion is the same.

- [ ] **Step 4: Spec 14 test 6**

Replace test 6 (`14-campaigns.spec.mjs:659-697`) with:

```js
  test("6. New Session in Unfiled scope prompts for a campaign; dismissing the prompt files the session into \"New Campaign\"", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const sessionName = await page.evaluate(() => game.i18n.localize("MEJCampaignCompanion.hub.newSession"));
    const beforeIds = await page.evaluate((n) => game.journal.filter((j) => j.name === n).map((j) => j.id), sessionName);
    const fallbackBefore = await fallbackCampaignId(page);
    try {
      const shell = await openHub(page);
      await scopeHub(shell, page, "unfiled");
      await shell.locator("button.mej-cc-new-session").click();
      // Two (or more) campaigns exist by now (Alpha + Beta) - promptCampaignChoice()
      // only skips the dialog when zero campaigns exist.
      const dialog = page.locator("dialog.application").last();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('select[name="campaign"]')).toHaveCount(1);
      await page.keyboard.press("Escape");
      await settle(page, 1200);

      const created = await page.evaluate(({ n, beforeIds }) => {
        const e = game.journal.find((j) => j.name === n && !beforeIds.includes(j.id));
        return e ? { id: e.id, folder: e.folder?.id ?? null, folderName: e.folder?.name ?? null } : null;
      }, { n: sessionName, beforeIds });
      expect(created).toBeTruthy();
      // Spec 2026-10-16 §1a/§1c: never loose; the fallback campaign holds it.
      expect(created.folderName).toBe("New Campaign");
      expect(created.folder).toBe(await fallbackCampaignId(page));
      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async ({ n, beforeIds }) => {
        const ids = game.journal.filter((j) => j.name === n && !beforeIds.includes(j.id)).map((j) => j.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      }, { n: sessionName, beforeIds }).catch(() => {});
      if (!fallbackBefore) await cleanupFallbackCampaign(page).catch(() => {});
    }
  });
```

Add `fallbackCampaignId, cleanupFallbackCampaign` to spec 14's helper import. Tests 1, 5 and 7 of spec 14 read `timelineJournalId` only to drive or observe the adoption/legacy path; `getTimelineJournal()` still honours the setting, so they stay as they are (run them to confirm).

- [ ] **Step 5: Spec 02 — world-timeline tests become TT- campaign-timeline tests**

In `tests/e2e/02-hub-timeline.spec.mjs`:
- Import `createTtCampaign, deleteFoldersById` from the helpers and `openHubViaToolbar` from `./helpers/hub.mjs` (delete the local copy at :10-27).
- Add `const RUN = Date.now().toString(36); let createdFolders = [];` near the top.
- Replace `ensureWorldTimeline` (:28-66) and its header comment with:

```js
/**
 * The pane this spec writes to: a TT- campaign's own timeline, created
 * through the module's createCampaign (folder + portal + timeline). Since
 * 0.28.0 the companion never creates a world timeline (spec 2026-10-16 §1e),
 * so the former "ensure the world singleton" bootstrap cannot exist; and the
 * campaign timeline is the only pane the Hub can scope to deterministically.
 * Refuses a timeline that existed before this run (never someone's own data).
 */
async function ensureTtTimeline(page) {
  const { folderId, timelineId } = await createTtCampaign(page, `${TT_PREFIX}02 Hub ${RUN}`);
  createdFolders.push(folderId);
  expect(timelineId).toBeTruthy();
  expect(Array.isArray(preexistingTimelines)).toBe(true);
  expect(preexistingTimelines).not.toContain(timelineId);
  return { folderId, timelineId };
}

/** Scope the Hub to the TT- campaign so its single stack is that campaign's timeline. */
async function scopeHubTo(shell, page, folderId) {
  await shell.locator('select[name="campaign-scope"]').selectOption(folderId);
  await settle(page, 400);
}
```

- In `openOwnTimelineTab` make the timeline picker optional (a campaign with one timeline may render no picker): replace the `selectOption` line with
  `const picker = shell.locator('select[name="timeline-select"]'); if (await picker.count()) { await picker.selectOption(timelineId); await settle(page, 300); }`
  and keep the `data-journal-id` equality assertion (it is the point of the helper).
- In each of the three timepoint tests (`:155`, `:215`, and the player-visibility test that calls `ensureWorldTimeline`), replace
  `const worldTimelineId = await ensureWorldTimeline(page); const shell = await openHubViaToolbar(page); await openOwnTimelineTab(shell, page, worldTimelineId);`
  with
  `const { folderId, timelineId } = await ensureTtTimeline(page); const shell = await openHubViaToolbar(page); await scopeHubTo(shell, page, folderId); await openOwnTimelineTab(shell, page, timelineId);`
  and rename every later `worldTimelineId` use to `timelineId`. At `:271` replace `await worldTimelineJournalId(page)` with `timelineId` (drop the `worldTimelineJournalId` import if now unused).
- In `afterEach`, after `cleanupTimelineJournals(...)`, add `await deleteFoldersById(gmPage, createdFolders); createdFolders = [];` inside the same `cleanupAsGm` callback.
- Rewrite the header comment block (`:72-82`) to describe the campaign pane instead of the singleton.

- [ ] **Step 6: Run the three specs live, one at a time**

Run: `npx playwright test tests/e2e/37-sessions-in-campaigns.spec.mjs --trace off` — expected 6 passed.
Run: `npx playwright test tests/e2e/14-campaigns.spec.mjs --trace off` — expected all passed (12 tests).
Run: `npx playwright test tests/e2e/02-hub-timeline.spec.mjs --trace off` — expected all passed.
After the runs: `fallbackCampaignId` on World A should be null unless it existed before (check in the Playwright report or with a one-off `page.evaluate`), and no journal named "Campaign Timeline" was added at the root.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/helpers/foundry.mjs tests/e2e/helpers/sweep-rules.mjs tests/e2e/helpers/hub.mjs test/sweep-rules.test.js tests/e2e/global-setup.mjs tests/e2e/37-sessions-in-campaigns.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/34-player-hub.spec.mjs
git commit -m "test(e2e): sessions-in-campaigns spec, fallback-campaign reclaim, spec 02 on a TT- campaign timeline, spec 14 cancel files into New Campaign"
```

---

### Task 8: Realign the specs that create folderless sessions (01, 05, 06, 09, 10, 21)

The filing hook moves every folderless TT- session the suite creates into the fallback campaign and raises its default ownership to OWNER (observer baseline). Specs whose assertions depend on a session's location or default ownership must create their sessions inside a **plain TT- folder** (left alone by the hook); specs whose imports relied on a world timeline target a TT- campaign.

**Files:**
- Modify: `tests/e2e/06-player-collab.spec.mjs:12-23`, `tests/e2e/09-secrets.spec.mjs` (session creates at :25, :73, :338, :405, :460, :537, :724, :785, :866, :1056), `tests/e2e/10-secrets-hub.spec.mjs` (its two session creates), `tests/e2e/21-players-write-sessions.spec.mjs:22-27`, `tests/e2e/01-session.spec.mjs` (API-created sessions; the New Entry dialog test at :98 stays folderless on purpose), `tests/e2e/05-docx-import.spec.mjs` (imports target a TT- campaign).

**Interfaces:**
- Consumes: `createTtPlainFolder`, `createTtCampaign`, `deleteFoldersById`, `cleanupStrandedTestFolders` (Task 7).

- [ ] **Step 1: Pattern for the ownership-sensitive specs (06, 09, 10, 21, 01)**

In each spec: in `test.beforeAll` (or at the top of the single test for 21) create one plain folder as GM:

```js
let plainFolderId;
test.beforeAll(async ({ browser }) => {
  await withGmPage(browser, async (gm) => { plainFolderId = await createTtPlainFolder(gm, `${TT_PREFIX}<spec> Sessions ${RUN}`); });
});
test.afterAll(async ({ browser }) => {
  await withGmPage(browser, async (gm) => { await deleteFoldersById(gm, [plainFolderId]); });
});
```

and pass `folder: plainFolderId` into every `JournalEntry.create` of an entry holding a session page (the ownership they pass stays exactly as it is). Where a spec already has a session-creating helper (06's `createSession` at :12-23; 09's helpers at :25 and :73), add the folder there once. For 21, which has one test and no `beforeAll`, create the folder inside the test before the entry and delete it in the existing `afterEach` (it already deletes TT- journals; add `game.folders.filter((f) => f.name?.startsWith("TT-"))` deletion there).

In `01-session.spec.mjs` apply the folder to the API-created sessions (tests at :132, :210, :240, :275, :352, :450). Leave the New Entry dialog test (:98) as it is: its session is filed into "New Campaign" by design, its assertions are about type and flag, and the global-setup reclaim removes the folder on the next run. Add one assertion to that test: after creation, `expect.poll(() => folderOf(page, id)).not.toBeNull()` and the folder's name is "New Campaign" — the dialog path is one of §1b's "every other creation path".

- [ ] **Step 2: Spec 05 docx import**

Its imports currently run with no campaign chosen and expect timepoints on a timeline tracked through the `timelineJournalIds` ledger. Create a TT- campaign in `beforeAll` (`createTtCampaign`), choose it in the wizard's destination control the way `14-campaigns.spec.mjs` test 5 (:581-640) does, and assert the imported timepoints land on `timelineId` from `createTtCampaign` (replace any `worldTimelineJournalId` / legacy-setting reads). Delete the folder in `afterAll`. Keep the ledger-based `cleanupTimelineJournals` as a safety net.

- [ ] **Step 3: Run each spec live, one at a time, time-boxed (~10 min each)**

```bash
npx playwright test tests/e2e/21-players-write-sessions.spec.mjs --trace off
npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off
npx playwright test tests/e2e/09-secrets.spec.mjs --trace off
npx playwright test tests/e2e/10-secrets-hub.spec.mjs --trace off
npx playwright test tests/e2e/01-session.spec.mjs --trace off
npx playwright test tests/e2e/05-docx-import.spec.mjs --trace off
```

Expected: each spec fully green. Fix only drift caused by the move (a locator that now needs the folder, a changed timeline id); anything else that fails is reported with its attribution, not patched here.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/01-session.spec.mjs tests/e2e/05-docx-import.spec.mjs tests/e2e/06-player-collab.spec.mjs tests/e2e/09-secrets.spec.mjs tests/e2e/10-secrets-hub.spec.mjs tests/e2e/21-players-write-sessions.spec.mjs
git commit -m "test(e2e): session fixtures live in a plain TT- folder (or a TT- campaign) now that loose sessions are filed"
```

---

### Task 9: Player picker rules — pure logic (§2)

**Files:**
- Modify: `scripts/logic/hub-player-view.mjs:8-31` (+ two new functions)
- Modify: `lang/en.json` (`hub.scope` block)
- Test: `test/hub-player-view.test.js`

**Interfaces:**
- Produces: `playerHeaderMode(campaigns, { isGM, emptyTitle })` — non-GM with zero campaigns → `{ mode: "title", title: emptyTitle, campaignId: null }`; `scopeOptionsForUser(...)` — non-GM → visible campaigns only; `playerScopeId(campaigns, remembered): string`; `restrictHits(hits, { scopeId, within, campaignIdOf }): { hits, spillover }`. i18n `MEJCampaignCompanion.hub.scope.none` = "No campaigns yet".

- [ ] **Step 1: Write the failing tests**

In `test/hub-player-view.test.js` change the import line to also pull `playerScopeId, restrictHits`. Replace the two player cases in `describe("scopeOptionsForUser")` and add new describes:

```js
  it("player: exactly their visible campaigns, in order — no All, Unfiled or New Campaign (spec 2026-10-16 §2)", () => {
    const out = scopeOptionsForUser(two, "c2", { isGM: false, hasUnfiled: true, labels });
    expect(out.map((o) => o.value)).toEqual(["c1", "c2"]);
    expect(out.find((o) => o.value === "c2").selected).toBe(true);
  });
  it("player with no campaigns: no options at all", () => {
    expect(scopeOptionsForUser([], "", { isGM: false, hasUnfiled: true, labels })).toEqual([]);
  });
```

In `describe("playerHeaderMode")` replace the "no visible campaign keeps the picker" case with:

```js
  it("non-GM with no visible campaign gets the empty title (spec 2026-10-16 §2)", () => {
    expect(playerHeaderMode([], { isGM: false, emptyTitle: "No campaigns yet" })).toEqual({ mode: "title", title: "No campaigns yet", campaignId: null });
  });
```

Append:

```js
describe("playerScopeId", () => {
  it("keeps the remembered campaign while it is still visible", () => {
    expect(playerScopeId(two, "c2")).toBe("c2");
  });
  it("falls back to the first visible campaign for a stale, empty or unfiled remembered scope", () => {
    expect(playerScopeId(two, "gone")).toBe("c1");
    expect(playerScopeId(two, "")).toBe("c1");
    expect(playerScopeId(two, "unfiled")).toBe("c1");
    expect(playerScopeId(two, null)).toBe("c1");
  });
  it("is empty only when nothing is visible", () => {
    expect(playerScopeId([], "c1")).toBe("");
  });
});

describe("restrictHits", () => {
  const hit = (uuid, cid) => ({ uuid, cid });
  const hits = [hit("a1", "c1"), hit("a2", "c1"), hit("b1", "c2"), hit("x1", "c9"), hit("u1", null)];
  const campaignIdOf = (h) => h.cid;
  it("GM (no universe): the scope filter and spillover count every hit, as before", () => {
    expect(restrictHits(hits, { scopeId: "c1", campaignIdOf })).toEqual({ hits: hits.slice(0, 2), spillover: 3 });
    expect(restrictHits(hits, { scopeId: null, campaignIdOf })).toEqual({ hits, spillover: 0 });
  });
  it("player: spillover counts only hits inside campaigns they can see; unfiled and hidden campaigns never count", () => {
    const within = new Set(["c1", "c2"]);
    expect(restrictHits(hits, { scopeId: "c1", within, campaignIdOf })).toEqual({ hits: hits.slice(0, 2), spillover: 1 });
  });
  it("player search-all (scopeId null) widens to every visible campaign and nothing else", () => {
    const within = new Set(["c1", "c2"]);
    expect(restrictHits(hits, { scopeId: null, within, campaignIdOf })).toEqual({ hits: hits.slice(0, 3), spillover: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/hub-player-view.test.js`
Expected: FAIL (imports missing; player options still start with "").

- [ ] **Step 3: Implement**

Replace lines 8-31 of `scripts/logic/hub-player-view.mjs` with:

```js
/**
 * A non-GM who can see exactly one campaign gets that campaign's name as a
 * static title and no picker; one who can see none gets `emptyTitle` as the
 * title (spec 2026-10-16 §2); everyone else gets the picker.
 * @param {{id:string,name:string}[]} campaigns  campaigns visible to this user
 */
export function playerHeaderMode(campaigns, { isGM, emptyTitle = null }) {
  const list = campaigns ?? [];
  if (!isGM && list.length === 0) return { mode: "title", title: emptyTitle, campaignId: null };
  if (!isGM && list.length === 1) return { mode: "title", title: list[0].name, campaignId: list[0].id };
  return { mode: "picker", title: null, campaignId: null };
}

/**
 * Picker options per seat. A player sees exactly the campaigns visible to
 * them, in the Hub's order - no All, no Unfiled, no New Campaign (spec
 * 2026-10-16 §2). GM options are unchanged.
 */
export function scopeOptionsForUser(campaigns, current, { isGM, hasUnfiled, labels }) {
  const cur = current ?? "";
  const campaignOptions = (campaigns ?? []).map((c) => ({ value: c.id, label: c.name, selected: cur === c.id }));
  if (!isGM) return campaignOptions;
  const options = [{ value: "", label: labels.all, selected: cur === "" }, ...campaignOptions];
  if (hasUnfiled) options.push({ value: "unfiled", label: labels.unfiled, selected: cur === "unfiled" });
  options.push({ value: "__new", label: labels.newCampaign, selected: false });
  return options;
}

/**
 * A player's effective scope: the remembered campaign while it is still
 * visible to them, else the first visible one, else "" (nothing to show).
 * Never All, never Unfiled (spec 2026-10-16 §2).
 */
export function playerScopeId(campaigns, remembered) {
  const list = campaigns ?? [];
  if (remembered && list.some((c) => c.id === remembered)) return remembered;
  return list[0]?.id ?? "";
}

/**
 * Scope search hits for a seat. `within` (a Set of campaign ids; players
 * only) bounds the universe to campaigns the seat can see, so spillover
 * counts only hits the seat could actually reach; `scopeId` null means
 * "every campaign in the universe" (a player's search-all). With no
 * `within` this is the GM rule searchScoped always applied.
 */
export function restrictHits(hits, { scopeId, within = null, campaignIdOf }) {
  const universe = within ? hits.filter((h) => within.has(campaignIdOf(h))) : hits;
  if (!scopeId) return { hits: universe, spillover: 0 };
  const inScope = universe.filter((h) => campaignIdOf(h) === scopeId);
  return { hits: inScope, spillover: universe.length - inScope.length };
}
```

In `lang/en.json` `hub.scope` block add `"none": "No campaigns yet"` after `"newCampaign"`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/hub-player-view.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-player-view.mjs test/hub-player-view.test.js lang/en.json
git commit -m "feat(hub): player picker rules — visible campaigns only, remembered-or-first scope, search within visible campaigns"
```

---

### Task 10: Hub wiring for players; spec 38; spec 16 player tests (§2)

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (imports; `HUB_STATE`; `#headerMode` :536-538; `#effectiveScopeId` :541-546; `#scopedEntries` :690-696; timeline else-branch :432-471; `#searchContext` :794-796; `#scopeFilterRows` :898-900; `onSearchAllCampaigns` :1644-1648; scope `change` handler :2087; search input handler :2175)
- Create: `tests/e2e/38-player-campaign-picker.spec.mjs`
- Modify: `tests/e2e/16-multi-timeline.spec.mjs` tests 7 (:584) and 8 (:649)

**Interfaces:**
- Consumes: Task 9's functions; `searchAll` (`scripts/search/live-index.mjs:182`, already exported); `campaignIdOf` (already imported in the Hub).

- [ ] **Step 1: Hub changes**

Imports: extend the `hub-player-view.mjs` import (:33) with `playerScopeId, restrictHits`; add `searchAll` to the `live-index.mjs` import that already brings `searchScoped`.

`HUB_STATE` (:83-110): add `searchAllVisible: false,` after `searchQuery: "",` with the comment `// Player-only: this search widened to every visible campaign (spec 2026-10-16 §2); reset on scope or query change.`

`#headerMode`:

```js
  #headerMode() {
    return playerHeaderMode(this.#visibleCampaigns().map((c) => ({ id: c.id, name: c.name })), {
      isGM: game.user.isGM, emptyTitle: game.i18n.localize(`${I18N}.hub.scope.none`)
    });
  }
```

`#effectiveScopeId`:

```js
  /** The effective scope id. GM: the picker's choice (All/Unfiled/campaign). Player: the remembered campaign while visible, else the first visible, else "" — never All or Unfiled (spec 2026-10-16 §2). */
  #effectiveScopeId() {
    if (game.user.isGM) return lockedScopeId(this.#headerMode(), this.state.campaignId ?? "");
    return playerScopeId(this.#visibleCampaigns(), this.state.campaignId ?? "");
  }
```

`#scopedEntries` (:690-696): after `if (campaign) return campaignEntries(campaign, { user: game.user });` insert:

```js
    // A player with no visible campaign sees nothing; unfiled content is
    // never shown to players (spec 2026-10-16 §2).
    if (!game.user.isGM) return [];
```

Timeline stacks (:432): change the final `} else {` of the `stacks` chain into `} else if (!isGM) { stacks = []; } else {` with the comment `// Players never hold All scope (spec 2026-10-16 §2): nothing to stack.` — the GM branch body stays untouched.

`#scopeFilterRows` (:899-900):

```js
    const id = this.#effectiveScopeId();
    if (!id) return game.user.isGM ? rows : [];
```

`#searchContext` (:795-796):

```js
    const scopeId = this.#effectiveScopeId() || null;
    const { hits, spillover } = game.user.isGM
      ? searchScoped(this.state.searchQuery, scopeId)
      : restrictHits(searchAll(this.state.searchQuery), {
        scopeId: this.state.searchAllVisible ? null : scopeId,
        within: new Set(this.#visibleCampaigns().map((c) => c.id)),
        campaignIdOf: (hit) => campaignIdOf(fromUuidSync(hit.uuid))
      });
```

`onSearchAllCampaigns`:

```js
  static async onSearchAllCampaigns() {
    if (!game.user.isGM) {
      // Players never leave their campaign scope (spec 2026-10-16 §2): widen
      // only this search across the campaigns they can see.
      this.state.searchAllVisible = true;
      this.render({ parts: ["main"] });
      return;
    }
    this.state.campaignId = "";
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, "");
    this.render({ parts: ["main"] });
  }
```

Reset the flag: in the scope `change` handler (:2087, before `this.state.campaignId = event.target.value;`) and in the search input handler (:2175, next to `HUB_STATE.searchQuery = event.target.value;`) add `this.state.searchAllVisible = false;` / `HUB_STATE.searchAllVisible = false;` respectively (match whichever object each handler already writes to).

Run: `npx vitest run` — expected PASS (the Hub is not unit-loaded; this guards the shared logic modules).

- [ ] **Step 2: Spec 38**

Create `tests/e2e/38-player-campaign-picker.spec.mjs`:

```js
// A player's Hub shows exactly their campaigns (spec 2026-10-16 §2). GM seeds
// two TT- campaigns User 1 can see and hides every other campaign from them
// for the duration (restored in afterAll), like 34-player-hub does.
import { test, expect } from "@playwright/test";
import {
  login, settle, TT_PREFIX, withGmPage, deleteJournalsByPrefix, deleteFoldersById,
  createTtCampaign, hideOtherCampaignsFrom, restoreHidden,
  trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";
import { openHubViaToolbar } from "./helpers/hub.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const A = `${TT_PREFIX}PP Alpha ${RUN}`;
const B = `${TT_PREFIX}PP Beta ${RUN}`;
const TOKEN = `lanternfall${RUN}`;

async function seedPerson(gm, name, folderId) {
  return gm.evaluate(async ({ n, f, token }) => (await JournalEntry.create({
    name: n, folder: f, ownership: { default: 2 },
    pages: [{ name: n, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: `<p>${token}</p>` } }]
  })).id, { n: name, f: folderId, token: TOKEN });
}

test.describe("38 player campaign picker", () => {
  const ids = {};

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      ids.a = await createTtCampaign(gm, A);
      ids.b = await createTtCampaign(gm, B);
      ids.personA = await seedPerson(gm, `${TT_PREFIX}PP Person A ${RUN}`, ids.a.folderId);
      ids.personB = await seedPerson(gm, `${TT_PREFIX}PP Person B ${RUN}`, ids.b.folderId);
      ids.hidden = await hideOtherCampaignsFrom(gm, [ids.a.folderId, ids.b.folderId]);
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      await restoreHidden(gm, ids.hidden);
      await deleteJournalsByPrefix(gm);
      await deleteFoldersById(gm, [ids.a?.folderId, ids.b?.folderId]);
    });
  });

  async function openAsPlayer(page, remembered) {
    await login(page, "User 1");
    await page.evaluate((v) => game.settings.set("mej-campaign-companion", "hubCampaignScope", v), remembered);
    return openHubViaToolbar(page);
  }
  const optionValues = (shell) => shell.locator('select[name="campaign-scope"] option').evaluateAll((os) => os.map((o) => o.value));
  const selected = (shell) => shell.locator('select[name="campaign-scope"]').inputValue();

  test("1. the picker lists exactly the two visible campaigns, in Hub order, and opens on the first", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const shell = await openAsPlayer(page, "");
    expect(await optionValues(shell)).toEqual([ids.a.folderId, ids.b.folderId]);
    expect(await selected(shell)).toBe(ids.a.folderId);
    await expect(shell.locator("button.mej-cc-new-session")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("2. a remembered campaign is used while visible; a stale one falls back to the first", async ({ page }) => {
    const shell = await openAsPlayer(page, ids.b.folderId);
    expect(await selected(shell)).toBe(ids.b.folderId);
    const again = await openAsPlayer(page, "no-such-folder");
    expect(await selected(again)).toBe(ids.a.folderId);
  });

  test("3. Search all widens only the search: the scope stays, the other campaign's hit appears", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const shell = await openAsPlayer(page, ids.a.folderId);
    await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
    await settle(page, 200);
    await shell.locator("input.mej-cc-search-input").fill(TOKEN);
    await settle(page, 600);
    const rows = shell.locator(".mej-cc-search-result");  // the hit rows 14-campaigns test 3 counts; confirm the class against hub.hbs
    await expect(rows).toHaveCount(1);
    const spill = shell.locator("button.mej-cc-search-spillover");
    await expect(spill).toBeVisible();
    await spill.click();
    await settle(page, 600);
    await expect(rows).toHaveCount(2);
    expect(await selected(shell)).toBe(ids.a.folderId);
    assertNoConsoleErrors(errors);
  });

  test("4. zero visible campaigns: the header reads \"No campaigns yet\", no picker, no entry rows", async ({ page, browser }) => {
    let hiddenToo;
    await withGmPage(browser, async (gm) => { hiddenToo = await hideOtherCampaignsFrom(gm, []); });
    try {
      const shell = await openAsPlayer(page, "");
      await expect(shell.locator("h2.mej-cc-campaign-title")).toHaveText("No campaigns yet");
      await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(0);
      await expect(shell.locator('section.tab[data-tab="index"] [data-uuid]')).toHaveCount(0);
    } finally {
      await withGmPage(browser, async (gm) => { await restoreHidden(gm, hiddenToo); });
    }
  });
});
```

Before relying on `.mej-cc-search-result` and `section.tab[data-tab="index"] [data-uuid]`, confirm both against `templates/hub.hbs` (the search rows are what `14-campaigns.spec.mjs` test 3 at :479-524 counts; use its exact locator).

- [ ] **Step 3: Spec 16 tests 7 and 8**

Players no longer have an All scope, so both tests now run in campaign scope. In test 7 (:584) and test 8 (:649), after the player's Hub opens, add `await scopeHubToCampaign(playerPage, playerCampaignId)` (the helper is a no-op when the player is locked to one campaign) and keep the assertions: test 7 — only the observable timeline is offered and no management controls render; test 8 — the hidden default renders the empty stack, never its timepoint labels. Rename test 8's title to drop "in All scope". Import `scopeHubToCampaign` from the helpers.

- [ ] **Step 4: Run live, one at a time**

```bash
npx playwright test tests/e2e/38-player-campaign-picker.spec.mjs --trace off
npx playwright test tests/e2e/16-multi-timeline.spec.mjs --trace off
npx playwright test tests/e2e/34-player-hub.spec.mjs --trace off
npx playwright test tests/e2e/27-hub-ux.spec.mjs --trace off
```

Expected: all green. (34 and 27 are the GM/player header specs most likely to notice the header change.)

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs tests/e2e/38-player-campaign-picker.spec.mjs tests/e2e/16-multi-timeline.spec.mjs
git commit -m "feat(hub): players see only their campaigns — no All scope, remembered-or-first default, search-all within visible campaigns"
```

---

### Task 11: Knowledge side rail (§3)

**Files:**
- Modify: `templates/knowledge-panel.hbs`
- Modify: `styles/campaign-companion.css:675-750, 1295-1300, 1485`
- Modify: `scripts/hooks/knowledge-ui.mjs:202-211, 350-372`
- Modify: `tests/e2e/07-knowledge.spec.mjs:456, 468`
- Create: `tests/e2e/39-knowledge-rail.spec.mjs`

**Interfaces:**
- Produces: panel root `aside.mej-cc-knowledge[.collapsed]` → children `.mej-cc-knowledge-body` (the `<details>` sections) and `button.mej-cc-knowledge-tab[aria-expanded]` (holds `.mej-cc-knowledge-chevron`, `.mej-cc-knowledge-title`, `.mej-cc-knowledge-summary`). Wrapper `div.mej-cc-rail-row` around MEJ's `.sheet-container` (or the companion's `.mej-cc-media-page`) and the panel. Setting `knowledgePanelCollapsed` unchanged (true = rail closed). Selectors `.mej-cc-knowledge`, `.collapsed`, `.mej-cc-knowledge-title`, `.mej-cc-knowledge-summary`, `details` keep their meaning for specs 07/09/13/15/17/29.

Layout rule (builder's call made here): the open rail is `flex: 0 0 min(300px, 40%)` of the row, so it is 300 px on any sheet at least 750 px wide, never more than 40% on a narrower one, and the text column keeps at least 320 px on every sheet 534 px or wider. The DOM wrap is inserted only when a panel mounts; MEJ re-renders replace the subsheet body wholesale, which discards the wrap, so every render starts from MEJ's own DOM.

- [ ] **Step 1: Template**

Replace `templates/knowledge-panel.hbs` lines 1-6 (the `<section>` open tag and the `<header>` bar) with:

```hbs
<aside class="mej-cc-knowledge{{#if collapsed}} collapsed{{/if}}" data-page-uuid="{{pageUuid}}" aria-label="{{localize "MEJCampaignCompanion.knowledge.title"}}">
    <div class="mej-cc-knowledge-body">
```

Keep every `<details>` block exactly as it is, and replace the closing `</section>` (line 71) with:

```hbs
    </div>
    <button type="button" class="mej-cc-knowledge-tab" aria-expanded="{{#if collapsed}}false{{else}}true{{/if}}" title="{{localize "MEJCampaignCompanion.knowledge.title"}}">
        <i class="fa-solid fa-chevron-right mej-cc-knowledge-chevron"></i>
        <span class="mej-cc-knowledge-title">{{localize "MEJCampaignCompanion.knowledge.title"}}</span>
        <span class="mej-cc-knowledge-summary">{{#if summary}}{{summary}}{{else}}{{localize "MEJCampaignCompanion.knowledge.summary.empty"}}{{/if}}</span>
    </button>
</aside>
```

- [ ] **Step 2: CSS**

In `styles/campaign-companion.css` replace the block from the comment `/* Knowledge panel: tags/attributes/Mentioned-in, appended to the bottom of` (:675) through the `.mej-cc-knowledge.collapsed .mej-cc-knowledge-chevron { … }` rule (:748) with:

```css
/* Knowledge rail (spec 2026-10-16 §3). The panel sits in a right-hand rail
   beside the sheet body, inside a flex row the companion inserts only when a
   panel mounts (knowledge-ui.mjs wraps MEJ's .sheet-container - or the
   companion's .mej-cc-media-page - in .mej-cc-rail-row). Pages without a
   panel keep MEJ's DOM and layout untouched. Push, not overlay: the text
   column re-flows narrower while the rail is open. */
.monks-enhanced-journal .mej-cc-rail-row {
  display: flex;
  flex-direction: row;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  width: 100%;
}

.monks-enhanced-journal .mej-cc-rail-row > .sheet-container,
.monks-enhanced-journal .mej-cc-rail-row > .mej-cc-media-page {
  flex: 1 1 0;
  min-width: 0;
}

/* Open: 300px, or 40% of the row on a sheet narrower than 750px, so the text
   column keeps at least 320px on any sheet 534px or wider. */
.monks-enhanced-journal .mej-cc-knowledge {
  display: flex;
  flex-direction: row;
  flex: 0 0 min(300px, 40%);
  min-width: 0;
  height: 100%;
  border-left: 1px solid var(--color-border-light-tertiary, rgba(0, 0, 0, 0.1));
}

/* Closed: only the tab remains. */
.monks-enhanced-journal .mej-cc-knowledge.collapsed {
  flex: 0 0 auto;
}

.monks-enhanced-journal .mej-cc-knowledge-body {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  padding: 0.5em 0.6em;
}

.monks-enhanced-journal .mej-cc-knowledge.collapsed > .mej-cc-knowledge-body {
  display: none;
}

/* The tab: a real button on the sheet's right edge, vertical text, keyboard
   focusable (Enter/Space toggle natively). Three classes deep so it beats
   MEJ's `.sheet.standard-form button:not(.reveal)` styling. */
.monks-enhanced-journal .mej-cc-knowledge .mej-cc-knowledge-tab {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5em;
  width: auto;
  height: 100%;
  margin: 0;
  padding: 0.6em 0.2em;
  writing-mode: vertical-rl;
  line-height: 1;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
  background: var(--mej-cc-chip-bg);
  color: var(--mej-cc-ink);
  border: 0;
  border-left: 1px solid var(--color-border-light-tertiary, rgba(0, 0, 0, 0.1));
  border-radius: 0;
}

.monks-enhanced-journal .mej-cc-knowledge .mej-cc-knowledge-tab:focus-visible {
  outline: 2px solid var(--color-shadow-primary, #ff6400);
  outline-offset: -2px;
}

.monks-enhanced-journal .mej-cc-knowledge-summary {
  font-weight: normal;
  font-size: 0.9em;
  opacity: 0.75;
}

.monks-enhanced-journal .mej-cc-knowledge-chevron {
  transition: transform 120ms ease;
}

/* Open: the chevron points at the rail (right); closed: it points back into the sheet. */
.monks-enhanced-journal .mej-cc-knowledge.collapsed .mej-cc-knowledge-chevron {
  transform: rotate(180deg);
}

.mej-cc-knowledge summary {
  cursor: pointer;
  font-weight: bold;
}

.mej-cc-knowledge-empty {
  opacity: 0.7;
  font-style: italic;
}
```

This removes, by replacement: the bottom-strip border/margin, the 50%-height cap (`.mej-cc-knowledge:not(.collapsed)`), the PR #60 `:has(.editor-parent.editing) .mej-cc-knowledge { display:none }` rule, the `.mej-cc-knowledge-bar` rules and `.mej-cc-knowledge.collapsed > details`. The `.session-details` scroll rules at the top of the file stay.

At `:1295` (`.theme-dark .mej-cc-knowledge`) change `border-top-color` to `border-left-color` and remove the `border-radius` and `padding` lines (the body carries the padding now). At `:1485` replace `.mej-cc-knowledge-bar` with `.mej-cc-knowledge-tab` in the `:is(…)` list. Check `git grep -n "mej-cc-knowledge-bar"` returns nothing in `styles/`, `templates/`, `scripts/`.

- [ ] **Step 3: Mount as a rail and bind the tab**

In `scripts/hooks/knowledge-ui.mjs` replace line 204 `bindCollapseBar(panel);` with `bindRailTab(panel);` and lines 209-210 with:

```js
  element.querySelectorAll(":scope .mej-cc-knowledge").forEach((stale) => stale.remove());
  mountRail(element, panel);
```

Add after `injectPanel`:

```js
/**
 * Mount the panel as a right-hand rail (spec 2026-10-16 §3). The sheet body -
 * MEJ's .sheet-container, or the companion's own .mej-cc-media-page - is
 * wrapped in a flex row the companion owns, created on the first mount and
 * reused by later ones; MEJ re-renders replace the body wholesale, which
 * drops the row with it, so every render starts from MEJ's own DOM and a
 * page with no panel is never touched. A sheet with neither body (an
 * unexpected template) gets the panel appended as before.
 */
function mountRail(element, panel) {
  let row = element.querySelector(".mej-cc-rail-row");
  if (!row) {
    const body = element.querySelector(".sheet-container, .mej-cc-media-page");
    if (!body) {
      element.appendChild(panel);
      return;
    }
    row = document.createElement("div");
    row.className = "mej-cc-rail-row";
    body.replaceWith(row);
    row.appendChild(body);
  }
  row.appendChild(panel);
}
```

Replace `bindCollapseBar` (:350-372) with:

```js
// Whole-rail open/closed (spec 2026-09-04 §D, rail form 2026-10-16 §3): one
// client setting, read on every injection, so the state follows the user
// across sheets, re-renders and reloads. The inner <details> keep their own
// open/closed state. A real <button> toggles on Enter/Space natively.
function bindRailTab(panel) {
  const tab = panel.querySelector(".mej-cc-knowledge-tab");
  if (!tab) return;
  tab.addEventListener("click", async (event) => {
    event.preventDefault();
    const collapsed = !panel.classList.contains("collapsed");
    panel.classList.toggle("collapsed", collapsed);
    tab.setAttribute("aria-expanded", String(!collapsed));
    try {
      await game.settings.set(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING, collapsed);
    } catch (err) {
      console.error(`${MODULE_ID} | saving the knowledge rail state failed`, err);
    }
  });
}
```

Update the file's header comment ("appended to the bottom" → "mounted as a right-hand rail beside the sheet body").

- [ ] **Step 4: Spec 07 selectors and spec 39**

In `tests/e2e/07-knowledge.spec.mjs` replace `.mej-cc-knowledge-bar` with `.mej-cc-knowledge-tab` at :456 and :468 (the `details` hidden/visible assertions still hold: the body is `display:none` when collapsed).

Create `tests/e2e/39-knowledge-rail.spec.mjs`:

```js
// Knowledge side rail (spec 2026-10-16 §3): collapsible, push (never overlay),
// state in the knowledgePanelCollapsed client setting, present on the
// popped-out sheet and while editing. GM seat, World A; TT- fixtures.
import { test, expect } from "@playwright/test";
import { login, settle, reloadGame, TT_PREFIX, deleteJournalsByPrefix, trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404 } from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const LONG = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i + 1}: Elara runs the locksmith stall by the east gate and trades in rare keys.</p>`).join("");

async function createPerson(page, name) {
  return page.evaluate(async ({ n, t }) => (await JournalEntry.create({
    name: n,
    pages: [{ name: n, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" }, "mej-campaign-companion": { tags: ["alpha"] } }, text: { content: t } }]
  })).id, { n: name, t: LONG });
}

async function openEntry(page, id) {
  await page.evaluate(async (i) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(i)); }, id);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  const panel = shell.locator(".mej-cc-knowledge");
  await expect(panel).toHaveCount(1);
  return { shell, panel, row: shell.locator(".mej-cc-rail-row"), body: shell.locator(".mej-cc-rail-row > .sheet-container") };
}

test.describe("39 knowledge rail", () => {
  let personId;
  test.beforeEach(async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    personId = await createPerson(page, `${TT_PREFIX}Rail Person ${RUN}`);
  });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false)).catch(() => {});
    await deleteJournalsByPrefix(page);
  });

  test("1. the tab opens and closes the rail; the text column is wider while closed; the state persists across reopen and reload", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const { panel, body } = await openEntry(page, personId);
    await expect(panel).not.toHaveClass(/collapsed/);
    const tab = panel.locator("button.mej-cc-knowledge-tab");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator(".mej-cc-knowledge-summary")).toHaveText("1 tag");
    const openWidth = (await body.boundingBox()).width;

    await tab.click();
    await expect(panel).toHaveClass(/collapsed/);
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect(panel.locator("details").first()).toBeHidden();
    const closedWidth = (await body.boundingBox()).width;
    expect(closedWidth).toBeGreaterThan(openWidth + 100);
    expect(await page.evaluate(() => game.settings.get("mej-campaign-companion", "knowledgePanelCollapsed"))).toBe(true);

    const second = await createPerson(page, `${TT_PREFIX}Rail Second ${RUN}`);
    const { panel: p2 } = await openEntry(page, second);
    await expect(p2).toHaveClass(/collapsed/);

    await reloadGame(page);
    const { panel: p3 } = await openEntry(page, second);
    await expect(p3).toHaveClass(/collapsed/);
    await p3.locator("button.mej-cc-knowledge-tab").click();
    await expect(p3).not.toHaveClass(/collapsed/);
    await expect(p3.locator("details").first()).toBeVisible();
    assertNoConsoleErrors(errors);
  });

  test("2. push, not overlay: the rail never covers the text column and takes at most 40% of the row (300px cap)", async ({ page }) => {
    const { panel, row, body } = await openEntry(page, personId);
    const [r, b, p] = await Promise.all([row.boundingBox(), body.boundingBox(), panel.boundingBox()]);
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + 1);
    expect(p.width).toBeLessThanOrEqual(Math.min(301, r.width * 0.4 + 1));
    expect(b.width).toBeGreaterThanOrEqual(320);
    // The rail scrolls internally: its body never pushes the sheet taller.
    expect(p.height).toBeLessThanOrEqual(r.height + 1);
  });

  test("3. the rail renders on the popped-out sheet", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await page.evaluate(async (i) => { await game.journal.get(i).pages.contents[0].sheet.render(true); }, personId);
    const popped = page.locator(".application.monks-enhanced-journal").last();
    await expect(popped.locator(".mej-cc-knowledge")).toHaveCount(1, { timeout: 15_000 });
    await expect(popped.locator(".window-content .mej-cc-rail-row > .sheet-container")).toHaveCount(1);
    const [b, p] = await Promise.all([popped.locator(".mej-cc-rail-row > .sheet-container").boundingBox(), popped.locator(".mej-cc-knowledge").boundingBox()]);
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + 1);
    await page.evaluate(async (i) => { await game.journal.get(i).pages.contents[0].sheet.close(); }, personId);
    assertNoConsoleErrors(errors);
  });

  test("4. edit mode leaves the rail in place", async ({ page }) => {
    const { shell, panel } = await openEntry(page, personId);
    // Enter edit mode the way 24-entity-from-selection.spec.mjs does for its edit-mode case (its editor-open step); the toolbar must appear.
    await shell.locator(".editor-parent .editor-edit, .editor-parent button.toggle").first().click();
    await expect(shell.locator(".editor-parent.editing, .editor-container .ProseMirror")).toHaveCount(1, { timeout: 10_000 });
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeVisible();
  });
});
```

If `page.sheet.render(true)` in test 3 does not produce an MEJ `EnhancedJournalSheet` window (the registered sheet for the page type decides), open it with `new (CONFIG.JournalEntryPage.sheetClasses["monks-enhanced-journal.person"][…].cls)(…)` as `12-native-mode.spec.mjs` or `17-media-routing.spec.mjs` does for a standalone sheet, and record the method in the spec header. For test 4 use the exact editor-open step 24 uses.

- [ ] **Step 5: Run live, one at a time**

```bash
npx playwright test tests/e2e/39-knowledge-rail.spec.mjs --trace off
npx playwright test tests/e2e/07-knowledge.spec.mjs --trace off
npx playwright test tests/e2e/29-readability.spec.mjs --trace off
npx playwright test tests/e2e/09-secrets.spec.mjs --trace off
npx playwright test tests/e2e/24-entity-from-selection.spec.mjs --trace off
```

Expected: all green. Spec 29's knowledge-panel checks (:363-369, :504-510, :552-558) keep their thresholds; if the vertical tab's text fails a contrast check, adjust the tab's `background`/`color` tokens, never the threshold. Spec 24's edit-mode test (the reason PR #60 hid the panel) must pass with the rail present — the rail no longer takes height from the body.

Then v13 (World B, port 30013, stock MEJ 13.06), time-boxed:

```bash
npm run e2e:stock:v13
FOUNDRY_TARGET=v13 npx playwright test tests/e2e/39-knowledge-rail.spec.mjs --trace off
```

Expected: stock gate green (it waits for `.mej-cc-knowledge` and measures `.mej-cc-knowledge-title`); spec 39 tests 1-2 green on v13 (tests 3-4 may be v14-only; if they fail on v13 for a reason unrelated to the rail, mark them `test.skip` under `FOUNDRY_TARGET === "v13"` with the reason in a comment).

- [ ] **Step 6: Commit**

```bash
git add templates/knowledge-panel.hbs styles/campaign-companion.css scripts/hooks/knowledge-ui.mjs tests/e2e/07-knowledge.spec.mjs tests/e2e/39-knowledge-rail.spec.mjs
git commit -m "feat(knowledge): collapsible right-hand rail that pushes the text column; tab button with aria-expanded; rail stays while editing"
```

---

### Task 12: Docs, changelog, version, PR (§6)

**Files:**
- Modify: `README.md:36, 47-48, 66, 241-242` (+ a Sessions note), `CHANGELOG.md:1-20`, `module.json:5`, `tests/e2e/README.md`

- [ ] **Step 1: README**

- Line 36: after "The Hub's campaign picker (All campaigns / Unfiled / each campaign) scopes…" add: "GMs get that picker; a player's picker lists only the campaigns they can see (one campaign shows as a title, none shows "No campaigns yet"), and their Search tab's *Search all* widens only the search across those campaigns."
- Add to the Sessions/Campaigns section: "Sessions always live in a campaign. A session created with no campaign chosen — from the Hub, the sidebar's New Entry, the API or an import — is filed by the GM's client into a campaign named **New Campaign** (created once, reused while a root campaign of that name exists; rename it like any folder). Sessions you placed in your own plain folders are left alone. Unfiled sessions that already exist are moved the first time a GM loads the world. The companion no longer creates a world-level timeline."
- Line 66: "edited in a knowledge panel at the foot of each sheet" → "edited in the knowledge rail on the right of each sheet (click the vertical **Knowledge** tab to open or close it; the text column re-flows while it is open)".
- Settings table: `hubCampaignScope` → "`""` (All campaigns, GM only), `unfiled` (GM only), or a campaign folder id; players always resolve to one of their campaigns."; `knowledgePanelCollapsed` → "Client-scoped. The knowledge rail is closed to its tab on every sheet."

- [ ] **Step 2: CHANGELOG**

Replace `## Unreleased` with `## 0.28.0 (<today's date, YYYY-MM-DD>)` and add above the existing `### Fixed` list:

```markdown
### Added
- Sessions always live in a campaign. A session created with no campaign chosen — Hub New Session with the prompt dismissed, the sidebar's New Entry, the API, an import — is filed into a campaign named "New Campaign" (created once, reused while a root campaign of that exact name exists). Unfiled sessions are moved into a "New Campaign" campaign the first time a GM loads the world. Sessions in your own plain folders are never moved.
- Knowledge rail: the knowledge panel is now a collapsible right-hand rail (vertical "Knowledge" tab, keyboard-focusable) that pushes the page text narrower while open; it stays available while editing. Open/closed is remembered per client as before.
- Player Hub: the campaign picker lists only the campaigns a player can see (no All / Unfiled / New Campaign); it opens on the remembered campaign or the first one, and "No campaigns yet" when none is visible. Search all widens only the search across those campaigns.

### Changed
- The companion never creates a world-level "Campaign Timeline" any more; a world that already has one keeps showing it. Add Timepoint, auto-capture and imports with no campaign use the "New Campaign" campaign's timeline.
- Session tab: the "Drag an Actor here" hint shows to anyone who can edit the session — GM or owning player — so players who manage attendees are told how. View-only players see "No attendees recorded yet."
- Start Session: dismissing its campaign prompt still starts nothing (unchanged); only New Session falls back to a created campaign.
```

Add to `### Fixed`: "`/note` on Foundry 13 keeps literal tag-like text (`/note the <div> tag`): a message is treated as HTML only when it starts with a block wrapper, which is what Foundry 14's chat box sends." Replace the PR #60 line about the panel hiding while editing with: "Knowledge panel no longer competes with page text for height (it is a side rail now); the 0.27.0 edit-mode squeeze is gone." Under `### Tests` add: "New specs 37 (sessions in campaigns), 38 (player campaign picker), 39 (knowledge rail); spec 02 runs on a TT- campaign timeline; specs 01/05/06/09/10/21 keep their sessions in a TT- folder; global setup reclaims a 'New Campaign' that holds only the suite's leftovers."

- [ ] **Step 3: module.json and e2e README**

`module.json:5` → `"version": "0.28.0"` (the 0.27.0 release commit c706509 changed only this line and the changelog; `manifest`/`download` point at `releases/latest` and stay).

`tests/e2e/README.md`: add a short section "Fallback campaign" — specs that create folderless sessions cause the GM client to create "New Campaign"; `cleanupFallbackCampaign` (global setup) deletes it only when it holds nothing but TT- leftovers; specs that need a session's own ownership or location use `createTtPlainFolder` / `createTtCampaign`.

- [ ] **Step 4: Full unit suite and a final live sanity pass**

Run: `npx vitest run` — expected all green (1514 + the new tests).
Run, one at a time: `npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off` is v13-only (done in Task 11); on v14 run `npx playwright test tests/e2e/36-scoping-gm-consolidation.spec.mjs --trace off` and `npx playwright test tests/e2e/03-search.spec.mjs --trace off` as the two GM/player scoping specs not yet exercised. Expected green.

- [ ] **Step 5: Commit, then finish the branch**

```bash
git add README.md CHANGELOG.md module.json tests/e2e/README.md
git commit -m "chore: release 0.28.0 — changelog, version, docs for sessions-in-campaigns, player picker, knowledge rail"
```

Then use superpowers:finishing-a-development-branch: push `feat/sessions-in-campaigns-rail`, open the PR against `main` with a body summarising the four product changes, the test changes and the live-run evidence (no Claude attribution). The owner merges. After the merge: `git tag -a 0.28.0 -m "0.28.0" <merge commit>` and `git push origin 0.28.0` to trigger `release.yml` — this last step runs only once the owner has merged.

---

## Self-review notes

- Spec coverage: §1a Task 6; §1b/§1c Tasks 3, 5, 7; §1d Task 5; §1e Tasks 4, 6; §1f Task 5 + spec 37 test 5; §1g no change (campaign-guard untouched); §1h Task 6 (source test + spec 37 test 6); §1i Task 6 (`silent`); §2 Tasks 9, 10; §3 Task 11; §4 Task 2; §5 Task 1; §6 Task 12; Testing section — units in Tasks 1, 3, 4, 6, 7, 9; e2e new specs 37/38/39; updated 02, 14, 34, 07, 29 (run only), 16 (Task 10), global-setup (Task 7); v13 gate in Task 11.
- Names used across tasks: `ensureFallbackCampaign`, `ensureSessionFiled`, `sweepUnfiledSessions` (Task 5 → 6, 7); `sessionTargetLevel` (Task 5 only); `playerScopeId`, `restrictHits`, `playerHeaderMode(…, { emptyTitle })` (Task 9 → 10); `createTtCampaign`, `createTtPlainFolder`, `fallbackCampaignId`, `cleanupFallbackCampaign`, `hideOtherCampaignsFrom`, `restoreHidden`, `fallbackCampaignReclaimable` (Task 7 → 8, 10); `.mej-cc-knowledge-tab`, `.mej-cc-knowledge-body`, `.mej-cc-rail-row` (Task 11 template, CSS, JS, specs 07/39).
- Known judgment points left to the executor, each with its rule stated: spec 37 test 6's Start button scope; spec 38's search-row and index-row locators (confirm against hub.hbs); spec 39 test 3's standalone-sheet open and test 4's editor-open step (reuse 12/17 and 24's exact steps).
