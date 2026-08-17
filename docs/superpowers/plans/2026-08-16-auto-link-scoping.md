# Auto-Link Scoping Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound all auto-linking by audience containment, and extend it to two new paths: docx-import-time linking and a GM-side retroactive pass when a new MEJ entity is created. Ships as mej-campaign-companion 0.4.0.

**Architecture:** One linking engine — the existing `autoLinkAdded` (`scripts/logic/auto-link.mjs`), reused with an empty baseline for whole-document passes. New pure modules compute audience containment (`link-audience.mjs`) and the retroactive plan (`retro-link.mjs`); a new hook module (`hooks/retro-link.mjs`) stamps a `retroLinkPending` flag at creation and processes it on the active GM's client (create-hook + ready sweep) behind a `retroLinkMode` world setting (off/confirm/silent). The import wizard gains an Audience select that sets created-entry ownership AND bounds import-time link candidates.

**Tech Stack:** Foundry VTT v13/v14 (ApplicationV2, DialogV2), Monk's Enhanced Journal extension API, vitest (unit, `test/*.test.js`), Playwright (`tests/e2e/*.spec.mjs`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-auto-link-scoping-design.md` (approved 2026-08-16).

## Global Constraints

- **Containment rule (spec Part 1, verbatim):** a mention in page P may link to entity E only if every non-GM user who can view P can also view E; "can view" is `isVisibleToUser(entry, user)` from `scripts/logic/hub-index.mjs` (GM, or `testUserPermission ≥ LIMITED`), evaluated on the page's **parent JournalEntry** and on E. No per-page granularity.
- **One engine:** all matching goes through `autoLinkAdded` from `scripts/logic/auto-link.mjs`. Never write a second tokenizer/matcher.
- **Ambiguity:** a name shared by 2+ entities that both pass containment for the target page is never linked — skipped and (where a report channel exists) reported. Never guess.
- **Exact names:** world setting `retroLinkMode` (String, choices `off`/`confirm`/`silent`, default `"confirm"`); entry flag `flags["mej-campaign-companion"].retroLinkPending` (Boolean); update-options guard `options["mej-campaign-companion"].retroLink === true`; page opt-out flag `noAutoLink` (existing, moves to constants as `NO_AUTO_LINK_FLAG`).
- **Name floor:** candidate/entity names shorter than 3 trimmed characters never link (existing `selectCandidates` default — the retroactive pass applies the same floor).
- **Actor:** the retroactive pass runs only where `game.users.activeGM === game.user`. The pending flag is stamped by the creating client in `preCreateJournalEntry` (fires locally only).
- **Observer posture:** every hook body is wrapped so failures `console.error` (prefixed `mej-campaign-companion | `) and skip — never block the underlying create/import/save.
- **Scan surface:** page `text.content` only.
- **i18n:** every user-facing string goes through `game.i18n` under the `MEJCampaignCompanion` prefix (`I18N` constant); new keys added to `lang/en.json`.
- **Tests:** unit tests in `test/<module>.test.js` (vitest, pure modules only — no Foundry globals); e2e in `tests/e2e/`. Run unit with `npx vitest run test/<file>`, full suite `npm test`.
- **Commits:** small, per-task, message style `feat:`/`test:`/`docs:` as below.

## File Structure

| File | Responsibility |
|---|---|
| Create `scripts/logic/link-audience.mjs` | Pure audience math: viewer sets, containment, import-audience helpers |
| Create `scripts/logic/retro-link.mjs` | Pure retroactive-pass planner (per-page rows, ambiguity, match counts) |
| Create `scripts/hooks/retro-link.mjs` | Foundry glue: flag stamping, GM processing, confirm dialog, whisper, ready sweep |
| Modify `scripts/logic/auto-link-candidates.mjs` | Add `dropAmbiguousNames` |
| Modify `scripts/hooks/auto-link.mjs` | Containment-based candidates; retro-write re-entry guard |
| Modify `scripts/constants.mjs` | `RETRO_LINK_MODE_SETTING`, `RETRO_LINK_PENDING_FLAG`, `NO_AUTO_LINK_FLAG` |
| Modify `scripts/campaign-companion.mjs` | Register setting + `registerRetroLink()` |
| Modify `scripts/data/mej-entry.mjs` | Optional `ownership` param |
| Modify `scripts/apps/import-wizard.mjs` | Audience select, import-time linking, ownership threading |
| Modify `templates/import-wizard.hbs` | Audience form-group |
| Modify `lang/en.json`, `styles/campaign-companion.css` | Strings; dialog row styling |
| Create `test/link-audience.test.js`, `test/retro-link.test.js`; modify `test/auto-link-candidates.test.js` | Unit tests |
| Create `tests/e2e/11-auto-link-scope.spec.mjs` | E2e coverage |
| Modify `README.md`, `CHANGELOG.md`, `module.json` | Docs + 0.4.0 |

---

### Task 1: `link-audience` pure module

**Files:**
- Create: `scripts/logic/link-audience.mjs`
- Test: `test/link-audience.test.js`

**Interfaces:**
- Consumes: nothing (pure; the `isVisible` predicate is injected).
- Produces (later tasks rely on these exact signatures):
  - `viewerIds(entry, users, isVisible)` → `string[]` of non-GM user ids `u.id` where `isVisible(entry, u)` is true. `users` is an array of `{id, isGM}`-shaped objects.
  - `audienceContains(pageViewerIds, targetViewerIds)` → `boolean`; true iff every id in `pageViewerIds` is in `targetViewerIds`. Empty page audience → always true.
  - `audienceViewerIdsForImport(audience, users)` → `string[]`; `"players"` → every non-GM user id, anything else (`"gm"`) → `[]`.
  - `filterCandidatesForAudience(candidates, audienceViewerIds)` → the subset of `candidates` (each `{name, uuid, viewerIds}`) where `audienceContains(audienceViewerIds, c.viewerIds)`.

- [ ] **Step 1: Write the failing test**

```js
// test/link-audience.test.js
import { describe, it, expect } from "vitest";
import {
  viewerIds, audienceContains, audienceViewerIdsForImport, filterCandidatesForAudience
} from "../scripts/logic/link-audience.mjs";

const user = (id, isGM = false) => ({ id, isGM });

describe("viewerIds", () => {
  it("returns non-GM users the predicate accepts, excluding GMs even when visible", () => {
    const users = [user("gm", true), user("a"), user("b")];
    const isVisible = (entry, u) => u.id !== "b";
    expect(viewerIds({ uuid: "e" }, users, isVisible)).toEqual(["a"]);
  });

  it("is empty for a GM-only entry", () => {
    const users = [user("gm", true), user("a")];
    expect(viewerIds({}, users, () => false)).toEqual([]);
  });
});

describe("audienceContains", () => {
  it("true when the page audience is a subset of the target audience", () => {
    expect(audienceContains(["a"], ["a", "b"])).toBe(true);
  });
  it("false when a page viewer cannot see the target", () => {
    expect(audienceContains(["a", "c"], ["a", "b"])).toBe(false);
  });
  it("an empty page audience (GM-only page) accepts any target", () => {
    expect(audienceContains([], [])).toBe(true);
    expect(audienceContains([], ["a"])).toBe(true);
  });
});

describe("audienceViewerIdsForImport", () => {
  const users = [user("gm", true), user("a"), user("b")];
  it("'players' → every non-GM id", () => {
    expect(audienceViewerIdsForImport("players", users)).toEqual(["a", "b"]);
  });
  it("'gm' → empty", () => {
    expect(audienceViewerIdsForImport("gm", users)).toEqual([]);
  });
});

describe("filterCandidatesForAudience", () => {
  it("keeps only candidates whose viewers contain the audience", () => {
    const cands = [
      { name: "Pub", uuid: "u1", viewerIds: ["a", "b"] },
      { name: "Sec", uuid: "u2", viewerIds: [] }
    ];
    expect(filterCandidatesForAudience(cands, ["a"]).map((c) => c.uuid)).toEqual(["u1"]);
    expect(filterCandidatesForAudience(cands, []).map((c) => c.uuid)).toEqual(["u1", "u2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/link-audience.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/link-audience.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/logic/link-audience.mjs
// Pure audience math for auto-link scoping (spec Part 1). The containment
// rule: a mention in page P may link to entity E only if every non-GM user
// who can view P can also view E. "Can view" is injected (isVisibleToUser
// from hub-index.mjs at the call sites) so this stays unit-testable.

/**
 * Non-GM user ids the predicate accepts for this entry.
 * @param {object} entry  a JournalEntry (opaque to this module)
 * @param {{id:string,isGM:boolean}[]} users
 * @param {(entry: object, user: object) => boolean} isVisible
 * @returns {string[]}
 */
export function viewerIds(entry, users, isVisible) {
  return (users ?? []).filter((u) => !u.isGM && isVisible(entry, u)).map((u) => u.id);
}

/** True iff every page viewer can also see the target (empty page audience → true). */
export function audienceContains(pageViewerIds, targetViewerIds) {
  const target = new Set(targetViewerIds ?? []);
  return (pageViewerIds ?? []).every((id) => target.has(id));
}

/** The viewer set an import audience choice implies: "players" → all non-GM ids, else none. */
export function audienceViewerIdsForImport(audience, users) {
  if (audience !== "players") return [];
  return (users ?? []).filter((u) => !u.isGM).map((u) => u.id);
}

/** Candidates ({name, uuid, viewerIds}) whose viewers contain the given audience. */
export function filterCandidatesForAudience(candidates, audienceViewerIds) {
  return (candidates ?? []).filter((c) => audienceContains(audienceViewerIds, c.viewerIds));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/link-audience.test.js` — Expected: PASS (all 8).

- [ ] **Step 5: Run the whole unit suite, then commit**

Run: `npm test` — Expected: no regressions.

```bash
git add scripts/logic/link-audience.mjs test/link-audience.test.js
git commit -m "feat: pure audience-containment module for auto-link scoping"
```

---

### Task 2: Containment + ambiguity on the typing path

**Files:**
- Modify: `scripts/logic/auto-link-candidates.mjs` (add one function; existing `selectCandidates` unchanged)
- Modify: `scripts/hooks/auto-link.mjs` (rewrite `buildCandidates`, add re-entry guard)
- Modify: `scripts/constants.mjs` (add `NO_AUTO_LINK_FLAG`)
- Test: `test/auto-link-candidates.test.js` (append)

**Interfaces:**
- Consumes: `viewerIds`, `audienceContains` from Task 1; `isVisibleToUser` from `scripts/logic/hub-index.mjs`; `selectCandidates` (existing).
- Produces: `dropAmbiguousNames(candidates)` → `{ kept: {name,uuid}[], ambiguousNames: string[] }` where `candidates` is `selectCandidates` output (`{name, uuid}[]`, longest-first) and names are compared `trim().toLowerCase()`; `kept` preserves input order. Task 5 consumes this. `NO_AUTO_LINK_FLAG = "noAutoLink"` exported from `scripts/constants.mjs`; Task 4 consumes it. The typing hook must skip updates where `options?.["mej-campaign-companion"]?.retroLink` is truthy; Task 4 relies on that guard.

- [ ] **Step 1: Write the failing test** — append to `test/auto-link-candidates.test.js`:

```js
import { dropAmbiguousNames } from "../scripts/logic/auto-link-candidates.mjs";

describe("dropAmbiguousNames", () => {
  it("drops every candidate whose normalized name collides; reports each name once", () => {
    const { kept, ambiguousNames } = dropAmbiguousNames([
      { name: "Waterdeep Harbor", uuid: "u1" },
      { name: "Inn", uuid: "u2" },
      { name: "inn ", uuid: "u3" },
      { name: "Sam", uuid: "u4" }
    ]);
    expect(kept).toEqual([
      { name: "Waterdeep Harbor", uuid: "u1" },
      { name: "Sam", uuid: "u4" }
    ]);
    expect(ambiguousNames).toEqual(["Inn"]);
  });

  it("passes a collision-free list through untouched", () => {
    const list = [{ name: "A1b", uuid: "x" }];
    expect(dropAmbiguousNames(list)).toEqual({ kept: list, ambiguousNames: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auto-link-candidates.test.js` — Expected: FAIL, `dropAmbiguousNames` not exported.

- [ ] **Step 3: Implement `dropAmbiguousNames`** — append to `scripts/logic/auto-link-candidates.mjs`:

```js
/**
 * Spec "never guess" rule: a name carried by 2+ candidates that all survived
 * the containment filter is dropped entirely (first occurrence's original
 * name is reported once). Input is selectCandidates() output; order kept.
 * @param {{name:string, uuid:string}[]} candidates
 * @returns {{kept: {name:string, uuid:string}[], ambiguousNames: string[]}}
 */
export function dropAmbiguousNames(candidates) {
  const counts = new Map();
  for (const c of candidates ?? []) {
    const key = c.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kept = [];
  const ambiguousNames = [];
  const reported = new Set();
  for (const c of candidates ?? []) {
    const key = c.name.trim().toLowerCase();
    if (counts.get(key) > 1) {
      if (!reported.has(key)) {
        reported.add(key);
        ambiguousNames.push(c.name.trim());
      }
      continue;
    }
    kept.push(c);
  }
  return { kept, ambiguousNames };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auto-link-candidates.test.js` — Expected: PASS.

- [ ] **Step 5: Add `NO_AUTO_LINK_FLAG` to constants** — in `scripts/constants.mjs`, after the `AUTO_LINK_SETTING` block, add:

```js
/** Page flag: opt this page out of every auto-link path (typing, import, retroactive). */
export const NO_AUTO_LINK_FLAG = "noAutoLink";
```

- [ ] **Step 6: Rewrite the typing hook** — replace the full contents of `scripts/hooks/auto-link.mjs` with:

```js
// scripts/hooks/auto-link.mjs
// Typing-path auto-link. Candidates are bounded by AUDIENCE CONTAINMENT
// (spec Part 1): an entity may link into this page only if every non-GM user
// who can view the page's parent entry can also view the entity. This is
// deliberately stricter than the previous acting-user-visibility rule for
// GMs: typing a GM-only entity's name into a player-visible page no longer
// produces a link players can see but not open. Same-name candidates that
// both pass containment are dropped (never guess) — the typing path has no
// report channel, so the drop is silent here.
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";

/**
 * Linkable candidates for a page: every other MEJ-typed JournalEntry whose
 * viewer set contains the page's parent-entry viewer set. Each candidate's
 * `uuid` is the entry's own Foundry uuid ("JournalEntry.<id>"), which is
 * exactly the @UUID target auto-link.mjs emits.
 */
function buildCandidates(page) {
  const users = game.users.contents;
  const pageViewers = viewerIds(page.parent, users, isVisibleToUser);
  const pages = game.journal
    .filter((entry) => game.MonksEnhancedJournal.getMEJType(entry))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: audienceContains(pageViewers, viewerIds(entry, users, isVisibleToUser))
    }));
  return dropAmbiguousNames(selectCandidates({ pages, selfId: page.parent?.id })).kept;
}

/**
 * On a committed page save, wrap newly-added MEJ entry-name mentions in
 * text.content as @UUID content links.
 *
 * Baseline note: campaign-record anchors its diff baseline to the last full
 * sheet render (tracked separately, set from BaseRecordSheet#_onRender)
 * because its inline-edit fields autosave quietly (`{ render: false }`)
 * between renders, and preUpdateJournalEntryPage skips those quiet saves -
 * so the document's live field value can silently drift past the
 * last-processed state. MEJ's page text.content has no such quiet
 * autosave path: it's only written by an explicit editor "save" commit, which
 * always reaches this hook. So the pre-update `page.text.content` (the
 * content as of the last save that *did* run this hook) is already the
 * correct baseline - no separate baseline tracking is needed here.
 */
export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    try {
      // Retroactive-pass writes are already fully linked (hooks/retro-link.mjs
      // stamps this option) - re-running the diff here would be wasted work.
      if (options?.[MODULE_ID]?.retroLink) return;
      if (!game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) return;
      if (page.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG)) return;
      const next = changes?.text?.content;
      if (next === undefined || typeof next !== "string" || !next) return;

      const candidates = buildCandidates(page);
      if (!candidates.length) return;

      const baseline = page.text?.content ?? "";
      const linked = autoLinkAdded(baseline, next, candidates);
      if (linked !== next) foundry.utils.setProperty(changes, "text.content", linked);
    } catch (err) {
      console.error(`${MODULE_ID} | auto-link failed`, err);
    }
  });
}
```

Note the old local `const NO_AUTO_LINK_FLAG = "noAutoLink";` is gone — it now comes from constants (same string, existing flags unaffected).

- [ ] **Step 7: Run the whole unit suite**

Run: `npm test` — Expected: PASS (the hook file has no unit tests — it touches Foundry globals — but imports must resolve; `npx vitest run` will surface a bad import path via the candidates test file).

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/auto-link-candidates.mjs scripts/hooks/auto-link.mjs scripts/constants.mjs test/auto-link-candidates.test.js
git commit -m "feat: audience-containment candidate filter + ambiguity drop on typing auto-link"
```

---

### Task 3: Retroactive-pass planner (pure)

**Files:**
- Create: `scripts/logic/retro-link.mjs`
- Test: `test/retro-link.test.js`

**Interfaces:**
- Consumes: `autoLinkAdded` from `scripts/logic/auto-link.mjs`; `audienceContains` from Task 1.
- Produces (Task 4 and Task 5 rely on these exact signatures):
  - `countEntityLinks(html, uuid)` → `number` of `@UUID[<uuid>]` occurrences in `html`.
  - `buildRetroPlan({ entity, pages, otherSameNamed, minLength = 3 })` → `{ rows }` where `entity` is `{uuid, name, viewerIds}`, `pages` is `[{uuid, name, content, viewerIds, noAutoLink, isOwn}]`, `otherSameNamed` is `[{viewerIds}]` (same-named MEJ entities other than `entity`), and each row is `{pageUuid, pageName, matchCount, newHtml, ambiguous}` — `newHtml` is `null` when `ambiguous` is true. Pages with no mention produce no row.

- [ ] **Step 1: Write the failing test**

```js
// test/retro-link.test.js
import { describe, it, expect } from "vitest";
import { buildRetroPlan, countEntityLinks } from "../scripts/logic/retro-link.mjs";

const ENTITY = { uuid: "JournalEntry.new1", name: "Gandalf", viewerIds: [] };
const page = (uuid, content, extra = {}) => ({
  uuid, name: `page ${uuid}`, content, viewerIds: [], noAutoLink: false, isOwn: false, ...extra
});

describe("countEntityLinks", () => {
  it("counts @UUID occurrences for exactly that uuid", () => {
    const html = "<p>@UUID[JournalEntry.new1]{Gandalf} and @UUID[JournalEntry.other]{X}</p>";
    expect(countEntityLinks(html, "JournalEntry.new1")).toBe(1);
    expect(countEntityLinks(html, "JournalEntry.none")).toBe(0);
  });
});

describe("buildRetroPlan", () => {
  it("links plain mentions in contained pages and counts matches", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>Gandalf arrives. Gandalf smokes.</p>")],
      otherSameNamed: []
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pageUuid).toBe("p1");
    expect(rows[0].matchCount).toBe(2);
    expect(rows[0].ambiguous).toBe(false);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.new1]{Gandalf}");
  });

  it("skips pages without a mention, own pages, noAutoLink pages, and empty content", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [
        page("p1", "<p>No mention here.</p>"),
        page("p2", "<p>Gandalf</p>", { isOwn: true }),
        page("p3", "<p>Gandalf</p>", { noAutoLink: true }),
        page("p4", "")
      ],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });

  it("enforces containment: a page with a viewer outside the entity's set is skipped", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, viewerIds: ["a"] },
      pages: [
        page("gmOnly", "<p>Gandalf</p>", { viewerIds: [] }),
        page("playerPage", "<p>Gandalf</p>", { viewerIds: ["a", "b"] })
      ],
      otherSameNamed: []
    });
    expect(rows.map((r) => r.pageUuid)).toEqual(["gmOnly"]);
  });

  it("marks a page ambiguous (newHtml null) when a same-named entity also passes containment there", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      otherSameNamed: [{ viewerIds: ["a", "b"] }]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].ambiguous).toBe(true);
    expect(rows[0].newHtml).toBeNull();
    expect(rows[0].matchCount).toBe(1);
  });

  it("does not mark ambiguous when the same-named twin fails containment for that page", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, viewerIds: ["a"] },
      pages: [page("p1", "<p>Gandalf</p>", { viewerIds: ["a"] })],
      otherSameNamed: [{ viewerIds: [] }]
    });
    expect(rows[0].ambiguous).toBe(false);
    expect(rows[0].newHtml).toContain("@UUID[");
  });

  it("returns no rows for names under the length floor", () => {
    const { rows } = buildRetroPlan({
      entity: { ...ENTITY, name: "Ok" },
      pages: [page("p1", "<p>Ok then.</p>")],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });

  it("never links inside an existing @UUID link", () => {
    const { rows } = buildRetroPlan({
      entity: ENTITY,
      pages: [page("p1", "<p>@UUID[JournalEntry.old]{Gandalf}</p>")],
      otherSameNamed: []
    });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/retro-link.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```js
// scripts/logic/retro-link.mjs
// Pure planner for the retroactive auto-link pass (spec Part 2): given a
// newly-created entity and descriptors for every text page in the world,
// produce the per-page write plan. Matching reuses autoLinkAdded with an
// EMPTY baseline — the LCS diff then marks every word as "added", so the
// proven tokenizer/claiming engine does whole-document linking and existing
// links/<code>/<pre> stay opaque. No Foundry globals here.
import { autoLinkAdded } from "./auto-link.mjs";
import { audienceContains } from "./link-audience.mjs";

/** Occurrences of `@UUID[<uuid>]` in html (uuid taken literally, not as a pattern). */
export function countEntityLinks(html, uuid) {
  const needle = `@UUID[${uuid}]`;
  let count = 0;
  let i = 0;
  while ((i = (html ?? "").indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

/**
 * @param {object} args
 * @param {{uuid:string, name:string, viewerIds:string[]}} args.entity  the new entity
 * @param {{uuid:string, name:string, content:string, viewerIds:string[],
 *          noAutoLink:boolean, isOwn:boolean}[]} args.pages  every text page
 *          (viewerIds = the page's PARENT ENTRY viewer set)
 * @param {{viewerIds:string[]}[]} args.otherSameNamed  other entities whose
 *          trimmed, lowercased name equals the entity's
 * @param {number} [args.minLength=3]
 * @returns {{rows: {pageUuid:string, pageName:string, matchCount:number,
 *            newHtml:string|null, ambiguous:boolean}[]}}
 */
export function buildRetroPlan({ entity, pages, otherSameNamed, minLength = 3 }) {
  const rows = [];
  if ((entity.name?.trim().length ?? 0) < minLength) return { rows };
  const candidate = [{ name: entity.name, uuid: entity.uuid }];
  for (const page of pages ?? []) {
    if (page.isOwn || page.noAutoLink) continue;
    if (typeof page.content !== "string" || !page.content) continue;
    if (!audienceContains(page.viewerIds, entity.viewerIds)) continue;
    const linked = autoLinkAdded("", page.content, candidate);
    if (linked === page.content) continue;
    const matchCount =
      countEntityLinks(linked, entity.uuid) - countEntityLinks(page.content, entity.uuid);
    const ambiguous = (otherSameNamed ?? []).some((o) =>
      audienceContains(page.viewerIds, o.viewerIds)
    );
    rows.push({
      pageUuid: page.uuid,
      pageName: page.name,
      matchCount,
      newHtml: ambiguous ? null : linked,
      ambiguous
    });
  }
  return { rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/retro-link.test.js` — Expected: PASS (8 tests).

- [ ] **Step 5: Run the whole unit suite, then commit**

Run: `npm test` — Expected: no regressions.

```bash
git add scripts/logic/retro-link.mjs test/retro-link.test.js
git commit -m "feat: pure retroactive auto-link planner"
```

---

### Task 4: Retroactive hooks — setting, stamping, GM processing, dialog, whisper, sweep

**Files:**
- Create: `scripts/hooks/retro-link.mjs`
- Modify: `scripts/constants.mjs` (two constants)
- Modify: `scripts/campaign-companion.mjs` (setting registration + hook wiring)
- Modify: `lang/en.json` (settings + dialog/whisper strings)
- Modify: `styles/campaign-companion.css` (dialog rows)

No unit tests in this task — every function touches Foundry globals; the pure logic it calls was tested in Tasks 1–3, and Task 6's e2e drives this file end to end.

**Interfaces:**
- Consumes: `buildRetroPlan` (Task 3), `viewerIds` (Task 1), `isVisibleToUser` (`logic/hub-index.mjs`), `NO_AUTO_LINK_FLAG` (Task 2), `fromUuid`, `game.users.activeGM`.
- Produces: `registerRetroLink()` (called once from `campaign-companion.mjs`); constants `RETRO_LINK_MODE_SETTING = "retroLinkMode"`, `RETRO_LINK_PENDING_FLAG = "retroLinkPending"`. Page writes carry `options["mej-campaign-companion"].retroLink = true` (Task 2's guard).

- [ ] **Step 1: Add constants** — in `scripts/constants.mjs`, after the `NO_AUTO_LINK_FLAG` block:

```js
/** World setting: retroactive auto-link mode for newly-created MEJ entities ("off" | "confirm" | "silent"). */
export const RETRO_LINK_MODE_SETTING = "retroLinkMode";

/** JournalEntry flag: stamped at creation, processed (and cleared) by the active GM's retro-link pass. */
export const RETRO_LINK_PENDING_FLAG = "retroLinkPending";
```

- [ ] **Step 2: Write the hook module**

```js
// scripts/hooks/retro-link.mjs
// Retroactive auto-link pass (spec Part 2). The creating client stamps
// flags[MODULE_ID].retroLinkPending on every new MEJ-typed JournalEntry
// (preCreateJournalEntry fires locally only, and a creator always owns the
// document they just made — this is the "catch-up queue": no world-setting
// write, so players can enqueue too). The ACTIVE GM's client processes and
// clears the flag, either immediately (createJournalEntry broadcast) or at
// login (ready sweep) for entities created while no GM was connected.
import { buildRetroPlan } from "../logic/retro-link.mjs";
import { viewerIds } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import {
  MODULE_ID, I18N, RETRO_LINK_MODE_SETTING, RETRO_LINK_PENDING_FLAG, NO_AUTO_LINK_FLAG
} from "../constants.mjs";

/**
 * MEJ's own New Entry dialog creates the entry FIRST (with
 * flags["monks-enhanced-journal"].pagetype) and its _onCreate patch adds the
 * typed page afterward — so at preCreate time getMEJType(entry) can still be
 * false for a dialog-created entry. Check both the constructed document and
 * the raw entry-level MEJ flags.
 */
function isMejCandidate(entry) {
  if (game.MonksEnhancedJournal?.getMEJType?.(entry)) return true;
  const mejFlags = entry.flags?.["monks-enhanced-journal"];
  return !!(mejFlags?.pagetype || mejFlags?.type);
}

function planForEntity(entry) {
  const users = game.users.contents;
  const entityViewers = viewerIds(entry, users, isVisibleToUser);
  const norm = entry.name.trim().toLowerCase();
  const otherSameNamed = game.journal
    .filter((e) =>
      e.id !== entry.id &&
      game.MonksEnhancedJournal.getMEJType(e) &&
      e.name.trim().toLowerCase() === norm)
    .map((e) => ({ viewerIds: viewerIds(e, users, isVisibleToUser) }));
  const pages = [];
  for (const e of game.journal.contents) {
    const entryViewers = viewerIds(e, users, isVisibleToUser);
    for (const p of e.pages.contents) {
      const content = p.text?.content;
      if (typeof content !== "string" || !content) continue;
      pages.push({
        uuid: p.uuid,
        name: e.name === p.name ? e.name : `${e.name}: ${p.name}`,
        content,
        viewerIds: entryViewers,
        noAutoLink: !!p.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG),
        isOwn: e.id === entry.id
      });
    }
  }
  return buildRetroPlan({
    entity: { uuid: entry.uuid, name: entry.name, viewerIds: entityViewers },
    pages,
    otherSameNamed
  });
}

/** Returns the writable rows the GM checked, or null on cancel/skip. */
async function confirmDialog(entry, writable, ambiguous) {
  const esc = foundry.utils.escapeHTML;
  const rowsHtml = writable.map((r, i) =>
    `<label class="mej-cc-retro-row"><input type="checkbox" name="row-${i}" checked> `
    + `${esc(r.pageName)} (${r.matchCount})</label>`
  ).join("");
  const ambHtml = ambiguous.length
    ? `<p>${game.i18n.localize(`${I18N}.retroLink.ambiguous`)}</p>`
      + `<ul>${ambiguous.map((r) => `<li>${esc(r.pageName)}</li>`).join("")}</ul>`
    : "";
  const content = `<div class="mej-cc-retro-link">`
    + `<p>${game.i18n.format(`${I18N}.retroLink.intro`, { name: esc(entry.name) })}</p>`
    + rowsHtml + ambHtml + `</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.retroLink.title`) },
    classes: ["mej-cc-retro-link-dialog"],
    content,
    buttons: [
      { action: "skip", label: `${I18N}.retroLink.skip` },
      {
        action: "apply", label: `${I18N}.retroLink.apply`, default: true,
        callback: (event, button) => [...button.form.elements]
          .filter((el) => el.name?.startsWith("row-") && el.checked)
          .map((el) => Number(el.name.slice(4)))
      }
    ],
    rejectClose: false
  });
  return Array.isArray(result) ? result.map((i) => writable[i]) : null;
}

async function whisperSummary(entry, applied, ambiguous) {
  const esc = foundry.utils.escapeHTML;
  const parts = [
    `<p>${game.i18n.format(`${I18N}.retroLink.summary`, { name: esc(entry.name), count: applied.length })}</p>`
  ];
  if (applied.length) {
    parts.push(`<ul>${applied.map((r) => `<li>${esc(r.pageName)} (${r.matchCount})</li>`).join("")}</ul>`);
  }
  if (ambiguous.length) {
    parts.push(`<p>${game.i18n.localize(`${I18N}.retroLink.ambiguous`)}</p>`
      + `<ul>${ambiguous.map((r) => `<li>${esc(r.pageName)}</li>`).join("")}</ul>`);
  }
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: parts.join("")
  });
}

async function processPendingEntity(entry) {
  try {
    // Clear first: a reload mid-dialog must not replay the pass forever.
    await entry.unsetFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG);
    const mode = game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING);
    if (mode === "off") return;
    const { rows } = planForEntity(entry);
    if (!rows.length) return;
    const writable = rows.filter((r) => !r.ambiguous);
    const ambiguous = rows.filter((r) => r.ambiguous);
    let chosen = writable;
    if (mode === "confirm") {
      chosen = await confirmDialog(entry, writable, ambiguous);
      if (!chosen) return;
    }
    const applied = [];
    for (const row of chosen) {
      try {
        const pageDoc = await fromUuid(row.pageUuid);
        if (!pageDoc) continue;
        await pageDoc.update({ "text.content": row.newHtml }, { [MODULE_ID]: { retroLink: true } });
        applied.push(row);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link write failed for ${row.pageUuid}`, err);
      }
    }
    if (mode === "silent") await whisperSummary(entry, applied, ambiguous);
  } catch (err) {
    console.error(`${MODULE_ID} | retro-link failed for "${entry?.name}"`, err);
  }
}

export function registerRetroLink() {
  Hooks.on("preCreateJournalEntry", (entry) => {
    try {
      if (game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING) === "off") return;
      if (!isMejCandidate(entry)) return;
      entry.updateSource({ [`flags.${MODULE_ID}.${RETRO_LINK_PENDING_FLAG}`]: true });
    } catch (err) {
      console.error(`${MODULE_ID} | retro-link stamp failed`, err);
    }
  });

  Hooks.on("createJournalEntry", async (entry) => {
    if (game.users.activeGM !== game.user) return;
    if (!entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) return;
    await processPendingEntity(entry);
  });

  // Catch-up sweep: entities created while no GM was connected still carry
  // the pending flag; process them (sequentially — one dialog at a time in
  // confirm mode) once a GM logs in.
  Hooks.once("ready", async () => {
    if (game.users.activeGM !== game.user) return;
    for (const entry of game.journal.contents) {
      try {
        if (entry.getFlag(MODULE_ID, RETRO_LINK_PENDING_FLAG)) await processPendingEntity(entry);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link sweep failed for "${entry?.name}"`, err);
      }
    }
  });
}
```

- [ ] **Step 3: Register the setting and the hooks** — in `scripts/campaign-companion.mjs`:

1. Extend the constants import with `RETRO_LINK_MODE_SETTING`.
2. Add a static import next to `registerAutoLink`: `import { registerRetroLink } from "./hooks/retro-link.mjs";` (retro-link.mjs statically imports only companion logic — no MEJ files — so the alphabetical-load-order hazard documented for SessionSheet does not apply).
3. In the `init` block, after the `AUTO_LINK_SETTING` registration:

```js
  game.settings.register(MODULE_ID, RETRO_LINK_MODE_SETTING, {
    name: `${I18N}.settings.retroLinkMode.name`,
    hint: `${I18N}.settings.retroLinkMode.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: `${I18N}.settings.retroLinkMode.off`,
      confirm: `${I18N}.settings.retroLinkMode.confirm`,
      silent: `${I18N}.settings.retroLinkMode.silent`
    },
    default: "confirm"
  });
```

4. In the `setupMonksEnhancedJournal` handler, directly after the `registerAutoLink();` call:

```js
    // Retroactive auto-link pass for newly-created MEJ entities (gated on
    // the "retroLinkMode" world setting, checked inside the hooks).
    registerRetroLink();
```

(Inside the setup handler because both `isMejCandidate` and `planForEntity` need `game.MonksEnhancedJournal.getMEJType`.)

- [ ] **Step 4: Add the strings** — in `lang/en.json`, inside `MEJCampaignCompanion.settings` add:

```json
"retroLinkMode": {
  "name": "Retroactive Auto-Link",
  "hint": "When a new Enhanced Journal entry is created, link existing plain-text mentions of its name across the journal (audience-scoped). Confirm shows a review dialog to the GM; Silent writes immediately and whispers a summary.",
  "off": "Off",
  "confirm": "Confirm (review dialog)",
  "silent": "Silent (whisper summary)"
}
```

and as a new top-level section inside `MEJCampaignCompanion` (sibling of `settings`):

```json
"retroLink": {
  "title": "Auto-Link New Entry",
  "intro": "\"{name}\" is mentioned in the pages below. Link the checked pages?",
  "apply": "Link Checked",
  "skip": "Skip",
  "ambiguous": "Skipped as ambiguous (another entity shares this name):",
  "summary": "Auto-linked \"{name}\" in {count} page(s)."
}
```

- [ ] **Step 5: Dialog styling** — append to `styles/campaign-companion.css`:

```css
/* Retroactive auto-link confirm dialog */
.mej-cc-retro-link .mej-cc-retro-row { display: block; margin: 2px 0; }
.mej-cc-retro-link ul { margin: 4px 0 0 0; }
```

- [ ] **Step 6: Sanity checks, then commit**

Run: `npm test` (no regressions) and `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); console.log('json ok')"` — Expected: both clean.

```bash
git add scripts/hooks/retro-link.mjs scripts/constants.mjs scripts/campaign-companion.mjs lang/en.json styles/campaign-companion.css
git commit -m "feat: GM-side retroactive auto-link pass with confirm/silent modes and pending-flag catch-up"
```

---

### Task 5: Import wizard — audience select, ownership, import-time linking

**Files:**
- Modify: `scripts/data/mej-entry.mjs` (optional `ownership` param)
- Modify: `scripts/apps/import-wizard.mjs`
- Modify: `templates/import-wizard.hbs`
- Modify: `lang/en.json` (import strings)

No new unit tests — the pure pieces (`audienceViewerIdsForImport`, `filterCandidatesForAudience`, `dropAmbiguousNames`, `autoLinkAdded`, `countEntityLinks`) are covered by Tasks 1–3; this task is Foundry glue, verified by Task 6's e2e.

**Interfaces:**
- Consumes: everything listed in the previous sentence, plus `viewerIds`, `isVisibleToUser`, `AUTO_LINK_SETTING`.
- Produces: `createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null)` — 5th param, `null` keeps today's behavior exactly. Wizard review form gains `<select name="audience">` with values `"gm"` (default) / `"players"`.

- [ ] **Step 1: Extend `createMejEntry`** — in `scripts/data/mej-entry.mjs`, change the signature and entry data:

```js
export async function createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null) {
```

and in the `JournalEntry.create` payload add, directly after `name,`:

```js
    ...(ownership ? { ownership } : {}),
```

Update the JSDoc with `@param {object|null} [ownership] entry-level ownership record (e.g. { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }); null → Foundry default`.

- [ ] **Step 2: Template** — in `templates/import-wizard.hbs`, immediately after the opening `<form class="mej-cc-import-review">` tag, add:

```hbs
    <div class="form-group mej-cc-import-audience">
      <label>{{localize "MEJCampaignCompanion.import.audience"}}</label>
      <select name="audience">
        <option value="gm">{{localize "MEJCampaignCompanion.import.audienceGm"}}</option>
        <option value="players">{{localize "MEJCampaignCompanion.import.audiencePlayers"}}</option>
      </select>
      <p class="hint">{{localize "MEJCampaignCompanion.import.audienceHint"}}</p>
    </div>
```

- [ ] **Step 3: Strings** — in `lang/en.json`, inside the existing `MEJCampaignCompanion.import` section add:

```json
"audience": "Audience",
"audienceGm": "GM only",
"audiencePlayers": "All players (Observer)",
"audienceHint": "Sets ownership of the created entries and bounds which entities the imported text may auto-link to.",
"ambiguousSkipped": "Ambiguous name not auto-linked (multiple entities share it): {name}",
"linked": "{count} name mention(s) auto-linked."
```

- [ ] **Step 4: Wizard changes** — in `scripts/apps/import-wizard.mjs`:

1. Extend imports:

```js
import { MODULE_ID, I18N, COMPANION_IMPORT_TYPES, AUTO_LINK_SETTING } from "../constants.mjs";
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { countEntityLinks } from "../logic/retro-link.mjs";
import { dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceViewerIdsForImport, filterCandidatesForAudience } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
```

(keep every existing import; only the constants line changes shape).

2. Add two instance methods (after `#formRows()`):

```js
  /** The whole-import audience choice from the review form ("gm" default). */
  #formAudience() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    return form?.elements.audience?.value === "players" ? "players" : "gm";
  }

  /**
   * Import-time link candidates, bounded by containment against the chosen
   * audience (spec: links are validated against the audience the created
   * entries will actually have). Ambiguous names are dropped and reported
   * into the wizard's warnings list (shown in the result dialog).
   */
  #linkCandidates(audience, warnings) {
    const users = game.users.contents;
    const audienceViewers = audienceViewerIdsForImport(audience, users);
    const all = game.journal
      .filter((e) => game.MonksEnhancedJournal.getMEJType(e))
      .map((e) => ({ name: e.name, uuid: e.uuid, viewerIds: viewerIds(e, users, isVisibleToUser) }));
    const contained = filterCandidatesForAudience(all, audienceViewers)
      .filter((c) => (c.name?.trim().length ?? 0) >= 3)
      .map((c) => ({ name: c.name, uuid: c.uuid }))
      .sort((a, b) => b.name.length - a.name.length);
    const { kept, ambiguousNames } = dropAmbiguousNames(contained);
    for (const n of ambiguousNames) {
      warnings.push(game.i18n.format(`${I18N}.import.ambiguousSkipped`, { name: n }));
    }
    return kept;
  }
```

3. In `#onCreate`, after the `if (!plan.pages.length)` guard and before `target.disabled = true;`, add:

```js
    const audience = this.#formAudience();
    const ownership = audience === "players"
      ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      : null;
    // Import-time auto-link (spec Part 2): same engine as the typing path,
    // empty baseline = whole document eligible. Gated on the same autoLink
    // world setting; failure never blocks the import (observer posture).
    let linkedCount = 0;
    if (game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) {
      try {
        const candidates = this.#linkCandidates(audience, plan.warnings);
        if (candidates.length) {
          for (const page of plan.pages) {
            const linked = autoLinkAdded("", page.html, candidates);
            if (linked !== page.html) {
              linkedCount += candidates.reduce(
                (n, c) => n + countEntityLinks(linked, c.uuid) - countEntityLinks(page.html, c.uuid), 0);
              page.html = linked;
            }
          }
        }
      } catch (error) {
        console.error(`${MODULE_ID} | import auto-link failed`, error);
      }
    }
```

4. Thread ownership into creation: change the `#createPage` signature to `async #createPage(page, campaignDate, ownership)` and, in each of its two `JournalEntry.create({...})` payloads, add `...(ownership ? { ownership } : {}),` directly after `name: page.name,`; change its final line to `return createMejEntry(page.type, page.name, page.html, {}, ownership);`. Update the one call site to `await this.#createPage(page, campaignDate, ownership);`.

5. Surface the link count: change the `#showResult` call to `await ImportWizard.#showResult(results, plan.warnings, linkedCount);`, the signature to `static async #showResult(results, warnings, linkedCount = 0)`, and after the first `parts` entry add:

```js
    if (linkedCount) {
      parts.push(`<p>${game.i18n.format(`${I18N}.import.linked`, { count: linkedCount })}</p>`);
    }
```

Note the retroactive pass composes automatically: each imported entry is a new MEJ entity, so Task 4's preCreate stamp fires for it and the GM (who is running the import) processes it — the imported entry's *name* also gets linked across existing pages. No extra wiring needed. In `confirm` mode a multi-section import can therefore surface several sequential dialogs; that is accepted spec behavior (the GM can set `retroLinkMode` to `off`/`silent` before bulk imports).

- [ ] **Step 5: Sanity checks, then commit**

Run: `npm test` and the JSON check from Task 4 Step 6 — Expected: clean.

```bash
git add scripts/data/mej-entry.mjs scripts/apps/import-wizard.mjs templates/import-wizard.hbs lang/en.json
git commit -m "feat: import wizard audience select, ownership threading, and import-time auto-link"
```

---

### Task 6: E2e coverage

**Files:**
- Create: `tests/e2e/11-auto-link-scope.spec.mjs`

**Interfaces:**
- Consumes: helpers from `tests/e2e/helpers/foundry.mjs` (`login`, `cleanupAsGm`, `trackConsoleErrors`, `assertNoConsoleErrors`, `settle`, `KNOWN_MEJ_SESSION_ICON_404`), the deployed module in the v14 test world (deploy via the harness's existing global-setup — run like every other spec), Tasks 2/4/5 behavior.
- Produces: nothing downstream.

Before writing, read `tests/e2e/09-secrets.spec.mjs` and `05-docx-import.spec.mjs` once for the login/cleanup idioms mirrored below (run-unique needles, `cleanupAsGm`, no swallowed cleanup errors).

- [ ] **Step 1: Write the spec**

```js
// tests/e2e/11-auto-link-scope.spec.mjs
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
// Run-unique, single-token names (WORD_RE treats hyphenless alnum runs as one
// word): stale documents/chat from an earlier failed run can never satisfy
// this run's assertions (same lesson as 09-secrets' SECRET_TEXT).
const RUN = Date.now();
const N = {
  gmPage: `TTRetroGmPage${RUN}`,
  playerPage: `TTRetroPlayerPage${RUN}`,
  hero: `TTRetroHero${RUN}`,
  silentPage: `TTSilentPage${RUN}`,
  villain: `TTSilentVillain${RUN}`,
  gmSecret: `TTGmSecret${RUN}`,
  pubAlly: `TTPubAlly${RUN}`,
  typedPage: `TTTypedPage${RUN}`
};

/** Create a MEJ place entry (native text page + MEJ type flag), returning ids. */
async function createMejPlace(page, name, html, ownershipDefault) {
  return page.evaluate(async ({ n, html, own }) => {
    const entry = await JournalEntry.create({
      name: n,
      ownership: { default: own },
      pages: [{
        name: n, type: "text",
        flags: { "monks-enhanced-journal": { type: "place" } },
        text: { content: html }
      }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html, own: ownershipDefault });
}

async function setSettings(page, { autoLink, retroLinkMode }) {
  await page.evaluate(async ({ autoLink, retroLinkMode }) => {
    if (autoLink !== undefined) await game.settings.set("mej-campaign-companion", "autoLink", autoLink);
    if (retroLinkMode !== undefined) await game.settings.set("mej-campaign-companion", "retroLinkMode", retroLinkMode);
  }, { autoLink, retroLinkMode });
}

async function pageContent(page, entryId) {
  return page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", entryId);
}

async function cleanup(gmPage) {
  await gmPage.evaluate(async (run) => {
    const ids = game.journal.filter((j) => j.name?.includes(String(run))).map((j) => j.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const msgs = game.messages.filter((m) => m.content?.includes(String(run))).map((m) => m.id);
    if (msgs.length) await ChatMessage.implementation.deleteDocuments(msgs);
    await game.settings.set("mej-campaign-companion", "autoLink", false);
    await game.settings.set("mej-campaign-companion", "retroLinkMode", "confirm");
  }, RUN);
}

test.describe("11 auto-link scoping", () => {
  test.afterEach(async ({ page, browser }) => {
    try {
      await cleanupAsGm(page, browser, (gmPage) => cleanup(gmPage));
    } catch (error) {
      console.error("11-auto-link-scope cleanup failed:", error);
      throw error;
    }
  });

  test("retroactive confirm: GM page linked via dialog, player-visible page excluded", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Setup docs with the pass disabled so their own creation can't trigger dialogs.
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    // Ownership levels are passed as plain numbers (0 = NONE, 2 = OBSERVER):
    // CONST only exists inside the browser context, not in Node test scope.
    const gmDoc = await createMejPlace(page, N.gmPage,
      `<p>Meet ${N.hero} at the gate.</p>`, 0);
    const playerDoc = await createMejPlace(page, N.playerPage,
      `<p>Meet ${N.hero} at the gate.</p>`, 2);

    await setSettings(page, { retroLinkMode: "confirm" });
    // Creating the entity triggers the pass on this (GM) client.
    const hero = await createMejPlace(page, N.hero, "<p>A hero.</p>", 0);

    const dialog = page.locator(".mej-cc-retro-link-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(N.gmPage);
    await expect(dialog).not.toContainText(N.playerPage);
    await dialog.locator('button[data-action="apply"]').click();
    await settle(page, 500);

    expect(await pageContent(page, gmDoc.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    expect(await pageContent(page, playerDoc.id)).not.toContain("@UUID[");
    assertNoConsoleErrors(errors);
  });

  test("retroactive silent: links written and GM whisper summary sent", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const mention = await createMejPlace(page, N.silentPage, `<p>${N.villain} was here.</p>`, 0);
    await setSettings(page, { retroLinkMode: "silent" });
    const villain = await createMejPlace(page, N.villain, "<p>A villain.</p>", 0);
    await settle(page, 1500);

    expect(await pageContent(page, mention.id)).toContain(`@UUID[JournalEntry.${villain.id}]`);
    const whisper = await page.evaluate((needle) =>
      game.messages.some((m) => m.whisper?.length && m.content?.includes(needle)), N.villain);
    expect(whisper).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("typing path: GM typing into a player-visible page links only player-visible entities", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: true, retroLinkMode: "off" });
    const secret = await createMejPlace(page, N.gmSecret, "<p>gm only</p>", 0);
    const ally = await createMejPlace(page, N.pubAlly, "<p>public</p>", 2);
    const typed = await createMejPlace(page, N.typedPage, "<p>start</p>", 2);

    await page.evaluate(async ({ id, html }) => {
      const p = game.journal.get(id).pages.contents[0];
      await p.update({ "text.content": html });
    }, { id: typed.id, html: `<p>start ${N.gmSecret} and ${N.pubAlly}</p>` });
    await settle(page, 500);

    const content = await pageContent(page, typed.id);
    expect(content).toContain(`@UUID[JournalEntry.${ally.id}]`);
    expect(content).not.toContain(`@UUID[JournalEntry.${secret.id}]`);
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/e2e/11-auto-link-scope.spec.mjs`
Expected: 3 passed. If the harness needs the module redeployed to the test world first, follow the existing flow (`tests/e2e/helpers/deploy.mjs` runs from global-setup — same as every other spec; no manual step).

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e` — Expected: no regressions (06-player-collab has a known full-suite flake; re-run it isolated if it is the only failure).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/11-auto-link-scope.spec.mjs
git commit -m "test: e2e coverage for auto-link audience scoping (retro confirm/silent, typing containment)"
```

---

### Task 7: Docs and version

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `module.json`

**Interfaces:** consumes the shipped behavior of Tasks 1–6; produces nothing downstream.

- [ ] **Step 1: module.json** — set `"version": "0.4.0"` (the release script rewrites manifest/download URLs at build time; only the version field changes here).

- [ ] **Step 2: README** — add a subsection under the existing auto-link documentation titled **"Auto-link scoping"** containing exactly these points (prose, not this list verbatim):
  - The containment rule: a mention links to an entity only when everyone who can view the page can also view the entity (evaluated at the JournalEntry level via ownership, threshold LIMITED); GMs excepted.
  - New paths: docx import links imported text at creation (gated on the Auto-Link setting; the wizard's Audience choice sets created-entry ownership and bounds link targets), and the Retroactive Auto-Link setting (off/confirm/silent, default confirm) links existing mentions of a newly-created entity's name from the active GM's client — entities created while no GM is online are processed when a GM next connects.
  - Ambiguity: names shared by multiple in-audience entities are never auto-linked (reported in the dialog/summary/import warnings).
  - Caveat (mirrors the Phase C caveat style): links are validated when written; changing permissions afterward does not add or remove existing links.
  - The per-page `noAutoLink` flag opts a page out of every path.

- [ ] **Step 3: CHANGELOG** — add:

```markdown
## 0.4.0 (2026-08-16)

- Auto-linking is now bounded by audience containment on every path: a name only links to an entity when everyone who can view the page can also view the entity.
- Docx import auto-links imported text at creation; new Audience choice in the import wizard sets created-entry ownership and bounds link targets.
- New Retroactive Auto-Link world setting (off/confirm/silent): creating an MEJ entity links existing plain-text mentions of its name, with a GM review dialog or whispered summary; entities created while no GM is online are processed at next GM login.
- Ambiguous names (shared by multiple in-audience entities) are never auto-linked; they are reported instead.
```

- [ ] **Step 4: Final check + commit**

Run: `npm test` — Expected: full unit suite green.

```bash
git add README.md CHANGELOG.md module.json
git commit -m "docs: auto-link scoping docs; bump to 0.4.0"
```
