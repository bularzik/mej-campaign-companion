# Hub Chrome & Graph Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the Hub's global controls into a header bar above the tab nav (picker with inline "New Campaign…", New Session, Tools menu), and move the relationship graph from a standalone popup into a campaign-scoped Hub tab.

**Architecture:** Chrome moves are template rearrangement reusing existing action handlers; the one new behavior (picker `__new` option) routes to the existing New Campaign dialog with revert-on-cancel. The graph's row collection is extracted into a pure, injected function (`logic/graph-rows.mjs`, vitest-covered); the d3-force draw code moves intact into a hub-side pane module; scoping comes free by feeding the Hub's existing `#scopedEntries()` seam into it. `logic/graph-data.mjs` (`buildGraph`) is untouched.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, HandlebarsApplicationMixin/ApplicationV2), vendored d3-force, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-hub-chrome-graph-tab-design.md` (on this branch — read it first; its Decisions table is binding, including: pencil is the ONLY settings home, Tools order Import/Export/Auto-capture/Guide, node click OPENS the entry, ego-centering only via the entity-header entry point, out-of-scope edges clipped with no ghost nodes).

## Global Constraints

- Branch `feature/hub-chrome`, worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/hub-chrome`. Never commit to main. No changes to the monks-enhanced-journal repo, ever.
- Playwright always `--trace off`; TT- fixture prefix; World A shared — id-tracked destructive cleanup only; restore any state you change; restore the module symlink after e2e even on failure.
- Unit suite: 545 tests green before this plan; Task 1 adds exactly 7 → **552** from Task 1 on.
- Behavior preservation: all existing action handlers (`newSession`, `editCampaign`, `openImportWizard`, `openExportDialog`, `setCaptureCampaign`, `openHelp`, `onNewCampaign`) are REUSED, not rewritten. GM gating stays exactly as today (Import/Export/Auto-capture/New Session GM-only; Guide all seats).
- The graph's visual behavior (d3 forces, drag-to-pin, wheel zoom, node click opens the entry, 200-node cap, truncation notice, hidden-rel styling) must be preserved verbatim — the draw code MOVES, it does not change.

---

### Task 1: Pure graph row builder

**Files:**
- Create: `scripts/logic/graph-rows.mjs`
- Test: `test/graph-rows.test.js`
- Modify (consumer comes in Task 3; this task only creates + tests the pure module)

**Interfaces:**
- Consumes: `visibleRelRows` from `./rel-reveals.mjs` (existing pure module).
- Produces: `combineLabel(label, secretText) -> string` and `graphRowsFor(entries, ctx) -> Array<{uuid, name, type, relationships}>` where `ctx = { isGM, userId, groups, getType(page), canObserve(entry), relRevealsOf(entry), relationshipsOf(page) }`. Task 3's pane module calls `graphRowsFor` with real Foundry injections. Row shape is IDENTICAL to graph-app.mjs's current `graphRows()` output (buildGraph consumes it unchanged).

- [ ] **Step 1: Write the failing tests**

Create `test/graph-rows.test.js`:

```js
import { describe, it, expect } from "vitest";
import { graphRowsFor, combineLabel } from "../scripts/logic/graph-rows.mjs";
import { buildGraph } from "../scripts/logic/graph-data.mjs";

function page(type, relationships = []) {
  return { __type: type, __rels: relationships };
}
function entry(uuid, name, pages, { observable = true } = {}) {
  return { uuid, name, pages: { contents: pages }, __observable: observable };
}
const ctx = (over = {}) => ({
  isGM: false, userId: "u1", groups: [],
  getType: (p) => p.__type,
  canObserve: (e) => e.__observable,
  relRevealsOf: () => ({}),
  relationshipsOf: (p) => p.__rels,
  ...over
});

describe("combineLabel", () => {
  it("joins label and secret, drops null/empty parts", () => {
    expect(combineLabel("ally", "owes a debt")).toBe("ally / owes a debt");
    expect(combineLabel("ally", null)).toBe("ally");
    expect(combineLabel("", null)).toBe("");
  });
});

describe("graphRowsFor", () => {
  it("emits one row per MEJ-typed entry, first typed page wins", () => {
    const rows = graphRowsFor([
      entry("J.a", "A", [page(null), page("person"), page("place")]),
      entry("J.b", "B", [page("quest")])
    ], ctx());
    expect(rows).toEqual([
      { uuid: "J.a", name: "A", type: "person", relationships: [] },
      { uuid: "J.b", name: "B", type: "quest", relationships: [] }
    ]);
  });

  it("skips untyped entries entirely", () => {
    expect(graphRowsFor([entry("J.x", "X", [page(null)])], ctx())).toEqual([]);
  });

  it("gates non-observable entries for players but not for the GM", () => {
    const es = [entry("J.h", "H", [page("person")], { observable: false })];
    expect(graphRowsFor(es, ctx())).toEqual([]);
    expect(graphRowsFor(es, ctx({ isGM: true }))).toHaveLength(1);
  });

  it("maps visible relationship rows with combined labels", () => {
    const rels = [{ id: "r1", uuid: "J.b", hidden: false, label: "ally", secretText: "owes gold" }];
    const rows = graphRowsFor([entry("J.a", "A", [page("person", rels)])], ctx({ isGM: true }));
    expect(rows[0].relationships).toEqual([
      { id: "r1", uuid: "J.b", hidden: false, revealedToViewer: false, label: "ally / owes gold" }
    ]);
  });

  it("scope is exactly the entries passed in (no world reads)", () => {
    const a = entry("J.a", "A", [page("person", [{ id: "r", uuid: "J.out", hidden: false, label: "knows" }])]);
    expect(graphRowsFor([a], ctx()).map((r) => r.uuid)).toEqual(["J.a"]);
  });

  it("buildGraph clips edges whose far end is out of scope (no ghost nodes)", () => {
    const rows = graphRowsFor([
      entry("J.a", "A", [page("person", [{ id: "r", uuid: "J.gone", hidden: false, label: "knows" }])]),
      entry("J.b", "B", [page("place")])
    ], ctx({ isGM: true }));
    const g = buildGraph(rows, [], { mode: "all", isGM: true, maxNodes: 200 });
    expect(g.nodes.map((n) => n.uuid).sort()).toEqual(["J.a", "J.b"]);
    expect(g.edges).toHaveLength(0);
  });
});
```

(That is 6 `it` blocks in graphRowsFor + 1 in combineLabel = 7 tests.)

- [ ] **Step 2: Run to verify they fail**

Run (worktree root): `npx vitest run test/graph-rows.test.js`
Expected: FAIL — module `scripts/logic/graph-rows.mjs` not found.

- [ ] **Step 3: Implement `scripts/logic/graph-rows.mjs`**

```js
// Pure graph row collection, extracted from apps/graph-app.mjs's graphRows()
// so the Hub's graph tab can feed it SCOPED entries (the campaign picker's
// selection) instead of the whole world, and so it is vitest-loadable. Every
// Foundry touch is injected - same convention as campaigns.mjs. Row shape is
// exactly what logic/graph-data.mjs's buildGraph consumes.
import { visibleRelRows } from "./rel-reveals.mjs";

/**
 * Edge label text: the free-text relationship label plus the secret label
 * when one is visible to the current viewer. `secretText` is null when
 * visibleRelRows withheld it (unrevealed, non-GM viewer) - combineLabel
 * naturally drops it in that case, covering both the GM and player rules.
 */
export function combineLabel(label, secretText) {
  return [label, secretText].filter((s) => typeof s === "string" && s.length).join(" / ");
}

/**
 * One row per MEJ-typed entry in `entries` (single-page convention: the
 * first typed page wins). Scope IS the entries argument - callers decide
 * membership (the Hub passes its #scopedEntries()).
 * ctx: { isGM, userId, groups, getType(page), canObserve(entry),
 *        relRevealsOf(entry), relationshipsOf(page) }
 */
export function graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf }) {
  const rows = [];
  for (const entry of entries ?? []) {
    if (!isGM && !canObserve(entry)) continue;
    for (const page of entry.pages?.contents ?? []) {
      const type = getType(page);
      if (!type) continue;
      const relationships = visibleRelRows(
        relationshipsOf(page),
        relRevealsOf(entry) ?? {},
        { userId, groups, isGM }
      ).map((r) => ({ id: r.id, uuid: r.uuid, hidden: r.hidden, revealedToViewer: r.rowRevealedToUser, label: combineLabel(r.label, r.secretText) }));
      rows.push({ uuid: entry.uuid, name: entry.name, type, relationships });
      break;
    }
  }
  return rows;
}
```

Note: `visibleRelRows` must tolerate the plain rel objects the tests pass — it already accepts row arrays and a reveals map (it is pure). If a test fails on its row shape, read `scripts/logic/rel-reveals.mjs` and match the test fixtures to the real accepted shape rather than changing the implementation.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run` — Expected: 552 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/graph-rows.mjs test/graph-rows.test.js
git commit -m "feat: pure scoped graph row builder (logic/graph-rows.mjs)"
```

---

### Task 2: Header bar, Tools menu, Index toolbar cleanup

**Files:**
- Create: `templates/hub-header.hbs`
- Modify: `templates/hub.hbs` (include header above tab nav; strip moved controls from the Index toolbar)
- Modify: `scripts/apps/CampaignHubPage.mjs` (HUB_STATE, header context, `toggleToolsMenu` action, picker `__new` routing, drop the `newCampaign` action map entry)
- Modify: `scripts/campaign-companion.mjs` (register the partial via `loadTemplates`)
- Modify: `lang/en.json` (`hub.tools`, `hub.scope.newCampaign`)
- Modify: `styles/campaign-companion.css` (header bar + tools menu rules; if the stylesheet has a different filename, use the module's existing one — check `module.json`'s `styles` array)

**Interfaces:**
- Consumes: existing actions `editCampaign`, `newSession`, `openImportWizard`, `openExportDialog`, `setCaptureCampaign`, `openHelp`, and the existing `onNewCampaign` static (called directly by the picker routing — its dialog-cancel path must not change state, which it already doesn't: it only sets `state.campaignId` after a successful create).
- Produces: `context.header = { scopeOptions, isCampaignScope, toolsMenuOpen }`; HUB_STATE gains `toolsMenuOpen: false`. The scope `<select>` keeps its name/class (`campaign-scope` / `mej-cc-campaign-scope`) so existing bindings and e2e selectors keep working; it now lives in the header. Task 5's e2e asserts the header layout.

- [ ] **Step 1: Create `templates/hub-header.hbs`**

```handlebars
<div class="mej-cc-hub-header">
    <select name="campaign-scope" class="mej-cc-campaign-scope" aria-label="{{localize 'MEJCampaignCompanion.hub.scope.label'}}">
        {{#each header.scopeOptions}}
        <option value="{{this.value}}" {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
        {{/each}}
    </select>
    {{#if header.isCampaignScope}}{{#if isGM}}
    <button type="button" class="mej-cc-edit-campaign" data-action="editCampaign"
            data-tooltip="{{localize 'MEJCampaignCompanion.hub.editCampaign'}}">
        <i class="fa-solid fa-gear"></i>
    </button>
    {{/if}}{{/if}}
    {{#if isGM}}
    <button type="button" class="mej-cc-new-session" data-action="newSession">
        <i class="fa-solid fa-dice-d20"></i> {{localize 'MEJCampaignCompanion.hub.newSession'}}
    </button>
    {{/if}}
    <div class="mej-cc-tools">
        <button type="button" class="mej-cc-tools-summary" data-action="toggleToolsMenu"
                aria-haspopup="true" aria-expanded="{{#if header.toolsMenuOpen}}true{{else}}false{{/if}}">
            <i class="fa-solid fa-ellipsis"></i> {{localize 'MEJCampaignCompanion.hub.tools'}}
        </button>
        {{#if header.toolsMenuOpen}}
        <div class="mej-cc-tools-menu mej-cc-menu">
            {{#if isGM}}
            <button type="button" data-action="openImportWizard"><i class="fa-solid fa-file-import"></i> {{localize 'MEJCampaignCompanion.import.button'}}</button>
            <button type="button" data-action="openExportDialog"><i class="fa-solid fa-file-export"></i> {{localize 'MEJCampaignCompanion.export.button'}}</button>
            <button type="button" data-action="setCaptureCampaign"><i class="fa-solid fa-crosshairs"></i> {{localize 'MEJCampaignCompanion.hub.captureTarget'}}</button>
            {{/if}}
            <button type="button" data-action="openHelp"><i class="fa-solid fa-circle-question"></i> {{localize 'MEJCampaignCompanion.help.open'}}</button>
        </div>
        {{/if}}
    </div>
</div>
```

- [ ] **Step 2: Register and include the partial**

In `scripts/campaign-companion.mjs`'s `Hooks.once("init", …)` block, add (adapting to any existing `loadTemplates` call if one exists — search first):

```js
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/hub-header.hbs`
  ]);
```

In `templates/hub.hbs`, directly ABOVE the line
`{{> "templates/generic/tab-navigation.hbs" tabs=subtabs}}`, insert:

```handlebars
            {{> "modules/mej-campaign-companion/templates/hub-header.hbs"}}
```

- [ ] **Step 3: Strip the moved controls from the Index toolbar**

In `templates/hub.hbs`'s `.mej-cc-index-controls` div, DELETE: the
`select[name="campaign-scope"]` block, the `mej-cc-edit-campaign` button
(with its surrounding `{{#if index.campaignScope.isCampaignScope}}{{#if isGM}}…{{/if}}{{/if}}`
wrapper), the `mej-cc-new-campaign` button (with its `{{#if isGM}}` wrapper),
the `mej-cc-graph-open` button, the `mej-cc-help-open` button, the
`mej-cc-new-session` button, the `mej-cc-capture-target` button, the
`mej-cc-import-open` button, and the `mej-cc-export-open` button. KEEP:
the doctype filter block, the sort block, the `index-filter` input, the
filtered-count span, and the `mej-cc-file-all` button in its
`{{#if index.isUnfiledScope}}` wrapper — mind the `{{#if isGM}}` nesting:
after the deletions, file-all must remain inside an `{{#if isGM}}` guard.
The adoption banner above the toolbar is untouched.

- [ ] **Step 4: Hub page changes (`scripts/apps/CampaignHubPage.mjs`)**

1. HUB_STATE literal: add `toolsMenuOpen: false,` after `sortMenuOpen: false,`.
2. Actions map: add `toggleToolsMenu: CampaignHubPage.onToggleToolsMenu,` and DELETE the `newCampaign: CampaignHubPage.onNewCampaign,` entry (the picker now calls the method directly; the method itself stays).
3. New action, modeled on `onToggleTypeMenu` (find it and mirror its open/close-others behavior):

```js
  static onToggleToolsMenu() {
    this.state.toolsMenuOpen = !this.state.toolsMenuOpen;
    this.state.typeMenuOpen = false;
    this.state.sortMenuOpen = false;
    this.render({ parts: ["main"] });
  }
```

(If `onToggleTypeMenu` also closes menus on outside click via a document listener in `_onRender`, extend that same listener to close `toolsMenuOpen` too — mirror, don't fork, the mechanism.)
4. `#campaignScopeContext()`: after the unfiled push, add the GM-only creation option:

```js
    if (game.user.isGM) {
      options.push({ value: "__new", label: game.i18n.localize(`${I18N}.hub.scope.newCampaign`), selected: false });
    }
```

5. In `_prepareBodyContext`, expose the header context (and keep `index.campaignScope` feeding whatever index template logic remains — if after Step 3 nothing in the index pane reads `index.campaignScope`, move the call: `const scopeContext = this.#campaignScopeContext();` and set `context.header = { scopeOptions: scopeContext.options, isCampaignScope: scopeContext.isCampaignScope, toolsMenuOpen: this.state.toolsMenuOpen };` — check `hub.hbs` for remaining `index.campaignScope` references and update `#indexContext` accordingly so no dead context keys remain).
6. The scope-select change listener (`_onRender`, the `scopeSelect` block): route the new option before the normal path —

```js
      scopeSelect.addEventListener("change", async (event) => {
        if (event.target.value === "__new") {
          // Action-as-option: revert the visible selection immediately;
          // onNewCampaign itself switches scope only after a successful
          // create, so dialog-cancel leaves the previous scope untouched.
          event.target.value = this.state.campaignId ?? "";
          return CampaignHubPage.onNewCampaign.call(this);
        }
        this.state.campaignId = event.target.value;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, event.target.value);
        this.render({ parts: ["main"] });
      });
```

- [ ] **Step 5: i18n + CSS**

`lang/en.json`, in the `hub` block: add `"tools": "Tools",` and in its `scope` sub-block add `"newCampaign": "➕ New Campaign…",`.

Stylesheet (the file named in `module.json`'s `styles` array): add, following the existing `.mej-cc-index-controls` / `.mej-cc-doctype-filter` conventions:

```css
.mej-cc-hub-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border-light-tertiary, #7a7971);
}
.mej-cc-hub-header .mej-cc-tools {
  margin-left: auto;
  position: relative;
}
.mej-cc-hub-header .mej-cc-tools-menu {
  right: 0;
  left: auto;
}
.mej-cc-tools-menu button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
}
```

(If `.mej-cc-menu` already provides positioning, keep these overrides minimal — match how `.mej-cc-doctype-menu` is positioned and only add the right-alignment.)

- [ ] **Step 6: Verify**

Run: `npx vitest run` — Expected: 552 passed.
Run: `node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.
Run: `grep -n "newCampaign\|graph-open\|help-open\|import-open\|export-open\|capture-target\|new-session\|campaign-scope" templates/hub.hbs` — Expected: NO hits inside the `.mej-cc-index-controls` region; header partial include present; `data-action="newCampaign"` appears nowhere.

- [ ] **Step 7: Commit**

```bash
git add templates/hub-header.hbs templates/hub.hbs scripts/apps/CampaignHubPage.mjs scripts/campaign-companion.mjs lang/en.json styles/
git commit -m "feat: hub header bar with picker-inline New Campaign and Tools menu"
```

---

### Task 3: Graph tab (pane module, TABS, template, state)

**Files:**
- Create: `scripts/apps/hub-graph-pane.mjs`
- Modify: `scripts/apps/CampaignHubPage.mjs` (TABS, HUB_STATE graph fields, context, `_onRender` draw + bindings, `setGraphMode` action)
- Modify: `templates/hub.hbs` (graph pane between timeline and search panes)
- Delete: `templates/graph.hbs` (markup moves into hub.hbs, re-rooted under `graph.*` context)
- Modify: `lang/en.json` (`hub.tabs.graph`)

**Interfaces:**
- Consumes: Task 1's `graphRowsFor(entries, ctx)`; existing `buildGraph` (logic/graph-data.mjs), `backlinkPairs` (search/live-index.mjs), `visibleRelRows` injections' real counterparts (`mejType`, `normalizeGroups`, `PLAYER_GROUPS_SETTING`), the Hub's `#scopedEntries()`.
- Produces: `prepareGraphContext(entries, state) -> { graph, context }` and `drawGraphPane(svgEl, graph, { centerUuid, onOpen })` from `hub-graph-pane.mjs`; HUB_STATE gains `graphMode: "all"`, `graphCenterUuid: null`, `graphBacklinks: false`, `pendingTab: null`. Task 4 sets those state fields from the entity entry point; Task 5 asserts the pane.

- [ ] **Step 1: Create `scripts/apps/hub-graph-pane.mjs`**

The file is the popup's logic relocated. Copy from `scripts/apps/graph-app.mjs` (READ IT FIRST — it is deleted in Task 4): `MAX_NODES`, `typeHue`, the whole `#draw()` body, and `#bindDrag`, restructured as:

```js
// Graph pane for the Hub's Graph tab (spec B §2). Relocated from the
// retired standalone RelationshipGraphApp (apps/graph-app.mjs): same
// d3-force simulation, SVG rendering, drag-to-pin, wheel zoom, node-click-
// opens-entry, 200-node cap. What changed: rows come from the CALLER's
// (scoped) entry list via logic/graph-rows.mjs instead of walking all of
// game.journal, and pane state lives in the Hub's HUB_STATE.
import { MODULE_ID, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { buildGraph } from "../logic/graph-data.mjs";
import { graphRowsFor } from "../logic/graph-rows.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { backlinkPairs } from "../search/live-index.mjs";
import * as d3 from "../../vendor/d3-force.esm.js";
import { mejType } from "../integrations/mej-adapter.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const MAX_NODES = 200;

let activeSim = null;

/** Compute the scoped graph + the template context for the pane. */
export function prepareGraphContext(entries, state) {
  const rows = graphRowsFor(entries, {
    isGM: game.user.isGM,
    userId: game.user.id,
    groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
    getType: (page) => mejType(page),
    canObserve: (entry) => entry.testUserPermission(game.user, "OBSERVER") === true,
    relRevealsOf: (entry) => entry.getFlag(MODULE_ID, "relReveals"),
    relationshipsOf: (page) => page.flags?.[MEJ_FLAGS]?.relationships
  });
  const graph = buildGraph(rows, state.graphBacklinks ? backlinkPairs() : [], {
    mode: state.graphMode, centerUuid: state.graphCenterUuid,
    includeBacklinks: state.graphBacklinks, isGM: game.user.isGM, maxNodes: MAX_NODES
  });
  return {
    graph,
    context: {
      isEgo: state.graphMode === "ego",
      centerUuid: state.graphCenterUuid,
      includeBacklinks: state.graphBacklinks,
      truncated: graph.truncated === true
    }
  };
}
```

then `export function drawGraphPane(svg, graph, { centerUuid, onOpen })` containing the popup's `#draw()` body with these mechanical substitutions: `this.#graph` → `graph`; `this.#centerUuid` → `centerUuid`; `this.#sim` → `activeSim` (module-level: `activeSim?.stop()` before assigning the new simulation); the node click handler becomes `g.addEventListener("click", () => { if (dragged) return; onOpen(node.uuid); })` with `dragged` a local `let` closed over by both the click and the relocated drag-binding code (the popup's `#dragged` field + `#bindDrag` become a local variable + inner function `bindDrag(g, node)` in the same module — copy the pointer handling verbatim, substituting `this.#sim` → `activeSim` and `this.#dragged` → `dragged`). The wheel-zoom block moves verbatim (it only touches `svg`). Preserve every comment that still applies; update the ones that referenced the app class.

- [ ] **Step 2: TABS, state, context, render wiring in `CampaignHubPage.mjs`**

1. `static TABS` primary tabs array: insert `{ id: "graph", icon: "fa-solid fa-circle-nodes" },` between the `timeline` and `search` entries.
2. HUB_STATE literal: add `graphMode: "all", graphCenterUuid: null, graphBacklinks: false, pendingTab: null,`.
3. Imports: `import { prepareGraphContext, drawGraphPane } from "./hub-graph-pane.mjs";`
4. In `_prepareBodyContext`, alongside the other pane contexts: `const graphPrep = prepareGraphContext(this.#scopedEntries(), this.state); this.#graphData = graphPrep.graph; context.graph = graphPrep.context;` (add a `#graphData` instance field).
5. Actions map: add `setGraphMode: CampaignHubPage.onSetGraphMode,` and the handler:

```js
  static onSetGraphMode(event, target) {
    const mode = target.dataset.mode;
    if (!["ego", "all"].includes(mode)) return;
    this.state.graphMode = mode;
    this.render({ parts: ["main"] });
  }
```

6. In `_onRender` (with the other `html.querySelector` bindings, same `ccBound` dedupe convention):

```js
    const backlinksToggle = html.querySelector('[data-action-change="toggleGraphBacklinks"]');
    if (backlinksToggle && !backlinksToggle.dataset.ccBound) {
      backlinksToggle.dataset.ccBound = "1";
      backlinksToggle.addEventListener("change", () => {
        this.state.graphBacklinks = backlinksToggle.checked;
        this.render({ parts: ["main"] });
      });
    }
    const graphSvg = html.querySelector(".mej-cc-graph-svg");
    if (graphSvg && this.#graphData) {
      drawGraphPane(graphSvg, this.#graphData, {
        centerUuid: this.state.graphCenterUuid,
        onOpen: async (uuid) => {
          const entry = await fromUuid(uuid);
          if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
        }
      });
    }
    if (this.state.pendingTab) {
      const tab = this.state.pendingTab;
      this.state.pendingTab = null;
      this.changeTab(tab, "primary");
    }
```

- [ ] **Step 3: Pane template**

In `templates/hub.hbs`, after the timeline pane's closing `</div>` (the `data-tab="timeline"` block) and before the search pane, insert (this is `templates/graph.hbs`'s markup re-rooted under `graph.*` and with the checkbox action renamed to avoid colliding with any future popup naming):

```handlebars
                <div class="tab{{#if subtabs.graph.active}} active{{/if}}" data-group="primary" data-tab="graph">
                    <div class="tab-inner flexcol mej-cc-graph-pane">
                        <div class="mej-cc-graph-controls">
                            <button type="button" data-action="setGraphMode" data-mode="ego" class="{{#if graph.isEgo}}active{{/if}}" {{#unless graph.centerUuid}}disabled{{/unless}}>
                                <i class="fa-solid fa-bullseye"></i> {{localize "MEJCampaignCompanion.graph.ego"}}</button>
                            <button type="button" data-action="setGraphMode" data-mode="all" class="{{#unless graph.isEgo}}active{{/unless}}">
                                <i class="fa-solid fa-circle-nodes"></i> {{localize "MEJCampaignCompanion.graph.all"}}</button>
                            <label class="mej-cc-graph-backlinks"><input type="checkbox" data-action-change="toggleGraphBacklinks" {{#if graph.includeBacklinks}}checked{{/if}}>
                                {{localize "MEJCampaignCompanion.graph.backlinks"}}</label>
                            {{#if graph.truncated}}<span class="mej-cc-graph-truncated">{{localize "MEJCampaignCompanion.graph.truncated"}}</span>{{/if}}
                        </div>
                        <svg class="mej-cc-graph-svg"></svg>
                    </div>
                </div>
```

Delete `templates/graph.hbs`. Add `"graph": "Graph"` to `lang/en.json` under `hub.tabs` (find the existing `tabs` block that holds index/timeline/search labels).

- [ ] **Step 4: Verify**

Run: `npx vitest run` — Expected: 552 passed.
Run: `node --input-type=module --check < scripts/apps/hub-graph-pane.mjs && node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.
Run: `ls templates/graph.hbs 2>&1` — Expected: No such file.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub-graph-pane.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git rm templates/graph.hbs
git commit -m "feat: campaign-scoped relationship graph as a Hub tab"
```

---

### Task 4: Entry-point retarget + popup deletion

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (export `showGraphFor`; remove `onOpenGraph` + its action map entry)
- Modify: `scripts/campaign-companion.mjs:150-154` (entity-header button)
- Delete: `scripts/apps/graph-app.mjs`

**Interfaces:**
- Consumes: Task 3's HUB_STATE graph fields + `pendingTab`; existing `openHub` (integrations/mej-adapter.mjs), `campaignIdOf` (logic/campaigns.mjs — already imported in CampaignHubPage.mjs), `HUB_CAMPAIGN_SCOPE_SETTING`.
- Produces: `export async function showGraphFor(uuid)` from `scripts/apps/CampaignHubPage.mjs` (module-level export, NOT a class static — the entity button dynamic-imports it).

- [ ] **Step 1: Add `showGraphFor` to `CampaignHubPage.mjs`**

Module-level, after the class (uses the module's existing imports plus `openHub` — import it as `import { openHub } from "../integrations/mej-adapter.mjs";` — CampaignHubPage.mjs is itself only ever dynamic-imported by the adapter, so the static back-import creates no cycle at load time; verify with the syntax check in Step 4):

```js
/**
 * Entity-header entry point (spec B §2): open the Hub on the Graph tab,
 * ego-centered on `uuid`. If the entity belongs to a campaign, scope
 * switches to that campaign first so the ego view is in-context.
 */
export async function showGraphFor(uuid) {
  const doc = await fromUuid(uuid);
  const entry = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
  const cid = entry ? campaignIdOf(entry) : null;
  if (cid) {
    HUB_STATE.campaignId = cid;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, cid);
  }
  HUB_STATE.graphCenterUuid = entry?.uuid ?? uuid;
  HUB_STATE.graphMode = "ego";
  HUB_STATE.pendingTab = "graph";
  await openHub();
}
```

(`pendingTab` is consumed in `_onRender` — Task 3 Step 2.6 — so this works in both shell and native hosting without holding an app reference.)

- [ ] **Step 2: Retarget the entity button and remove the Hub action**

In `scripts/campaign-companion.mjs`, replace the button's `onclick`:

```js
    onclick: async () => {
      const { showGraphFor } = await import("./apps/CampaignHubPage.mjs");
      showGraphFor(doc.parent?.uuid ?? doc.uuid);
    }
```

In `CampaignHubPage.mjs`: delete the `openGraph: CampaignHubPage.onOpenGraph,` action map entry and the `onOpenGraph` method (find it near line 989 — it calls `openGraph()`), and remove any now-unused import of `openGraph`/graph-app.

- [ ] **Step 3: Delete the popup**

```bash
git rm scripts/apps/graph-app.mjs
```

- [ ] **Step 4: Verify**

Run: `grep -rn "graph-app\|RelationshipGraphApp\|onOpenGraph\|data-action=\"openGraph\"" scripts templates` — Expected: no matches (a comment mentioning the retirement in hub-graph-pane.mjs is fine — adjust the grep to confirm no CODE references).
Run: `node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && node --input-type=module --check < scripts/campaign-companion.mjs && echo OK` — Expected: OK.
Run: `npx vitest run` — Expected: 552 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: entity graph button targets the Hub graph tab; retire the popup"
```

---

### Task 5: E2E — chrome relocation + scoped graph, live verification

**Files:**
- Modify: `tests/e2e/08-query-graph.spec.mjs` (popup → tab; add scoping + ego-entry scenarios)
- Modify: `tests/e2e/14-campaigns.spec.mjs` (New Campaign via picker; any toolbar-selector fallout)
- Modify: `tests/e2e/02-hub-timeline.spec.mjs`, `tests/e2e/05-docx-import.spec.mjs`, `tests/e2e/guide-screenshots.spec.mjs` (selector fallout only)
- Create: header-bar scenarios (add to `tests/e2e/14-campaigns.spec.mjs` as a new test, not a new file)

**Interfaces:**
- Consumes: Tasks 2-4's DOM: `.mej-cc-hub-header` (containing `select[name="campaign-scope"]`, `.mej-cc-new-session`, `.mej-cc-tools-summary`, `.mej-cc-tools-menu`), tab `a[data-tab="graph"]`, `.mej-cc-graph-pane`, `.mej-cc-graph-node/.mej-cc-graph-edge`, picker option `__new`.
- Produces: the live verification gate for the whole branch.

- [ ] **Step 1: Point the test env at this worktree**

```bash
ln -sfn /Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/hub-chrome ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion
```

(`monks-enhanced-journal` stays pointed at the user's main checkout — never touch it.)

- [ ] **Step 2: Sweep the five specs for moved selectors**

Run `grep -n "mej-cc-graph-open\|mej-cc-new-campaign\|mej-cc-help-open\|mej-cc-import-open\|mej-cc-export-open\|mej-cc-capture-target\|mej-cc-graph-app" tests/e2e/*.spec.mjs` and fix every hit:
- `button.mej-cc-graph-open` clicks → `shell.locator('nav.sheet-tabs a[data-tab="graph"]').click()`.
- `.mej-cc-graph-app` locators → `shell.locator(".mej-cc-graph-pane")` (the graph now lives inside the Hub shell, not its own window; node/edge/label class names are unchanged).
- `button.mej-cc-new-campaign` clicks → select the picker option instead: `await shell.locator('select[name="campaign-scope"]').selectOption("__new");` (the New Campaign dialog flow after that is unchanged).
- `mej-cc-import-open` / `mej-cc-export-open` / `mej-cc-capture-target` / `mej-cc-help-open` clicks → open the Tools menu first: `await shell.locator(".mej-cc-tools-summary").click();` then click the same `data-action` button inside `.mej-cc-tools-menu` (e.g. `shell.locator('.mej-cc-tools-menu button[data-action="openImportWizard"]')`).
- `select[name="campaign-scope"]` and `.mej-cc-new-session` selectors keep working unchanged (same name/class, new location) — verify, don't rewrite.

- [ ] **Step 3: Graph scenarios in `08-query-graph.spec.mjs`**

Update the two existing graph tests per Step 2's transforms. Then add:

```js
  test("graph tab is campaign-scoped: member nodes only, All shows the world", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Campaign with one member + one loose entry, id-tracked for cleanup.
    const ids = await page.evaluate(async (prefix) => {
      const folder = await Folder.create({
        name: `${prefix}GraphScope`, type: "JournalEntry",
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      const member = await JournalEntry.create({
        name: `${prefix}Scope-Member`, folder: folder.id,
        pages: [{ name: `${prefix}Scope-Member`, type: "text", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      const loose = await JournalEntry.create({
        name: `${prefix}Scope-Loose`,
        pages: [{ name: `${prefix}Scope-Loose`, type: "text", flags: { "monks-enhanced-journal": { type: "place" } } }]
      });
      return { folderId: folder.id, memberId: member.id, looseId: loose.id };
    }, TT_PREFIX);

    const shell = await openHub(page);
    await shell.locator('select[name="campaign-scope"]').selectOption(ids.folderId);
    await settle(page, 400);
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(page, 600);
    const pane = shell.locator(".mej-cc-graph-pane");
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Member` })).toHaveCount(1);
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Loose` })).toHaveCount(0);

    await shell.locator('select[name="campaign-scope"]').selectOption("");
    await settle(page, 600);
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Loose` })).toHaveCount(1);

    await page.evaluate(async (x) => {
      await JournalEntry.implementation.deleteDocuments([x.memberId, x.looseId]);
      await game.folders.get(x.folderId)?.delete();
    }, ids);
    assertNoConsoleErrors(errors);
  });
```

And the entity-header entry point (same spec file):

```js
  test("entity header button lands on the Graph tab, scoped and ego-centered", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    // Create a TT- campaign folder + one member person entry: repeat the
    // scoping test's evaluate block verbatim (folder with campaign flag,
    // member JournalEntry inside it) minus the loose entry.
    const ids = await page.evaluate(async (prefix) => {
      const folder = await Folder.create({
        name: `${prefix}GraphEgo`, type: "JournalEntry",
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      const member = await JournalEntry.create({
        name: `${prefix}Ego-Member`, folder: folder.id,
        pages: [{ name: `${prefix}Ego-Member`, type: "text", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      return { folderId: folder.id, memberId: member.id };
    }, TT_PREFIX);

    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, ids.memberId);
    await settle(page, 500);
    // The graph header button MEJ renders for the mounted subsheet (class
    // mej-cc-open-graph, registered via getDocumentSheetHeaderButtons).
    await page.locator("#MonksEnhancedJournal .mej-cc-open-graph").first().click();
    await settle(page, 800);

    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator('nav.sheet-tabs [data-tab="graph"]')).toHaveClass(/active/);
    expect(await shell.locator('select[name="campaign-scope"]').inputValue()).toBe(ids.folderId);
    await expect(shell.locator('.mej-cc-graph-controls button[data-mode="ego"]')).toHaveClass(/active/);
    await expect(shell.locator(".mej-cc-graph-pane .mej-cc-graph-node.center")).toHaveCount(1);

    // Restore: scope back to All, id-tracked cleanup.
    await shell.locator('select[name="campaign-scope"]').selectOption("");
    await settle(page, 300);
    await page.evaluate(async (x) => {
      await JournalEntry.implementation.deleteDocuments([x.memberId]);
      await game.folders.get(x.folderId)?.delete();
    }, ids);
    assertNoConsoleErrors(errors);
  });
```

(The header-button and tab-handle selectors must be confirmed against the real rendered DOM on the first run — MEJ may render the header button as `a` and tab handles as `a` or `button`. Adjust locators to reality WITHOUT weakening the four assertions that follow.)

(Adapt the `openHub` helper name to whatever this spec already uses to open the Hub shell — read its existing tests first; if it opens the Hub differently, reuse that. Reset the scope select to `""` (All) before the test ends so World A's client state is unchanged.)

- [ ] **Step 4: Header-bar scenarios in `14-campaigns.spec.mjs`**

Add one test:

```js
  test("10. header bar: controls above the tabs, Tools menu, picker New Campaign with cancel-revert", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHubShell(page); // reuse this spec's existing hub-open helper name

    // Header renders above the tab nav with the relocated controls.
    const header = shell.locator(".mej-cc-hub-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator('select[name="campaign-scope"]')).toHaveCount(1);
    await expect(header.locator(".mej-cc-new-session")).toHaveCount(1);
    // The Index toolbar no longer carries the moved controls.
    await expect(shell.locator(".mej-cc-index-controls .mej-cc-new-campaign")).toHaveCount(0);
    await expect(shell.locator(".mej-cc-index-controls .mej-cc-import-open")).toHaveCount(0);

    // Tools menu opens with the four GM items and closes.
    await header.locator(".mej-cc-tools-summary").click();
    const menu = header.locator(".mej-cc-tools-menu");
    await expect(menu.locator('button[data-action="openImportWizard"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="openExportDialog"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="setCaptureCampaign"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="openHelp"]')).toHaveCount(1);
    await header.locator(".mej-cc-tools-summary").click();
    await expect(header.locator(".mej-cc-tools-menu")).toHaveCount(0);

    // Picker "New Campaign…": cancel reverts the visible selection.
    const before = await header.locator('select[name="campaign-scope"]').inputValue();
    await header.locator('select[name="campaign-scope"]').selectOption("__new");
    await settle(page, 400);
    const dialog = page.locator("dialog.application").last();
    await dialog.locator('button[data-action="cancel"], button[data-action="close"]').first().click().catch(() => dialog.evaluate((d) => d.close()));
    await settle(page, 400);
    expect(await header.locator('select[name="campaign-scope"]').inputValue()).toBe(before);
    assertNoConsoleErrors(errors);
  });
```

And a player-seat check (same spec, copying this file's existing second-browser-context pattern — scenario 8 "permissions from the player seat" shows the login/teardown shape):

```js
  test("11. player seat: Tools menu offers only the User Guide; no GM chrome", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "User 1");
    const shell = await openHubShell(page); // same helper scenario 8 uses

    const header = shell.locator(".mej-cc-hub-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator(".mej-cc-new-session")).toHaveCount(0);
    await expect(header.locator(".mej-cc-edit-campaign")).toHaveCount(0);
    // Picker exists but offers players no "__new" creation option.
    await expect(header.locator('select[name="campaign-scope"] option[value="__new"]')).toHaveCount(0);

    await header.locator(".mej-cc-tools-summary").click();
    const menu = header.locator(".mej-cc-tools-menu");
    await expect(menu.locator("button")).toHaveCount(1);
    await expect(menu.locator('button[data-action="openHelp"]')).toHaveCount(1);
    await context.close();
  });
```

(Read the New Campaign dialog's actual cancel-button markup in the spec's existing scenario-1 flow and use that selector — do not guess; the `.catch` fallback above is a last resort, replace it with the real selector once known. The create-path of "New Campaign…" — scope switching to the new campaign — is already covered by the existing scenario that creates a campaign once its click is retargeted in Step 2.)

- [ ] **Step 5: Run the touched suites**

```bash
npx playwright test tests/e2e/08-query-graph.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/05-docx-import.spec.mjs --trace off --reporter=line
```

Expected: all passed. Then run `tests/e2e/guide-screenshots.spec.mjs` the same way IF its own header says it is safe to run against World A (read it first — if it is a screenshot-generation utility rather than an assertion suite, running it once to confirm no crash is enough).
If failures: debug and re-run; assertions may be adapted to real DOM but never weakened (a scoping assertion must still distinguish member from non-member).

- [ ] **Step 6: Restore the symlink (mandatory, even on failure)**

```bash
ln -sfn /Users/danbularzik/Claude/Projects/mej-campaign-companion ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion
```

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/
git commit -m "test: e2e for hub header bar, tools menu, picker New Campaign, scoped graph tab"
```
