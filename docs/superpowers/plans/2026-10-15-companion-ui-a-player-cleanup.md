# Companion UI Plan A: Player-Facing Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Campaign Hub and Session sheet read correctly from a
first-time player's seat with no data-model change: one campaign, no GM
chrome, a chronological Sessions tab, reachable graph Focus, readable
search snippets, consistent wording, and in-app help.

**Architecture:** Every new behaviour is a pure, Foundry-free function in
`scripts/logic/` with a vitest test, consumed by `CampaignHubPage.mjs` or
`SessionSheet.mjs` at the render seam and by the Handlebars templates. The
Hub gains one new tab (`sessions`) whose rows come from
`logic/hub-sessions.mjs`; the tab order and the header's picker-or-title
decision come from `logic/hub-player-view.mjs`; snippet cleanup is
`logic/snippet-text.mjs`. No flags, settings or document shapes change.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, ApplicationV2 tab
groups, Handlebars partials), Monk's Enhanced Journal 13.06/14.01 shell,
vitest 3 (jsdom where DOM is built), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-15-companion-ui-review-design.md`
(items 4, 5, 9, 10, 11, 12, 13, 17, 18 of §6; target in §5.1, §5.2, §5.5,
§5.6, §5.7).

## Global Constraints

- Stock MEJ (native mode) and the API-carrying fork must both keep working;
  nothing here may depend on the MEJ extension API beyond what the Hub
  already uses (spec §8).
- Foundry 13 and 14 (spec §8).
- The companion never patches MEJ; party layers live in the companion's own
  flags or its own hidden entries (spec §8). This plan touches no flags.
- Secret text stays soft-hidden (client-side filtering) as documented
  (spec §8). Nothing here may add GM-only data to a player's context.
- Anti-goal (spec §3): no new Hub tab beyond Sessions for players, and no
  new settings toggle.
- Styling uses the readability ink tokens (`--mej-cc-ink`,
  `--mej-cc-ink-muted`, `--mej-cc-chip-bg`) already in
  `styles/campaign-companion.css`.
- Unit tests: `npx vitest run` from the worktree root (105 files green at
  the start of this plan). e2e: only `tests/e2e/34-player-hub.spec.mjs`
  (Task 11) and it is **not run** as part of executing this plan; the owner
  runs live tests (memory rule: time-box live Foundry runs).
- Commit messages carry the `Co-Authored-By: Claude Fable 5.1
  <noreply@anthropic.com>` trailer; PR bodies carry no Claude attribution
  footer (user rule).
- Tab ids stay stable: `index` keeps its id, only its label changes to
  "Entries" (Plan B relies on the ids).

## Cross-plan interfaces (Plan B builds on these)

- `sessionRows(pages, { noteCounts = new Map() } = {})` in
  `scripts/logic/hub-sessions.mjs` returns
  `{ uuid, name, number, worldDate, attendees, recapPreview, noteCount }[]`;
  `noteCount` defaults to 0 and the template renders it only when > 0.
  Plan B supplies the map.
- `hub-header.hbs`: this plan changes only the picker block (lines 2-6
  today). Plan B adds `templates/hub-tonight.hbs` below the header.
- `session.hbs`: this plan gates GM blocks on the Session tab. Plan B adds
  a notes stream inside the Recap tab (`data-tab="description"`), which
  this plan does not restructure.

## Review Focus

1. **A player who can see zero campaigns** (every campaign is GM-only):
   the header must still render something sensible (the picker with "All
   campaigns" only, no crash), and the Sessions tab must show its empty
   state. Test in Task 2 (`playerHeaderMode` with `[]`) and Task 3
   (`sessionRows([])`).
2. **A player who can see two campaigns** must keep the picker and must
   not get the "Unfiled" option or the spillover button. Test in Task 2.
3. **A Session page whose flag is missing or malformed** (`sessionNumber`
   a string, `campaignDate` null, `attendees` undefined) must still produce
   a row and sort last by number. Test in Task 3.
4. **A snippet containing a malformed or truncated `@UUID[` at the cut
   edge** (snippets are sliced mid-token by `snippetFor`) must not throw
   and must not leave a dangling `@UUID[` prefix. Test in Task 7.
5. **Graph Focus from a node click when the clicked node is already the
   center** must not re-open the Hub or flip scope; it stays a no-op
   redraw. Test in Task 8 (`focusTransition`).

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/logic/hub-player-view.mjs` (new) | Pure: `playerHeaderMode`, `playerTabOrder`, `scopeOptionsForUser` — what a given seat sees in the header and tab strip |
| `scripts/logic/hub-sessions.mjs` (new) | Pure: `sessionRows`, `recapPreview` — Sessions tab rows |
| `scripts/logic/snippet-text.mjs` (new) | Pure: `stripUuidLinks` — search snippet cleanup |
| `scripts/logic/graph-focus.mjs` (new) | Pure: `focusTransition` — what a node click or picker choice does to graph state |
| `scripts/apps/CampaignHubPage.mjs` | Consume the above: header/tab contexts, `sessions` tab, snippet mapping, focus actions, help panel toggle |
| `scripts/apps/hub-graph-pane.mjs` | Node click → focus callback alongside open |
| `templates/hub-header.hbs`, `templates/hub.hbs` | Title-or-picker header, Sessions tab, help panel include, Focus picker |
| `templates/hub-help.hbs` (new) | Static in-Hub help panel |
| `templates/session.hbs`, `scripts/sheets/SessionSheet.mjs` | Player-safe Session tab |
| `scripts/campaign-companion.mjs` | Scene-control tool for every seat |
| `lang/en.json` | New `hub.tabs.sessions`, `hub.sessions.*`, `help.*`, `graph.focusOn*` keys; wording pass |
| `templates/import-wizard.hbs` | Review hint only on step 2 |
| `styles/campaign-companion.css` | Header title, Sessions rows, help panel |
| `docs/gm-guide.md`, `docs/player-guide.md` | Three contradictions fixed; Sessions tab and help panel documented |
| `tests/e2e/34-player-hub.spec.mjs` (new) | Live check of the player-facing surfaces |

---

### Task 1: Scene-control Hub tool for every seat, and the three doc contradictions

**Files:**
- Modify: `scripts/campaign-companion.mjs:307-319`
- Modify: `docs/gm-guide.md:47`, `docs/gm-guide.md:64-68`, `docs/gm-guide.md:356`
- Modify: `docs/player-guide.md:35-39`
- Test: `tests/docs/check-guide-links.mjs` (existing link check, run only)

**Interfaces:**
- Consumes: `openHub()` from `scripts/integrations/mej-adapter.mjs`.
- Produces: nothing new. The `getSceneControlButtons` listener no longer
  returns early for non-GMs.

The three contradictions found during the review:

1. `docs/gm-guide.md:64-68` and `docs/player-guide.md:35-39` say the scene
   control is one of "three ways in, and all of them work for players too".
   Code at `scripts/campaign-companion.mjs:308` is `if (!game.user.isGM)
   return;`. Resolution: make the code match the docs (spec item 10).
2. `docs/gm-guide.md:356` says MEJ v14 builds render no companion "open
   graph" or "prep board" header button. Code at
   `scripts/campaign-companion.mjs:271-301` registers both through
   `getDocumentSheetHeaderButtons`, the graph one with no GM gate. The
   reviewer could not confirm either way on a live v14 build. Resolution:
   reword the doc to say the buttons are registered but may not render on
   some MEJ builds, and that Task 8's in-pane Focus makes the header
   button unnecessary.
3. `docs/gm-guide.md:47` says a player "sees three of those four: no
   Relationships tab"; `docs/gm-guide.md:326` and the player guide say the
   Relationships tab appears for players who can see or add party
   relationships (`scripts/hooks/rel-tab-wrap.mjs:79-96`). Resolution:
   fix line 47.

- [ ] **Step 1: Remove the GM gate on the scene-control tool**

In `scripts/campaign-companion.mjs`, replace lines 303-319 with:

```js
// Scene-controls entry point for every seat (spec 2026-10-15 item 10),
// mirroring how MEJ itself adds a toggle to the notes control group
// (monks-enhanced-journal.js's own getSceneControlButtons listener:
// controls.notes.tools[key] = {...}, the object-keyed shape Foundry 13+
// uses). Players reach the Hub from here without first opening an MEJ
// window; openHub() already scopes and permission-filters per seat.
Hooks.on("getSceneControlButtons", (controls) => {
  const noteControls = controls.notes;
  if (!noteControls?.tools) return;
  noteControls.tools[HUB_PAGE_ID] = {
    name: HUB_PAGE_ID,
    order: Object.keys(noteControls.tools).length,
    title: `${I18N}.hub.title`,
    icon: "fas fa-timeline",
    button: true,
    onChange: () => openHub()
  };
});
```

- [ ] **Step 2: Fix gm-guide.md line 47**

Replace the sentence `A player sees three of those four: no Relationships tab.` with:

```
A player sees **Recap**, **Session** and **Notes**, plus **Relationships** whenever they can add a party relationship there or have one to see (see [Player collaboration](#player-collaboration)).
```

- [ ] **Step 3: Fix gm-guide.md line 356**

Replace the paragraph beginning `Header buttons are not one of the differences` with:

```
Header buttons are not one of the differences either: Campaign Companion registers an "open graph" button on every entry sheet and a "prep board" button on Session sheets through MEJ's header-button hook in both modes, but some MEJ v14 builds do not render companion header buttons at all. Neither surface depends on them — the graph is a Hub tab and can be focused on any entry from inside it (click a node, or use **Focus on…**), and the prep board opens from the button in the Session tab's Secrets block.
```

- [ ] **Step 4: Leave the "three ways in" paragraphs as they are**

`docs/gm-guide.md:64-68` and `docs/player-guide.md:35-39` are now correct
after Step 1. No edit.

- [ ] **Step 5: Run the docs link check and the unit suite**

Run: `node tests/docs/check-guide-links.mjs && npx vitest run`
Expected: link check prints no broken anchors; vitest reports all files
passing (105 files at plan start).

- [ ] **Step 6: Commit**

```bash
git add scripts/campaign-companion.mjs docs/gm-guide.md
git commit -m "feat(hub): scene-control Hub tool for every seat; guides match the code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure player-view rules (header mode, tab order, scope options)

**Files:**
- Create: `scripts/logic/hub-player-view.mjs`
- Test: `test/hub-player-view.test.js`

**Interfaces:**
- Produces:
  - `playerHeaderMode(campaigns, { isGM }) → { mode: "picker"|"title", title: string|null, campaignId: string|null }`
    where `campaigns` is the list of campaign folders **visible to this user**
    (`{ id, name }`). A non-GM with exactly one visible campaign gets
    `{ mode: "title", title: name, campaignId: id }`; everyone else gets
    `{ mode: "picker", title: null, campaignId: null }`.
  - `scopeOptionsForUser(campaigns, current, { isGM, hasUnfiled, labels }) → { value, label, selected }[]`
    with `labels = { all, unfiled, newCampaign }`. Non-GMs never get
    `unfiled` or `__new`; GMs get the existing list.
  - `playerTabOrder(tabs, { isGM, hasVisibleDashboard }) → tabs[]`
    where `tabs` is the Hub's `TABS.primary.tabs` array (objects with `id`).
    GM: unchanged order. Player: `sessions, index, timeline, graph, search`
    then `dashboards` only when `hasVisibleDashboard`, never `secrets`.
  - `lockedScopeId(headerMode, stateCampaignId) → string` — the scope the
    Hub must use: the title's `campaignId` when mode is `title`, else
    `stateCampaignId`.

- [ ] **Step 1: Write the failing tests**

`test/hub-player-view.test.js`:

```js
import { describe, it, expect } from "vitest";
import { playerHeaderMode, scopeOptionsForUser, playerTabOrder, lockedScopeId } from "../scripts/logic/hub-player-view.mjs";

const one = [{ id: "c1", name: "Radiant Citadel" }];
const two = [{ id: "c1", name: "Radiant Citadel" }, { id: "c2", name: "Vale" }];
const labels = { all: "All campaigns", unfiled: "Unfiled", newCampaign: "➕ New Campaign…" };
const TABS = [
  { id: "index" }, { id: "timeline" }, { id: "graph" }, { id: "search" }, { id: "dashboards" }, { id: "secrets" }
];

describe("playerHeaderMode", () => {
  it("non-GM with exactly one visible campaign gets a title", () => {
    expect(playerHeaderMode(one, { isGM: false })).toEqual({ mode: "title", title: "Radiant Citadel", campaignId: "c1" });
  });
  it("non-GM with two visible campaigns keeps the picker (Review Focus 2)", () => {
    expect(playerHeaderMode(two, { isGM: false })).toEqual({ mode: "picker", title: null, campaignId: null });
  });
  it("non-GM with no visible campaign keeps the picker (Review Focus 1)", () => {
    expect(playerHeaderMode([], { isGM: false })).toEqual({ mode: "picker", title: null, campaignId: null });
  });
  it("a GM always gets the picker, even with one campaign", () => {
    expect(playerHeaderMode(one, { isGM: true }).mode).toBe("picker");
  });
});

describe("scopeOptionsForUser", () => {
  it("GM: all, campaigns, unfiled when present, new campaign", () => {
    const out = scopeOptionsForUser(two, "c2", { isGM: true, hasUnfiled: true, labels });
    expect(out.map((o) => o.value)).toEqual(["", "c1", "c2", "unfiled", "__new"]);
    expect(out.find((o) => o.value === "c2").selected).toBe(true);
  });
  it("player: all and campaigns only, never unfiled or new (Review Focus 2)", () => {
    const out = scopeOptionsForUser(two, "", { isGM: false, hasUnfiled: true, labels });
    expect(out.map((o) => o.value)).toEqual(["", "c1", "c2"]);
    expect(out[0].label).toBe("All campaigns");
  });
  it("player with no campaigns: just All (Review Focus 1)", () => {
    expect(scopeOptionsForUser([], "", { isGM: false, hasUnfiled: true, labels }).map((o) => o.value)).toEqual([""]);
  });
});

describe("playerTabOrder", () => {
  it("GM order is untouched", () => {
    expect(playerTabOrder(TABS, { isGM: true, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["index", "timeline", "graph", "search", "dashboards", "secrets"]);
  });
  it("player order is sessions, index, timeline, graph, search", () => {
    expect(playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["sessions", "index", "timeline", "graph", "search"]);
  });
  it("player gets dashboards last only when one is visible to them", () => {
    expect(playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: true }).map((t) => t.id))
      .toEqual(["sessions", "index", "timeline", "graph", "search", "dashboards"]);
  });
  it("sessions tab object carries the icon the template needs", () => {
    const sessions = playerTabOrder(TABS, { isGM: false, hasVisibleDashboard: false })[0];
    expect(sessions).toEqual({ id: "sessions", icon: "fa-solid fa-dice-d20" });
  });
  it("GM order includes sessions after index when the input has it", () => {
    const withSessions = [{ id: "index" }, { id: "sessions", icon: "fa-solid fa-dice-d20" }, ...TABS.slice(1)];
    expect(playerTabOrder(withSessions, { isGM: true, hasVisibleDashboard: false }).map((t) => t.id))
      .toEqual(["index", "sessions", "timeline", "graph", "search", "dashboards", "secrets"]);
  });
});

describe("lockedScopeId", () => {
  it("title mode forces the campaign", () => {
    expect(lockedScopeId({ mode: "title", campaignId: "c1" }, "")).toBe("c1");
    expect(lockedScopeId({ mode: "title", campaignId: "c1" }, "unfiled")).toBe("c1");
  });
  it("picker mode keeps the stored scope", () => {
    expect(lockedScopeId({ mode: "picker", campaignId: null }, "c2")).toBe("c2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/hub-player-view.test.js`
Expected: FAIL with `Failed to resolve import "../scripts/logic/hub-player-view.mjs"`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/hub-player-view.mjs`:

```js
// Pure rules for what a seat sees in the Hub header and tab strip (spec
// 2026-10-15 §5.1, §5.6). No Foundry imports so vitest loads it directly.

export const SESSIONS_TAB = Object.freeze({ id: "sessions", icon: "fa-solid fa-dice-d20" });

const PLAYER_ORDER = ["sessions", "index", "timeline", "graph", "search"];

/**
 * A non-GM who can see exactly one campaign gets that campaign's name as a
 * static title and no picker; everyone else gets the picker.
 * @param {{id:string,name:string}[]} campaigns  campaigns visible to this user
 */
export function playerHeaderMode(campaigns, { isGM }) {
  const list = campaigns ?? [];
  if (!isGM && list.length === 1) {
    return { mode: "title", title: list[0].name, campaignId: list[0].id };
  }
  return { mode: "picker", title: null, campaignId: null };
}

/** Picker options per seat: players never see Unfiled or New Campaign. */
export function scopeOptionsForUser(campaigns, current, { isGM, hasUnfiled, labels }) {
  const cur = current ?? "";
  const options = [
    { value: "", label: labels.all, selected: cur === "" },
    ...(campaigns ?? []).map((c) => ({ value: c.id, label: c.name, selected: cur === c.id }))
  ];
  if (isGM && hasUnfiled) options.push({ value: "unfiled", label: labels.unfiled, selected: cur === "unfiled" });
  if (isGM) options.push({ value: "__new", label: labels.newCampaign, selected: false });
  return options;
}

/**
 * Tab order per seat. GM: the input order (Sessions sits wherever the
 * caller placed it). Player: Sessions first, Dashboards only when one is
 * visible to them, Secrets never.
 */
export function playerTabOrder(tabs, { isGM, hasVisibleDashboard }) {
  const byId = new Map((tabs ?? []).map((t) => [t.id, t]));
  if (isGM) return [...(tabs ?? [])];
  const ordered = PLAYER_ORDER.map((id) => (id === "sessions" ? { ...SESSIONS_TAB } : byId.get(id))).filter(Boolean);
  if (hasVisibleDashboard && byId.has("dashboards")) ordered.push(byId.get("dashboards"));
  return ordered;
}

/** The scope the Hub must use: a title locks it, a picker defers to state. */
export function lockedScopeId(headerMode, stateCampaignId) {
  return headerMode?.mode === "title" ? headerMode.campaignId : (stateCampaignId ?? "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/hub-player-view.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-player-view.mjs test/hub-player-view.test.js
git commit -m "feat(hub): pure player-view rules for header mode, scope options and tab order

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure Sessions-tab rows

**Files:**
- Create: `scripts/logic/hub-sessions.mjs`
- Test: `test/hub-sessions.test.js`

**Interfaces:**
- Consumes: nothing from the module; takes plain page-shaped objects.
- Produces:
  - `recapPreview(html, max = 140) → string` — tag-stripped, whitespace-collapsed first `max` characters with `…` when cut.
  - `sessionRows(pages, { noteCounts = new Map(), formatDate = () => "", attendeeNames = () => [] } = {}) → Row[]`
    where a page is `{ uuid, name, parent: { uuid }, system: { recap }, flags: { "mej-campaign-companion": { session } } }`
    and `Row = { uuid, entryUuid, name, number, worldDate, attendees, recapPreview, noteCount }`.
    Sorted by `number` descending (nulls last, then by name). `worldDate`
    is `formatDate(campaignDate)` or `""`. `attendees` is
    `attendeeNames(session.attendees)`.

- [ ] **Step 1: Write the failing tests**

`test/hub-sessions.test.js`:

```js
import { describe, it, expect } from "vitest";
import { recapPreview, sessionRows } from "../scripts/logic/hub-sessions.mjs";

const P = "mej-campaign-companion";
const page = (uuid, name, session, recap = "") => ({
  uuid, name, parent: { uuid: `E.${uuid}` }, system: { recap }, flags: { [P]: { session } }
});

describe("recapPreview", () => {
  it("strips tags, collapses whitespace, cuts with an ellipsis", () => {
    expect(recapPreview("<p>The party   found the <b>caravan</b>.</p>\n<p>Boot prints.</p>")).toBe("The party found the caravan. Boot prints.");
    expect(recapPreview("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });
  it("empty for empty or non-string", () => {
    expect(recapPreview("")).toBe("");
    expect(recapPreview(null)).toBe("");
  });
  it("turns @UUID[...]{Label} into Label before cutting", () => {
    expect(recapPreview("Met @UUID[JournalEntry.abc]{the Duke} at dawn")).toBe("Met the Duke at dawn");
  });
});

describe("sessionRows", () => {
  const pages = [
    page("s1", "Session 1", { sessionNumber: 1, campaignDate: { year: 1497, month: 5, day: 14 }, attendees: ["Actor.a"] }, "<p>First night</p>"),
    page("s3", "Session 3", { sessionNumber: 3, campaignDate: null, attendees: [] }),
    page("s2", "Session 2", { sessionNumber: 2, campaignDate: null, attendees: [] })
  ];
  it("sorts newest (highest number) first and maps fields", () => {
    const rows = sessionRows(pages, {
      formatDate: (d) => (d ? `${d.year}-${d.month}-${d.day}` : ""),
      attendeeNames: (uuids) => uuids.map((u) => `name:${u}`)
    });
    expect(rows.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(rows[2]).toEqual({
      uuid: "s1", entryUuid: "E.s1", name: "Session 1", number: 1, worldDate: "1497-5-14",
      attendees: ["name:Actor.a"], recapPreview: "First night", noteCount: 0
    });
    expect(rows[0].worldDate).toBe("");
  });
  it("reads note counts from the map keyed by page uuid (Plan B seam)", () => {
    const rows = sessionRows(pages, { noteCounts: new Map([["s2", 4]]) });
    expect(rows.find((r) => r.uuid === "s2").noteCount).toBe(4);
    expect(rows.find((r) => r.uuid === "s1").noteCount).toBe(0);
  });
  it("malformed flags still produce a row that sorts last (Review Focus 3)", () => {
    const bad = page("sx", "Odd one", { sessionNumber: "seven", campaignDate: null });
    const none = { uuid: "sy", name: "No flag", parent: { uuid: "E.sy" }, system: {}, flags: {} };
    const rows = sessionRows([...pages, bad, none]);
    expect(rows.map((r) => r.uuid)).toEqual(["s3", "s2", "s1", "sy", "sx"]);
    expect(rows.at(-1)).toMatchObject({ number: null, worldDate: "", attendees: [], recapPreview: "" });
  });
  it("empty input gives [] (Review Focus 1)", () => {
    expect(sessionRows([])).toEqual([]);
    expect(sessionRows(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/hub-sessions.test.js`
Expected: FAIL with `Failed to resolve import "../scripts/logic/hub-sessions.mjs"`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/hub-sessions.mjs`:

```js
// Pure view-model for the Hub's Sessions tab (spec 2026-10-15 §5.1, item 5).
// No Foundry imports. Note counts are a seam for Plan B (notes primitive):
// this plan always passes an empty map.
import { stripUuidLinks } from "./snippet-text.mjs";

const MODULE_ID = "mej-campaign-companion";

/** Tag-stripped, whitespace-collapsed first `max` characters of a recap. */
export function recapPreview(html, max = 140) {
  if (typeof html !== "string" || !html) return "";
  const text = stripUuidLinks(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function numberOf(session) {
  const n = session?.sessionNumber;
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object[]} pages  Session JournalEntryPages (any order)
 * @returns {{uuid,entryUuid,name,number,worldDate,attendees,recapPreview,noteCount}[]}
 */
export function sessionRows(pages, { noteCounts = new Map(), formatDate = () => "", attendeeNames = () => [] } = {}) {
  const rows = (pages ?? []).map((p) => {
    const session = p?.flags?.[MODULE_ID]?.session ?? {};
    const attendees = Array.isArray(session.attendees) ? session.attendees : [];
    return {
      uuid: p.uuid,
      entryUuid: p.parent?.uuid ?? p.uuid,
      name: p.name ?? "",
      number: numberOf(session),
      worldDate: session.campaignDate ? (formatDate(session.campaignDate) ?? "") : "",
      attendees: attendeeNames(attendees) ?? [],
      recapPreview: recapPreview(p.system?.recap ?? ""),
      noteCount: noteCounts.get(p.uuid) ?? 0
    };
  });
  rows.sort((a, b) => {
    if (a.number === null && b.number === null) return a.name.localeCompare(b.name);
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return b.number - a.number || a.name.localeCompare(b.name);
  });
  return rows;
}
```

The import of `stripUuidLinks` resolves once Task 7 lands. Until then,
create `scripts/logic/snippet-text.mjs` with the final implementation from
Task 7 Step 3 now (Task 7 then only adds its tests). Do this in the same
commit so the suite never imports a missing module.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/hub-sessions.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-sessions.mjs scripts/logic/snippet-text.mjs test/hub-sessions.test.js
git commit -m "feat(hub): pure Sessions-tab rows with a note-count seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Hub header and tabs consume the player-view rules

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs:218-231` (TABS), `:302-315` (`_prepareTabs`), `:416-425` (`context.header`), `:455-467` (`#scope`), `:575-589` (`#campaignScopeContext`), `:1410-1414` (`onSearchAllCampaigns`), `:1797-1812` (scope select listener)
- Modify: `templates/hub-header.hbs:2-6`
- Modify: `templates/hub.hbs:235-239` (spillover)
- Modify: `lang/en.json` (`hub.tabs.index` → "Entries", new `hub.tabs.sessions`)
- Modify: `styles/campaign-companion.css` (after the `.mej-cc-hub-header` block, line ~130)
- Test: `test/hub-player-view.test.js` (Task 2, unchanged) — this task is Foundry glue; its check is the unit suite staying green plus the e2e spec in Task 11.

**Interfaces:**
- Consumes: `playerHeaderMode`, `scopeOptionsForUser`, `playerTabOrder`, `lockedScopeId`, `SESSIONS_TAB` from `../logic/hub-player-view.mjs`; `getCampaigns()` from `../data/campaign-store.mjs`; `isVisibleToUser` from `../logic/hub-index.mjs`.
- Produces: `context.header = { mode, title, scopeOptions, isCampaignScope, toolsMenuOpen, helpOpen }`; a `sessions` tab id in `TABS.primary.tabs` (rendered by Task 5); `HUB_STATE.helpOpen` (used by Task 9).

- [ ] **Step 1: Add the Sessions tab to TABS and reorder per seat in `_prepareTabs`**

Replace `static TABS` (lines 218-231) with:

```js
  static TABS = {
    primary: {
      tabs: [
        { id: "index", icon: "fa-solid fa-list" },
        { id: "sessions", icon: "fa-solid fa-dice-d20" },
        { id: "timeline", icon: "fa-solid fa-timeline" },
        { id: "graph", icon: "fa-solid fa-circle-nodes" },
        { id: "search", icon: "fa-solid fa-magnifying-glass" },
        { id: "dashboards", icon: "fa-solid fa-table-columns" },
        { id: "secrets", icon: "fa-solid fa-user-secret" }
      ],
      initial: "index",
      labelPrefix: `${I18N}.hub.tabs`
    }
  };
```

Replace `_prepareTabs` (lines 302-315) with:

```js
  _prepareTabs(group) {
    if (group === "primary" && this.state.pendingTab) {
      this.tabGroups.primary = this.state.pendingTab;
      this.state.pendingTab = null;
    }
    const tabs = super._prepareTabs(group);
    if (group !== "primary") return tabs;
    const isGM = game.user.isGM;
    if (!isGM) delete tabs.secrets;
    // Player order: Sessions · Entries · Timeline · Graph · Search, and
    // Dashboards only when one is visible to them (spec 2026-10-15 §5.1).
    // super returns an object keyed by id; rebuild it in the seat's order.
    const hasVisibleDashboard = (game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? []).some((q) => q.showPlayers === true);
    const ordered = playerTabOrder(Object.values(tabs), { isGM, hasVisibleDashboard });
    const out = {};
    for (const t of ordered) if (tabs[t.id]) out[t.id] = tabs[t.id];
    // A player whose stored active tab was dropped lands on their first tab.
    if (!out[this.tabGroups.primary]) {
      const first = Object.keys(out)[0];
      this.tabGroups.primary = first;
      for (const t of Object.values(out)) t.active = t.id === first;
      if (out[first]) out[first].cssClass = "active";
    }
    return out;
  }
```

Add to the import block at line 32:

```js
import { playerHeaderMode, scopeOptionsForUser, playerTabOrder, lockedScopeId } from "../logic/hub-player-view.mjs";
```

- [ ] **Step 2: Lock the scope for a single-campaign player**

Replace `#scope()` (lines 455-467) with:

```js
  /** Campaigns this user can see (a GM sees all). Portal visibility is the player's gate. */
  #visibleCampaigns() {
    return getCampaigns().filter((c) => game.user.isGM || campaignEntries(c, { user: game.user }).length > 0 || (campaignPortal(c) && isVisibleToUser(campaignPortal(c), game.user)));
  }

  /** Header mode for this seat (title or picker), computed once per render. */
  #headerMode() {
    return playerHeaderMode(this.#visibleCampaigns().map((c) => ({ id: c.id, name: c.name })), { isGM: game.user.isGM });
  }

  /** Resolve HUB_STATE.campaignId to a scope. A single-campaign player is locked to it; stale ids reset to All. */
  #scope() {
    if (this.state.campaignId === null) {
      this.state.campaignId = game.settings.get(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING);
    }
    const id = lockedScopeId(this.#headerMode(), this.state.campaignId);
    if (id === "unfiled") return { campaign: null, unfiled: true };
    const folder = id ? game.folders.get(id) : null;
    if (id && (!folder || !isCampaignFolder(folder))) {
      this.state.campaignId = "";
      return { campaign: null, unfiled: false };
    }
    return { campaign: folder ?? null, unfiled: false };
  }
```

- [ ] **Step 3: Build the header context from the pure rules**

Replace `#campaignScopeContext()` (lines 575-589) with:

```js
  #campaignScopeContext() {
    const campaigns = getCampaigns();
    const visible = this.#visibleCampaigns();
    const headerMode = this.#headerMode();
    const current = lockedScopeId(headerMode, this.state.campaignId ?? "");
    const options = scopeOptionsForUser(
      visible.map((c) => ({ id: c.id, name: c.name })),
      current,
      {
        isGM: game.user.isGM,
        hasUnfiled: unfiledEntries({ user: game.user }).length > 0,
        labels: {
          all: game.i18n.localize(`${I18N}.hub.scope.all`),
          unfiled: game.i18n.localize(`${I18N}.hub.scope.unfiled`),
          newCampaign: game.i18n.localize(`${I18N}.hub.scope.newCampaign`)
        }
      }
    );
    return {
      campaignControls: campaignControls(campaigns),
      options,
      mode: headerMode.mode,
      title: headerMode.title,
      isCampaignScope: !!current && current !== "unfiled"
    };
  }
```

And at line 417 replace the `context.header = ...` line with:

```js
    context.header = {
      mode: scopeContext.mode, title: scopeContext.title,
      scopeOptions: scopeContext.options, isCampaignScope: scopeContext.isCampaignScope,
      toolsMenuOpen: this.state.toolsMenuOpen, helpOpen: this.state.helpOpen === true
    };
```

Also add `campaignPortal` to the import from `../data/campaign-store.mjs`
at line 20 if it is not already there (it is: `campaignPortal` is in that
import list today).

- [ ] **Step 4: Spillover only in picker mode**

In `#searchContext()` (line 631-647) change the returned `spillover` to:

```js
      spillover: this.#headerMode().mode === "picker" ? spillover : 0
```

- [ ] **Step 5: Header template: title or picker**

Replace `templates/hub-header.hbs` lines 2-6 with:

```hbs
    {{#if (eq header.mode "title")}}
    <h2 class="mej-cc-campaign-title" data-campaign-scope-title>{{header.title}}</h2>
    {{else}}
    <select name="campaign-scope" class="mej-cc-campaign-scope" aria-label="{{localize 'MEJCampaignCompanion.hub.scope.label'}}">
        {{#each header.scopeOptions}}
        <option value="{{this.value}}" {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
        {{/each}}
    </select>
    {{/if}}
```

(`eq` is already used in `hub.hbs:287`, so the helper exists.)

- [ ] **Step 6: Labels and CSS**

In `lang/en.json` under `hub.tabs`, change `"index": "Index"` to
`"index": "Entries"` and add `"sessions": "Sessions"`.

Append after the `.mej-cc-hub-header .mej-cc-tools` rule in
`styles/campaign-companion.css`:

```css
.mej-cc-hub-header .mej-cc-campaign-title {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-16, 16px);
  line-height: 28px;
  color: var(--mej-cc-ink);
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 7: Run the unit suite**

Run: `npx vitest run`
Expected: all files pass; `test/hub-player-view.test.js` and
`test/hub-sessions.test.js` included.

- [ ] **Step 8: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs templates/hub-header.hbs lang/en.json styles/campaign-companion.css
git commit -m "feat(hub): single-campaign players get a title, locked scope and no GM picker options

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Sessions tab rendered in the Hub

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (`_prepareBodyContext` after `context.index = ...` at line 419; `PARTS.main.scrollable` line 214)
- Modify: `templates/hub.hbs` (insert a new tab block after the Index block ends at line 98)
- Modify: `lang/en.json` (new `hub.sessions.*` keys)
- Modify: `styles/campaign-companion.css` (after the Index pane block, before `/* Timeline pane */` at line 276)
- Test: `test/hub-sessions.test.js` (Task 3). Glue is checked by Task 11.

**Interfaces:**
- Consumes: `sessionRows` from `../logic/hub-sessions.mjs`; `formatCampaignDate` from `../logic/campaign-calendar.mjs` (already imported at line 26); `attendeePlayerName` from `../logic/attendee-player.mjs`; `SESSION_DOCUMENT_TYPE` from `../constants.mjs`; `openSessionPage` from `../integrations/mej-adapter.mjs` (already imported at line 47).
- Produces: `context.sessions = { rows, empty: string }`; action `openSessionRow`.

- [ ] **Step 1: Context**

Add imports:

```js
import { sessionRows } from "../logic/hub-sessions.mjs";
import { attendeePlayerName } from "../logic/attendee-player.mjs";
```

and add `SESSION_DOCUMENT_TYPE` to the `../constants.mjs` import list.

Add a private method after `#indexContext()`:

```js
  /** Sessions tab (spec 2026-10-15 §5.1): every Session page in scope, newest number first. */
  #sessionsContext() {
    const pages = this.#scopedEntries().flatMap((entry) =>
      entry.pages.contents.filter((p) => p.type === SESSION_DOCUMENT_TYPE || p._source?.type === SESSION_DOCUMENT_TYPE)
    );
    const rows = sessionRows(pages, {
      formatDate: (d) => formatCampaignDate(d),
      attendeeNames: (uuids) => uuids.map((u) => {
        const actor = fromUuidSync(u);
        if (!actor) return null;
        const player = attendeePlayerName(actor, game.users);
        return player ? `${actor.name} (${player})` : actor.name;
      }).filter(Boolean)
    });
    return {
      rows,
      empty: game.i18n.localize(game.user.isGM ? `${I18N}.hub.sessions.emptyGm` : `${I18N}.hub.sessions.emptyPlayer`)
    };
  }
```

In `_prepareBodyContext`, after `context.index = this.#indexContext();` add:

```js
    context.sessions = this.#sessionsContext();
```

Add `".mej-cc-sessions-list"` to `PARTS.main.scrollable`.

Add the action to `DEFAULT_OPTIONS.actions`:

```js
      openSessionRow: CampaignHubPage.onOpenSessionRow,
```

and the handler next to `onOpenIndexRow`:

```js
  static onOpenSessionRow(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    fromUuid(uuid).then((page) => {
      if (page) openSessionPage(page);
    });
  }
```

- [ ] **Step 2: Template**

Insert into `templates/hub.hbs` directly after line 98 (the closing
`</div>` of the index tab):

```hbs
                <div class="tab{{#if subtabs.sessions.active}} active{{/if}}" data-group="primary" data-tab="sessions">
                    <div class="tab-inner flexcol mej-cc-sessions">
                        <ol class="mej-cc-sessions-list item-list scrollable">
                            {{#each sessions.rows}}
                            <li class="mej-cc-session-row item" data-uuid="{{this.uuid}}" data-action="openSessionRow">
                                <div class="mej-cc-session-row-head">
                                    {{#if this.number}}<span class="mej-cc-session-number">{{localize "MEJCampaignCompanion.hub.sessions.number" n=this.number}}</span>{{/if}}
                                    <span class="mej-cc-session-name">{{this.name}}</span>
                                    {{#if this.worldDate}}<span class="mej-cc-session-date">{{this.worldDate}}</span>{{/if}}
                                    {{#if this.noteCount}}<span class="mej-cc-mention-badge" title="{{localize 'MEJCampaignCompanion.hub.sessions.notes'}}"><i class="fa-solid fa-note-sticky"></i>{{this.noteCount}}</span>{{/if}}
                                </div>
                                {{#if this.attendees.length}}<div class="mej-cc-session-attendees">{{#each this.attendees}}<span class="mej-cc-session-attendee">{{this}}</span>{{/each}}</div>{{/if}}
                                {{#if this.recapPreview}}<p class="mej-cc-session-preview">{{this.recapPreview}}</p>{{/if}}
                            </li>
                            {{else}}
                            <li class="instruction">{{sessions.empty}}</li>
                            {{/each}}
                        </ol>
                    </div>
                </div>
```

- [ ] **Step 3: Strings and CSS**

`lang/en.json`, inside the `hub` object, add:

```json
      "sessions": {
        "number": "Session {n}",
        "notes": "Notes",
        "emptyGm": "No sessions yet. Use New Session to create one.",
        "emptyPlayer": "Your GM hasn't started a session yet. When they do, it will appear here."
      },
```

`styles/campaign-companion.css`, before `/* Timeline pane */`:

```css
/* Sessions pane (spec 2026-10-15 §5.1): newest first, one card per session. */
.mej-cc-sessions-list { padding: 4px 0; }
.mej-cc-session-row { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--color-border-light-tertiary, #7a7971); }
.mej-cc-session-row:hover { background: var(--mej-cc-chip-bg); }
.mej-cc-session-row-head { display: flex; align-items: baseline; gap: 8px; }
.mej-cc-session-number { font-weight: bold; color: var(--mej-cc-ink); }
.mej-cc-session-name { flex: 1; color: var(--mej-cc-ink); }
.mej-cc-session-date { color: var(--mej-cc-ink-muted); font-size: var(--font-size-12, 12px); }
.mej-cc-session-attendees { display: flex; flex-wrap: wrap; gap: 4px; }
.mej-cc-session-attendee { font-size: var(--font-size-11, 11px); color: var(--mej-cc-ink-muted); background: var(--mej-cc-chip-bg); border-radius: 3px; padding: 0 5px; }
.mej-cc-session-preview { margin: 0; color: var(--mej-cc-ink-muted); font-size: var(--font-size-12, 12px); }
```

- [ ] **Step 4: Run the unit suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json styles/campaign-companion.css
git commit -m "feat(hub): Sessions tab, newest first, with recap preview and attendees

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Player-safe Session tab

**Files:**
- Modify: `templates/session.hbs:83-142`
- Modify: `scripts/sheets/SessionSheet.mjs:178-185` (attendee context) — no change needed; this task is template gating only.
- Test: `test/session-template-gates.test.js` (new, jsdom-free string test of the template)

**Interfaces:**
- Consumes: template context `isGM`, `editable`, `secrets`, `attendeeDetails`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`test/session-template-gates.test.js` reads the template file as text and
checks the gates exist, which is what guards against a regression where a
later edit removes the `{{#if}}`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tpl = readFileSync(new URL("../templates/session.hbs", import.meta.url), "utf8");
const between = (from, to) => tpl.slice(tpl.indexOf(from), tpl.indexOf(to, tpl.indexOf(from)));

describe("session.hbs player gates (spec 2026-10-15 item 9)", () => {
  it("the attendee drag hint renders only for editors", () => {
    const attendees = between('<div class="attendees-section">', '<div class="secrets-section">');
    expect(attendees).toMatch(/\{\{#if @root\.editable\}\}\s*<li class="instruction">\{\{localize 'MEJCampaignCompanion\.session\.dragActorHint'\}\}<\/li>/);
  });
  it("the Secrets section renders for the GM, or for a player who has revealed secrets to read", () => {
    const idx = tpl.indexOf('<div class="secrets-section">');
    const before = tpl.slice(idx - 80, idx);
    // Not a bare isGM gate: `secrets` is already filtered to what this viewer
    // may see (SessionSheet context), so a player with a revealed checklist
    // secret must still get the section; only the empty heading goes away.
    expect(before).toContain("{{#if (or @root.isGM secrets.length)}}");
  });
  it("GM Notes stay GM-only", () => {
    const idx = tpl.indexOf('class="flexcol editor-parent gm-notes"');
    expect(tpl.slice(idx - 80, idx)).toContain("{{#if @root.isGM}}");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/session-template-gates.test.js`
Expected: FAIL on the first two assertions (the hint is unguarded; the
secrets section is not wrapped).

- [ ] **Step 3: Edit the template**

Replace `templates/session.hbs` lines 95-97 (the `{{else}}` branch of the
attendees `#each`):

```hbs
                                {{else}}
                                {{#if @root.editable}}
                                <li class="instruction">{{localize 'MEJCampaignCompanion.session.dragActorHint'}}</li>
                                {{else}}
                                <li class="instruction">{{localize 'MEJCampaignCompanion.session.noAttendees'}}</li>
                                {{/if}}
                                {{/each}}
```

Wrap the secrets section (lines 101-125) so it starts with
`{{#if (or @root.isGM secrets.length)}}` on its own line before
`<div class="secrets-section">` and ends with `{{/if}}` after the section's
closing `</div>`. Foundry registers the `or` Handlebars helper (v11+), so no
new helper is needed. The `secrets` array in the sheet context is already
filtered to what the viewer may see (`SessionSheet.mjs` `_prepareContext`,
read it to confirm the player branch only passes revealed/audience-matched
items), so a player with a revealed checklist secret still gets the list,
while a player with nothing revealed no longer sees the heading and
"No secrets yet.". Inside the wrap, the existing `{{#if @root.isGM}}` guards
on lines 104-107 and 112-119 stay as they are, so the diff is minimal.

Add to `lang/en.json` under `session`:

```json
      "noAttendees": "No attendees recorded yet.",
```

- [ ] **Step 4: Run the test to verify it passes, then the suite**

Run: `npx vitest run test/session-template-gates.test.js && npx vitest run`
Expected: PASS, 3 tests; suite green.

- [ ] **Step 5: Commit**

```bash
git add templates/session.hbs lang/en.json test/session-template-gates.test.js
git commit -m "feat(session): players no longer see the Secrets block or the GM drag hint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Search snippets without `@UUID` markup

**Files:**
- Create/finish: `scripts/logic/snippet-text.mjs` (created in Task 3 with this implementation)
- Modify: `scripts/apps/CampaignHubPage.mjs:631-647` (`#searchContext`)
- Test: `test/snippet-text.test.js`

**Interfaces:**
- Produces: `stripUuidLinks(text, { nameOf = () => null } = {}) → string`.
  `@UUID[x]{Label}` → `Label`; `@UUID[x]` → `nameOf("x")` when it returns a
  string, else the last dot-separated id segment; a truncated `@UUID[...`
  with no closing bracket is removed up to the end of the string.

- [ ] **Step 1: Write the failing tests**

`test/snippet-text.test.js`:

```js
import { describe, it, expect } from "vitest";
import { stripUuidLinks } from "../scripts/logic/snippet-text.mjs";

describe("stripUuidLinks", () => {
  it("replaces a labelled link with its label", () => {
    expect(stripUuidLinks("Met @UUID[JournalEntry.abc]{the Duke} at dawn")).toBe("Met the Duke at dawn");
  });
  it("replaces an unlabelled link with the resolved name, else the id tail", () => {
    expect(stripUuidLinks("See @UUID[JournalEntry.abc]", { nameOf: (u) => (u === "JournalEntry.abc" ? "Barnaby" : null) })).toBe("See Barnaby");
    expect(stripUuidLinks("See @UUID[JournalEntry.abc]")).toBe("See abc");
  });
  it("handles several links and leaves other @ text alone", () => {
    expect(stripUuidLinks("@UUID[A.1]{One} and @UUID[B.2]{Two} at @home")).toBe("One and Two at @home");
  });
  it("a truncated link at the snippet edge is dropped, not left dangling (Review Focus 4)", () => {
    expect(stripUuidLinks("…he arrived @UUID[JournalEntry.ab")).toBe("…he arrived ");
    expect(stripUuidLinks("…he arrived @UUID[JournalEntry.abc]{the Du")).toBe("…he arrived the Du");
  });
  it("non-strings give empty", () => {
    expect(stripUuidLinks(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/snippet-text.test.js`
Expected: FAIL (file missing, or if Task 3 already created it, the
truncated-link cases fail until the regex below is in place).

- [ ] **Step 3: Implementation**

`scripts/logic/snippet-text.mjs` (full file; Task 3 creates it with this
exact content):

```js
// Search-snippet cleanup (spec 2026-10-15 item 13): snippets are raw page
// text sliced by search-index.mjs's snippetFor, so links show through as
// @UUID[...]{...} markup and can be cut mid-token. Pure; no Foundry imports.

const FULL = /@UUID\[([^\]]*)\](?:\{([^}]*)\})?/g;
const TRUNCATED_LABEL = /@UUID\[[^\]]*\]\{([^}]*)$/;
const TRUNCATED_REF = /@UUID\[[^\]]*$/;

export function stripUuidLinks(text, { nameOf = () => null } = {}) {
  if (typeof text !== "string" || !text) return "";
  let out = text.replace(FULL, (_m, uuid, label) => {
    if (typeof label === "string") return label;
    const name = nameOf(uuid);
    if (typeof name === "string" && name) return name;
    return uuid.split(".").pop() ?? "";
  });
  out = out.replace(TRUNCATED_LABEL, "$1");
  out = out.replace(TRUNCATED_REF, "");
  return out;
}
```

- [ ] **Step 4: Use it in the Hub's search context**

In `scripts/apps/CampaignHubPage.mjs` add the import:

```js
import { stripUuidLinks } from "../logic/snippet-text.mjs";
```

and in `#searchContext()` change the `matches` mapping to:

```js
      matches: hit.matches.map((m) => ({
        fieldLabel: this.#fieldLabel(m.field),
        snippet: stripUuidLinks(m.snippet, { nameOf: (uuid) => fromUuidSync(uuid)?.name ?? null })
      }))
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/snippet-text.test.js && npx vitest run`
Expected: PASS, 5 tests; suite green.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/snippet-text.mjs test/snippet-text.test.js scripts/apps/CampaignHubPage.mjs
git commit -m "feat(hub): search snippets show link text instead of @UUID markup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Graph Focus reachable from a node click and a picker

**Files:**
- Create: `scripts/logic/graph-focus.mjs`
- Modify: `scripts/apps/hub-graph-pane.mjs:85-86` (signature), `:217-220` (click handler)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onSetGraphMode` at 1521; the `drawGraphPane` call in `activateListeners`; a new `focusOnEntry` action)
- Modify: `templates/hub.hbs:194-204` (graph controls)
- Modify: `lang/en.json` (`graph.focusOn`, `graph.focusOnPick`, `graph.openEntry`)
- Test: `test/graph-focus.test.js`

**Interfaces:**
- Produces:
  - `focusTransition(state, uuid) → { graphMode, graphCenterUuid, changed }` — pure next-state for "focus on this node".
  - `drawGraphPane(svg, graph, { centerUuid, onOpen, onFocus })` — `onFocus(uuid)` fires on a plain click; `onOpen(uuid)` on double-click or Ctrl/Cmd-click.
  - Hub action `focusOnEntry` (from the picker) and the `data-action="setGraphMode"` buttons unchanged.

- [ ] **Step 1: Write the failing tests**

`test/graph-focus.test.js`:

```js
import { describe, it, expect } from "vitest";
import { focusTransition, focusPickerRows } from "../scripts/logic/graph-focus.mjs";

describe("focusTransition", () => {
  it("focusing a new node switches to ego mode centred on it", () => {
    expect(focusTransition({ graphMode: "all", graphCenterUuid: null }, "E.1"))
      .toEqual({ graphMode: "ego", graphCenterUuid: "E.1", changed: true });
  });
  it("focusing the node that is already the centre is a no-op (Review Focus 5)", () => {
    expect(focusTransition({ graphMode: "ego", graphCenterUuid: "E.1" }, "E.1"))
      .toEqual({ graphMode: "ego", graphCenterUuid: "E.1", changed: false });
  });
  it("an empty uuid changes nothing", () => {
    expect(focusTransition({ graphMode: "all", graphCenterUuid: null }, "").changed).toBe(false);
  });
});

describe("focusPickerRows", () => {
  it("lists scope nodes sorted by name with the centre marked", () => {
    const nodes = [{ uuid: "E.2", name: "Zed", type: "person" }, { uuid: "E.1", name: "Amy", type: "place" }];
    expect(focusPickerRows(nodes, "E.2")).toEqual([
      { uuid: "E.1", name: "Amy", type: "place", selected: false },
      { uuid: "E.2", name: "Zed", type: "person", selected: true }
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/graph-focus.test.js`
Expected: FAIL with the import unresolved.

- [ ] **Step 3: Implementation**

`scripts/logic/graph-focus.mjs`:

```js
// Pure graph-focus rules (spec 2026-10-15 item 12): Focus is reachable from
// inside the pane, not only from an entry's header button.

export function focusTransition(state, uuid) {
  const current = { graphMode: state?.graphMode ?? "all", graphCenterUuid: state?.graphCenterUuid ?? null };
  if (!uuid) return { ...current, changed: false };
  if (current.graphMode === "ego" && current.graphCenterUuid === uuid) return { ...current, changed: false };
  return { graphMode: "ego", graphCenterUuid: uuid, changed: true };
}

export function focusPickerRows(nodes, centerUuid) {
  return [...(nodes ?? [])]
    .map((n) => ({ uuid: n.uuid, name: n.name, type: n.type, selected: n.uuid === centerUuid }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Node click focuses, double-click opens**

In `scripts/apps/hub-graph-pane.mjs` change the signature at line 86 to:

```js
export function drawGraphPane(svg, graph, { centerUuid, onOpen, onFocus = null }) {
```

and replace the click handler at lines 217-220 with:

```js
    // Plain click focuses on the node (spec 2026-10-15 item 12); double-click
    // or Ctrl/Cmd-click opens the entry, which was the only click action before.
    g.addEventListener("click", (event) => {
      if (dragged) return;
      if (!onFocus || event.ctrlKey || event.metaKey) { onOpen(node.uuid); return; }
      onFocus(node.uuid);
    });
    g.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (!dragged) onOpen(node.uuid);
    });
```

- [ ] **Step 5: Hub wires the callbacks and the picker**

In `scripts/apps/CampaignHubPage.mjs` add the import:

```js
import { focusTransition, focusPickerRows } from "../logic/graph-focus.mjs";
```

In `_prepareBodyContext`, after `context.graph = graphPrep.context;` add:

```js
    context.graph.focusRows = focusPickerRows(graphPrep.graph.nodes, this.state.graphCenterUuid);
```

Replace the `drawGraphPane(` call inside `activateListeners`
(`CampaignHubPage.mjs:1930-1936`) with:

```js
      drawGraphPane(graphSvg, this.#graphData, {
        centerUuid: this.state.graphCenterUuid,
        onOpen: async (uuid) => {
          const entry = await fromUuid(uuid);
          if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
        },
        onFocus: (uuid) => CampaignHubPage.focusOn.call(this, uuid)
      });
```

Add a static helper and an action:

```js
  /** Focus the graph on `uuid` from inside the pane (node click or picker). */
  static focusOn(uuid) {
    const next = focusTransition(this.state, uuid);
    if (!next.changed) return;
    this.state.graphMode = next.graphMode;
    this.state.graphCenterUuid = next.graphCenterUuid;
    this.render({ parts: ["main"] });
  }

  static onFocusOnEntry(event, target) {
    const uuid = target.value ?? target.closest("[data-uuid]")?.dataset.uuid;
    if (uuid) CampaignHubPage.focusOn.call(this, uuid);
  }
```

Register `focusOnEntry: CampaignHubPage.onFocusOnEntry` in
`DEFAULT_OPTIONS.actions`, and bind the picker's change event in
`activateListeners` next to the timeline select binding:

```js
    const focusSelect = html.querySelector('select[name="graph-focus"]');
    if (focusSelect && !focusSelect.dataset.ccBound) {
      focusSelect.dataset.ccBound = "1";
      focusSelect.addEventListener("change", (event) => CampaignHubPage.focusOn.call(this, event.target.value));
    }
```

- [ ] **Step 6: Template and strings**

In `templates/hub.hbs` replace lines 195-196 (the Focus button) with:

```hbs
                            <button type="button" data-action="setGraphMode" data-mode="ego" class="{{#if graph.isEgo}}active{{/if}}" {{#unless graph.centerUuid}}disabled{{/unless}}>
                                <i class="fa-solid fa-bullseye"></i> {{localize "MEJCampaignCompanion.graph.ego"}}</button>
                            <select name="graph-focus" class="mej-cc-graph-focus" aria-label="{{localize 'MEJCampaignCompanion.graph.focusOn'}}">
                                <option value="" {{#unless graph.centerUuid}}selected{{/unless}}>{{localize "MEJCampaignCompanion.graph.focusOnPick"}}</option>
                                {{#each graph.focusRows}}
                                <option value="{{this.uuid}}" {{#if this.selected}}selected{{/if}}>{{this.name}}</option>
                                {{/each}}
                            </select>
```

`lang/en.json` under `graph` add:

```json
      "focusOn": "Focus on an entry",
      "focusOnPick": "Focus on…",
      "openEntry": "Double-click a node to open it"
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/graph-focus.test.js && npx vitest run`
Expected: PASS, 4 tests; suite green.

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/graph-focus.mjs test/graph-focus.test.js scripts/apps/hub-graph-pane.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git commit -m "feat(graph): Focus reachable by node click and a Focus on… picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: In-Hub help panel and empty states

**Files:**
- Create: `templates/hub-help.hbs`
- Modify: `templates/hub.hbs:5` (include after the tab navigation), `templates/hub-header.hbs:31` (Tools → Help)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onOpenHelp` at 1437, a new `toggleHelp` action, template registration)
- Modify: `scripts/campaign-companion.mjs:36` (preload the partial next to `hub-header.hbs`)
- Modify: `lang/en.json` (`help.*`, `hub.timelineEmptyState`)
- Modify: `styles/campaign-companion.css`
- Test: `test/help-panel-copy.test.js`

**Interfaces:**
- Consumes: `HUB_STATE.helpOpen` (set in Task 4's header context as `header.helpOpen`).
- Produces: action `toggleHelp`; the existing `openHelp` keeps opening the GitHub guide.

- [ ] **Step 1: Write the failing test**

`test/help-panel-copy.test.js` checks the strings exist and the partial
references only keys that exist:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).MEJCampaignCompanion;
const tpl = readFileSync(new URL("../templates/hub-help.hbs", import.meta.url), "utf8");

describe("hub-help partial (spec 2026-10-15 item 11)", () => {
  it("every localize key in the partial exists in en.json", () => {
    const keys = [...tpl.matchAll(/localize ['"]MEJCampaignCompanion\.([\w.]+)['"]/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(4);
    for (const k of keys) {
      const value = k.split(".").reduce((o, p) => o?.[p], en);
      expect(value, k).toBeTypeOf("string");
    }
  });
  it("has the five player lines and the guide link", () => {
    for (const k of ["sessions", "notes", "entries", "reveals", "lookBack"]) expect(en.help.lines[k]).toBeTypeOf("string");
    expect(en.help.open).toBe("Open the full user guide");
    expect(en.help.title).toBe("Help");
  });
  it("the timeline empty state no longer promises a GM action to players", () => {
    expect(en.hub.timelineEmptyState).toBe("No timeline yet.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/help-panel-copy.test.js`
Expected: FAIL (partial missing).

- [ ] **Step 3: Partial, strings, template, CSS**

`templates/hub-help.hbs`:

```hbs
{{#if header.helpOpen}}
<section class="mej-cc-help" aria-label="{{localize 'MEJCampaignCompanion.help.title'}}">
    <header>
        <strong>{{localize "MEJCampaignCompanion.help.title"}}</strong>
        <button type="button" data-action="toggleHelp" data-tooltip="{{localize 'MEJCampaignCompanion.help.close'}}"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <ol>
        <li>{{localize "MEJCampaignCompanion.help.lines.sessions"}}</li>
        <li>{{localize "MEJCampaignCompanion.help.lines.notes"}}</li>
        <li>{{localize "MEJCampaignCompanion.help.lines.entries"}}</li>
        <li>{{localize "MEJCampaignCompanion.help.lines.reveals"}}</li>
        <li>{{localize "MEJCampaignCompanion.help.lines.lookBack"}}</li>
    </ol>
    <button type="button" data-action="openHelp"><i class="fa-solid fa-arrow-up-right-from-square"></i> {{localize "MEJCampaignCompanion.help.open"}}</button>
</section>
{{/if}}
```

`lang/en.json`: replace the `help` object with:

```json
    "help": {
      "title": "Help",
      "menu": "Help",
      "close": "Close help",
      "open": "Open the full user guide",
      "lines": {
        "sessions": "Each game night is a Session. Your GM starts one; it lists who was there, the shared recap, and when it happened in the world.",
        "notes": "Write what happened in the Session's recap. Mention a person or place by name and it becomes a link when you save.",
        "entries": "Entries are the people, places, quests and things your GM has written up. Search finds words inside them; Entries lists them all.",
        "reveals": "When your GM reveals a secret to you, you get a whisper in chat and the text appears on the entry with an orange rule.",
        "lookBack": "Sessions and Timeline show what happened in order. Graph shows how entries connect; click a node to focus on it."
      }
    },
```

and change `hub.timelineEmptyState` to `"No timeline yet."`.

`templates/hub-header.hbs` line 31: replace the help button with two:

```hbs
            <button type="button" data-action="toggleHelp"><i class="fa-solid fa-circle-question"></i> {{localize 'MEJCampaignCompanion.help.menu'}}</button>
```

(The "Open the full user guide" link now lives inside the panel.)

`templates/hub.hbs` line 5, after the tab-navigation include, add:

```hbs
            {{> "modules/mej-campaign-companion/templates/hub-help.hbs"}}
```

`scripts/campaign-companion.mjs` line 36: add
`` `modules/${MODULE_ID}/templates/hub-help.hbs` `` to the preloaded
template list next to `hub-header.hbs`.

`scripts/apps/CampaignHubPage.mjs`: register `toggleHelp:
CampaignHubPage.onToggleHelp` and add:

```js
  static onToggleHelp() {
    this.state.helpOpen = !this.state.helpOpen;
    this.state.toolsMenuOpen = false;
    this.render({ parts: ["main"] });
  }
```

`styles/campaign-companion.css`, after the Hub header block:

```css
/* In-Hub help panel (spec 2026-10-15 item 11). */
.mej-cc-help { margin: 6px; padding: 8px 10px; border: 1px solid var(--color-border-light-tertiary, #7a7971); border-radius: 4px; background: var(--mej-cc-chip-bg); color: var(--mej-cc-ink); }
.mej-cc-help header { display: flex; justify-content: space-between; align-items: center; }
.mej-cc-help ol { margin: 6px 0; padding-left: 18px; }
.mej-cc-help li { margin: 2px 0; font-size: var(--font-size-12, 12px); }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/help-panel-copy.test.js && npx vitest run`
Expected: PASS, 3 tests; suite green. (If `test/help-link.test.js` still
passes it is because `guideUrl` is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add templates/hub-help.hbs templates/hub.hbs templates/hub-header.hbs scripts/apps/CampaignHubPage.mjs scripts/campaign-companion.mjs lang/en.json styles/campaign-companion.css test/help-panel-copy.test.js
git commit -m "feat(hub): in-Hub help panel and a player-safe timeline empty state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Wording pass and the import wizard hint

**Files:**
- Modify: `lang/en.json`
- Modify: `templates/import-wizard.hbs:3` (move the hint)
- Modify: `templates/hub.hbs:139` (action name)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`renameTimepoint` → `editTimepoint` action id and handler name)
- Test: `test/wording-rules.test.js`

**Interfaces:** none new. Action id `renameTimepoint` becomes
`editTimepoint` (template and handler together).

String changes, old → new (all under `MEJCampaignCompanion`):

| Key | Old | New |
|---|---|---|
| `hub.hide` | Hide from players | Hide entry from players |
| `hub.reveal` | Reveal to players | Share entry with players |
| `hub.allTypes` | All Types | All types |
| `hub.typeFilter` | Filter by Type | Filter by type |
| `hub.sortBy` | Sort By | Sort by |
| `hub.orderBy` | Order By | Order by |
| `hub.filterName` | Filter by name... | Filter by name… |
| `hub.search.placeholder` | Search everything... | Search everything… |
| `hub.addTimepoint` | Add Timepoint | Add timepoint |
| `hub.editTimepoint` | Edit Timepoint | Edit timepoint |
| `hub.deleteTimepoint` | Delete Timepoint | Delete timepoint |
| `hub.removeLink` | Remove Link | Remove link |
| `hub.toggleShowPlayers` | Toggle Player Visibility | Show or hide for players |
| `hub.newSession` | New Session | New session |
| `hub.newCampaign` | New Campaign | New campaign |
| `hub.scope.newCampaign` | ➕ New Campaign… | ➕ New campaign… |
| `campaign.createButton` | New Campaign | New campaign |
| `session.editRecap` | Edit Recap | Edit recap |
| `session.removeAttendee` | Remove Attendee | Remove attendee |
| `session.addSecret` | Add Secret | Add secret |
| `session.deleteSecret` | Delete Secret | Delete secret |
| `session.secretPlaceholder` | Secret text... | Secret text… |
| `session.editGmNotes` | Edit GM Notes | Edit GM notes |
| `session.addImage` | Add Image | Add image |
| `entityFromSelection.menu` | Create Entity from Selection | Create entry from selection |
| `entityFromSelection.menuLink` | Link to Entity | Link to entry |
| `entityFromSelection.pickTitle` | Link to Entity | Link to entry |
| `entityFromSelection.pickLabel` | Entity | Entry |
| `entityFromSelection.title` | Create Entity from Selection | Create entry from selection |
| `entityFromSelection.nameRequired` | The entity needs a name. | The entry needs a name. |
| `entityFromSelection.failed` | Could not create the entity ({reason}). | Could not create the entry ({reason}). |
| `hub.contributorsHint` | Contributors can create entities from selected text in this campaign's pages while a GM is connected. | Contributors can add party relationships, and create entries from selected text in this campaign's pages while a GM is connected. |
| `import.button` | Import Document | Import a Word document |
| `export.button` | Export | Export to Word |

Keys **not** changed: `hub.tools`, `hub.scope.*` other than above,
`secrets.*`, `graph.*`, `knowledge.*` (already sentence case), `help.*`
(Task 9). The `retroLink.ambiguous*` strings say "entity" but are GM-only
console-adjacent text and stay.

- [ ] **Step 1: Write the failing test**

`test/wording-rules.test.js`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")).MEJCampaignCompanion;
const get = (k) => k.split(".").reduce((o, p) => o?.[p], en);
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : flat(v, `${p}${k}.`)));

describe("wording rules (spec 2026-10-15 item 17)", () => {
  it("'Add …' labels are sentence case", () => {
    for (const [k, v] of flat(en)) {
      if (/^Add [A-Z]/.test(v) && !/^Add (GM|PDF)/.test(v)) expect(`${k}=${v}`).toBe("");
    }
  });
  it("no three-dot ellipsis in any string", () => {
    for (const [k, v] of flat(en)) expect(v, k).not.toMatch(/\.\.\./);
  });
  it("player-facing labels say entry, not entity", () => {
    for (const k of ["entityFromSelection.menu", "entityFromSelection.menuLink", "entityFromSelection.pickLabel", "entityFromSelection.title"]) {
      expect(get(k), k).not.toMatch(/entit/i);
    }
  });
  it("the Index eye tooltip names what it does", () => {
    expect(get("hub.hide")).toBe("Hide entry from players");
    expect(get("hub.reveal")).toBe("Share entry with players");
  });
  it("the contributors hint covers party relationships", () => {
    expect(get("hub.contributorsHint")).toMatch(/party relationships/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/wording-rules.test.js`
Expected: FAIL on all five.

- [ ] **Step 3: Apply the string table**

Edit `lang/en.json` row by row from the table above. Then rename the
timepoint action: in `templates/hub.hbs:139` change
`data-action="renameTimepoint"` to `data-action="editTimepoint"`; in
`scripts/apps/CampaignHubPage.mjs` change the `actions` entry to
`editTimepoint: CampaignHubPage.onEditTimepoint` and rename the method
`onRenameTimepoint` (line 1609) to `onEditTimepoint`. Grep for any other
`renameTimepoint` reference (tests/e2e) and update it:

Run: `grep -rn "renameTimepoint" scripts templates tests`
Expected after edits: no matches.

- [ ] **Step 4: Import wizard hint on step 2 only**

In `templates/import-wizard.hbs` delete line 3
(`<p class="hint">{{localize "MEJCampaignCompanion.import.reviewHint"}}</p>`,
inside the `{{#if isSource}}` block that spans lines 2-14) and insert the
same line directly after line 16 (`{{#if isReview}}`), so the review step
opens with the hint and the file-chooser step shows only its own
`sourceLocalHint`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/wording-rules.test.js && npx vitest run`
Expected: PASS, 5 tests; suite green. If any existing unit test asserts an
old string value (grep `test/` for the old text), update that assertion
in the same commit.

- [ ] **Step 6: Commit**

```bash
git add lang/en.json templates/hub.hbs templates/import-wizard.hbs scripts/apps/CampaignHubPage.mjs test/wording-rules.test.js test
git commit -m "chore(i18n): wording pass — sentence case, one ellipsis, entry not entity, clearer eye tooltip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Playwright spec for the player-facing Hub (written, not run)

**Files:**
- Create: `tests/e2e/34-player-hub.spec.mjs`
- Modify: `docs/player-guide.md` ("Finding things" section: Sessions tab, Entries label, Help), `docs/gm-guide.md` ("The Campaign Hub": Sessions tab, Help)

**Interfaces:**
- Consumes: helpers from `tests/e2e/helpers/foundry.mjs` (`login`, `settle`, `TT_PREFIX`, `deleteJournalsByPrefix`, `cleanupStrandedTestFolders`, `withGmPage`, `trackConsoleErrors`, `assertNoConsoleErrors`, `KNOWN_MEJ_SESSION_ICON_404`); `createCampaign` from `scripts/data/campaign-store.mjs`; `buildSessionPageData` from `scripts/logic/session-page-data.mjs`.

- [ ] **Step 1: Write the spec**

`tests/e2e/34-player-hub.spec.mjs`:

```js
// Player-facing Hub (spec 2026-10-15 Plan A): a single-campaign player sees a
// title instead of a picker, Sessions first, no GM blocks on the Session tab,
// and an in-Hub help panel. Fixtures are TT- prefixed and swept.
import { test, expect } from "@playwright/test";
import {
  login, settle, TT_PREFIX, deleteJournalsByPrefix, cleanupStrandedTestFolders, withGmPage,
  trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const CAMPAIGN = `${TT_PREFIX}PH Campaign ${RUN}`;
const SESSION = `${TT_PREFIX}PH Session ${RUN}`;

async function seed(page) {
  return page.evaluate(async ({ campaignName, sessionName }) => {
    const { createCampaign, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
    const folder = await createCampaign(campaignName, { ownershipDefault: "observer" });
    const pageData = buildSessionPageData(sessionName, "<p>We met the duke.</p>", { year: 1497, month: 5, day: 14 }, 12);
    const session = await JournalEntry.create({ name: sessionName, folder: folder.id, ownership: { default: 2 }, pages: [pageData] });
    return { folderId: folder.id, portalId: campaignPortal(folder)?.id ?? null, sessionId: session.id };
  }, { campaignName: CAMPAIGN, sessionName: SESSION });
}

async function openPortal(page, portalId) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, portalId);
  await settle(page, 600);
  return page.locator("#MonksEnhancedJournal");
}

test.describe("34 player Hub", () => {
  let ids;

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      // Hide every other campaign from players for the duration of this spec
      // so User 1 sees exactly one; restored in afterAll from the snapshot.
      ids = await seed(gm);
      ids.hidden = await gm.evaluate(async (keep) => {
        const { getCampaigns, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const out = [];
        for (const c of getCampaigns()) {
          if (c.id === keep) continue;
          const portal = campaignPortal(c);
          if (!portal) continue;
          out.push({ id: portal.id, ownership: foundry.utils.deepClone(portal.ownership) });
          await portal.update({ "ownership.default": 0 });
        }
        return out;
      }, ids.folderId);
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      await gm.evaluate(async (hidden) => {
        for (const h of hidden ?? []) await game.journal.get(h.id)?.update({ ownership: h.ownership });
      }, ids?.hidden);
      await deleteJournalsByPrefix(gm);
      await cleanupStrandedTestFolders(gm);
    });
  });

  test("1. header shows the campaign title and no picker; tabs start with Sessions", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    await expect(shell.locator("[data-campaign-scope-title]")).toHaveText(CAMPAIGN);
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(0);
    const tabs = await shell.locator("nav.sheet-tabs a[data-tab]").evaluateAll((as) => as.map((a) => a.dataset.tab));
    expect(tabs.slice(0, 5)).toEqual(["sessions", "index", "timeline", "graph", "search"]);
    expect(tabs).not.toContain("secrets");
    await expect(shell.locator('nav.sheet-tabs a[data-tab="index"]')).toContainText("Entries");
    assertNoConsoleErrors(errors);
  });

  test("2. Sessions tab lists the session newest first with its preview", async ({ page }) => {
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    await shell.locator('nav.sheet-tabs a[data-tab="sessions"]').click();
    await settle(page, 300);
    const row = shell.locator(".mej-cc-session-row").first();
    await expect(row.locator(".mej-cc-session-number")).toHaveText("Session 12");
    await expect(row.locator(".mej-cc-session-name")).toHaveText(SESSION);
    await expect(row.locator(".mej-cc-session-preview")).toHaveText("We met the duke.");
  });

  test("3. a player's Session tab has no Secrets block and no drag hint", async ({ page }) => {
    await login(page, "User 1");
    await page.locator('[data-tab="journal"][data-action="tab"]').click();
    await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, ids.sessionId);
    await settle(page, 600);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('nav a[data-tab="session"]').click();
    await settle(page, 300);
    await expect(shell.locator(".secrets-section")).toHaveCount(0);
    await expect(shell.locator(".attendees-list .instruction")).toHaveText("No attendees recorded yet.");
  });

  test("4. Tools → Help opens the panel; the guide link is inside it", async ({ page }) => {
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    await shell.locator("button.mej-cc-tools-summary").click();
    await shell.locator('button[data-action="toggleHelp"]').click();
    await settle(page, 300);
    await expect(shell.locator(".mej-cc-help li")).toHaveCount(5);
    await expect(shell.locator('.mej-cc-help button[data-action="openHelp"]')).toContainText("Open the full user guide");
    await shell.locator('.mej-cc-help button[data-action="toggleHelp"]').click();
    await expect(shell.locator(".mej-cc-help")).toHaveCount(0);
  });

  test("5. GM still gets the picker, Index labelled Entries, Secrets tab present", async ({ page }) => {
    await login(page, "Gamemaster");
    const shell = await openPortal(page, ids.portalId);
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(1);
    const tabs = await shell.locator("nav.sheet-tabs a[data-tab]").evaluateAll((as) => as.map((a) => a.dataset.tab));
    expect(tabs).toEqual(["index", "sessions", "timeline", "graph", "search", "dashboards", "secrets"]);
  });
});
```

- [ ] **Step 2: Confirm Playwright lists the spec without running it**

Run: `npx playwright test --list tests/e2e/34-player-hub.spec.mjs`
Expected: five tests listed under "34 player Hub". Do **not** run the spec
in this plan; the owner runs live tests.

- [ ] **Step 3: Update the guides**

`docs/player-guide.md`, in "Finding things", replace the sentence that
begins `Below the header bar are the panes. **You see five**` with:

```
Below the header bar are the panes. If you can see only one campaign, the header shows its name instead of a picker. **You see five** — **Sessions**, **Entries**, **Timeline**, **Graph** and **Search** — plus **Dashboards** when your GM has shared one. **Sessions** lists every session, newest first, with who was there and the first line of its recap. **Tools → Help** opens a short in-Hub summary; the full guide is linked from it.
```

`docs/gm-guide.md`, in "The Campaign Hub", change `Below the header bar are **six panes**: **Index**, …` to
`Below the header bar are **seven panes**: **Entries** (the index), **Sessions**, **Timeline**, **Graph**, **Search**, **Dashboards**, and **Secrets**`, and add one sentence: `**Sessions** lists every Session page in scope, newest number first, with its in-world date, attendees and recap preview.` Also note under Tools that **Help** opens an in-Hub panel and the guide link moved inside it.

Run: `node tests/docs/check-guide-links.mjs`
Expected: no broken anchors.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/34-player-hub.spec.mjs docs/player-guide.md docs/gm-guide.md
git commit -m "test(e2e): player Hub spec (title, Sessions tab, player-safe Session tab, help); guides updated

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Item 4 → Tasks 2, 4 (title, locked scope, no
Unfiled/spillover for players; shell-control scoping to the open entry's
campaign is not in this plan: `openHub()` has no entry context today and
Plan B's current-session work touches the same seam, so it is deferred to
Plan C's scoping task). Item 5 → Tasks 3, 5. Item 9 → Task 6 (attendee
defaulting to connected users is Plan B's Start-session work). Item 10 →
Task 1. Item 11 → Task 9. Item 12 → Task 8. Item 13 → Task 7. Item 17 →
Task 10. Item 18 → Task 10 Step 4. e2e → Task 11.

**Placeholders.** None: every step carries its code, command and expected
result; line numbers cited were read from origin/main @ 191026f.

**Type consistency.** `sessionRows` row shape in Task 3 matches the
template in Task 5 (`uuid`, `number`, `name`, `worldDate`, `attendees`,
`recapPreview`, `noteCount`). `playerHeaderMode` → `{ mode, title,
campaignId }` is consumed as `header.mode` / `header.title` in Task 4's
template. `focusTransition` → `{ graphMode, graphCenterUuid, changed }` is
consumed in Task 8's `focusOn`. `HUB_STATE.helpOpen` is set in Task 9 and
read as `header.helpOpen` from Task 4's header context.

**Review Focus.** 1 → Task 2 and Task 3 tests. 2 → Task 2. 3 → Task 3. 4 →
Task 7. 5 → Task 8.
