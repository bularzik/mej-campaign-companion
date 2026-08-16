# Phase C Secrets Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-player/group secret reveal across MEJ journals — block-level secrets, relationship reveals with graph labels, a GM secrets tracker, and a session prep board — shipping as `mej-campaign-companion` 0.3.0.

**Architecture:** One pure reveal engine (`reveal-state.mjs`, audience records `{users, groups, all, revealedAt}` with live group membership) consumed by every feature. Reveal state lives in companion flags on the owning JournalEntry, keyed by native secret-section ids / MEJ relationship ids. Render-time filtering rides the same hooks as the Phase B knowledge panel; the scan pipeline extracts secret blocks into `record.meta.secrets` for the GM tracker and prep board.

**Tech Stack:** Foundry v14 (ApplicationV2/HandlebarsApplicationMixin, DialogV2), MEJ extension API (already consumed), vitest, Playwright.

## Global Constraints

(from spec §2 — every task implicitly includes these)

- **Zero MEJ changes.** No new MEJ API surface, no libWrapper, no patches to MEJ files. Injection uses `renderJournalPageSheet` (shell) + `renderEnhancedJournalSheet` (popped out); updates use `updateJournalEntry`/`deleteJournalEntry`.
- **No circular imports:** never statically import `/modules/monks-enhanced-journal/...` from any module reachable from `campaign-companion.mjs`'s static import graph. MEJ imports only inside modules that are exclusively dynamic-imported in the `setupMonksEnhancedJournal` handler (`SessionSheet.mjs` and `CampaignHubPage.mjs` already are).
- **Soft-hidden trust model:** hiding is client-side filtering; never claim server-enforced secrecy in UI or docs.
- **One audience semantics:** only `reveal-state.mjs` implements membership logic. No feature re-implements `canSee`.
- **GM-only writes:** reveal state is written by GM clients only; UI never rendered for players; every action handler re-checks `game.user.isGM`. No new socket message types.
- **Reveal always whispers** the recipients (block, checklist, relationship); un-reveal is silent.
- Pure logic lives in `scripts/logic/` (Foundry-free, vitest-loadable — no `game`, no `foundry.*`, no `Date.now()` defaults). Foundry glue lives in `scripts/hooks/`, `scripts/apps/`, `scripts/sheets/`.
- All flag writes use `MODULE_ID` = `"mej-campaign-companion"`; i18n prefix `I18N` = `"MEJCampaignCompanion"` (both from `scripts/constants.mjs`).
- MEJ's shell never calls `_onRender` for hosted subsheets: DOM listeners bind in `activateListeners`/injection code. Shell re-render after companion flag writes needs the explicit `shell.render({tempOwnership, reload: true})` pattern (see `scripts/hooks/knowledge-ui.mjs:83-90`).
- Run unit tests with `npm test` (vitest); all 408 existing tests must stay green after every task.

## File Structure

New pure logic (vitest-covered):
- `scripts/logic/reveal-state.mjs` — audience records + `canSee` + prune + recipient resolution
- `scripts/logic/player-groups.mjs` — named group list normalization/CRUD
- `scripts/logic/secret-blocks.mjs` — secret-section extraction from HTML + export stripping
- `scripts/logic/rel-reveals.mjs` — per-viewer relationship row/secret visibility
- `scripts/logic/secrets-tracker.mjs` — tracker row filtering ("what does X know")

New Foundry glue:
- `scripts/apps/audience-dialog.mjs` — shared reveal dialog (players/groups/everyone)
- `scripts/hooks/secrets-ui.mjs` — GM block-secret overlay, player re-enrichment, whisper, live update
- `scripts/hooks/relationships-ui.mjs` — relationship audience buttons + player row injection
- `scripts/apps/prep-board-app.mjs` + `templates/prep-board.hbs` — session prep board

Modified:
- `scripts/constants.mjs` (+`PLAYER_GROUPS_SETTING`), `scripts/campaign-companion.mjs` (setting, registrations, prep-board header button)
- `scripts/search/live-index.mjs` (`meta.secrets`, `outboundRefsForEntry`, `gmSecretRecords`)
- `scripts/logic/graph-data.mjs` + `scripts/apps/graph-app.mjs` + `templates/graph.hbs` (edge labels)
- `scripts/sheets/SessionSheet.mjs` + `templates/session.hbs` (checklist audiences)
- `scripts/apps/CampaignHubPage.mjs` + `templates/hub.hbs` (Secrets tab + group management)
- `scripts/logic/doc-export-snapshot.mjs` (secret stripping on export)
- `lang/en.json`, `styles/campaign-companion.css`, `module.json`, `README.md`, `CHANGELOG.md`

---

### Task 1: Reveal engine (`reveal-state.mjs`)

**Files:**
- Create: `scripts/logic/reveal-state.mjs`
- Test: `test/reveal-state.test.js`

**Interfaces:**
- Consumes: nothing (pure, dependency-free).
- Produces (used by Tasks 5–12):
  - `normalizeAudience(raw) -> {users: string[], groups: string[], all: boolean, revealedAt: number|null}`
  - `canSee(audience, userId, groups) -> boolean` (groups = `[{id, name, members}]`, live membership)
  - `isRevealed(audience) -> boolean` (any target at all)
  - `toggleUser(audience, userId, revealedAt)`, `toggleGroup(audience, groupId, revealedAt)`, `setAll(audience, all, revealedAt)` — immutable helpers
  - `resolveRecipients(audience, groups) -> string[]` (unique userIds, for whispers)
  - `pruneReveals(revealMap, liveIds) -> {map, changed}` (drop records whose key ∉ liveIds)

- [ ] **Step 1: Write the failing tests**

```js
// test/reveal-state.test.js
import { describe, it, expect } from "vitest";
import {
  normalizeAudience, canSee, isRevealed, toggleUser, toggleGroup, setAll,
  resolveRecipients, pruneReveals
} from "../scripts/logic/reveal-state.mjs";

const GROUPS = [
  { id: "g1", name: "Party A", members: ["u1", "u2"] },
  { id: "g2", name: "Traitors", members: ["u3"] }
];

describe("normalizeAudience", () => {
  it("fills defaults for missing/garbage input", () => {
    expect(normalizeAudience(null)).toEqual({ users: [], groups: [], all: false, revealedAt: null });
    expect(normalizeAudience({ users: "x", groups: null, all: "yes" }))
      .toEqual({ users: [], groups: [], all: false, revealedAt: null });
  });
  it("keeps valid fields and drops non-string ids", () => {
    expect(normalizeAudience({ users: ["u1", 7], groups: ["g1"], all: true, revealedAt: 123 }))
      .toEqual({ users: ["u1"], groups: ["g1"], all: true, revealedAt: 123 });
  });
});

describe("canSee", () => {
  it("all wins regardless of membership", () => {
    expect(canSee({ users: [], groups: [], all: true }, "anyone", [])).toBe(true);
  });
  it("direct user membership", () => {
    const a = { users: ["u1"], groups: [], all: false };
    expect(canSee(a, "u1", GROUPS)).toBe(true);
    expect(canSee(a, "u2", GROUPS)).toBe(false);
  });
  it("live group membership: joining grants, leaving revokes", () => {
    const a = { users: [], groups: ["g1"], all: false };
    expect(canSee(a, "u2", GROUPS)).toBe(true);
    const after = [{ id: "g1", name: "Party A", members: ["u1"] }]; // u2 left
    expect(canSee(a, "u2", after)).toBe(false);
    const joined = [{ id: "g1", name: "Party A", members: ["u1", "u2", "u9"] }];
    expect(canSee(a, "u9", joined)).toBe(true);
  });
  it("unknown group id resolves to no members", () => {
    expect(canSee({ users: [], groups: ["nope"], all: false }, "u1", GROUPS)).toBe(false);
  });
});

describe("toggle helpers (immutable)", () => {
  it("toggleUser adds then removes, stamping revealedAt on add", () => {
    const a0 = normalizeAudience(null);
    const a1 = toggleUser(a0, "u1", 111);
    expect(a1.users).toEqual(["u1"]);
    expect(a1.revealedAt).toBe(111);
    expect(a0.users).toEqual([]); // unchanged
    const a2 = toggleUser(a1, "u1", 222);
    expect(a2.users).toEqual([]);
  });
  it("toggleGroup and setAll behave the same way", () => {
    const a1 = toggleGroup(normalizeAudience(null), "g1", 5);
    expect(a1.groups).toEqual(["g1"]);
    const a2 = setAll(a1, true, 9);
    expect(a2.all).toBe(true);
    expect(setAll(a2, false, 9).all).toBe(false);
  });
});

describe("isRevealed / resolveRecipients", () => {
  it("isRevealed true when any target exists", () => {
    expect(isRevealed({ users: [], groups: [], all: false })).toBe(false);
    expect(isRevealed({ users: ["u1"], groups: [], all: false })).toBe(true);
    expect(isRevealed({ users: [], groups: ["g1"], all: false })).toBe(true);
    expect(isRevealed({ users: [], groups: [], all: true })).toBe(true);
  });
  it("resolveRecipients unions users and group members, deduped", () => {
    const a = { users: ["u1", "u3"], groups: ["g1"], all: false };
    expect(resolveRecipients(a, GROUPS).sort()).toEqual(["u1", "u2", "u3"]);
  });
  it("resolveRecipients with all=true returns empty (callers whisper all players themselves)", () => {
    expect(resolveRecipients({ users: ["u1"], groups: [], all: true }, GROUPS)).toEqual([]);
  });
});

describe("pruneReveals", () => {
  it("drops records whose key is gone, reports changed", () => {
    const map = { "secret-a": { users: ["u1"], groups: [], all: false, revealedAt: 1 }, "secret-b": { users: [], groups: ["g1"], all: false, revealedAt: 2 } };
    const { map: out, changed } = pruneReveals(map, ["secret-a"]);
    expect(Object.keys(out)).toEqual(["secret-a"]);
    expect(changed).toBe(true);
    const same = pruneReveals(map, ["secret-a", "secret-b"]);
    expect(same.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/reveal-state.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/reveal-state.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/logic/reveal-state.mjs
/**
 * The Phase C reveal engine (spec §3): the ONE place audience semantics
 * live. An audience record is {users, groups, all, revealedAt}; group
 * membership resolves LIVE against the caller-supplied groups list
 * ([{id, name, members}], from the playerGroups world setting) — joining a
 * group grants everything previously revealed to it, leaving revokes it.
 * Pure and Foundry-free (vitest-loadable); timestamps are passed in by
 * callers, never read from a clock here.
 */

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function normalizeAudience(raw) {
  return {
    users: strings(raw?.users),
    groups: strings(raw?.groups),
    all: raw?.all === true,
    revealedAt: typeof raw?.revealedAt === "number" ? raw.revealedAt : null
  };
}

export function isRevealed(audience) {
  const a = normalizeAudience(audience);
  return a.all || a.users.length > 0 || a.groups.length > 0;
}

export function canSee(audience, userId, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return true;
  if (a.users.includes(userId)) return true;
  const groupIds = new Set(a.groups);
  return (groups ?? []).some((g) => groupIds.has(g.id) && (g.members ?? []).includes(userId));
}

const toggled = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function toggleUser(audience, userId, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, users: toggled(a.users, userId), revealedAt: revealedAt ?? a.revealedAt };
}

export function toggleGroup(audience, groupId, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, groups: toggled(a.groups, groupId), revealedAt: revealedAt ?? a.revealedAt };
}

export function setAll(audience, all, revealedAt) {
  const a = normalizeAudience(audience);
  return { ...a, all: all === true, revealedAt: revealedAt ?? a.revealedAt };
}

/**
 * Concrete userIds a reveal should whisper to. all=true returns [] — the
 * caller decides what "everyone" means in its context (typically every
 * non-GM user), because this module has no user directory.
 */
export function resolveRecipients(audience, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return [];
  const out = new Set(a.users);
  const groupIds = new Set(a.groups);
  for (const g of groups ?? []) {
    if (!groupIds.has(g.id)) continue;
    for (const m of g.members ?? []) out.add(m);
  }
  return [...out];
}

/** Drop reveal records whose key no longer exists (orphan cleanup, spec §5). */
export function pruneReveals(revealMap, liveIds) {
  const live = new Set(liveIds ?? []);
  const map = {};
  let changed = false;
  for (const [key, value] of Object.entries(revealMap ?? {})) {
    if (live.has(key)) map[key] = value;
    else changed = true;
  }
  return { map, changed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/reveal-state.test.js` then `npm test`
Expected: new file PASS; full suite green (408 + 12).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/reveal-state.mjs test/reveal-state.test.js
git commit -m "feat: reveal-state audience engine (canSee, toggles, recipients, prune)"
```

---

### Task 2: Player groups (logic + world setting)

**Files:**
- Create: `scripts/logic/player-groups.mjs`
- Modify: `scripts/constants.mjs` (add `PLAYER_GROUPS_SETTING`), `scripts/campaign-companion.mjs` (register setting in the `init` block after `SAVED_QUERIES_SETTING`)
- Test: `test/player-groups.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeGroups(raw) -> [{id: string, name: string, members: string[]}]`
  - `upsertGroup(groups, {id, name, members}) -> groups'` (immutable; matching id replaces, unknown/absent id appends with the given id)
  - `deleteGroup(groups, id) -> groups'`
  - Constant `PLAYER_GROUPS_SETTING = "playerGroups"` (world, `config: false`, `type: Array`, `default: []`). Read everywhere as `normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING))`.

- [ ] **Step 1: Write the failing tests**

```js
// test/player-groups.test.js
import { describe, it, expect } from "vitest";
import { normalizeGroups, upsertGroup, deleteGroup } from "../scripts/logic/player-groups.mjs";

describe("normalizeGroups", () => {
  it("drops rows without id or name, coerces members", () => {
    expect(normalizeGroups(null)).toEqual([]);
    expect(normalizeGroups([
      { id: "g1", name: "A", members: ["u1", 5] },
      { id: "", name: "bad" },
      { name: "no-id" },
      { id: "g2", name: "B" }
    ])).toEqual([
      { id: "g1", name: "A", members: ["u1"] },
      { id: "g2", name: "B", members: [] }
    ]);
  });
});

describe("upsertGroup / deleteGroup", () => {
  const base = [{ id: "g1", name: "A", members: ["u1"] }];
  it("replaces by id, immutably", () => {
    const out = upsertGroup(base, { id: "g1", name: "A2", members: ["u2"] });
    expect(out).toEqual([{ id: "g1", name: "A2", members: ["u2"] }]);
    expect(base[0].name).toBe("A");
  });
  it("appends a new id", () => {
    const out = upsertGroup(base, { id: "g9", name: "New", members: [] });
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("g9");
  });
  it("deleteGroup removes by id and tolerates unknown ids", () => {
    expect(deleteGroup(base, "g1")).toEqual([]);
    expect(deleteGroup(base, "zzz")).toEqual(base);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (`npx vitest run test/player-groups.test.js`)

- [ ] **Step 3: Implement**

```js
// scripts/logic/player-groups.mjs
/**
 * Named player groups (spec §3): the playerGroups world setting's value,
 * [{id, name, members: [userId]}], GM-managed from the Hub Secrets tab.
 * Pure normalization/CRUD only — reveal semantics live in reveal-state.mjs.
 */
export function normalizeGroups(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((g) => g && typeof g.id === "string" && g.id.length && typeof g.name === "string" && g.name.length)
    .map((g) => ({
      id: g.id,
      name: g.name,
      members: (Array.isArray(g.members) ? g.members : []).filter((m) => typeof m === "string")
    }));
}

export function upsertGroup(groups, { id, name, members }) {
  const next = { id, name, members: [...(members ?? [])] };
  const list = normalizeGroups(groups);
  const at = list.findIndex((g) => g.id === id);
  if (at === -1) return [...list, next];
  return list.map((g, i) => (i === at ? next : g));
}

export function deleteGroup(groups, id) {
  return normalizeGroups(groups).filter((g) => g.id !== id);
}
```

In `scripts/constants.mjs`, after `SAVED_QUERIES_SETTING`:

```js
/** World setting: named player groups [{id, name, members: [userId]}] for per-group secret reveal (GM-managed from the Hub Secrets tab). */
export const PLAYER_GROUPS_SETTING = "playerGroups";
```

In `scripts/campaign-companion.mjs`: add `PLAYER_GROUPS_SETTING` to the constants import, and register in the `init` hook after the `SAVED_QUERIES_SETTING` registration:

```js
  game.settings.register(MODULE_ID, PLAYER_GROUPS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
```

- [ ] **Step 4: Run** `npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/player-groups.mjs test/player-groups.test.js scripts/constants.mjs scripts/campaign-companion.mjs
git commit -m "feat: playerGroups world setting + pure group CRUD"
```

---

### Task 3: Secret-block parsing (`secret-blocks.mjs`)

**Files:**
- Create: `scripts/logic/secret-blocks.mjs`
- Test: `test/secret-blocks.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `extractSecretBlocks(html) -> [{id: string, preview: string, revealedAll: boolean}]` — one row per `<section class="secret">`; `id` may be `""` (hand-authored HTML); `revealedAll` true when the class list contains `revealed`; `preview` = tag-stripped text, ≤140 chars.
  - `stripSecretSections(html, {includeAll = false} = {}) -> string` — for export (Task 12): with `includeAll` the html passes through untouched; otherwise every `section.secret` **without** the `revealed` class is removed (audience-only reveals are NOT "everyone" and are also removed).
  - Documented limitation (module doc comment): parsing is regex-based over well-formed ProseMirror editor output; a `<section>` nested *inside* a secret section is not supported.

- [ ] **Step 1: Write the failing tests**

```js
// test/secret-blocks.test.js
import { describe, it, expect } from "vitest";
import { extractSecretBlocks, stripSecretSections } from "../scripts/logic/secret-blocks.mjs";

const HTML = [
  "<p>Intro prose.</p>",
  '<section class="secret" id="secret-aaa"><p>The duke is a <b>vampire</b>.</p></section>',
  "<p>Middle.</p>",
  '<section id="secret-bbb" class="secret revealed"><p>Known to all.</p></section>',
  '<section class="secret"><p>No id here.</p></section>',
  '<section class="content-embed"><p>Not a secret.</p></section>'
].join("");

describe("extractSecretBlocks", () => {
  it("finds secret sections with id, preview, revealedAll", () => {
    const blocks = extractSecretBlocks(HTML);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ id: "secret-aaa", preview: "The duke is a vampire.", revealedAll: false });
    expect(blocks[1]).toEqual({ id: "secret-bbb", preview: "Known to all.", revealedAll: true });
    expect(blocks[2].id).toBe("");
  });
  it("ignores non-secret sections and empty input", () => {
    expect(extractSecretBlocks("")).toEqual([]);
    expect(extractSecretBlocks("<section class='content-embed'>x</section>")).toEqual([]);
  });
  it("truncates long previews to 140 chars", () => {
    const long = `<section class="secret" id="s"><p>${"x".repeat(300)}</p></section>`;
    expect(extractSecretBlocks(long)[0].preview).toHaveLength(140);
  });
});

describe("stripSecretSections", () => {
  it("removes unrevealed secrets, keeps revealed and normal content", () => {
    const out = stripSecretSections(HTML);
    expect(out).toContain("Intro prose.");
    expect(out).toContain("Known to all.");
    expect(out).toContain("Not a secret.");
    expect(out).not.toContain("vampire");
    expect(out).not.toContain("No id here.");
  });
  it("includeAll passes through untouched", () => {
    expect(stripSecretSections(HTML, { includeAll: true })).toBe(HTML);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement**

```js
// scripts/logic/secret-blocks.mjs
/**
 * Regex-based parsing of Foundry's native secret blocks
 * (<section class="secret" id="secret-…">…</section>) out of raw journal
 * HTML — pure and Foundry-free for vitest. Assumes well-formed ProseMirror
 * editor output; a <section> nested INSIDE a secret section is not
 * supported (the non-greedy close-tag match would truncate it). The
 * render-time paths use real DOM instead (hooks/secrets-ui.mjs); this
 * module serves the scan pipeline (spec §9) and docx export (spec §11).
 */

const SECTION_RE = /<section\b[^>]*>[\s\S]*?<\/section>/gi;

function attr(openTag, name) {
  const m = openTag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function classesOf(block) {
  const openTag = block.slice(0, block.indexOf(">") + 1);
  return attr(openTag, "class").split(/\s+/).filter(Boolean);
}

function isSecret(block) {
  return classesOf(block).includes("secret");
}

function textPreview(html, max = 140) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function extractSecretBlocks(html) {
  const out = [];
  for (const block of String(html ?? "").match(SECTION_RE) ?? []) {
    if (!isSecret(block)) continue;
    const openTag = block.slice(0, block.indexOf(">") + 1);
    out.push({
      id: attr(openTag, "id"),
      preview: textPreview(block),
      revealedAll: classesOf(block).includes("revealed")
    });
  }
  return out;
}

/**
 * Export stripping (spec §11): remove every unrevealed secret section
 * unless includeAll (the export dialog's GM-content opt-in). Audience-only
 * reveals are removed too — they are not revealed to "everyone", and a
 * player-safe export must not carry them.
 */
export function stripSecretSections(html, { includeAll = false } = {}) {
  const src = String(html ?? "");
  if (includeAll) return src;
  return src.replace(SECTION_RE, (block) =>
    isSecret(block) && !classesOf(block).includes("revealed") ? "" : block
  );
}
```

- [ ] **Step 4: Run** `npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/secret-blocks.mjs test/secret-blocks.test.js
git commit -m "feat: secret-block extraction and export stripping (pure)"
```

---

### Task 4: Index integration (`meta.secrets`, outbound refs, GM records)

**Files:**
- Modify: `scripts/search/live-index.mjs`
- Test: extend `test/field-extractors.test.js` is NOT needed (extractors unchanged); no new unit file — `recordFor` is Foundry-glue. Verification is by the existing suite staying green plus Task 13's e2e.

**Interfaces:**
- Consumes: `extractSecretBlocks` (Task 3).
- Produces (for Tasks 10–11):
  - `record.meta.secrets = [{id, preview, revealedAll}]` on every indexed record (from the page's prose body).
  - `export function outboundRefsForEntry(sourceUuid) -> [{uuid, name, type, count}]` — the entries `sourceUuid`'s content references; players get public refs filtered by `userCanSee`, GM additionally gets gmRefs.
  - `export function gmSecretRecords() -> [{uuid, name, type, secrets}]` — GM-only (returns `[]` for non-GM); every record with ≥1 secret block.

- [ ] **Step 1: Implement** (glue module — no unit test cycle; keep changes minimal)

In `scripts/search/live-index.mjs`:

1. Add to imports: `import { extractSecretBlocks } from "../logic/secret-blocks.mjs";`
2. In `recordFor(page, type)`, right after the `record.meta = { tags: record.tags, attrs: ccAttrs };` line:

```js
  // Phase C (spec §9): secret blocks in the prose body, for the GM-only
  // Secrets tracker and prep board. GM-gated at the accessors below —
  // meta.secrets never reaches non-GM consumers (search()/runQuery() read
  // fields/gmFields/meta.tags/meta.attrs, never meta.secrets).
  record.meta.secrets = extractSecretBlocks(page?.system?.recap ?? page?.text?.content ?? "");
```

3. Append the two accessors at the end of the file:

```js
/**
 * Entries this entry's own content references (outbound @UUID refs) — the
 * prep board's "linked entries" (spec §8). Public refs for everyone
 * (filtered to entries the user can observe); gmRefs added for the GM.
 */
export function outboundRefsForEntry(sourceUuid) {
  const idx = ensureIndex();
  const source = backlinks.outbound.get(sourceUuid);
  if (!source) return [];
  const rows = [];
  const push = (target, count) => {
    if (!userCanSee(target)) return;
    const rec = idx.records.get(target);
    rows.push({ uuid: target, count, name: rec?.name ?? fromUuidSync(target)?.name ?? target, type: rec?.type ?? "" });
  };
  for (const [target, count] of source.refs) push(target, count);
  if (game.user.isGM) for (const [target, count] of source.gmRefs) push(target, count);
  return rows;
}

/** GM-only: every indexed record carrying secret blocks (Secrets tracker, spec §7). Empty for non-GM. */
export function gmSecretRecords() {
  if (!game.user.isGM) return [];
  const idx = ensureIndex();
  const rows = [];
  for (const record of idx.records.values()) {
    const secrets = record.meta?.secrets ?? [];
    if (secrets.length) rows.push({ uuid: record.uuid, name: record.name, type: record.type, secrets });
  }
  return rows;
}
```

- [ ] **Step 2: Run** `npm test` — the existing suite must stay green (search-index tests construct records without `meta.secrets`; nothing reads it yet).

- [ ] **Step 3: Commit**

```bash
git add scripts/search/live-index.mjs
git commit -m "feat: index secret blocks into record.meta.secrets; outbound refs + GM secret records accessors"
```

---

### Task 5: Audience dialog + whisper helper

**Files:**
- Create: `scripts/apps/audience-dialog.mjs`
- Modify: `lang/en.json` (add the `secrets` section below)
- Test: none (pure Foundry UI glue; e2e covers it in Task 13)

**Interfaces:**
- Consumes: `normalizeAudience`, `setAll`, `resolveRecipients` (Task 1); `normalizeGroups` (Task 2).
- Produces (used by Tasks 6, 7, 9, 10, 11):
  - `promptAudience({title, audience, groups}) -> Promise<audience|null>` — checkbox dialog; null on cancel/dismiss. Returned audience is normalized with `revealedAt: Date.now()` when newly revealed targets exist, else the prior `revealedAt`.
  - `sendRevealWhisper({audience, previousAudience, groups, html, entryUuid, entryName}) -> Promise<void>` — whispers `html` + a content link to recipients newly added by this change (diff vs `previousAudience`); `all: true` newly set whispers every non-GM user. Failures log, never throw (spec §10).

- [ ] **Step 1: Implement**

```js
// scripts/apps/audience-dialog.mjs
// The shared per-player/group reveal dialog (spec §5) and the reveal
// whisper (spec §10). GM-only affordances: every caller re-checks
// game.user.isGM before opening the dialog or writing the audience.
import { I18N, MODULE_ID } from "../constants.mjs";
import { normalizeAudience, resolveRecipients } from "../logic/reveal-state.mjs";

/**
 * Checkbox dialog over players / groups / everyone. Returns the new
 * audience (normalized) or null on cancel. revealedAt is stamped when the
 * result has any target and the prior audience had none.
 */
export async function promptAudience({ title, audience, groups }) {
  const prior = normalizeAudience(audience);
  const esc = foundry.utils.escapeHTML;
  const players = game.users.filter((u) => !u.isGM);
  const playerRows = players.map((u) =>
    `<label class="mej-cc-audience-row"><input type="checkbox" name="user-${u.id}"${prior.users.includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`
  ).join("");
  const groupRows = (groups ?? []).map((g) =>
    `<label class="mej-cc-audience-row"><input type="checkbox" name="group-${g.id}"${prior.groups.includes(g.id) ? " checked" : ""}> <i class="fa-solid fa-users"></i> ${esc(g.name)}</label>`
  ).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `
      <label class="mej-cc-audience-row mej-cc-audience-all"><input type="checkbox" name="all"${prior.all ? " checked" : ""}>
        <strong>${game.i18n.localize(`${I18N}.secrets.everyone`)}</strong></label>
      <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.players`)}</legend>${playerRows || `<p class="notes">${game.i18n.localize(`${I18N}.secrets.noPlayers`)}</p>`}</fieldset>
      <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.groups`)}</legend>${groupRows || `<p class="notes">${game.i18n.localize(`${I18N}.secrets.noGroups`)}</p>`}</fieldset>`,
    ok: {
      label: `${I18N}.secrets.apply`,
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          users: players.filter((u) => form[`user-${u.id}`]?.checked).map((u) => u.id),
          groups: (groups ?? []).filter((g) => form[`group-${g.id}`]?.checked).map((g) => g.id),
          all: form.all?.checked === true
        };
      }
    },
    rejectClose: false
  });
  if (!result) return null;
  const had = prior.all || prior.users.length || prior.groups.length;
  const has = result.all || result.users.length || result.groups.length;
  return normalizeAudience({ ...result, revealedAt: has && !had ? Date.now() : prior.revealedAt });
}

/**
 * Whisper the revealed content to recipients NEWLY added by this audience
 * change (spec §10). Un-reveal (targets removed) whispers nothing.
 */
export async function sendRevealWhisper({ audience, previousAudience, groups, html, entryUuid, entryName }) {
  try {
    const next = normalizeAudience(audience);
    const prev = normalizeAudience(previousAudience);
    let recipients;
    if (next.all && !prev.all) {
      recipients = game.users.filter((u) => !u.isGM).map((u) => u.id);
    } else {
      const before = new Set(resolveRecipients(prev, groups));
      recipients = resolveRecipients(next, groups).filter((id) => !before.has(id));
    }
    if (!recipients.length) return;
    const content = `<div class="mej-cc-reveal-whisper">
      <p><strong>${game.i18n.format(`${I18N}.secrets.whisperHeader`, { name: foundry.utils.escapeHTML(entryName) })}</strong></p>
      ${html}
      <p>@UUID[${entryUuid}]{${entryName}}</p></div>`;
    await ChatMessage.implementation.create({ content, whisper: recipients });
  } catch (err) {
    console.error(`${MODULE_ID} | reveal whisper failed`, err);
  }
}
```

Add to `lang/en.json` under the top-level `MEJCampaignCompanion` object (sibling of `knowledge`):

```json
"secrets": {
  "everyone": "Everyone",
  "players": "Players",
  "groups": "Groups",
  "noPlayers": "No player users in this world.",
  "noGroups": "No groups defined yet — manage them on the Hub's Secrets tab.",
  "apply": "Apply",
  "revealTitle": "Reveal secret",
  "whisperHeader": "A secret from {name} has been revealed to you:",
  "revealedToYou": "Revealed to you",
  "noId": "This secret block has no id — re-create it with the editor's Secret button to make it revealable.",
  "audienceButton": "Reveal to…",
  "chipsNone": "Hidden from players"
}
```

- [ ] **Step 2: Verify** `npm test` stays green (no logic modules touched) and `node --check scripts/apps/audience-dialog.mjs` passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/apps/audience-dialog.mjs lang/en.json
git commit -m "feat: shared audience dialog and reveal whisper"
```

---

### Task 6: Block-secret UI (`secrets-ui.mjs`) — GM overlay, player re-enrichment, live update

**Files:**
- Create: `scripts/hooks/secrets-ui.mjs`
- Modify: `scripts/campaign-companion.mjs` (register in the `setupMonksEnhancedJournal` handler, after `registerQueryEnricher()`), `styles/campaign-companion.css` (chip/button styles)
- Test: none (browser glue; e2e in Task 13)

**Interfaces:**
- Consumes: Tasks 1, 2, 5; the injection-hook pattern of `scripts/hooks/knowledge-ui.mjs` (same two hooks, same `refresh` shell-reload pattern at knowledge-ui.mjs:83-90).
- Produces: `registerSecretsUi()`. Flag shape written: `flags["mej-campaign-companion"].secretReveals = {[sectionId]: audience}` on the **JournalEntry** (page.parent).

Key mechanics (verified in this repo/Foundry):
- Enriched player HTML **omits** unrevealed secret sections entirely (Foundry `text-editor.mjs:133` removes `section.secret:not(.revealed)` when `secrets:false`); MEJ enriches with `secrets: this.document.isOwner` (EnhancedJournalSheet.js:278) into `.editor-display[data-key="text.content"]`.
- So the player path re-enriches raw `page.text.content` with `secrets: true`, removes disallowed sections via DOM, and swaps the container's children. GM path just overlays buttons on the already-present sections.

- [ ] **Step 1: Implement**

```js
// scripts/hooks/secrets-ui.mjs
// Block-level secret reveal (spec §5): GM audience buttons on every native
// secret section; per-user re-enrichment for players with reveals; orphan
// pruning; live update on the replicated flag write. Same injection hooks
// and shell-refresh pattern as knowledge-ui.mjs (see its header comment).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, canSee, isRevealed, pruneReveals, resolveRecipients } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const REVEALS_FLAG = "secretReveals";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return game.MonksEnhancedJournal?.getMEJType?.(doc) ? doc : null;
}

const groupsSetting = () => normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
const revealsOf = (entry) => entry?.getFlag?.(MODULE_ID, REVEALS_FLAG) ?? {};

/** Same shell-reload necessity as knowledge-ui.mjs's refresh (see its comment). */
function refresh(sheet, shellHosted) {
  const shell = shellHosted ? game.MonksEnhancedJournal?.journal : null;
  if (shell?.rendered) shell.render({ tempOwnership: shell.tempOwnership, reload: true });
  else sheet.render?.({ parts: ["main"] });
}

/** Short "who knows this" chip text for the GM button. */
function chipText(audience, groups) {
  const a = normalizeAudience(audience);
  if (a.all) return game.i18n.localize(`${I18N}.secrets.everyone`);
  const names = [
    ...game.users.filter((u) => a.users.includes(u.id)).map((u) => u.name),
    ...groups.filter((g) => a.groups.includes(g.id)).map((g) => g.name)
  ];
  return names.length ? names.join(", ") : game.i18n.localize(`${I18N}.secrets.chipsNone`);
}

async function injectGmOverlay(sheet, element, shellHosted) {
  const page = mejPageOf(sheet);
  if (!page || !element || !game.user.isGM) return;
  const entry = page.parent;
  if (!entry) return;
  const groups = groupsSetting();
  const reveals = revealsOf(entry);
  const sections = element.querySelectorAll('.editor-display[data-key="text.content"] section.secret');
  for (const section of sections) {
    if (section.querySelector(":scope > .mej-cc-secret-audience")) continue;
    const id = section.id ?? "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mej-cc-secret-audience";
    if (!id) {
      button.disabled = true;
      button.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.noId`);
      button.innerHTML = '<i class="fa-solid fa-user-secret"></i>';
    } else {
      const audience = normalizeAudience(reveals[id]);
      button.innerHTML = `<i class="fa-solid fa-user-secret"></i> <span class="mej-cc-secret-chips">${foundry.utils.escapeHTML(chipText(audience, groups))}</span>`;
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await editAudience(entry, page, id, section, sheet, shellHosted);
      });
    }
    section.prepend(button);
  }
  await pruneOrphans(entry, page);
}

async function editAudience(entry, page, sectionId, section, sheet, shellHosted) {
  if (!game.user.isGM) return;
  const groups = groupsSetting();
  const previous = normalizeAudience(revealsOf(entry)[sectionId]);
  const audience = await promptAudience({
    title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups
  });
  if (!audience) return;
  await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}.${sectionId}`]: audience });
  // Whisper the section's content (already enriched in the GM's DOM) minus our own button.
  const clone = section.cloneNode(true);
  clone.querySelector(":scope > .mej-cc-secret-audience")?.remove();
  await sendRevealWhisper({
    audience, previousAudience: previous, groups,
    html: clone.innerHTML, entryUuid: entry.uuid, entryName: entry.name
  });
  refresh(sheet, shellHosted);
}

/** Drop reveal records whose section no longer exists in the content (spec §5). GM-side only. */
async function pruneOrphans(entry, page) {
  const reveals = revealsOf(entry);
  const keys = Object.keys(reveals);
  if (!keys.length) return;
  const liveIds = [...String(page.text?.content ?? "").matchAll(/<section\b[^>]*id="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  const { map, changed } = pruneReveals(reveals, liveIds);
  if (changed) await entry.update({ [`flags.${MODULE_ID}.${REVEALS_FLAG}`]: map }, { diff: false });
}

/**
 * Player path (spec §5): only when this user has ≥1 reveal on the entry —
 * re-enrich raw content with secrets:true, strip sections not visible to
 * this user, and swap into the rendered container. DOM-based (robust to
 * nested markup); the pure regex parser is only for index/export.
 */
async function injectPlayerSecrets(sheet, element) {
  if (game.user.isGM) return;
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  const entry = page.parent;
  const reveals = revealsOf(entry ?? {});
  const groups = groupsSetting();
  const mine = Object.entries(reveals).filter(([, aud]) => canSee(aud, game.user.id, groups)).map(([id]) => id);
  if (!mine.length) return;
  const container = element.querySelector('.editor-display[data-key="text.content"]');
  if (!container) return;
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    page.text?.content ?? "", { relativeTo: page, secrets: true, async: true }
  );
  const fragment = document.createRange().createContextualFragment(`<div>${enriched}</div>`);
  const root = fragment.firstElementChild;
  const allowed = new Set(mine);
  for (const section of root.querySelectorAll("section.secret")) {
    if (section.classList.contains("revealed")) continue;
    if (allowed.has(section.id)) {
      section.classList.add("mej-cc-revealed-to-you");
      section.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.revealedToYou`);
    } else {
      section.remove();
    }
  }
  container.replaceChildren(...root.childNodes);
}

export function registerSecretsUi() {
  const inject = (sheet, html, shellHosted) => {
    const element = asElement(html);
    injectGmOverlay(sheet, element, shellHosted).catch((err) => console.error(`${MODULE_ID} | secret overlay failed`, err));
    injectPlayerSecrets(sheet, element).catch((err) => console.error(`${MODULE_ID} | player secret render failed`, err));
  };
  Hooks.on("renderJournalPageSheet", (sheet, html) => inject(sheet, html, true));
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => inject(sheet, html, false));

  // Live update (spec §5): the reveal flag write replicates to every
  // client; MEJ's own updateJournalEntry hook ignores foreign flag
  // namespaces (see knowledge-ui.mjs's refresh comment), so reload the
  // shell ourselves when it is showing the updated entry.
  Hooks.on("updateJournalEntry", (entry, changes) => {
    const flags = changes?.flags?.[MODULE_ID];
    if (flags?.[REVEALS_FLAG] === undefined && flags?.relReveals === undefined) return;
    const shell = game.MonksEnhancedJournal?.journal;
    if (!shell?.rendered) return;
    const shown = shell.document?.parent ?? shell.document;
    if (shown?.uuid !== entry.uuid && shell.document?.uuid !== entry.uuid) return;
    shell.render({ tempOwnership: shell.tempOwnership, reload: true });
  });
}
```

In `scripts/campaign-companion.mjs`, in the `setupMonksEnhancedJournal` handler after `registerQueryEnricher()`:

```js
    // Phase C: block-level secret reveal UI (GM overlay + player
    // re-enrichment). Dynamic import — it reaches live Foundry globals and
    // the audience dialog; nothing MEJ-static, but keep the pattern.
    const { registerSecretsUi } = await import("./hooks/secrets-ui.mjs");
    registerSecretsUi();
```

Add to `styles/campaign-companion.css`:

```css
/* Phase C: secret reveal */
.mej-cc-secret-audience { float: right; margin: 2px; font-size: var(--font-size-11); padding: 1px 6px; line-height: 1.4; width: auto; }
.mej-cc-secret-chips { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
section.secret.mej-cc-revealed-to-you { border-left: 3px solid var(--color-border-highlight, #ff6400); }
.mej-cc-audience-row { display: block; margin: 2px 0; }
```

- [ ] **Step 2: Verify** `node --check scripts/hooks/secrets-ui.mjs`; `npm test` green.

- [ ] **Step 3: Commit**

```bash
git add scripts/hooks/secrets-ui.mjs scripts/campaign-companion.mjs styles/campaign-companion.css
git commit -m "feat: block-secret reveal UI — GM overlay, player re-enrichment, live update"
```

---

### Task 7: Relationship reveals (logic + UI)

**Files:**
- Create: `scripts/logic/rel-reveals.mjs`, `scripts/hooks/relationships-ui.mjs`
- Modify: `scripts/campaign-companion.mjs` (register after `registerSecretsUi()`), `lang/en.json` (add `secrets.relRevealTitle`, `secrets.relSecretRevealTitle`, `secrets.knownConnections`), `styles/campaign-companion.css`
- Test: `test/rel-reveals.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 5. MEJ relationship flag shape: `flags["monks-enhanced-journal"].relationships` = dict id→`{id?, uuid, relationship?, secret?, revealed?, hidden?}` (legacy array form exists — reuse the tolerant iteration of `graph-data.mjs`'s `normalizeRelationships`).
- Produces:
  - `visibleRelRows(relationships, relReveals, {userId, groups, isGM}) -> [{id, uuid, label, hidden, rowRevealedToUser, secretText}]` — GM: every row, `secretText` always present (may be `""`); player: non-hidden rows plus hidden rows whose `relReveals[id].row` audience matches; `secretText` only when `rel.revealed === true` (MEJ's own all-reveal) or `relReveals[id].secret` matches, else `null`.
  - Flag shape written by the UI: `flags["mej-campaign-companion"].relReveals = {[relationshipId]: {row?: audience, secret?: audience}}` on the JournalEntry.
  - `registerRelationshipsUi()`.

- [ ] **Step 1: Write the failing tests**

```js
// test/rel-reveals.test.js
import { describe, it, expect } from "vitest";
import { visibleRelRows } from "../scripts/logic/rel-reveals.mjs";

const GROUPS = [{ id: "g1", name: "A", members: ["u2"] }];
const RELS = {
  r1: { id: "r1", uuid: "JournalEntry.aaa", relationship: "Ally", hidden: false },
  r2: { id: "r2", uuid: "JournalEntry.bbb", relationship: "Enemy", hidden: true },
  r3: { id: "r3", uuid: "JournalEntry.ccc", relationship: "", secret: "Secret sibling", revealed: false, hidden: false }
};
const REVEALS = {
  r2: { row: { users: ["u1"], groups: [], all: false } },
  r3: { secret: { users: [], groups: ["g1"], all: false } }
};

describe("visibleRelRows", () => {
  it("GM sees every row with secretText always a string", () => {
    const rows = visibleRelRows(RELS, REVEALS, { userId: "gm", groups: GROUPS, isGM: true });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "r3").secretText).toBe("Secret sibling");
  });
  it("player sees non-hidden rows plus row-revealed hidden rows", () => {
    const u1 = visibleRelRows(RELS, REVEALS, { userId: "u1", groups: GROUPS, isGM: false });
    expect(u1.map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect(u1.find((r) => r.id === "r2").rowRevealedToUser).toBe(true);
    const u3 = visibleRelRows(RELS, REVEALS, { userId: "u3", groups: GROUPS, isGM: false });
    expect(u3.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });
  it("secretText per-viewer: group reveal via live membership; hidden otherwise", () => {
    const u2 = visibleRelRows(RELS, REVEALS, { userId: "u2", groups: GROUPS, isGM: false });
    expect(u2.find((r) => r.id === "r3").secretText).toBe("Secret sibling");
    const u1 = visibleRelRows(RELS, REVEALS, { userId: "u1", groups: GROUPS, isGM: false });
    expect(u1.find((r) => r.id === "r3").secretText).toBe(null);
  });
  it("rel.revealed === true shows secretText to everyone; tolerates array form + missing uuid", () => {
    const rels = [{ id: "x", uuid: "JournalEntry.x", secret: "s", revealed: true }, { id: "bad" }];
    const rows = visibleRelRows(rels, {}, { userId: "u9", groups: [], isGM: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].secretText).toBe("s");
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement the logic**

```js
// scripts/logic/rel-reveals.mjs
/**
 * Per-viewer relationship visibility (spec §6). MEJ natively gives each
 * relationship a free-text label, an all-or-nothing secret label
 * (rel.revealed), and a binary hidden row flag; the companion overlay
 * (flags["mej-campaign-companion"].relReveals = {[relId]: {row?, secret?}})
 * adds per-player/group granularity on top without touching MEJ data.
 * Pure and Foundry-free.
 */
import { canSee } from "./reveal-state.mjs";

function entriesOf(flagValue) {
  if (Array.isArray(flagValue)) return flagValue.map((rel) => [rel?.id ?? "", rel]);
  if (flagValue && typeof flagValue === "object") return Object.entries(flagValue);
  return [];
}

export function visibleRelRows(relationships, relReveals, { userId, groups, isGM }) {
  const rows = [];
  for (const [key, rel] of entriesOf(relationships)) {
    if (!rel || typeof rel.uuid !== "string" || !rel.uuid.length) continue;
    const id = String(rel.id ?? key);
    const overlay = relReveals?.[id] ?? {};
    const hidden = rel.hidden === true;
    const rowRevealedToUser = !isGM && hidden && canSee(overlay.row, userId, groups);
    if (!isGM && hidden && !rowRevealedToUser) continue;
    const secret = typeof rel.secret === "string" ? rel.secret : "";
    let secretText = null;
    if (isGM) secretText = secret;
    else if (secret && (rel.revealed === true || canSee(overlay.secret, userId, groups))) secretText = secret;
    rows.push({ id, uuid: rel.uuid, label: typeof rel.relationship === "string" ? rel.relationship : "", hidden, rowRevealedToUser, secretText });
  }
  return rows;
}
```

- [ ] **Step 4: Run** `npx vitest run test/rel-reveals.test.js` — PASS; `npm test` green.

- [ ] **Step 5: Implement the UI glue**

```js
// scripts/hooks/relationships-ui.mjs
// Relationship reveal overlay (spec §6). GM: an audience button per
// relationship row (row visibility for hidden rows; secret-label audience
// when the row has a secret). Player: rows revealed to them are appended
// to MEJ's relationships list (MEJ itself filtered them out server of
// nothing — the raw flag is client-readable, soft model); if MEJ's list
// markup is missing, rows fall back into the knowledge panel area as a
// plain "Known connections" list.
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { visibleRelRows } from "../logic/rel-reveals.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";
const REL_FLAG = "relReveals";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return game.MonksEnhancedJournal?.getMEJType?.(doc) ? doc : null;
}

const groupsSetting = () => normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
const relRevealsOf = (entry) => entry?.getFlag?.(MODULE_ID, REL_FLAG) ?? {};

function refresh(sheet, shellHosted) {
  const shell = shellHosted ? game.MonksEnhancedJournal?.journal : null;
  if (shell?.rendered) shell.render({ tempOwnership: shell.tempOwnership, reload: true });
  else sheet.render?.({ parts: ["main"] });
}

async function editRelAudience(entry, relId, kind, { label, secret }, sheet, shellHosted) {
  if (!game.user.isGM) return;
  const groups = groupsSetting();
  const previous = normalizeAudience(relRevealsOf(entry)[relId]?.[kind]);
  const titleKey = kind === "row" ? "relRevealTitle" : "relSecretRevealTitle";
  const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.${titleKey}`), audience: previous, groups });
  if (!audience) return;
  await entry.update({ [`flags.${MODULE_ID}.${REL_FLAG}.${relId}.${kind}`]: audience });
  const esc = foundry.utils.escapeHTML;
  const text = kind === "secret" ? secret : label;
  await sendRevealWhisper({
    audience, previousAudience: previous, groups,
    html: `<p>${esc(text || entry.name)}</p>`, entryUuid: entry.uuid, entryName: entry.name
  });
  refresh(sheet, shellHosted);
}

function injectGm(sheet, element, shellHosted) {
  const page = mejPageOf(sheet);
  if (!page || !element || !game.user.isGM) return;
  const entry = page.parent;
  if (!entry) return;
  const rels = page.flags?.[MEJ_FLAGS]?.relationships ?? {};
  const rows = visibleRelRows(rels, relRevealsOf(entry), { userId: game.user.id, groups: groupsSetting(), isGM: true });
  for (const row of rows) {
    const li = element.querySelector(`.relationships .item[data-id="${row.id}"] .item-controls`)
      ?? element.querySelector(`.relationships .item[data-uuid="${row.uuid}"] .item-controls`);
    if (!li || li.querySelector(".mej-cc-rel-audience")) continue;
    const a = document.createElement("a");
    a.className = "mej-cc-rel-audience";
    a.dataset.tooltip = game.i18n.localize(`${I18N}.secrets.audienceButton`);
    a.innerHTML = '<i class="fa-solid fa-user-secret"></i>';
    a.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const kind = row.hidden ? "row" : (row.secretText ? "secret" : "row");
      editRelAudience(entry, row.id, kind, { label: row.label, secret: row.secretText ?? "" }, sheet, shellHosted)
        .catch((err) => console.error(`${MODULE_ID} | relationship reveal failed`, err));
    });
    li.prepend(a);
  }
}

async function injectPlayer(sheet, element) {
  if (game.user.isGM) return;
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  const entry = page.parent;
  const rows = visibleRelRows(
    page.flags?.[MEJ_FLAGS]?.relationships ?? {},
    relRevealsOf(entry), { userId: game.user.id, groups: groupsSetting(), isGM: false }
  );
  const extras = rows.filter((r) => r.rowRevealedToUser || (r.secretText && r.hidden === false));
  if (!extras.length) return;
  element.querySelector(":scope .mej-cc-known-connections")?.remove();
  const list = element.querySelector(".relationships .items-list ol.item-list");
  const esc = foundry.utils.escapeHTML;
  const rowHtml = await Promise.all(extras.map(async (r) => {
    const target = await fromUuid(r.uuid).catch(() => null);
    const name = esc(target?.name ?? r.uuid);
    const secret = r.secretText ? ` <em class="mej-cc-rel-secret">${esc(r.secretText)}</em>` : "";
    return `<li class="item flexrow mej-cc-rel-revealed" data-uuid="${r.uuid}">
      <i class="fa-solid fa-eye" data-tooltip="${game.i18n.localize(`${I18N}.secrets.revealedToYou`)}"></i>
      <div class="item-name"><a data-cc-open="${r.uuid}">${name}</a></div>
      <div class="item-relationship">${esc(r.label)}${secret}</div></li>`;
  }));
  let host = list;
  if (!host) {
    // Graceful degradation (spec §6): MEJ's markup changed — render our own list at the sheet's end.
    host = document.createElement("ol");
    host.className = "mej-cc-known-connections item-list";
    host.innerHTML = `<li><header>${game.i18n.localize(`${I18N}.secrets.knownConnections`)}</header></li>`;
    element.appendChild(host);
  }
  const frag = document.createRange().createContextualFragment(rowHtml.join(""));
  frag.querySelectorAll("[data-cc-open]").forEach((a) => a.addEventListener("click", async () => {
    const target = await fromUuid(a.dataset.ccOpen);
    if (target) game.MonksEnhancedJournal.openJournalEntry(target);
  }));
  host.appendChild(frag);
}

export function registerRelationshipsUi() {
  const inject = (sheet, html, shellHosted) => {
    const element = asElement(html);
    try { injectGm(sheet, element, shellHosted); } catch (err) { console.error(`${MODULE_ID} | rel GM overlay failed`, err); }
    injectPlayer(sheet, element).catch((err) => console.error(`${MODULE_ID} | rel player inject failed`, err));
  };
  Hooks.on("renderJournalPageSheet", (sheet, html) => inject(sheet, html, true));
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => inject(sheet, html, false));
}
```

Register in `campaign-companion.mjs` after `registerSecretsUi()`:

```js
    const { registerRelationshipsUi } = await import("./hooks/relationships-ui.mjs");
    registerRelationshipsUi();
```

Add lang keys inside the `secrets` object: `"relRevealTitle": "Reveal relationship"`, `"relSecretRevealTitle": "Reveal secret relationship"`, `"knownConnections": "Known connections"`.
Add CSS: `.mej-cc-rel-revealed .fa-eye { color: var(--color-text-hyperlink, #4a90d9); margin-right: 4px; } .mej-cc-rel-secret { opacity: 0.85; }`.

- [ ] **Step 6: Run** `npm test` green; `node --check` both new files.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/rel-reveals.mjs test/rel-reveals.test.js scripts/hooks/relationships-ui.mjs scripts/campaign-companion.mjs lang/en.json styles/campaign-companion.css
git commit -m "feat: per-player relationship reveals (logic + sheet overlay)"
```

---

### Task 8: Graph edge labels

**Files:**
- Modify: `scripts/logic/graph-data.mjs`, `scripts/apps/graph-app.mjs`, `styles/campaign-companion.css`
- Test: extend `test/graph-data.test.js`

**Interfaces:**
- Consumes: `visibleRelRows` (Task 7).
- Produces: `normalizeRelationships` rows gain `label` (from `rel.relationship`); `buildGraph` edges gain `label` and `hidden`. `graph-app.mjs`'s `graphRows()` pre-filters each entry's relationships per-viewer via `visibleRelRows` (replacing the in-buildGraph `rel.hidden && !isGM` skip: rows arrive already viewer-filtered, and revealed-hidden rows arrive with `hidden: true` so the GM/beneficiary sees the dashed style).

- [ ] **Step 1: Add failing tests** to `test/graph-data.test.js`:

```js
describe("edge labels (Phase C)", () => {
  it("normalizeRelationships carries the label", () => {
    const rows = normalizeRelationships({ a: { id: "a", uuid: "U.a", relationship: "Rival", hidden: false } });
    expect(rows[0].label).toBe("Rival");
  });
  it("buildGraph copies label and hidden onto the edge", () => {
    const rows = [
      { uuid: "U.a", name: "A", type: "person", relationships: [{ id: "r", uuid: "U.b", hidden: true, label: "Nemesis" }] },
      { uuid: "U.b", name: "B", type: "person", relationships: [] }
    ];
    const g = buildGraph(rows, [], { isGM: true });
    expect(g.edges[0].label).toBe("Nemesis");
    expect(g.edges[0].hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement**

In `graph-data.mjs`:
- `normalizeRelationships` map: add `label: typeof rel.relationship === "string" ? rel.relationship : ""` to the returned object.
- In `buildGraph`'s relationship-edge loop, replace the pushed edge object with:

```js
      edges.push({ source: row.uuid, target: rel.uuid, kind: "relationship", label: rel.label ?? "", hidden: rel.hidden === true });
```

(The `if (rel.hidden && !isGM) continue;` line stays — callers that pre-filter simply never pass an invisible rel.)

In `graph-app.mjs`:
- Add imports: `import { visibleRelRows } from "../logic/rel-reveals.mjs";`, `import { normalizeGroups } from "../logic/player-groups.mjs";`, and add `PLAYER_GROUPS_SETTING` to the constants import.
- In `graphRows()`, replace the `relationships:` line with per-viewer filtering that keeps the dashed-hidden marker:

```js
        relationships: visibleRelRows(
          page.flags?.[MEJ_FLAGS]?.relationships,
          entry.getFlag(MODULE_ID, "relReveals") ?? {},
          { userId: game.user.id, groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)), isGM: game.user.isGM }
        ).map((r) => ({ id: r.id, uuid: r.uuid, hidden: r.hidden, label: r.secretText && game.user.isGM ? `${r.label || ""}${r.label && r.secretText ? " / " : ""}${r.secretText}` : (r.secretText ?? r.label) || r.label }))
```

  …simplify per implementation taste, with this exact visibility rule: players see `label`, plus `secretText` only when `visibleRelRows` returned it non-null; the GM sees both joined with `" / "` when both exist. (`MODULE_ID` is already imported.)
- In `#draw()`'s edge creation, after `line.classList.add(...)`:

```js
      if (link.hidden) line.classList.add("hidden-rel");
```

  and render the label as SVG text kept in sync on tick:

```js
    const edgeLabelEls = links.map((link) => {
      if (!link.label) return null;
      const text = document.createElementNS(NS, "text");
      text.classList.add("mej-cc-graph-edge-label");
      text.textContent = link.label;
      svg.append(text);
      return text;
    });
```

  and inside the tick handler's `links.forEach`:

```js
          const labelEl = edgeLabelEls[i];
          if (labelEl) {
            labelEl.setAttribute("x", (link.source.x + link.target.x) / 2);
            labelEl.setAttribute("y", (link.source.y + link.target.y) / 2 - 4);
          }
```

CSS additions:

```css
.mej-cc-graph-edge.hidden-rel { stroke-dasharray: 4 3; }
.mej-cc-graph-edge-label { font-size: 10px; fill: var(--color-text-dark-secondary, #666); text-anchor: middle; pointer-events: none; }
```

- [ ] **Step 4: Run** `npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/graph-data.mjs scripts/apps/graph-app.mjs test/graph-data.test.js styles/campaign-companion.css
git commit -m "feat: graph edge labels with per-viewer relationship visibility"
```

---

### Task 9: Session checklist audiences

**Files:**
- Modify: `scripts/sheets/SessionSheet.mjs`, `templates/session.hbs`, `lang/en.json` (`secrets.checklistRevealTitle`)
- Test: extend `test/field-extractors.test.js` with one guard test (below). The sheet itself is e2e-covered.

**Interfaces:**
- Consumes: Tasks 1, 2, 5. Phase A checklist item `{id, text, revealed, revealedAt}` gains optional `audience` (spec §4): `revealed: true` still means everyone (wins over `audience`); `audience` + `revealed: false` means exactly that audience.
- Produces: action `secretAudience` on SessionSheet; player-visible secrets = `revealed || canSee(audience)`.
- **No change** to `scripts/logic/field-extractors.mjs`: the public `fields.secrets` keeps holding revealed-to-**all** text only — an audience-only secret must not become searchable by other players through a shared index field (GM search still finds it via `gmFields.secrets`).

- [ ] **Step 1: Add the extractor guard test** to `test/field-extractors.test.js`:

```js
  it("audience-only session secrets stay out of the public field (Phase C)", () => {
    const page = {
      uuid: "U.s", name: "S", system: { recap: "" },
      flags: { "mej-campaign-companion": { session: { secrets: [
        { id: "1", text: "for-everyone", revealed: true },
        { id: "2", text: "audience-only", revealed: false, audience: { users: ["u1"], groups: [], all: false } }
      ] } } }
    };
    const record = extractRecord(page, "session");
    expect(record.fields.secrets).toBe("for-everyone");
    expect(record.gmFields.secrets).toContain("audience-only");
  });
```

- [ ] **Step 2: Run** — this should PASS already (extractor filters on `revealed`); it exists as a regression guard. If it fails, the extractor changed — stop and re-read spec §4.

- [ ] **Step 3: Implement the sheet changes**

In `SessionSheet.mjs`:
- Imports: add `PLAYER_GROUPS_SETTING` to the constants import; add

```js
import { canSee, normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";
```

- `actions`: add `secretAudience: SessionSheet.onSecretAudience`.
- In `_prepareBodyContext`, replace the `context.secrets = isGM ? ... : ...` assignment with:

```js
    // Phase C (spec §4): a player sees a checklist item when it's revealed
    // to all (revealed: true, which wins) OR their audience matches. The
    // sanitized non-GM shape still drops `revealed`/`audience` internals.
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    context.secrets = isGM
      ? session.secrets.map((s) => ({ ...s, audienceCount: (normalizeAudience(s.audience).users.length + normalizeAudience(s.audience).groups.length) }))
      : session.secrets
          .filter((s) => s.revealed || canSee(s.audience, game.user.id, groups))
          .map(({ id, text, revealedAt }) => ({ id, text, revealedAt }));
```

- Add the handler next to `onToggleSecret`:

```js
  // Per-player/group reveal for one checklist item (spec §4/§8). "Everyone"
  // remains onToggleSecret's revealed flag; this dialog manages the
  // audience field. Reveal whispers the item text to new recipients.
  static async onSecretAudience(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const item = session.secrets.find((s) => s.id === id);
    if (!item) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const audience = await promptAudience({
      title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`),
      audience: item.audience, groups
    });
    if (!audience) return;
    const secrets = session.secrets.map((s) => (s.id === id ? { ...s, audience } : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    await sendRevealWhisper({
      audience, previousAudience: item.audience, groups,
      html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
      entryUuid: this.document.parent?.uuid ?? this.document.uuid,
      entryName: this.document.parent?.name ?? this.document.name
    });
    this.render();
  }
```

In `templates/session.hbs`, inside the GM-only controls of each secrets-list row (next to the existing toggle/delete buttons — match the surrounding markup style):

```hbs
<a data-action="secretAudience" data-tooltip="{{localize 'MEJCampaignCompanion.secrets.audienceButton'}}">
  <i class="fa-solid fa-user-secret"></i>{{#if this.audienceCount}}<span class="mej-cc-audience-count">{{this.audienceCount}}</span>{{/if}}
</a>
```

Lang: add `"checklistRevealTitle": "Reveal secret to…"` to the `secrets` object.

- [ ] **Step 4: Run** `npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add scripts/sheets/SessionSheet.mjs templates/session.hbs test/field-extractors.test.js lang/en.json
git commit -m "feat: per-player/group audiences on the Session secrets checklist"
```

---

### Task 10: Secrets tracker Hub tab + group management

**Files:**
- Create: `scripts/logic/secrets-tracker.mjs`
- Modify: `scripts/apps/CampaignHubPage.mjs`, `templates/hub.hbs`, `lang/en.json`, `styles/campaign-companion.css`
- Test: `test/secrets-tracker.test.js`

**Interfaces:**
- Consumes: `gmSecretRecords` (Task 4), `visibleRelRows` (Task 7), Tasks 1–2, 5; `SESSION_DOCUMENT_TYPE` pages' checklist items.
- Produces:
  - Pure: `filterTrackerRows(rows, {type = "", state = "all", playerId = "", groups = []}) -> rows'` where each row is `{kind: "block"|"session"|"relationship", entryUuid, entryName, entryType, secretId, preview, audience, revealedAll}`. `state` ∈ `all|revealed|unrevealed` (`revealed` = `revealedAll || isRevealed(audience)`); `playerId` set = only rows that player can see (`revealedAll || canSee`).
  - Hub: GM-only `secrets` tab (hidden from players by deleting `context.subtabs.secrets`), actions `secretsSetFilter`, `trackerAudience`, `addGroup`, `editGroup`, `deleteGroup`; group-management block writing `PLAYER_GROUPS_SETTING`.

- [ ] **Step 1: Write the failing tests**

```js
// test/secrets-tracker.test.js
import { describe, it, expect } from "vitest";
import { filterTrackerRows } from "../scripts/logic/secrets-tracker.mjs";

const GROUPS = [{ id: "g1", name: "A", members: ["u2"] }];
const ROWS = [
  { kind: "block", entryUuid: "U.a", entryName: "A", entryType: "person", secretId: "s1", preview: "p1", audience: { users: ["u1"], groups: [], all: false }, revealedAll: false },
  { kind: "block", entryUuid: "U.a", entryName: "A", entryType: "person", secretId: "s2", preview: "p2", audience: null, revealedAll: true },
  { kind: "session", entryUuid: "U.s", entryName: "S", entryType: "session", secretId: "c1", preview: "clue", audience: { users: [], groups: ["g1"], all: false }, revealedAll: false },
  { kind: "relationship", entryUuid: "U.r", entryName: "R", entryType: "person", secretId: "r1", preview: "rel", audience: null, revealedAll: false }
];

describe("filterTrackerRows", () => {
  it("no filters returns everything", () => {
    expect(filterTrackerRows(ROWS, {})).toHaveLength(4);
  });
  it("type filter matches entryType", () => {
    expect(filterTrackerRows(ROWS, { type: "session" })).toHaveLength(1);
  });
  it("state revealed/unrevealed", () => {
    expect(filterTrackerRows(ROWS, { state: "revealed" }).map((r) => r.secretId).sort()).toEqual(["c1", "s1", "s2"]);
    expect(filterTrackerRows(ROWS, { state: "unrevealed" }).map((r) => r.secretId)).toEqual(["r1"]);
  });
  it("what does player X know: direct, group (live), and revealed-to-all", () => {
    expect(filterTrackerRows(ROWS, { playerId: "u1", groups: GROUPS }).map((r) => r.secretId).sort()).toEqual(["s1", "s2"]);
    expect(filterTrackerRows(ROWS, { playerId: "u2", groups: GROUPS }).map((r) => r.secretId).sort()).toEqual(["c1", "s2"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement the pure filter**

```js
// scripts/logic/secrets-tracker.mjs
/**
 * Secrets tracker row filtering (spec §7). Rows are pre-assembled by the
 * Hub (Foundry glue); this module only implements the filter semantics so
 * they're vitest-testable: type, revealed-state, and the "what does player
 * X know" view. Pure and Foundry-free.
 */
import { canSee, isRevealed } from "./reveal-state.mjs";

export function filterTrackerRows(rows, { type = "", state = "all", playerId = "", groups = [] } = {}) {
  return (rows ?? []).filter((row) => {
    if (type && row.entryType !== type) return false;
    const revealed = row.revealedAll === true || isRevealed(row.audience);
    if (state === "revealed" && !revealed) return false;
    if (state === "unrevealed" && revealed) return false;
    if (playerId && !(row.revealedAll === true || canSee(row.audience, playerId, groups))) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run** — new tests PASS.

- [ ] **Step 5: Wire the Hub tab**

In `CampaignHubPage.mjs`:
- Imports: add `PLAYER_GROUPS_SETTING` to the constants import; add

```js
import { gmSecretRecords } from "../search/live-index.mjs"; // extend the existing live-index import line
import { filterTrackerRows } from "../logic/secrets-tracker.mjs";
import { normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups, upsertGroup, deleteGroup } from "../logic/player-groups.mjs";
import { visibleRelRows } from "../logic/rel-reveals.mjs";
import { promptAudience, sendRevealWhisper } from "./audience-dialog.mjs";
```

- `HUB_STATE`: add `secretsType: "", secretsState: "all", secretsPlayer: ""`.
- `TABS.primary.tabs`: append `{ id: "secrets", icon: "fa-solid fa-user-secret" }`; `PARTS.main.scrollable`: append `".mej-cc-secrets-list"`.
- `actions`: add `secretsSetFilter`, `trackerAudience`, `addGroup`, `editGroup`, `deleteGroup` mapped to the statics below.
- In `_prepareBodyContext`, after `context.dashboards = ...`:

```js
    // Secrets tracker (spec §7): GM-only tab — players must not even see
    // the tab header, so drop it from the prepared tab set.
    if (isGM) context.secrets = await this.#secretsContext();
    else if (context.subtabs?.secrets) delete context.subtabs.secrets;
```

- Context assembly + handlers (private methods/statics on the class):

```js
  /** Assemble every secret in the campaign for the tracker (GM-only path). */
  async #secretsContext() {
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const rows = [];
    // 1. Block secrets, via the index (spec §9).
    for (const rec of gmSecretRecords()) {
      const entry = fromUuidSync(rec.uuid);
      const reveals = entry?.getFlag(MODULE_ID, "secretReveals") ?? {};
      for (const s of rec.secrets) {
        rows.push({ kind: "block", entryUuid: rec.uuid, entryName: rec.name, entryType: rec.type, secretId: s.id, preview: s.preview, audience: normalizeAudience(reveals[s.id]), revealedAll: s.revealedAll });
      }
    }
    // 2. Session checklist items + 3. hidden/secret relationships — walk MEJ pages once.
    for (const entry of game.journal?.contents ?? []) {
      for (const page of entry.pages?.contents ?? []) {
        const type = game.MonksEnhancedJournal.getMEJType(page);
        if (!type) continue;
        if (type === "session") {
          for (const s of page.flags?.[MODULE_ID]?.session?.secrets ?? []) {
            rows.push({ kind: "session", entryUuid: entry.uuid, entryName: entry.name, entryType: type, secretId: s.id, preview: s.text ?? "", audience: normalizeAudience(s.audience), revealedAll: s.revealed === true });
          }
        }
        const relRows = visibleRelRows(page.flags?.["monks-enhanced-journal"]?.relationships, entry.getFlag(MODULE_ID, "relReveals") ?? {}, { userId: game.user.id, groups, isGM: true });
        const relReveals = entry.getFlag(MODULE_ID, "relReveals") ?? {};
        for (const r of relRows.filter((r) => r.hidden || r.secretText)) {
          rows.push({ kind: "relationship", entryUuid: entry.uuid, entryName: entry.name, entryType: type, secretId: r.id, preview: r.secretText || r.label, audience: normalizeAudience(r.hidden ? relReveals[r.id]?.row : relReveals[r.id]?.secret), revealedAll: false });
        }
        break; // single-page convention, same as graph-app's graphRows()
      }
    }
    const filtered = filterTrackerRows(rows, { type: this.state.secretsType, state: this.state.secretsState, playerId: this.state.secretsPlayer, groups });
    const audienceLabel = (row) => {
      if (row.revealedAll) return game.i18n.localize(`${I18N}.secrets.everyone`);
      const a = row.audience;
      const names = [
        ...game.users.filter((u) => a.users.includes(u.id)).map((u) => u.name),
        ...groups.filter((g) => a.groups.includes(g.id)).map((g) => g.name)
      ];
      return a.all ? game.i18n.localize(`${I18N}.secrets.everyone`) : names.join(", ");
    };
    return {
      rows: filtered.map((row) => ({ ...row, icon: this.#typeIcon(row.entryType), audienceLabel: audienceLabel(row), canAudience: row.kind !== "block" || !!row.secretId })),
      types: [...new Set(rows.map((r) => r.entryType))].sort().map((t) => ({ value: t, label: this.#typeLabel(t), selected: t === this.state.secretsType })),
      state: this.state.secretsState,
      players: game.users.filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, selected: u.id === this.state.secretsPlayer })),
      groups: groups.map((g) => ({ ...g, memberNames: g.members.map((m) => game.users.get(m)?.name ?? m).join(", ") }))
    };
  }

  static onSecretsSetFilter(event, target) {
    if (!game.user.isGM) return;
    const { filter, value } = target.dataset;
    if (filter === "type") this.state.secretsType = this.state.secretsType === value ? "" : value;
    else if (filter === "state") this.state.secretsState = value;
    else if (filter === "player") this.state.secretsPlayer = this.state.secretsPlayer === value ? "" : value;
    this.render({ parts: ["main"] });
  }

  /** Quick reveal from the tracker: route to the right storage per kind. */
  static async onTrackerAudience(event, target) {
    if (!game.user.isGM) return;
    const row = target.closest("[data-secret-kind]");
    const { secretKind, entryUuid, secretId } = row.dataset;
    const entry = await fromUuid(entryUuid);
    if (!entry) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    if (secretKind === "block") {
      const previous = normalizeAudience((entry.getFlag(MODULE_ID, "secretReveals") ?? {})[secretId]);
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups });
      if (!audience) return;
      await entry.update({ [`flags.${MODULE_ID}.secretReveals.${secretId}`]: audience });
      await sendRevealWhisper({ audience, previousAudience: previous, groups, html: `<p>${foundry.utils.escapeHTML(row.dataset.preview ?? "")}</p>`, entryUuid, entryName: entry.name });
    } else if (secretKind === "session") {
      const page = entry.pages.contents.find((p) => game.MonksEnhancedJournal.getMEJType(p) === "session");
      const secrets = page?.flags?.[MODULE_ID]?.session?.secrets ?? [];
      const item = secrets.find((s) => s.id === secretId);
      if (!item) return;
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: item.audience, groups });
      if (!audience) return;
      await page.update({ [`flags.${MODULE_ID}.session.secrets`]: secrets.map((s) => (s.id === secretId ? { ...s, audience } : s)) });
      await sendRevealWhisper({ audience, previousAudience: item.audience, groups, html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`, entryUuid, entryName: entry.name });
    } else if (secretKind === "relationship") {
      const overlay = (entry.getFlag(MODULE_ID, "relReveals") ?? {})[secretId] ?? {};
      const kind = row.dataset.relKind ?? "row";
      const previous = normalizeAudience(overlay[kind]);
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.relRevealTitle`), audience: previous, groups });
      if (!audience) return;
      await entry.update({ [`flags.${MODULE_ID}.relReveals.${secretId}.${kind}`]: audience });
      await sendRevealWhisper({ audience, previousAudience: previous, groups, html: `<p>${foundry.utils.escapeHTML(row.dataset.preview ?? entry.name)}</p>`, entryUuid, entryName: entry.name });
    }
    this.render({ parts: ["main"] });
  }

  /** Name + member-checkbox dialog; returns {name, members} or null. */
  static async #promptGroup(initial = {}, { titleKey }) {
    const esc = foundry.utils.escapeHTML;
    const players = game.users.filter((u) => !u.isGM);
    const memberRows = players.map((u) =>
      `<label class="mej-cc-audience-row"><input type="checkbox" name="member-${u.id}"${(initial.members ?? []).includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`
    ).join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `<div class="form-group"><label>${game.i18n.localize(`${I18N}.secrets.groupName`)}</label>
          <input type="text" name="name" value="${esc(initial.name ?? "")}" required autofocus></div>
        <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.groupMembers`)}</legend>${memberRows}</fieldset>`,
      ok: {
        label: `${I18N}.hub.save`,
        callback: (event, button) => {
          const name = button.form.elements.name.value.trim();
          if (!name) return null;
          return { name, members: players.filter((u) => button.form.elements[`member-${u.id}`]?.checked).map((u) => u.id) };
        }
      },
      rejectClose: false
    });
  }

  static async onAddGroup() {
    if (!game.user.isGM) return;
    const result = await CampaignHubPage.#promptGroup({}, { titleKey: `${I18N}.secrets.addGroup` });
    if (!result) return;
    const groups = upsertGroup(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), { id: foundry.utils.randomID(8), ...result });
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, groups);
    this.render({ parts: ["main"] });
  }

  static async onEditGroup(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const existing = groups.find((g) => g.id === id);
    if (!existing) return;
    const result = await CampaignHubPage.#promptGroup(existing, { titleKey: `${I18N}.secrets.editGroup` });
    if (!result) return;
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id, ...result }));
    this.render({ parts: ["main"] });
  }

  static async onDeleteGroup(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, deleteGroup(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), id));
    this.render({ parts: ["main"] });
  }
```

In `templates/hub.hbs`, add a fourth tab section after the dashboards tab (same structure; only renders content when `secrets` is present):

```hbs
<div class="tab{{#if subtabs.secrets.active}} active{{/if}}" data-group="primary" data-tab="secrets">
    <div class="tab-inner flexcol mej-cc-secrets">
        {{#if secrets}}
        <div class="mej-cc-secrets-controls">
            {{#each secrets.types}}<button type="button" data-action="secretsSetFilter" data-filter="type" data-value="{{this.value}}" class="{{#if this.selected}}active{{/if}}">{{this.label}}</button>{{/each}}
            <span class="mej-cc-secrets-sep"></span>
            <button type="button" data-action="secretsSetFilter" data-filter="state" data-value="all" class="{{#if (eq secrets.state 'all')}}active{{/if}}">{{localize 'MEJCampaignCompanion.secrets.stateAll'}}</button>
            <button type="button" data-action="secretsSetFilter" data-filter="state" data-value="revealed" class="{{#if (eq secrets.state 'revealed')}}active{{/if}}">{{localize 'MEJCampaignCompanion.secrets.stateRevealed'}}</button>
            <button type="button" data-action="secretsSetFilter" data-filter="state" data-value="unrevealed" class="{{#if (eq secrets.state 'unrevealed')}}active{{/if}}">{{localize 'MEJCampaignCompanion.secrets.stateUnrevealed'}}</button>
            <span class="mej-cc-secrets-sep"></span>
            {{#each secrets.players}}<button type="button" data-action="secretsSetFilter" data-filter="player" data-value="{{this.id}}" class="{{#if this.selected}}active{{/if}}"><i class="fa-solid fa-user"></i> {{this.name}}</button>{{/each}}
        </div>
        <ol class="mej-cc-secrets-list item-list scrollable">
            {{#each secrets.rows}}
            <li class="mej-cc-secret-row item" data-secret-kind="{{this.kind}}" data-entry-uuid="{{this.entryUuid}}" data-secret-id="{{this.secretId}}" data-preview="{{this.preview}}">
                <i class="{{this.icon}}"></i>
                <a class="mej-cc-secret-source" data-action="openIndexRow" data-uuid="{{this.entryUuid}}">{{this.entryName}}</a>
                <span class="mej-cc-secret-preview">{{this.preview}}</span>
                <span class="mej-cc-secret-audience-label">{{#if this.audienceLabel}}{{this.audienceLabel}}{{else}}{{localize 'MEJCampaignCompanion.secrets.chipsNone'}}{{/if}}</span>
                {{#if this.canAudience}}<a data-action="trackerAudience" data-tooltip="{{localize 'MEJCampaignCompanion.secrets.audienceButton'}}"><i class="fa-solid fa-user-secret"></i></a>{{/if}}
            </li>
            {{else}}
            <li class="instruction">{{localize 'MEJCampaignCompanion.secrets.empty'}}</li>
            {{/each}}
        </ol>
        <div class="mej-cc-groups">
            <header>{{localize 'MEJCampaignCompanion.secrets.groupsHeader'}}
                <button type="button" data-action="addGroup"><i class="fa-solid fa-plus"></i> {{localize 'MEJCampaignCompanion.secrets.addGroup'}}</button>
            </header>
            <ul>
                {{#each secrets.groups}}
                <li data-group-id="{{this.id}}"><strong>{{this.name}}</strong> — {{this.memberNames}}
                    <a data-action="editGroup"><i class="fa-solid fa-pen"></i></a>
                    <a data-action="deleteGroup"><i class="fa-solid fa-trash"></i></a>
                </li>
                {{else}}
                <li class="instruction">{{localize 'MEJCampaignCompanion.secrets.noGroups'}}</li>
                {{/each}}
            </ul>
        </div>
        {{/if}}
    </div>
</div>
```

Lang additions inside `secrets`: `"stateAll": "All"`, `"stateRevealed": "Revealed"`, `"stateUnrevealed": "Unrevealed"`, `"empty": "No secrets tracked yet."`, `"groupsHeader": "Player groups"`, `"addGroup": "Add group"`, `"editGroup": "Edit group"`, `"groupName": "Group name"`, `"groupMembers": "Members"`. Add tab label at the Hub's existing tab-label location: `"MEJCampaignCompanion.hub.tabs.secrets": "Secrets"` (follow how `dashboards` is keyed).
CSS: rows as flex with ellipsized preview; `.mej-cc-secrets-controls button.active { … }` matching the timeline order-menu active style.

- [ ] **Step 6: Run** `npm test` — green.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/secrets-tracker.mjs test/secrets-tracker.test.js scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json styles/campaign-companion.css
git commit -m "feat: Hub Secrets tracker tab with filters, quick reveal, and group management"
```

---

### Task 11: Session prep board

**Files:**
- Create: `scripts/apps/prep-board-app.mjs`, `templates/prep-board.hbs`
- Modify: `scripts/campaign-companion.mjs` (prep-board header button for session pages in the existing `getDocumentSheetHeaderButtons` hook), `lang/en.json` (`prep` section), `styles/campaign-companion.css`
- Test: none new (glue; e2e in Task 13)

**Interfaces:**
- Consumes: `outboundRefsForEntry` (Task 4), `sessionData` shape via flags, Tasks 1–2, 5.
- Produces: `openPrepBoard({pageUuid})`; `prepNotes` flag (string) on the session **page** (`flags["mej-campaign-companion"].prepNotes`).

- [ ] **Step 1: Implement the app**

```js
// scripts/apps/prep-board-app.mjs
// Session prep board (spec §8): GM-only floating window bound to one
// Session page. Four zones — attendees, secrets/clues with one-click
// reveal, linked entries (outbound refs + mention badges), scratch notes
// (prepNotes flag, 300ms trailing-debounced like the Phase B attributes).
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeAudience, isRevealed } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { outboundRefsForEntry, mentionBadgeCounts } from "../search/live-index.mjs";
import { promptAudience, sendRevealWhisper } from "./audience-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PrepBoardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["mej-cc-prep-board"],
    window: { title: `${I18N}.prep.title`, icon: "fa-solid fa-clipboard-list", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      revealSecret: PrepBoardApp.onRevealSecret,
      toggleSecret: PrepBoardApp.onToggleSecret,
      openLinked: PrepBoardApp.onOpenLinked
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/prep-board.hbs`, scrollable: [".mej-cc-prep-linked", ".mej-cc-prep-secrets"] } };

  #page;
  #hookId = null;

  constructor({ page }) {
    super({ id: `mej-cc-prep-${page.id}` });
    this.#page = page;
  }

  get page() { return this.#page; }

  async _prepareContext() {
    const page = this.#page;
    const entry = page.parent;
    const session = page.flags?.[MODULE_ID]?.session ?? {};
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const attendees = await Promise.all((session.attendees ?? []).map(async (uuid) => {
      const actor = await fromUuid(uuid).catch(() => null);
      return { uuid, name: actor?.name ?? uuid, img: actor?.img ?? "icons/svg/mystery-man.svg" };
    }));
    const mentions = mentionBadgeCounts();
    const linked = outboundRefsForEntry(entry.uuid).map((r) => ({
      ...r, icon: `fas ${game.MonksEnhancedJournal.getIcon(r.type)}`, mentions: mentions.get(r.uuid) ?? 0
    }));
    return {
      name: entry.name,
      attendees,
      secrets: (session.secrets ?? []).map((s) => ({
        ...s,
        revealedAny: s.revealed === true || isRevealed(s.audience),
        audienceCount: normalizeAudience(s.audience).users.length + normalizeAudience(s.audience).groups.length
      })),
      linked,
      notes: page.flags?.[MODULE_ID]?.prepNotes ?? ""
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const notes = this.element.querySelector(".mej-cc-prep-notes textarea");
    const commit = foundry.utils.debounce(async () => {
      await this.#page.update({ [`flags.${MODULE_ID}.prepNotes`]: notes.value });
    }, 300);
    notes?.addEventListener("input", commit);
    // Live refresh on session-page updates (secrets toggled elsewhere, etc.).
    if (this.#hookId === null) {
      this.#hookId = Hooks.on("updateJournalEntryPage", (page, changes) => {
        if (page.uuid !== this.#page.uuid || !this.rendered) return;
        if (changes?.flags?.[MODULE_ID]?.prepNotes !== undefined) return; // our own debounced write
        this.render();
      });
    }
  }

  _onClose(options) {
    if (this.#hookId !== null) { Hooks.off("updateJournalEntryPage", this.#hookId); this.#hookId = null; }
    super._onClose?.(options);
  }

  static async onRevealSecret(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = this.page.flags?.[MODULE_ID]?.session ?? {};
    const item = (session.secrets ?? []).find((s) => s.id === id);
    if (!item) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: item.audience, groups });
    if (!audience) return;
    const secrets = session.secrets.map((s) => (s.id === id ? { ...s, audience } : s));
    await this.page.update({ [`flags.${MODULE_ID}.session.secrets`]: secrets });
    await sendRevealWhisper({
      audience, previousAudience: item.audience, groups,
      html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
      entryUuid: this.page.parent.uuid, entryName: this.page.parent.name
    });
    this.render();
  }

  static async onToggleSecret(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = this.page.flags?.[MODULE_ID]?.session ?? {};
    const secrets = (session.secrets ?? []).map((s) => {
      if (s.id !== id) return s;
      const revealed = !s.revealed;
      return { ...s, revealed, revealedAt: revealed ? Date.now() : null };
    });
    await this.page.update({ [`flags.${MODULE_ID}.session.secrets`]: secrets });
    this.render();
  }

  static async onOpenLinked(event, target) {
    const entry = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid);
    if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
  }
}

export async function openPrepBoard({ pageUuid }) {
  if (!game.user.isGM) return;
  const page = await fromUuid(pageUuid);
  if (page) new PrepBoardApp({ page }).render(true);
}
```

```hbs
{{!-- templates/prep-board.hbs --}}
<div class="mej-cc-prep flexcol">
    <h3>{{name}}</h3>
    <section class="mej-cc-prep-attendees">
        <header>{{localize 'MEJCampaignCompanion.prep.attendees'}}</header>
        <ul class="flexrow">
            {{#each attendees}}<li data-tooltip="{{this.name}}"><img src="{{this.img}}" alt="{{this.name}}"></li>
            {{else}}<li class="instruction">{{localize 'MEJCampaignCompanion.prep.noAttendees'}}</li>{{/each}}
        </ul>
    </section>
    <section class="mej-cc-prep-secrets">
        <header>{{localize 'MEJCampaignCompanion.prep.secrets'}}</header>
        <ol>
            {{#each secrets}}
            <li data-id="{{this.id}}" class="{{#if this.revealedAny}}revealed{{/if}}">
                <a data-action="toggleSecret" data-tooltip="{{localize 'MEJCampaignCompanion.prep.toggleAll'}}"><i class="fa-solid {{#if this.revealed}}fa-eye{{else}}fa-eye-slash{{/if}}"></i></a>
                <span class="mej-cc-prep-secret-text">{{this.text}}</span>
                <a data-action="revealSecret" data-tooltip="{{localize 'MEJCampaignCompanion.secrets.audienceButton'}}">
                    <i class="fa-solid fa-user-secret"></i>{{#if this.audienceCount}}<span class="mej-cc-audience-count">{{this.audienceCount}}</span>{{/if}}
                </a>
            </li>
            {{else}}<li class="instruction">{{localize 'MEJCampaignCompanion.prep.noSecrets'}}</li>{{/each}}
        </ol>
    </section>
    <section class="mej-cc-prep-linked">
        <header>{{localize 'MEJCampaignCompanion.prep.linked'}}</header>
        <ol>
            {{#each linked}}
            <li data-uuid="{{this.uuid}}" data-action="openLinked">
                <i class="{{this.icon}}"></i> {{this.name}}
                {{#if this.mentions}}<span class="mej-cc-mention-badge"><i class="fa-solid fa-link"></i>{{this.mentions}}</span>{{/if}}
            </li>
            {{else}}<li class="instruction">{{localize 'MEJCampaignCompanion.prep.noLinked'}}</li>{{/each}}
        </ol>
    </section>
    <section class="mej-cc-prep-notes flexcol">
        <header>{{localize 'MEJCampaignCompanion.prep.notes'}}</header>
        <textarea placeholder="{{localize 'MEJCampaignCompanion.prep.notesPlaceholder'}}">{{notes}}</textarea>
    </section>
</div>
```

In `campaign-companion.mjs`, inside the existing `getDocumentSheetHeaderButtons` hook body, after the graph button `unshift`:

```js
  // Phase C: prep board on Session sheets (GM-only, spec §8).
  if (game.user.isGM && game.MonksEnhancedJournal.getMEJType(doc) === "session") {
    buttons.unshift({
      label: `${I18N}.prep.open`,
      class: "mej-cc-open-prep",
      icon: "fas fa-clipboard-list",
      onclick: async () => {
        const { openPrepBoard } = await import("./apps/prep-board-app.mjs");
        openPrepBoard({ pageUuid: doc.uuid });
      }
    });
  }
```

Lang: new top-level `prep` section: `"title": "Session prep board"`, `"open": "Prep board"`, `"attendees": "Attendees"`, `"noAttendees": "No attendees yet."`, `"secrets": "Secrets & clues"`, `"noSecrets": "No secrets on this session."`, `"toggleAll": "Reveal/hide for everyone"`, `"linked": "Linked entries"`, `"noLinked": "No linked entries."`, `"notes": "Scratch notes"`, `"notesPlaceholder": "GM-only notes for running this session…"`.
CSS: `.mej-cc-prep section { margin-bottom: 8px; } .mej-cc-prep-attendees img { width: 36px; height: 36px; border-radius: 4px; } .mej-cc-prep-secrets li.revealed .mej-cc-prep-secret-text { opacity: 0.6; text-decoration: line-through; } .mej-cc-prep-notes textarea { min-height: 90px; width: 100%; }`.

- [ ] **Step 2: Verify** `node --check scripts/apps/prep-board-app.mjs`; `npm test` green.

- [ ] **Step 3: Commit**

```bash
git add scripts/apps/prep-board-app.mjs templates/prep-board.hbs scripts/campaign-companion.mjs lang/en.json styles/campaign-companion.css
git commit -m "feat: session prep board (attendees, quick reveal, linked entries, scratch notes)"
```

---

### Task 12: Export secret stripping

**Files:**
- Modify: `scripts/logic/doc-export-snapshot.mjs`
- Test: extend `test/doc-export-snapshot.test.js` (or the existing export test file — match its name)

**Interfaces:**
- Consumes: `stripSecretSections` (Task 3); existing `recordSnapshot(row, opts)` / `sessionBodyHtml` in the same file (both build body HTML from `bodyText(row.page)`; `opts.includeGM` already exists).
- Produces: player-safe exports (`includeGM: false`) contain no unrevealed secret sections (audience-only reveals also excluded — spec §11); `includeGM: true` exports everything.

- [ ] **Step 1: Write the failing test**

```js
it("recordSnapshot strips unrevealed secret sections unless includeGM (Phase C)", () => {
  const page = { name: "P", text: { content: '<p>public</p><section class="secret" id="secret-z"><p>hidden-truth</p></section>' }, flags: {} };
  const row = { page, type: "place" };
  const opts = { includeGM: false, relationships: [], labels: { relationships: "Rel" }, formatCampaignDate: () => "" };
  const safe = recordSnapshot(row, opts);
  expect(JSON.stringify(safe)).not.toContain("hidden-truth");
  const gm = recordSnapshot(row, { ...opts, includeGM: true });
  expect(JSON.stringify(gm)).toContain("hidden-truth");
});
```

(Adapt the `row`/`opts` fixture shape to the file's existing recordSnapshot tests — copy a passing fixture and add the secret section to its content.)

- [ ] **Step 2: Run to verify FAIL** (secret text currently rides into the snapshot).

- [ ] **Step 3: Implement**

In `doc-export-snapshot.mjs`: add `import { stripSecretSections } from "./secret-blocks.mjs";` and wrap the two body-HTML build sites:
- In `recordSnapshot` (the `const html = bodyText(row.page) + relationshipsHtml(...)` line):

```js
  const html = stripSecretSections(bodyText(row.page), { includeAll: includeGM }) + relationshipsHtml(relationships, includeGM, labels.relationships);
```

- In `sessionBodyHtml`, wrap its `bodyText(page)` usage the same way — it takes no `includeGM` today, so add `includeGM` to its options object parameter, pass it through from `recordSnapshot`'s session branch, and apply `stripSecretSections(bodyText(page), { includeAll: includeGM })`.

- [ ] **Step 4: Run** `npm test` — green (existing export tests unaffected: fixtures without secret sections pass through unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-export-snapshot.mjs test/*.test.js
git commit -m "fix: exclude unrevealed secret sections from player-safe docx export"
```

---

### Task 13: e2e coverage

**Files:**
- Create: `tests/e2e/09-secrets.spec.mjs`, `tests/e2e/10-secrets-hub.spec.mjs`

**Interfaces:**
- Consumes: the harness in `tests/e2e/helpers/foundry.mjs` (`login(page, "Gamemaster"|"User 1"|"User 2")`, `TT_PREFIX`, `settle`, `trackConsoleErrors`/`assertNoConsoleErrors`, `cleanupAsGm`, `KNOWN_MEJ_SESSION_ICON_404`); two-client pattern from `06-player-collab.spec.mjs` (`browser.newContext({viewport:{width:1440,height:900}, screen:{width:1440,height:900}})`).
- Run with the repo's Playwright config against the Foundry v14 test env (World A), same as the existing 9 spec files.

- [ ] **Step 1: Write `09-secrets.spec.mjs`** — block-secret reveal, two clients:

```js
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEW = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const SECRET_HTML = '<p>Public intro.</p><section class="secret" id="secret-e2e1"><p>TT-secret-vampire</p></section>';

async function createPlaceWithSecret(page, name) {
  return page.evaluate(async ({ n, html }) => {
    const entry = await JournalEntry.create({
      name: n,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      pages: [{ name: n, type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: html } }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html: SECRET_HTML });
}

async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  return page.locator("#MonksEnhancedJournal");
}

test.describe("09 secrets", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "playerGroups", []);
      });
    });
  });

  test("GM reveals a block to User 1: A sees block + whisper, User 2 sees neither", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Secret-Place`);
    const gmShell = await openEntry(page, id);
    // GM sees the secret and the audience button.
    await expect(gmShell.locator("section.secret")).toHaveCount(1);
    const btn = gmShell.locator(".mej-cc-secret-audience");
    await expect(btn).toHaveCount(1);

    // Player 1 before reveal: no secret content.
    const p1Ctx = await browser.newContext(VIEW);
    const p1 = await p1Ctx.newPage();
    await login(p1, "User 1");
    const p1Shell = await openEntry(p1, id);
    await expect(p1Shell.locator("section.secret")).toHaveCount(0);
    await expect(p1Shell).not.toContainText("TT-secret-vampire");

    // GM reveals to User 1.
    await btn.click();
    await settle(page, 300);
    const dialog = page.locator(".dialog, dialog.application").last();
    const u1Id = await page.evaluate(() => game.users.getName("User 1").id);
    await dialog.locator(`input[name="user-${u1Id}"]`).check();
    await dialog.locator('button[data-action="ok"], button.ok, button:has-text("Apply")').first().click();
    await settle(page, 800);

    // Player 1 now sees the block (live update) and got a whisper.
    await expect(p1Shell.locator("section.secret.mej-cc-revealed-to-you")).toHaveCount(1);
    await expect(p1Shell).toContainText("TT-secret-vampire");
    const whispered = await p1.evaluate(() =>
      game.messages.contents.some((m) => m.content?.includes("TT-secret-vampire") && m.whisper?.length)
    );
    expect(whispered).toBe(true);

    // Player 2 sees neither.
    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    const p2Shell = await openEntry(p2, id);
    await expect(p2Shell.locator("section.secret")).toHaveCount(0);
    const p2Whisper = await p2.evaluate(() =>
      game.messages.contents.some((m) => m.content?.includes("TT-secret-vampire") && m.whisper?.includes(game.user.id))
    );
    expect(p2Whisper).toBe(false);

    await p1Ctx.close();
    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });

  test("group reveal follows live membership", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const { id } = await createPlaceWithSecret(page, `${TT_PREFIX}Group-Place`);
    // Group contains only User 1; reveal to the group.
    await page.evaluate(async (entryId) => {
      const u1 = game.users.getName("User 1").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1] }]);
      const entry = game.journal.get(entryId);
      await entry.update({ "flags.mej-campaign-companion.secretReveals.secret-e2e1": { users: [], groups: ["gA"], all: false, revealedAt: 1 } });
    }, id);

    const p2Ctx = await browser.newContext(VIEW);
    const p2 = await p2Ctx.newPage();
    await login(p2, "User 2");
    let p2Shell = await openEntry(p2, id);
    await expect(p2Shell.locator("section.secret")).toHaveCount(0);

    // User 2 joins the group -> sees the previously revealed secret.
    await page.evaluate(async () => {
      const u1 = game.users.getName("User 1").id;
      const u2 = game.users.getName("User 2").id;
      await game.settings.set("mej-campaign-companion", "playerGroups", [{ id: "gA", name: "TT Group", members: [u1, u2] }]);
    });
    await settle(p2, 600);
    p2Shell = await openEntry(p2, id); // reopen to re-render with new membership
    await expect(p2Shell).toContainText("TT-secret-vampire");

    await p2Ctx.close();
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 2: Write `10-secrets-hub.spec.mjs`** — tracker + prep board (single GM client):

```js
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

test.describe("10 secrets hub + prep board", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "playerGroups", []);
      });
    });
  });

  test("tracker lists block + session secrets; player filter narrows; prep board reveals", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const { placeId, sessionId } = await page.evaluate(async ({ prefix }) => {
      const place = await JournalEntry.create({
        name: `${prefix}Tracker-Place`,
        pages: [{ name: "p", type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: '<section class="secret" id="secret-t1"><p>tracker-block-secret</p></section>' } }]
      });
      const session = await JournalEntry.create({
        name: `${prefix}Tracker-Session`,
        pages: [{ name: "s", type: "mej-campaign-companion.session", flags: { "mej-campaign-companion": { session: { sessionNumber: 1, campaignDate: null, attendees: [], secrets: [{ id: "c1", text: "tracker-clue", revealed: false, revealedAt: null }] } }, "monks-enhanced-journal": { type: "session" } } }]
      });
      const u1 = game.users.getName("User 1").id;
      await place.update({ "flags.mej-campaign-companion.secretReveals.secret-t1": { users: [u1], groups: [], all: false, revealedAt: 1 } });
      return { placeId: place.id, sessionId: session.id };
    }, { prefix: TT_PREFIX });

    // Open Hub -> Secrets tab.
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, placeId);
    await settle(page, 500);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator('nav.sheet-tabs a[data-tab="secrets"]').click();
    await settle(page, 300);

    const rows = shell.locator(".mej-cc-secret-row");
    await expect(rows.filter({ hasText: "tracker-block-secret" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "tracker-clue" })).toHaveCount(1);

    // "What does User 1 know" -> only the block secret remains.
    await shell.locator('.mej-cc-secrets-controls button[data-filter="player"]', { hasText: "User 1" }).click();
    await settle(page, 300);
    await expect(shell.locator(".mej-cc-secret-row").filter({ hasText: "tracker-clue" })).toHaveCount(0);
    await expect(shell.locator(".mej-cc-secret-row").filter({ hasText: "tracker-block-secret" })).toHaveCount(1);

    // Prep board: open from the session sheet header, toggle the clue to everyone.
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, sessionId);
    await settle(page, 500);
    await page.locator(".mej-cc-open-prep").first().click();
    await settle(page, 500);
    const board = page.locator(".mej-cc-prep-board");
    await expect(board.locator(".mej-cc-prep-secrets li", { hasText: "tracker-clue" })).toHaveCount(1);
    await board.locator('.mej-cc-prep-secrets li a[data-action="toggleSecret"]').first().click();
    await settle(page, 500);
    const revealed = await page.evaluate((id) => {
      const pageDoc = game.journal.get(id).pages.contents[0];
      return pageDoc.flags["mej-campaign-companion"].session.secrets[0].revealed;
    }, sessionId);
    expect(revealed).toBe(true);

    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 3: Run** the two new specs against the test env (same runner as the existing suite; consult `tests/e2e/README` / repo scripts for the exact command used in Phase B — `npx playwright test tests/e2e/09-secrets.spec.mjs tests/e2e/10-secrets-hub.spec.mjs`). Debug selectors/timing against the live DOM as needed — the dialog button selector in 09 is the most likely first failure; align it with what DialogV2 actually renders.
Expected: both specs PASS, and the full e2e suite still passes.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/09-secrets.spec.mjs tests/e2e/10-secrets-hub.spec.mjs
git commit -m "test: e2e coverage for secret reveal, live groups, tracker, prep board"
```

---

### Task 14: Docs, version, release prep

**Files:**
- Modify: `module.json` (version `0.3.0`; download `https://github.com/bularzik/mej-campaign-companion/releases/download/0.3.0/module.zip`), `README.md`, `CHANGELOG.md`

- [ ] **Step 1: `module.json`** — bump `"version": "0.3.0"` and repoint `"download"` to the 0.3.0 asset URL (manifest URL stays `releases/latest/download/module.json`).

- [ ] **Step 2: README** — add a "Secrets layer (0.3.0)" feature section describing: block-level secrets on native secret sections with per-player/group reveal; named player groups with live membership; relationship reveals + graph edge labels; the Hub Secrets tab (filters, "what does player X know", group management); the session prep board; reveal whispers. Include the trust-model disclaimer verbatim in spirit with the existing media-relay one, e.g.:

> **Trust model:** like Foundry's own secret blocks and MEJ's GM notes, secret text is hidden by client-side filtering — the data still replicates to any client that can see the journal entry. A technically savvy player could read it from the raw document data. Do not use this module to protect genuinely sensitive information.

- [ ] **Step 3: CHANGELOG** — add a `## 0.3.0` section listing the features above plus "player-safe docx export now excludes unrevealed secret blocks".

- [ ] **Step 4: Run** `npm test` (full green) and the full e2e suite one final time.

- [ ] **Step 5: Commit**

```bash
git add module.json README.md CHANGELOG.md
git commit -m "docs: 0.3.0 secrets layer — README, changelog, version bump"
```

---

## Self-Review Notes (resolved during planning)

- **Spec coverage:** §3→T1+T2, §4→T1/T6/T7/T9/T11, §5→T3/T4/T6, §6→T7+T8, §7→T10, §8→T11, §9→T4, §10→T5 (whisper), §11→T6 (GM-only writes)/T12 (export), §12→per-task tests + T13. All spec sections mapped.
- **`field-extractors.mjs` intentionally unchanged** (audience-only session secrets stay out of the shared public index field) — T9 carries the guard test and rationale.
- **Type consistency spot-checks:** `normalizeAudience` shape `{users, groups, all, revealedAt}` used identically in T1/T5/T6/T7/T9/T10/T11; flag names `secretReveals`/`relReveals`/`prepNotes` consistent across T6/T7/T10/T11 and the e2e specs; `visibleRelRows` row shape consistent between T7 (definition), T8 (graph), T10 (tracker).
- Placeholder scan: no TBD/TODO/"similar to Task N"; every code step carries the actual code.
