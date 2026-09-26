# Hub UX Fixes and 0.22.1 Deferred Minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub menus dismiss on outside click / Escape, the Timeline tab scrolls, the Graph pans, and the three 0.22.1 deferred minors are closed.

**Architecture:** Two new pure helpers (`logic/menu-dismiss.mjs`, `logic/graph-pan.mjs`) carry the decisions and are unit-tested; thin DOM wiring lives in `apps/CampaignHubPage.mjs` and `apps/hub-graph-pane.mjs`. Timeline scrolling is CSS only. The session stamp gains a `preCreateJournalEntry` path sharing `sessionFlagPatch`.

**Tech Stack:** Foundry VTT 13/14 module (ES modules, Handlebars, ApplicationV2 subsheet hosted in MEJ's shell), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-hub-ux-fixes-design.md`

Repo/worktree: `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/session-type-label`, branch `fix/session-type-label`. All paths below are relative to it.

## Global Constraints

- World A (port 30000, Foundry 14, default target) is the user's real campaign: create only `TT-`-prefixed documents, delete only what the test created, never touch "Radiant Citadel".
- World B: `FOUNDRY_TARGET=v13` (port 30013). Every new e2e test runs on both.
- Never patch MEJ; companion-side code only.
- Version stays `0.22.1`; no new version bump.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Unit: `npm test` (currently 1025 passing). E2E: `npx playwright test <file>` (World A) and `FOUNDRY_TARGET=v13 npx playwright test <file>` (World B).
- Menu keys and state flags, exact: `tools`↔`toolsMenuOpen`, `type`↔`typeMenuOpen`, `sort`↔`sortMenuOpen`.

## Review Focus

1. Outside click that lands on another Hub control (a tab, New Session) — the menu must close AND that control's action must still run (no re-render before the click is handled).
2. Escape while a menu is open must not also close the MEJ window (Foundry's Escape keybinding); Escape with no menu open must behave exactly as before.
3. Clicking a menu's own toggle button while a different menu is open — exactly one menu ends up open, no flicker/double toggle.
4. A graph pan that starts on the background and ends over a node must not open that node; a node drag must not pan.
5. Timeline in campaign scope with several stacks — the pane, not an inner list, scrolls, and the controls row stays visible.

---

### Task 1: Menus dismiss on outside click and Escape

**Files:**
- Create: `scripts/logic/menu-dismiss.mjs`
- Create: `test/menu-dismiss.test.js`
- Modify: `templates/hub.hbs` (the `.mej-cc-doctype-filter` and `.mej-cc-sort-filter` divs, ~lines 17 and 35)
- Modify: `templates/hub-header.hbs` (the `.mej-cc-tools` div, ~line 18)
- Modify: `scripts/apps/CampaignHubPage.mjs` (import; module-level installer near `HUB_STATE`; call from `activateListeners`)
- Create: `tests/e2e/27-hub-ux.spec.mjs`

**Interfaces:**
- Produces: `MENU_FLAGS`, `openMenuKeys(state) → string[]`, `dismissPatch(state, { insideMenuKey }?) → object|null`. `tests/e2e/27-hub-ux.spec.mjs` with an `openHub(page)` helper that Tasks 2–3 extend.

- [ ] **Step 1: Write the failing unit test** — `test/menu-dismiss.test.js`

```js
import { describe, it, expect } from "vitest";
import { MENU_FLAGS, openMenuKeys, dismissPatch } from "../scripts/logic/menu-dismiss.mjs";

describe("menu-dismiss", () => {
  it("maps menu keys to HUB_STATE flags", () => {
    expect(MENU_FLAGS).toEqual({ tools: "toolsMenuOpen", type: "typeMenuOpen", sort: "sortMenuOpen" });
  });
  it("lists open menus", () => {
    expect(openMenuKeys({ toolsMenuOpen: true, typeMenuOpen: false, sortMenuOpen: true })).toEqual(["tools", "sort"]);
    expect(openMenuKeys({})).toEqual([]);
    expect(openMenuKeys(null)).toEqual([]);
  });
  it("closes every open menu on an outside click", () => {
    expect(dismissPatch({ typeMenuOpen: true, sortMenuOpen: true })).toEqual({ typeMenuOpen: false, sortMenuOpen: false });
  });
  it("keeps the menu the click was inside", () => {
    expect(dismissPatch({ typeMenuOpen: true }, { insideMenuKey: "type" })).toBeNull();
    expect(dismissPatch({ typeMenuOpen: true, toolsMenuOpen: true }, { insideMenuKey: "tools" })).toEqual({ typeMenuOpen: false });
  });
  it("returns null when nothing is open", () => {
    expect(dismissPatch({ typeMenuOpen: false })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run test/menu-dismiss.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `scripts/logic/menu-dismiss.mjs`

```js
// Which Hub pop-up menus a click or Escape should close (spec 2026-09-25
// hub-ux-fixes §1). Pure: the DOM wiring lives in CampaignHubPage.mjs.
export const MENU_FLAGS = { tools: "toolsMenuOpen", type: "typeMenuOpen", sort: "sortMenuOpen" };

export function openMenuKeys(state) {
  return Object.keys(MENU_FLAGS).filter((key) => state?.[MENU_FLAGS[key]] === true);
}

/** State patch closing every open menu except `insideMenuKey`; null if none. */
export function dismissPatch(state, { insideMenuKey = null } = {}) {
  const patch = {};
  for (const key of openMenuKeys(state)) {
    if (key !== insideMenuKey) patch[MENU_FLAGS[key]] = false;
  }
  return Object.keys(patch).length ? patch : null;
}
```

- [ ] **Step 4: Run it** — `npx vitest run test/menu-dismiss.test.js`. Expected: 5 passed.

- [ ] **Step 5: Tag the wrappers.** In `templates/hub.hbs` change `<div class="mej-cc-doctype-filter">` to `<div class="mej-cc-doctype-filter" data-cc-menu="type">` and `<div class="mej-cc-sort-filter">` to `<div class="mej-cc-sort-filter" data-cc-menu="sort">`. In `templates/hub-header.hbs` change `<div class="mej-cc-tools">` to `<div class="mej-cc-tools" data-cc-menu="tools">`.

- [ ] **Step 6: Wire the listeners** in `scripts/apps/CampaignHubPage.mjs`. Add the import beside the other logic imports:

```js
import { MENU_FLAGS, dismissPatch } from "../logic/menu-dismiss.mjs";
```

After the `HUB_STATE` declaration add:

```js
// Outside-click / Escape dismissal for the Hub's pop-up menus (spec
// 2026-09-25 hub-ux-fixes §1). Closing edits the DOM directly instead of
// re-rendering: a re-render would replace the element the user clicked
// before its own click handler ran, swallowing that click. Document-level,
// installed once; a no-op while no menu is open. The click listener is in
// the bubble phase, so a toggle button's own action has already run.
let menuDismissInstalled = false;
function closeMenus(patch) {
  Object.assign(HUB_STATE, patch);
  for (const [key, flag] of Object.entries(MENU_FLAGS)) {
    if (patch[flag] !== false) continue;
    for (const wrap of document.querySelectorAll(`.mej-cc-hub [data-cc-menu="${key}"]`)) {
      wrap.querySelector(".mej-cc-menu")?.remove();
      wrap.querySelector("[aria-haspopup]")?.setAttribute("aria-expanded", "false");
    }
  }
}
function installMenuDismissal() {
  if (menuDismissInstalled) return;
  menuDismissInstalled = true;
  document.addEventListener("click", (event) => {
    const insideMenuKey = event.target?.closest?.("[data-cc-menu]")?.dataset.ccMenu ?? null;
    const patch = dismissPatch(HUB_STATE, { insideMenuKey });
    if (patch) closeMenus(patch);
  });
  // Window capture phase so it runs before Foundry's Escape keybinding,
  // which would otherwise also close the MEJ window. Only swallowed when it
  // actually closed a menu.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const patch = dismissPatch(HUB_STATE);
    if (!patch) return;
    event.stopPropagation();
    event.preventDefault();
    closeMenus(patch);
  }, { capture: true });
}
```

At the top of `activateListeners(html)` (right after `await super.activateListeners(html);`) add `installMenuDismissal();`.

- [ ] **Step 7: Write the e2e test** — create `tests/e2e/27-hub-ux.spec.mjs`. Copy `openHub`/`openHubTab` verbatim from `tests/e2e/08-query-graph.spec.mjs` (lines 33–67, with their doc comment). Imports: `test, expect` from `@playwright/test`; `login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle, KNOWN_MEJ_SESSION_ICON_404` from `./helpers/foundry.mjs`. `HUB_STATE` is module-private, so there is no state-reset helper: each test leaves every menu closed when it ends. Tests (all as `Gamemaster`, `IGNORE = [KNOWN_MEJ_SESSION_ICON_404]`, console errors asserted):

```js
test.describe("27 Hub UX", () => {
  test("menus: an outside click closes the Type menu", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleTypeMenu"]').click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    // Inside click keeps it open (multi-select).
    await shell.locator('.mej-cc-doctype-menu input[name="doctype-check"]').first().check();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    await shell.locator('.mej-cc-doctype-menu input[name="doctype-check"]').first().uncheck();
    // Outside click on inert Hub space closes it.
    await shell.locator(".mej-cc-index-controls input[name='index-filter']").click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toHaveCount(0);
    await expect(shell.locator('button[data-action="toggleTypeMenu"]')).toHaveAttribute("aria-expanded", "false");
    assertNoConsoleErrors(errors);
  });

  test("menus: an outside click on a tab closes the Tools menu and switches tab", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleToolsMenu"]').click();
    await expect(shell.locator(".mej-cc-tools-menu")).toBeVisible();
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await expect(shell.locator(".mej-cc-tools-menu")).toHaveCount(0);
    await expect(shell.locator('.tab[data-tab="graph"]')).toHaveClass(/active/);
    assertNoConsoleErrors(errors);
  });

  test("menus: one toggle switches menus; Escape closes without closing the window", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubTab(page, "index");
    await shell.locator('button[data-action="toggleTypeMenu"]').click();
    await expect(shell.locator(".mej-cc-doctype-menu")).toBeVisible();
    await shell.locator('button[data-action="toggleSortMenu"]').click();
    await expect(shell.locator(".mej-cc-sort-menu")).toBeVisible();
    await expect(shell.locator(".mej-cc-doctype-menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(shell.locator(".mej-cc-sort-menu")).toHaveCount(0);
    await expect(page.locator("#MonksEnhancedJournal")).toBeVisible();
    // A later render must not resurrect it (state was cleared, not just DOM).
    await shell.locator('nav.sheet-tabs a[data-tab="timeline"]').click();
    await shell.locator('nav.sheet-tabs a[data-tab="index"]').click();
    await expect(shell.locator(".mej-cc-sort-menu")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
```

If a tab-link selector differs in this build, read `templates/hub.hbs`'s `<nav>` and adjust; record a ledger ruling.

- [ ] **Step 8: Verify red then green.** Stash the Step 5–6 edits (`git stash push templates scripts/apps/CampaignHubPage.mjs`), run `npx playwright test tests/e2e/27-hub-ux.spec.mjs` — Expected: the three tests FAIL (menu still visible). `git stash pop`, re-run — Expected: 3 passed. Then `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/27-hub-ux.spec.mjs` — Expected: 3 passed. Re-run `tests/e2e/14-campaigns.spec.mjs` and `tests/e2e/02-hub-timeline.spec.mjs` on World A (they toggle these menus) — Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/menu-dismiss.mjs test/menu-dismiss.test.js templates/hub.hbs templates/hub-header.hbs scripts/apps/CampaignHubPage.mjs tests/e2e/27-hub-ux.spec.mjs
git commit -m "fix(hub): menus close on an outside click or Escape"
```

---

### Task 2: Timeline tab scrolls

**Files:**
- Modify: `styles/campaign-companion.css` (Timeline pane block, ~line 276)
- Modify: `tests/e2e/27-hub-ux.spec.mjs`

**Interfaces:**
- Consumes: `openHub`/`openHubTab` from Task 1's spec file.

- [ ] **Step 1: Write the failing e2e test** (append inside the describe). Seed a `TT-` world timeline with 40 timepoints through the module's own data layer, select it, measure:

```js
test("timeline: a long timeline scrolls and keeps its controls visible", async ({ page }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const tlId = await page.evaluate(async (name) => {
    const { createTimeline } = await import("/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs");
    const Timepoints = await import("/modules/mej-campaign-companion/scripts/data/timepoints.mjs");
    const journal = await createTimeline({ campaign: null, name });
    for (let i = 1; i <= 40; i++) await Timepoints.addTimepoint(journal, `${name} point ${i}`);
    return journal.id;
  }, `${TT_PREFIX}Long timeline`);
  try {
    const shell = await openHubTab(page, "timeline");
    await shell.locator('select[name="timeline-select"]').selectOption(tlId);
    await settle(page, 300);
    const pane = shell.locator(".tab-inner.mej-cc-timeline");
    const m = await pane.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBeGreaterThan(m.ch);
    await pane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(shell.locator(`.mej-cc-timeline-list li:has-text("${TT_PREFIX}Long timeline point 40")`)).toBeInViewport();
    await expect(shell.locator(".mej-cc-timeline-controls")).toBeInViewport();
  } finally {
    await page.evaluate((id) => game.journal.get(id)?.delete(), tlId);
  }
  assertNoConsoleErrors(errors);
});
```

Before relying on them, confirm `createTimeline`/`addTimepoint` signatures in `scripts/data/timeline-journal.mjs:60` and `scripts/data/timepoints.mjs:22` (`addTimepoint(group, label, …)` takes the journal) and that the dynamic-import path resolves (module files are served at `/modules/mej-campaign-companion/...`). If `createTimeline` returns something other than the journal, adapt and ledger a ruling. If the timepoint `li` text/selector differs, read `templates/hub.hbs` lines 129–170 and adjust.

- [ ] **Step 2: Run it** — `npx playwright test tests/e2e/27-hub-ux.spec.mjs -g timeline`. Expected: FAIL at `sh > ch` or `scrollTop > 0` (pane clips).

- [ ] **Step 3: Implement** — in `styles/campaign-companion.css`, directly after the `.mej-cc-timeline { … }` rule add:

```css
/* The Hub's .tab-inner clips (overflow:hidden) and the timeline stacks have
   no height bound, so a long timeline - or several stacks in All campaigns
   scope - was cut off. The Timeline pane scrolls as a whole; its controls
   row stays pinned (spec 2026-09-25 hub-ux-fixes §2). */
.mej-cc-hub .tab-inner.mej-cc-timeline {
  overflow-y: auto;
}
.mej-cc-hub .mej-cc-timeline-controls {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg, var(--background, #f0f0e0));
}
```

Check the sticky row's background in both light and dark mode on World A (screenshot the pane scrolled halfway); if timepoint rows show through or the colour clashes, pick the background token the Hub's own header/`.sheet-body` uses (grep `background` near `.mej-cc-hub-header`) and ledger it.

- [ ] **Step 4: Run it** — World A and `FOUNDRY_TARGET=v13`. Expected: passes on both. Re-run `tests/e2e/16-multi-timeline.spec.mjs` and `tests/e2e/02-hub-timeline.spec.mjs` on World A — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add styles/campaign-companion.css tests/e2e/27-hub-ux.spec.mjs
git commit -m "fix(hub): the Timeline tab scrolls when the timeline is taller than the pane"
```

---

### Task 3: Graph panning

**Files:**
- Create: `scripts/logic/graph-pan.mjs`
- Create: `test/graph-pan.test.js`
- Modify: `scripts/apps/hub-graph-pane.mjs` (import; pan binding after the wheel-zoom block)
- Modify: `styles/campaign-companion.css` (`.mej-cc-graph-svg` rule, ~line 947)
- Modify: `tests/e2e/27-hub-ux.spec.mjs`

**Interfaces:**
- Produces: `panViewBox(viewBox:[x,y,w,h], dxPx, dyPx, clientWidth, clientHeight) → [x,y,w,h]`.

- [ ] **Step 1: Write the failing unit test** — `test/graph-pan.test.js`

```js
import { describe, it, expect } from "vitest";
import { panViewBox } from "../scripts/logic/graph-pan.mjs";

describe("panViewBox", () => {
  it("moves the view opposite to the drag at 1:1 scale", () => {
    expect(panViewBox([0, 0, 800, 600], 10, -20, 800, 600)).toEqual([-10, 20, 800, 600]);
  });
  it("scales the drag by the zoom (viewBox units per pixel)", () => {
    expect(panViewBox([100, 50, 1600, 1200], 10, 10, 800, 600)).toEqual([80, 30, 1600, 1200]);
  });
  it("uses the larger axis scale, matching preserveAspectRatio meet", () => {
    // 800x400 viewBox in an 800x800 box: meet scale is max(1, 0.5) = 1.
    expect(panViewBox([0, 0, 800, 400], 10, 10, 800, 800)).toEqual([-10, -10, 800, 400]);
  });
  it("treats a zero-size box as 1:1", () => {
    expect(panViewBox([0, 0, 800, 600], 5, 5, 0, 0)).toEqual([-5, -5, 800, 600]);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run test/graph-pan.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `scripts/logic/graph-pan.mjs`

```js
// Background-drag panning for the Hub's Graph pane (spec 2026-09-25
// hub-ux-fixes §3). The SVG uses the default preserveAspectRatio
// (xMidYMid meet), so one screen pixel is max(w/cw, h/ch) viewBox units.
export function panViewBox([x, y, w, h], dxPx, dyPx, clientWidth, clientHeight) {
  const scale = clientWidth > 0 && clientHeight > 0 ? Math.max(w / clientWidth, h / clientHeight) : 1;
  return [x - dxPx * scale, y - dyPx * scale, w, h];
}
```

- [ ] **Step 4: Run it** — Expected: 4 passed.

- [ ] **Step 5: Wire it** in `scripts/apps/hub-graph-pane.mjs`. Add `import { panViewBox } from "../logic/graph-pan.mjs";` with the other logic imports. After the wheel-zoom `if (!svg.dataset.ccZoomBound) { … }` block, still inside `drawGraphPane`, add:

```js
  // Background drag pans (spec 2026-09-25 hub-ux-fixes §3). Node pointerdowns
  // bubble here too and are skipped, so drag-to-pin is untouched. A pan that
  // ends over a node cannot open it: the click then fires on the nearest
  // common ancestor (the SVG), not on the node.
  if (!svg.dataset.ccPanBound) {
    svg.dataset.ccPanBound = "1";
    svg.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || down.target.closest?.(".mej-cc-graph-node")) return;
      down.preventDefault();
      let last = { x: down.clientX, y: down.clientY };
      svg.classList.add("panning");
      const move = (event) => {
        const viewBox = svg.getAttribute("viewBox").split(" ").map(Number);
        const next = panViewBox(viewBox, event.clientX - last.x, event.clientY - last.y, svg.clientWidth, svg.clientHeight);
        svg.setAttribute("viewBox", next.join(" "));
        last = { x: event.clientX, y: event.clientY };
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        svg.classList.remove("panning");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
```

- [ ] **Step 6: Cursor CSS** — in `styles/campaign-companion.css` next to the `.mej-cc-graph-svg` rule add:

```css
.mej-cc-graph-svg { cursor: grab; }
.mej-cc-graph-svg.panning { cursor: grabbing; }
.mej-cc-graph-svg .mej-cc-graph-node { cursor: pointer; }
```

(If `.mej-cc-graph-node` already sets a cursor, keep that rule instead of adding the third line.)

- [ ] **Step 7: Write the e2e test** (append inside the describe). Seed two related `TT-` Persons so the graph has nodes (reuse `createPerson` from `08-query-graph.spec.mjs` lines 10–27, copied verbatim), scope the Hub's graph to All mode, then:

```js
test("graph: dragging the background pans; it opens nothing", async ({ page }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const ids = [await createPerson(page, `${TT_PREFIX}Pan A`), await createPerson(page, `${TT_PREFIX}Pan B`)];
  try {
    const shell = await openHubTab(page, "graph");
    await shell.locator('button[data-action="setGraphMode"][data-mode="all"]').click();
    const svg = shell.locator(".mej-cc-graph-svg");
    await expect(svg.locator(".mej-cc-graph-node").first()).toBeVisible();
    await settle(page, 1500); // let the force layout cool so nodes stop moving under the pointer
    const box = await svg.boundingBox();
    // Find an empty background point: a corner not covered by a node.
    const start = { x: box.x + 8, y: box.y + 8 };
    expect(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest(".mej-cc-graph-node"), start)).toBe(true);
    const before = await svg.getAttribute("viewBox");
    const opened = await page.evaluate(() => Object.keys(ui.windows ?? {}).length);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 8 });
    await page.mouse.up();
    const after = await svg.getAttribute("viewBox");
    const [bx, by] = before.split(" ").map(Number);
    const [ax, ay] = after.split(" ").map(Number);
    expect(ax).toBeLessThan(bx);
    expect(ay).toBeLessThan(by);
    await expect(shell.locator(".tab[data-tab='graph']")).toHaveClass(/active/);
    expect(await page.evaluate(() => Object.keys(ui.windows ?? {}).length)).toBe(opened);
  } finally {
    await page.evaluate((list) => JournalEntry.implementation.deleteDocuments(list.filter((id) => game.journal.get(id))), ids);
  }
  assertNoConsoleErrors(errors);
});
```

Node click-to-open is already covered by `08-query-graph.spec.mjs`; that file must stay green (Step 8). If the Graph's open handler routes through MEJ's shell rather than `ui.windows`, replace the window-count check with the shell's current entry (read how `onOpen` is passed in `CampaignHubPage.mjs`) and ledger it.

- [ ] **Step 8: Run** — `npx vitest run test/graph-pan.test.js`; `npx playwright test tests/e2e/27-hub-ux.spec.mjs -g graph` on World A and `FOUNDRY_TARGET=v13`; Expected: pass. Verify red: temporarily comment out the pan block, re-run the graph test — Expected: FAIL on `ax < bx`; restore. Re-run `tests/e2e/08-query-graph.spec.mjs` on World A — Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/graph-pan.mjs test/graph-pan.test.js scripts/apps/hub-graph-pane.mjs styles/campaign-companion.css tests/e2e/27-hub-ux.spec.mjs
git commit -m "feat(graph): drag the background to pan"
```

---

### Task 4: Session stamp reads the source and covers embedded pages

**Files:**
- Modify: `scripts/logic/session-flag-stamp.mjs`
- Modify: `scripts/hooks/session-flag-stamp.mjs`
- Modify: `test/session-flag-stamp.test.js`
- Modify: `tests/e2e/26-session-type-label.spec.mjs`

**Interfaces:**
- Produces: `sessionFlagPatch(source)` (unchanged contract, now fed `page._source`); `embeddedPagesPatch(entrySource) → { pages: object[] } | null`.

- [ ] **Step 1: Write the failing unit tests** — append to `test/session-flag-stamp.test.js` (and extend the import to `{ sessionFlagPatch, embeddedPagesPatch }`):

```js
describe("embeddedPagesPatch", () => {
  const MEJ = "monks-enhanced-journal";
  it("stamps only the session pages that lack the flag, keeping everything else", () => {
    const text = { _id: "a", name: "t", type: "text" };
    const bare = { _id: "b", name: "s", type: "mej-campaign-companion.session", flags: { other: { x: 1 } } };
    const flagged = { _id: "c", name: "s2", type: "mej-campaign-companion.session", flags: { [MEJ]: { type: "session", keep: 1 } } };
    const out = embeddedPagesPatch({ pages: [text, bare, flagged] });
    expect(out.pages[0]).toBe(text);
    expect(out.pages[2]).toBe(flagged);
    expect(out.pages[1]).toEqual({ ...bare, flags: { other: { x: 1 }, [MEJ]: { type: "session" } } });
    expect(bare.flags[MEJ]).toBeUndefined(); // input not mutated
  });
  it("keeps other MEJ flags on a stamped page", () => {
    const page = { type: "mej-campaign-companion.session", flags: { [MEJ]: { relationships: {} } } };
    expect(embeddedPagesPatch({ pages: [page] }).pages[0].flags[MEJ]).toEqual({ relationships: {}, type: "session" });
  });
  it("returns null when no page needs stamping or there are no pages", () => {
    expect(embeddedPagesPatch({ pages: [{ type: "text" }] })).toBeNull();
    expect(embeddedPagesPatch({ pages: [] })).toBeNull();
    expect(embeddedPagesPatch({})).toBeNull();
    expect(embeddedPagesPatch(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/session-flag-stamp.test.js`. Expected: FAIL (`embeddedPagesPatch` is not a function); the three existing tests still pass.

- [ ] **Step 3: Implement** — in `scripts/logic/session-flag-stamp.mjs` rename the parameter of `sessionFlagPatch` to `source` (body otherwise unchanged; update its two references), add to the header comment "Fed the page's `_source` (spec 2026-09-25 hub-ux-fixes §4a).", and append:

```js
/**
 * Pages created together with their entry (JournalEntry.create({pages}),
 * compendium import, duplicate) never fire preCreateJournalEntryPage, so the
 * entry's preCreate stamps them (spec 2026-09-25 hub-ux-fixes §4b). Returns
 * the full replacement `pages` array for entry.updateSource, or null.
 */
export function embeddedPagesPatch(entrySource) {
  const pages = entrySource?.pages;
  if (!Array.isArray(pages) || !pages.some((p) => sessionFlagPatch(p))) return null;
  return {
    pages: pages.map((p) => (sessionFlagPatch(p)
      ? { ...p, flags: { ...p.flags, [MEJ]: { ...p.flags?.[MEJ], type: SESSION_TYPE } } }
      : p))
  };
}
```

- [ ] **Step 4: Run** — Expected: all tests in the file pass (3 existing + 3 new).

- [ ] **Step 5: Hook** — replace the body of `registerSessionFlagStamp` in `scripts/hooks/session-flag-stamp.mjs`:

```js
import { MODULE_ID } from "../constants.mjs";
import { sessionFlagPatch, embeddedPagesPatch } from "../logic/session-flag-stamp.mjs";

export function registerSessionFlagStamp() {
  Hooks.on("preCreateJournalEntryPage", (page) => {
    try {
      const patch = sessionFlagPatch(page._source);
      if (patch) page.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp failed`, err);
    }
  });
  Hooks.on("preCreateJournalEntry", (entry) => {
    try {
      const patch = embeddedPagesPatch(entry._source);
      if (patch) entry.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp (embedded pages) failed`, err);
    }
  });
}
```

Keep the file's existing header comment, extended with one line about the entry hook.

- [ ] **Step 6: E2E** — append to `tests/e2e/26-session-type-label.spec.mjs` a test that runs in both modes (no skip):

```js
test("a Session page created together with its entry gets MEJ's type flag", async ({ page }) => {
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, "Gamemaster");
  const result = await page.evaluate(async (name) => {
    const entry = await JournalEntry.create({ name, pages: [
      { name: "s", type: "mej-campaign-companion.session" },
      { name: "t", type: "text" }
    ] });
    const pages = entry.pages.contents;
    const out = pages.map((p) => ({ type: p.type, flag: p.getFlag("monks-enhanced-journal", "type") ?? null }));
    await entry.delete();
    return out;
  }, `${TT_PREFIX}Embedded Session`);
  expect(result).toContainEqual({ type: "mej-campaign-companion.session", flag: "session" });
  expect(result).toContainEqual({ type: "text", flag: null });
  assertNoConsoleErrors(errors);
});
```

Match the file's existing `IGNORE`/imports. Verify red: `git stash push scripts/hooks/session-flag-stamp.mjs`, run `npx playwright test tests/e2e/26-session-type-label.spec.mjs -g "together"` — Expected: FAIL (flag null); `git stash pop`, re-run — Expected: pass. Then the whole file on World A and `FOUNDRY_TARGET=v13` — Expected: World A 2 passed + 1 skipped, World B 3 passed. Re-run `tests/e2e/01-session.spec.mjs` and `tests/e2e/23-campaign-creation.spec.mjs` on World A — Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/session-flag-stamp.mjs scripts/hooks/session-flag-stamp.mjs test/session-flag-stamp.test.js tests/e2e/26-session-type-label.spec.mjs
git commit -m "fix(session): stamp from the page source and stamp pages created with their entry"
```

---

### Task 5: Stabilize the flaky World A tests

**Files:**
- Modify: `tests/e2e/01-session.spec.mjs` (test "player client: gmNotes tab is absent from the DOM, unrevealed secrets are not sent", ~line 275)
- Modify: `tests/e2e/23-campaign-creation.spec.mjs` (test "6. right-click 'Make this folder a campaign' …", ~line 177)
- Production code only if the diagnosis finds a real companion bug.

This task is diagnosis-driven; there is no failing test to write first — the flake is the failing test.

- [ ] **Step 1: Reproduce.** On World A: `npx playwright test tests/e2e/01-session.spec.mjs -g "player client" --repeat-each=10 --trace retain-on-failure` and `npx playwright test tests/e2e/23-campaign-creation.spec.mjs -g "Make this folder" --repeat-each=10 --trace retain-on-failure`. Record pass/fail counts in the ledger. If a test passes 10/10, run `--repeat-each=25`; if still 25/25 green, ledger "not reproduced in N runs" and harden only waits that are demonstrably timing-based (fixed `settle()` immediately followed by an assertion on state that settle was standing in for).

- [ ] **Step 2: Diagnose** each reproduced failure from its trace (`npx playwright show-trace` is interactive — instead unzip the trace and read `test-results/**/error-context.md` and the failure message). Name the race: which fixed `settle()` or click raced which render/hook. Ledger `Task 5: diagnosis: <test> — <cause>`.

- [ ] **Step 3: Fix the cause.** Replace the racing fixed wait with a wait on the condition it stood in for (`expect(locator).toBeVisible()`, `page.waitForFunction(...)`, `expect.poll`). If the cause is in the companion's code, fix it with a unit test RED→GREEN first. If the cause is in MEJ or Foundry, do not patch it: keep the most robust test-side wait and ledger `Task 5: Ruling: upstream cause <what> — test waits on <condition>`.

- [ ] **Step 4: Prove it.** Re-run each with `--repeat-each=20` on World A — Expected: 20/20. Run each file once on `FOUNDRY_TARGET=v13` — Expected: same pass/skip counts as before this task.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/01-session.spec.mjs tests/e2e/23-campaign-creation.spec.mjs
git commit -m "test(e2e): wait on state, not time, in the two flaky World A tests"
```

(Add any production file + unit test touched in Step 3 to the same commit.)

---

### Task 6: Docs and changelog

**Files:**
- Modify: `docs/gm-guide.md` (Tools bullet ~line 75; graph section ~line 166–172)
- Modify: `CHANGELOG.md` (0.22.1 entry)

- [ ] **Step 1: GM guide.** Append to the **Tools** bullet (line ~75): " Like the index's Type and Sort menus, it closes when you click anywhere outside it or press Escape." In the graph section, after the paragraph that lists the three controls and before the 200-node cap paragraph, add: "Scroll the mouse wheel over the canvas to zoom, and drag an empty part of the canvas to pan around it. Dragging a node pins it in place; clicking a node opens its entry."
  Check the existing text first: if it already mentions wheel zoom or drag-to-pin, fold the new sentence into it instead of repeating.

- [ ] **Step 2: CHANGELOG.** Change the 0.22.1 intro line to "Session in Monk's Enhanced Journal's New Entry dialog, and Hub fixes." and append to its bullet list:

```markdown
- **Fixed:** the Hub's Tools, Type and Sort menus now close when you click anywhere outside them or press Escape, not only through their own button; the click still does whatever it landed on.
- **Fixed:** the Hub's Timeline tab scrolls when the timeline is taller than the pane, with its controls kept in view.
- **Added:** drag an empty part of the Hub's Graph to pan around it.
- **Fixed:** a Session page created together with its entry (a script's `JournalEntry.create` with pages, a compendium import, a duplicate) now also gets Monk's Enhanced Journal's type flag.
```

- [ ] **Step 3: Verify** — run the guide link check the repo uses (`grep -n "link" package.json`; if there is no script, `grep -o '](#[^)]*)' docs/gm-guide.md` and confirm each anchor exists). `npm test` — Expected: 1025 + 12 new = 1037 passed (adjust the expected total to the actual new-test count and ledger it).

- [ ] **Step 4: Commit**

```bash
git add docs/gm-guide.md CHANGELOG.md
git commit -m "docs: menu dismissal, graph panning, timeline scrolling in 0.22.1"
```
