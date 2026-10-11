# Party Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 0.25.0 Player Connections with party relationships: one
party row per entity pair, stored in a per-campaign notebook that
Contributors own, rendered inside MEJ's own Relationships list, written with
no GM online.

**Architecture:** Pure, Foundry-free logic (`logic/party-rows.mjs`,
`logic/party-access.mjs`) holds the model, rules and update paths. A GM-seat
hook keeps one hidden notebook JournalEntry per campaign and syncs its
ownership from Contributors. A render hook augments MEJ's rendered list
(lines under GM rows, extra lines for party-only pairs, drop + Add picker)
and writes straight to the notebook. The graph and export read the same
rows. All 0.25.0 player-connection modules, relay and socket actions go.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, ApplicationV2,
DialogV2), Monk's Enhanced Journal 13.06/14.01, vitest 3 (+ jsdom for DOM
builders), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-10-party-relationships-design.md`

## Global Constraints

- Companion features never patch MEJ: only render-hook injection and
  `logic/mej-wraps.mjs` wraps.
- Writes are per-field keyed `update()` paths, never a whole-flag `setFlag`;
  unknown row fields must survive every write (spec §2.3, §5.1).
- No GM relay, no socket action for any party-row write (spec decision
  "No GM needs to be connected").
- No migration (pre-1.0 releases are test-only): old `playerConnections`
  page flags are ignored; the GM seat may delete them on `ready`.
- Labels: plain text, trimmed, 0–200 chars, optional; set with
  `textContent`/escaped, never parsed as HTML.
- Setting key stays `playerConnectionsEnabled`; label "Players can add party
  relationships".
- Styling uses the readability ink tokens (`--mej-cc-ink`,
  `--mej-cc-ink-muted`, `--mej-cc-chip-bg`) on MEJ's classes.
- Unit tests: `npx vitest run` from the worktree root. e2e: specs 33 and 29
  only, v13 (`npm run e2e:v13 -- <spec>`) and v14 (`npx playwright test <spec>`);
  time-box live runs.
- PR bodies carry no Claude attribution footer (user rule).

## Deviations from the spec (decided while planning — confirm at review)

1. **No socket fallback for notebook creation** (spec §2.4). The GM seat
   creates notebooks on `ready` and whenever a campaign gains a Contributor;
   a player in a campaign with no notebook gets a toast
   ("A GM must open the world once before party relationships can be
   added"). Keeps the "no relay" property absolute.
2. **Labels keyed by side `a`/`b`, not by uuid** (spec §2.3). A uuid holds
   `.`, which Foundry's `update()` treats as a path separator.
   `labels: { a: "...", b: "..." }`.
3. **pairId from entry ids** (`<idLow>-<idHigh>`), and party rows link
   **world** JournalEntries only (no compendium targets). Readers never
   trust the key for identity — identity is the `a`/`b` pair — because an
   Omnipresence sync rewrites uuids inside flags but not flag keys.

## Review Focus

1. **Omnipresence-synced notebook:** `a`/`b` uuids rewritten, keys not —
   duplicate detection, `linesForEntry` and writes must work from `a`/`b`
   and the stored key, never a recomputed key. Test in Task 1.
2. **Typing while someone else saves:** a notebook update re-renders the
   sheet; the input being typed in must keep its text and caret (reuse
   `trackEditing`). Test in Task 5.
3. **Entry the viewer owns:** a player who owns the entry gets MEJ's own
   drop (GM row); the companion's drop handler must not also fire. Test in
   Task 5 (`dropMode`).
4. **MEJ list empty for this viewer** (`.instruction` div instead of
   `ol.item-list`): party-only lines must still render, in a list the
   companion creates. Test in Task 5.
5. **Contributor removed while a notebook exists:** ownership sync must
   lower that user back to the default, not leave OWNER behind. Test in
   Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/logic/party-rows.mjs` (new) | Pure model: pairId, normalize, find, target eligibility, lines for an entry, update paths, export lines |
| `scripts/logic/party-access.mjs` (new) | Pure seam: `partyWriters`, `partyReaders`, `notebookOwnership` |
| `scripts/data/party-notebook.mjs` (new) | Foundry glue: find/ensure notebook, sync ownership, readable notebooks |
| `scripts/hooks/party-notebook.mjs` (new) | GM-seat lifecycle hooks, sidebar hiding, view refresh on notebook change, old-flag cleanup |
| `scripts/apps/inline-edit.mjs` (new, moved) | `trackEditing`, `shouldKeepBlock`, `debounce`, `DEBOUNCE_MS` from 0.25.0 |
| `scripts/apps/party-lines.mjs` (new) | Pure DOM builders: party line, party-only row, Add button |
| `scripts/apps/party-target-picker.mjs` (new) | DialogV2 picker: search + list, returns a uuid |
| `scripts/hooks/party-relationships-ui.mjs` (new) | Render hook: inject lines, drop, Add, saves |
| `scripts/logic/rel-tab-visibility.mjs`, `scripts/hooks/rel-tab-wrap.mjs` | Retarget rule 2/3 to party rows |
| `scripts/logic/graph-rows.mjs`, `scripts/logic/graph-data.mjs`, `scripts/apps/hub-graph-pane.mjs`, `scripts/apps/CampaignHubPage.mjs`, `templates/hub.hbs` | Party edges |
| `scripts/apps/export-dialog.mjs`, `scripts/logic/doc-export-snapshot.mjs` | Party export list |
| `scripts/logic/campaigns.mjs`, `scripts/data/campaign-store.mjs`, `scripts/hooks/retro-link.mjs` | Notebook exclusion |
| Removed | `logic/player-connections.mjs`, `hooks/player-connections-{ui,relay,index}.mjs`, `apps/player-connection-dialog.mjs`, `apps/player-connections-block.mjs`, their tests, socket actions |

---

### Task 1: Pure party-row model

**Files:**
- Create: `scripts/logic/party-rows.mjs`
- Modify: `scripts/constants.mjs` (add constants next to `PLAYER_CONNECTIONS_FLAG`, line 166)
- Test: `test/party-rows.test.js`

**Interfaces:**
- Produces:
  - constants `PARTY_NOTEBOOK_FLAG = "partyNotebook"`, `PARTY_ROWS_FLAG = "partyRows"`
  - `LABEL_MAX = 200`
  - `entryIdOf(uuid: string): string|null` — id of a world JournalEntry uuid
  - `pairId(uuidA, uuidB): string|null`
  - `normalizeRows(flagValue): Row[]` where `Row = { key, a, b, labels:{a,b}, createdBy, createdName, editedBy, editedName, updated }`
  - `findPair(rows, uuidA, uuidB): Row|null`
  - `sideOf(row, uuid): "a"|"b"|null`
  - `targetProblem(target, ctx): null|"not-journal"|"self"|"no-access"|"type-not-allowed"` with `ctx = { sourceUuid, allowed:string[], typeOf(doc), canLimited(doc) }`
  - `eligibleTargets(entries, ctx, filter=""): {uuid,name,type}[]`
  - `linesForEntry(uuid, notebooks, { canLimited(uuid) }): Line[]` where `notebooks = [{ uuid, campaignName, rows: Row[] }]` and `Line = { notebookUuid, key, campaignName, other, label, otherLabel, side, editedName }`
  - `createRowUpdate({ sourceUuid, targetUuid, user:{id,name}, now }): { key, update }`
  - `labelUpdate(row, side, text, { user, now }): object|null` (null when text invalid)
  - `deleteUpdate(key): object`
  - `exportLines(lines, labels): {text, children:[]}[]` with `labels.edited(name)`

- [ ] **Step 1: Add constants**

In `scripts/constants.mjs`, after line 169 (`PLAYER_CONNECTION_RESULT_ACTION`):

```js
/** Party relationships (spec 2026-10-10): notebook marker and row map on the notebook JournalEntry. */
export const PARTY_NOTEBOOK_FLAG = "partyNotebook";
export const PARTY_ROWS_FLAG = "partyRows";
```

- [ ] **Step 2: Write the failing tests**

`test/party-rows.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  LABEL_MAX, entryIdOf, pairId, normalizeRows, findPair, sideOf, targetProblem, eligibleTargets,
  linesForEntry, createRowUpdate, labelUpdate, deleteUpdate, exportLines
} from "../scripts/logic/party-rows.mjs";

const A = "JournalEntry.aaaaaaaaaaaaaaaa";
const B = "JournalEntry.bbbbbbbbbbbbbbbb";
const C = "JournalEntry.cccccccccccccccc";
const P = "mej-campaign-companion";

describe("entryIdOf / pairId", () => {
  it("accepts world JournalEntry uuids only", () => {
    expect(entryIdOf(A)).toBe("aaaaaaaaaaaaaaaa");
    expect(entryIdOf("Compendium.x.y.JournalEntry.aaaaaaaaaaaaaaaa")).toBeNull();
    expect(entryIdOf("JournalEntry.a.JournalEntryPage.b")).toBeNull();
    expect(entryIdOf(null)).toBeNull();
  });
  it("is order independent and flag-safe", () => {
    expect(pairId(A, B)).toBe("aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb");
    expect(pairId(B, A)).toBe(pairId(A, B));
    expect(pairId(A, B)).not.toMatch(/[.|]/);
  });
  it("null for self or non-world uuids", () => {
    expect(pairId(A, A)).toBeNull();
    expect(pairId(A, "Compendium.x.y.JournalEntry.b")).toBeNull();
  });
});

describe("normalizeRows", () => {
  it("skips malformed rows and coerces fields", () => {
    const rows = normalizeRows({
      k1: { a: A, b: B, labels: { a: "Sister of", b: 7 }, createdName: "Dana", editedName: "Jo", updated: 5 },
      bad1: { a: A },
      bad2: "nope",
      bad3: { a: A, b: A }
    });
    expect(rows).toEqual([{
      key: "k1", a: A, b: B, labels: { a: "Sister of", b: "7" },
      createdBy: "", createdName: "Dana", editedBy: "", editedName: "Jo", updated: 5
    }]);
  });
  it("nullish and arrays give []", () => {
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows([])).toEqual([]);
  });
  it("non-object labels become empty", () => {
    expect(normalizeRows({ k: { a: A, b: B, labels: "x" } })[0].labels).toEqual({ a: "", b: "" });
  });
});

describe("findPair / sideOf (identity from a/b, never the key - Review Focus 1)", () => {
  // Omnipresence rewrote the uuids but kept the old key.
  const rows = normalizeRows({ "oldid1-oldid2": { a: B, b: A, labels: { a: "x", b: "y" } } });
  it("finds a pair in either order under a stale key", () => {
    expect(findPair(rows, A, B)?.key).toBe("oldid1-oldid2");
    expect(findPair(rows, B, A)?.key).toBe("oldid1-oldid2");
    expect(findPair(rows, A, C)).toBeNull();
  });
  it("sideOf reads the stored a/b", () => {
    expect(sideOf(rows[0], B)).toBe("a");
    expect(sideOf(rows[0], A)).toBe("b");
    expect(sideOf(rows[0], C)).toBeNull();
  });
});

describe("targetProblem / eligibleTargets", () => {
  const doc = (uuid, name, type, limited = true) => ({ uuid, name, type, limited });
  const ctx = { sourceUuid: A, allowed: ["person", "place"], typeOf: (d) => d.type, canLimited: (d) => d.limited };
  it("reasons", () => {
    expect(targetProblem(null, ctx)).toBe("not-journal");
    expect(targetProblem(doc(A, "A", "person"), ctx)).toBe("self");
    expect(targetProblem(doc(B, "B", "person", false), ctx)).toBe("no-access");
    expect(targetProblem(doc(B, "B", "quest"), ctx)).toBe("type-not-allowed");
    expect(targetProblem(doc("Compendium.x.y.JournalEntry.z", "Z", "person"), ctx)).toBe("not-journal");
    expect(targetProblem(doc(B, "B", "person"), ctx)).toBeNull();
  });
  it("filters, searches case-insensitively, sorts by name", () => {
    const list = [doc(C, "zed", "place"), doc(B, "Bea", "person"), doc(A, "Self", "person")];
    expect(eligibleTargets(list, ctx).map((r) => r.name)).toEqual(["Bea", "zed"]);
    expect(eligibleTargets(list, ctx, "ZE").map((r) => r.name)).toEqual(["zed"]);
  });
});

describe("linesForEntry", () => {
  const nb = (uuid, campaignName, flag) => ({ uuid, campaignName, rows: normalizeRows(flag) });
  const flag1 = { k1: { a: A, b: B, labels: { a: "Sister of", b: "Older sister" }, editedName: "Jo" } };
  it("returns this entry's side and the other side", () => {
    const lines = linesForEntry(B, [nb("JournalEntry.n1", "Red", flag1)], { canLimited: () => true });
    expect(lines).toEqual([{
      notebookUuid: "JournalEntry.n1", key: "k1", campaignName: "Red", other: A,
      side: "b", label: "Older sister", otherLabel: "Sister of", editedName: "Jo"
    }]);
  });
  it("drops rows whose other end the viewer can't see", () => {
    expect(linesForEntry(A, [nb("n1", "Red", flag1)], { canLimited: (u) => u !== B })).toEqual([]);
  });
  it("keeps the same pair from two notebooks, one line each", () => {
    const lines = linesForEntry(A, [nb("n1", "Red", flag1), nb("n2", "Blue", flag1)], { canLimited: () => true });
    expect(lines.map((l) => l.campaignName)).toEqual(["Red", "Blue"]);
  });
});

describe("update paths", () => {
  const user = { id: "u1", name: "Dana" };
  it("createRowUpdate writes one keyed row with empty labels", () => {
    const { key, update } = createRowUpdate({ sourceUuid: B, targetUuid: A, user, now: 9 });
    expect(key).toBe(pairId(A, B));
    expect(update).toEqual({
      [`flags.${P}.partyRows.${key}`]: {
        a: B, b: A, labels: { a: "", b: "" },
        createdBy: "u1", createdName: "Dana", editedBy: "u1", editedName: "Dana", updated: 9
      }
    });
  });
  it("labelUpdate touches only that side plus edit stamp (unknown fields survive)", () => {
    const row = normalizeRows({ k1: { a: A, b: B } })[0];
    expect(labelUpdate(row, "b", "  Rival ", { user, now: 3 })).toEqual({
      [`flags.${P}.partyRows.k1.labels.b`]: "Rival",
      [`flags.${P}.partyRows.k1.editedBy`]: "u1",
      [`flags.${P}.partyRows.k1.editedName`]: "Dana",
      [`flags.${P}.partyRows.k1.updated`]: 3
    });
  });
  it("labelUpdate refuses over-long or non-string text and bad sides", () => {
    const row = normalizeRows({ k1: { a: A, b: B } })[0];
    expect(labelUpdate(row, "a", "x".repeat(LABEL_MAX + 1), { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "a", 5, { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "c", "x", { user, now: 1 })).toBeNull();
    expect(labelUpdate(row, "a", "", { user, now: 1 })).not.toBeNull();
  });
  it("deleteUpdate uses the -= key", () => {
    expect(deleteUpdate("k1")).toEqual({ [`flags.${P}.partyRows.-=k1`]: null });
  });
});

describe("exportLines", () => {
  const labels = { edited: (n) => `edited by ${n}` };
  it("Name — label (edited by X), sorted by name; empty label omits the dash", () => {
    const lines = [
      { otherName: "Mara", label: "Sister of", editedName: "Jo" },
      { otherName: "Bram", label: "", editedName: "Dana" }
    ];
    expect(exportLines(lines, labels)).toEqual([
      { text: "Bram (edited by Dana)", children: [] },
      { text: "Mara — Sister of (edited by Jo)", children: [] }
    ]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/party-rows.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/logic/party-rows.mjs"`.

- [ ] **Step 4: Implement `scripts/logic/party-rows.mjs`**

```js
// Party relationships (spec 2026-10-10). Pure and Foundry-free: the row
// model, who may target what, the lines one entry shows, and the keyed
// update paths every write uses. Rows live on the campaign's party notebook
// JournalEntry at flags["mej-campaign-companion"].partyRows = {[key]: Row}.
// Identity is the stored a/b pair, never the key: an Omnipresence sync
// rewrites uuids inside flags but leaves flag keys alone.
import { MODULE_ID, PARTY_ROWS_FLAG } from "../constants.mjs";

export const LABEL_MAX = 200;
const ROOT = `flags.${MODULE_ID}.${PARTY_ROWS_FLAG}`;
const WORLD_ENTRY = /^JournalEntry\.([A-Za-z0-9]+)$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** The id of a world JournalEntry uuid, else null (compendium and page uuids are refused). */
export function entryIdOf(uuid) {
  const m = typeof uuid === "string" ? WORLD_ENTRY.exec(uuid) : null;
  return m ? m[1] : null;
}

/** Order-independent, flag-safe key for a pair; null for self or non-world uuids. */
export function pairId(uuidA, uuidB) {
  const x = entryIdOf(uuidA);
  const y = entryIdOf(uuidB);
  if (!x || !y || x === y) return null;
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

export function normalizeRows(flagValue) {
  if (!isObj(flagValue)) return [];
  const rows = [];
  for (const [key, r] of Object.entries(flagValue)) {
    if (!isObj(r) || typeof r.a !== "string" || typeof r.b !== "string" || !r.a || !r.b || r.a === r.b) continue;
    const labels = isObj(r.labels) ? r.labels : {};
    rows.push({
      key, a: r.a, b: r.b,
      labels: { a: str(labels.a), b: str(labels.b) },
      createdBy: str(r.createdBy), createdName: str(r.createdName),
      editedBy: str(r.editedBy), editedName: str(r.editedName),
      updated: Number.isFinite(r.updated) ? r.updated : 0
    });
  }
  return rows;
}

export function sideOf(row, uuid) {
  if (row?.a === uuid) return "a";
  if (row?.b === uuid) return "b";
  return null;
}

export function findPair(rows, uuidA, uuidB) {
  return (rows ?? []).find((r) => (r.a === uuidA && r.b === uuidB) || (r.a === uuidB && r.b === uuidA)) ?? null;
}

export function targetProblem(target, { sourceUuid, allowed, typeOf, canLimited }) {
  if (!target || !entryIdOf(target.uuid)) return "not-journal";
  if (target.uuid === sourceUuid) return "self";
  if (!canLimited(target)) return "no-access";
  const type = typeOf(target);
  if (!type || !(allowed ?? []).includes(type)) return "type-not-allowed";
  return null;
}

export function eligibleTargets(entries, ctx, filter = "") {
  const q = String(filter).trim().toLocaleLowerCase();
  return [...(entries ?? [])]
    .filter((entry) => targetProblem(entry, ctx) === null)
    .filter((entry) => !q || String(entry.name ?? "").toLocaleLowerCase().includes(q))
    .map((entry) => ({ uuid: entry.uuid, name: String(entry.name ?? ""), type: ctx.typeOf(entry) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One line per readable row touching `uuid`, in notebook order (spec §2.5, §3.2). */
export function linesForEntry(uuid, notebooks, { canLimited }) {
  const lines = [];
  for (const nb of notebooks ?? []) {
    for (const row of nb.rows ?? []) {
      const side = sideOf(row, uuid);
      if (!side) continue;
      const other = side === "a" ? row.b : row.a;
      if (!canLimited(other)) continue;
      lines.push({
        notebookUuid: nb.uuid, key: row.key, campaignName: nb.campaignName, other, side,
        label: row.labels[side], otherLabel: row.labels[side === "a" ? "b" : "a"], editedName: row.editedName
      });
    }
  }
  return lines;
}

export function createRowUpdate({ sourceUuid, targetUuid, user, now }) {
  const key = pairId(sourceUuid, targetUuid);
  return {
    key,
    update: {
      [`${ROOT}.${key}`]: {
        a: sourceUuid, b: targetUuid, labels: { a: "", b: "" },
        createdBy: user.id, createdName: user.name, editedBy: user.id, editedName: user.name, updated: now
      }
    }
  };
}

export function labelUpdate(row, side, text, { user, now }) {
  if (side !== "a" && side !== "b" || typeof text !== "string") return null;
  const clean = text.trim();
  if (clean.length > LABEL_MAX) return null;
  const base = `${ROOT}.${row.key}`;
  return {
    [`${base}.labels.${side}`]: clean,
    [`${base}.editedBy`]: user.id,
    [`${base}.editedName`]: user.name,
    [`${base}.updated`]: now
  };
}

export function deleteUpdate(key) {
  return { [`${ROOT}.-=${key}`]: null };
}

/** Word export lines for one entry: `Mara — Sister of (edited by Jo)` (spec §5.2). */
export function exportLines(lines, labels) {
  return [...(lines ?? [])]
    .sort((x, y) => x.otherName.localeCompare(y.otherName))
    .map((l) => ({
      text: [l.otherName, l.label ? `— ${l.label}` : null, l.editedName ? `(${labels.edited(l.editedName)})` : null]
        .filter(Boolean).join(" "),
      children: []
    }));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/party-rows.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/constants.mjs scripts/logic/party-rows.mjs test/party-rows.test.js
git commit -m "feat: party relationships row model"
```

---

### Task 2: Access seam and ownership plan

**Files:**
- Create: `scripts/logic/party-access.mjs`
- Test: `test/party-access.test.js`

**Interfaces:**
- Consumes: `isContributor(user, flag, groups)` and `campaignFlagOf(folder)` from `logic/campaigns.mjs`; `ownershipLevelFor(key, levels)`.
- Produces:
  - `partyWriters(campaign, users, groups): string[]` — non-GM user ids
  - `partyReaders(campaign, levels): number` — ownership default level
  - `notebookOwnership(current, { defaultLevel, writerIds, ownerLevel }): object|null` — the full `ownership` object to write, or null when unchanged

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { partyWriters, partyReaders, notebookOwnership } from "../scripts/logic/party-access.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const campaign = (contributors, ownershipDefault = "observer") => ({ flags: { [P]: { campaign: { ownershipDefault, contributors } } } });
const users = [
  { id: "gm", isGM: true }, { id: "u1", isGM: false }, { id: "u2", isGM: false }, { id: "u3", isGM: false }
];

describe("partyWriters (today: Contributors)", () => {
  it("direct users and group members, never GMs, deduped", () => {
    const c = campaign({ userIds: ["u1", "gm"], groupIds: ["g1"] });
    const groups = [{ id: "g1", name: "Red", members: ["u1", "u2"] }];
    expect(partyWriters(c, users, groups).sort()).toEqual(["u1", "u2"]);
  });
  it("no contributors: nobody", () => expect(partyWriters(campaign(undefined), users, [])).toEqual([]));
});

describe("partyReaders (today: the baseline)", () => {
  it("maps the campaign baseline", () => {
    expect(partyReaders(campaign({}, "observer"), LEVELS)).toBe(2);
    expect(partyReaders(campaign({}, "none"), LEVELS)).toBe(0);
  });
});

describe("notebookOwnership", () => {
  const opts = { defaultLevel: 2, writerIds: ["u1"], ownerLevel: 3 };
  it("sets default and writers", () => {
    expect(notebookOwnership({ default: 0 }, opts)).toEqual({ default: 2, u1: 3 });
  });
  it("removes a writer who left (Review Focus 5) but keeps GM entries", () => {
    const current = { default: 2, u1: 3, u2: 3, gm: 3 };
    expect(notebookOwnership(current, { ...opts, gmIds: ["gm"] })).toEqual({ default: 2, u1: 3, gm: 3 });
  });
  it("null when already right", () => {
    expect(notebookOwnership({ default: 2, u1: 3 }, opts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/party-access.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scripts/logic/party-access.mjs`**

```js
// The one seam for who writes and who reads party relationships (spec
// 2026-10-10 §2.2). Today: writers are the campaign's Contributors, readers
// get the campaign baseline. The future campaign-membership feature changes
// these two functions and nothing else.
import { campaignFlagOf, isContributor, ownershipLevelFor } from "./campaigns.mjs";

export function partyWriters(campaign, users, groups) {
  const flag = campaignFlagOf(campaign);
  return [...new Set((users ?? []).filter((u) => !u.isGM && isContributor(u, flag, groups)).map((u) => u.id))];
}

export function partyReaders(campaign, levels) {
  return ownershipLevelFor(campaignFlagOf(campaign)?.ownershipDefault, levels);
}

/**
 * The notebook's full ownership record, or null when `current` already
 * matches. Users not in `writerIds` lose their explicit entry (they fall back
 * to the default); `gmIds` entries are left alone.
 */
export function notebookOwnership(current, { defaultLevel, writerIds, ownerLevel, gmIds = [] }) {
  const next = { default: defaultLevel };
  for (const id of gmIds) if (current?.[id] !== undefined) next[id] = current[id];
  for (const id of writerIds) next[id] = ownerLevel;
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(next)]);
  const same = [...keys].every((k) => current?.[k] === next[k]);
  return same ? null : next;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/party-access.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/party-access.mjs test/party-access.test.js
git commit -m "feat: party relationships access seam"
```

---

### Task 3: The party notebook (storage, lifecycle, exclusions)

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (add `isPartyNotebook`; extend `isLinkableEntity`)
- Modify: `scripts/data/campaign-store.mjs:172-181` (exclude notebook from `campaignEntries`, `unfiledEntries`)
- Modify: `scripts/hooks/retro-link.mjs:31,81` (exclude notebook)
- Create: `scripts/data/party-notebook.mjs`
- Create: `scripts/hooks/party-notebook.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs:157-165` (register party hooks in place of the two player-connections steps — the old registrations are removed in Task 8; add the new step now, after "relationships ui")
- Test: `test/campaigns.test.js` (extend), `test/party-notebook-directory.test.js`

**Interfaces:**
- Consumes: Task 1 constants and `normalizeRows`; Task 2 `partyWriters`, `partyReaders`, `notebookOwnership`; `getCampaigns()`, `campaignOf`.
- Produces:
  - `isPartyNotebook(entry): boolean` (logic/campaigns.mjs)
  - `partyNotebookOf(campaign): JournalEntry|null`
  - `ensurePartyNotebook(campaign): Promise<JournalEntry|null>` (GM only)
  - `syncNotebookOwnership(campaign): Promise<void>` (GM only)
  - `readableNotebooks(user = game.user): { uuid, campaignName, rows }[]`
  - `hidePartyNotebookRows(root)` (exported for tests)
  - `registerPartyNotebook()`

- [ ] **Step 1: Failing tests for exclusion and sidebar**

Append to `test/campaigns.test.js`:

```js
import { isPartyNotebook, isLinkableEntity } from "../scripts/logic/campaigns.mjs";

describe("isPartyNotebook", () => {
  const nb = { flags: { "mej-campaign-companion": { partyNotebook: true } }, pages: { contents: [] } };
  it("detects the flag", () => {
    expect(isPartyNotebook(nb)).toBe(true);
    expect(isPartyNotebook({ flags: {} })).toBe(false);
    expect(isPartyNotebook(null)).toBe(false);
  });
  it("is never linkable, even if something gave it a MEJ type", () => {
    expect(isLinkableEntity(nb, () => "person")).toBe(false);
  });
});
```

`test/party-notebook-directory.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { hidePartyNotebookRows } from "../scripts/hooks/party-notebook.mjs";

beforeEach(() => {
  globalThis.game = { journal: new Map([
    ["nb", { flags: { "mej-campaign-companion": { partyNotebook: true } } }],
    ["e1", { flags: {} }]
  ]) };
});

describe("hidePartyNotebookRows", () => {
  it("removes notebook rows only, idempotently", () => {
    document.body.innerHTML = `<ol><li data-entry-id="nb"></li><li data-entry-id="e1"></li></ol>`;
    hidePartyNotebookRows(document.body);
    hidePartyNotebookRows(document.body);
    expect([...document.querySelectorAll("li")].map((li) => li.dataset.entryId)).toEqual(["e1"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/campaigns.test.js test/party-notebook-directory.test.js`
Expected: FAIL — `isPartyNotebook` not exported; module `party-notebook.mjs` not found.

- [ ] **Step 3: Implement exclusion**

In `scripts/logic/campaigns.mjs`, import `PARTY_NOTEBOOK_FLAG` with the other constants and add after `isTimelineJournal`:

```js
/** Is this the campaign's hidden party-relationships notebook (spec 2026-10-10 §2.1)? */
export function isPartyNotebook(entry) {
  return entry?.flags?.[MODULE_ID]?.[PARTY_NOTEBOOK_FLAG] === true;
}
```

Change `isLinkableEntity` body to:

```js
  return !!mejTypeOf(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry) && !isPartyNotebook(entry);
```

In `scripts/data/campaign-store.mjs`, import `isPartyNotebook` and change both filters (lines 173-174 and 179-180) to add `&& !isPartyNotebook(e)` after `!isCampaignPortal(e)`.

In `scripts/hooks/retro-link.mjs` lines 31 and 81, extend `isTimelineJournal(x) || isCampaignPortal(x)` with `|| isPartyNotebook(x)` (import it from `../logic/campaigns.mjs`).

- [ ] **Step 4: Implement `scripts/data/party-notebook.mjs`**

```js
// Foundry glue for the per-campaign party notebook (spec 2026-10-10 §2).
// GM-only writers self-check isGM (same convention as campaign-store.mjs).
import { MODULE_ID, I18N, PARTY_NOTEBOOK_FLAG, PARTY_ROWS_FLAG, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { campaignOf, isPartyNotebook } from "../logic/campaigns.mjs";
import { normalizeRows } from "../logic/party-rows.mjs";
import { partyWriters, partyReaders, notebookOwnership } from "../logic/party-access.mjs";
import { getCampaigns } from "./campaign-store.mjs";

/** Direct child of the campaign folder carrying the notebook flag. */
export function partyNotebookOf(campaign) {
  return (campaign?.contents ?? []).find((e) => isPartyNotebook(e)) ?? null;
}

function desiredOwnership(campaign, current) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return notebookOwnership(current ?? {}, {
    defaultLevel: partyReaders(campaign, L),
    writerIds: partyWriters(campaign, game.users.contents, game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
    ownerLevel: L.OWNER,
    gmIds: game.users.filter((u) => u.isGM).map((u) => u.id)
  });
}

/** GM-only. The campaign's notebook, created when missing. */
export async function ensurePartyNotebook(campaign) {
  if (!game.user.isGM || !campaign) return null;
  const existing = partyNotebookOf(campaign);
  if (existing) return existing;
  return JournalEntry.create({
    name: game.i18n.format(`${I18N}.party.notebookName`, { campaign: campaign.name }),
    folder: campaign.id,
    ownership: desiredOwnership(campaign, {}) ?? { default: 0 },
    flags: { [MODULE_ID]: { [PARTY_NOTEBOOK_FLAG]: true, [PARTY_ROWS_FLAG]: {} } }
  });
}

/** GM-only. Bring the notebook's ownership in line with the seam (Review Focus 5). */
export async function syncNotebookOwnership(campaign) {
  if (!game.user.isGM) return;
  const nb = partyNotebookOf(campaign);
  if (!nb) return;
  const next = desiredOwnership(campaign, nb.ownership);
  if (next) await nb.update({ ownership: next }, { diff: false, recursive: false });
}

/** Every notebook this user can read, with parsed rows. */
export function readableNotebooks(user = game.user) {
  return game.journal.contents
    .filter((e) => isPartyNotebook(e) && (user.isGM || e.testUserPermission(user, "OBSERVER")))
    .map((e) => ({ uuid: e.uuid, campaignName: campaignOf(e)?.name ?? "", rows: normalizeRows(e.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]) }));
}

/** The notebook a row added from `entry` goes into; null when none (or not in a campaign). */
export function writeNotebookFor(entry) {
  const campaign = campaignOf(entry);
  return campaign ? partyNotebookOf(campaign) : null;
}

/** Campaigns that need a notebook: any with at least one writer. */
export function campaignsNeedingNotebooks() {
  const groups = game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING);
  return getCampaigns().filter((c) => partyWriters(c, game.users.contents, groups).length > 0);
}
```

Note on `ownership` update: Foundry merges object updates; `{ diff: false, recursive: false }` makes the ownership object replace wholesale so removed writers actually lose OWNER. If v13 rejects `recursive: false` on a nested key, fall back to writing `"ownership.-=<id>": null` for each removed id plus the new values — verify live in Task 9 step 3.

- [ ] **Step 5: Implement `scripts/hooks/party-notebook.mjs`**

```js
// Party notebook lifecycle (spec 2026-10-10 §4.4). GM seat (elected active
// GM): create notebooks on ready and when a campaign gains writers, and
// keep notebook ownership in step with Contributors and player groups.
// Every seat: hide notebooks from the journal sidebar and re-render open
// sheets when a notebook's rows change.
import { MODULE_ID, CAMPAIGN_FLAG, PLAYER_GROUPS_SETTING, PARTY_ROWS_FLAG, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { isPartyNotebook, isCampaignFolder } from "../logic/campaigns.mjs";
import { ensurePartyNotebook, syncNotebookOwnership, campaignsNeedingNotebooks } from "../data/party-notebook.mjs";
import { getCampaigns } from "../data/campaign-store.mjs";
import { refreshViewsMatching } from "./view-refresh.mjs";

const isWriterSeat = () => game.user.isGM && game.user === game.users.activeGM;

export function hidePartyNotebookRows(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    if (isPartyNotebook(game.journal.get(li.dataset.entryId))) li.remove();
  }
}

async function reconcile(campaigns, { create = true } = {}) {
  for (const c of campaigns) {
    try {
      if (create) await ensurePartyNotebook(c);
      await syncNotebookOwnership(c);
    } catch (err) {
      console.error(`${MODULE_ID} | party notebook sync failed for campaign ${c.id}`, err);
    }
  }
}

/** Pre-1.0: no migration. Drop stray 0.25.0 playerConnections page flags. */
async function dropOldConnectionFlags() {
  for (const entry of game.journal.contents) {
    for (const page of entry.pages.contents) {
      if (page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] === undefined) continue;
      await page.update({ [`flags.${MODULE_ID}.-=${PLAYER_CONNECTIONS_FLAG}`]: null });
    }
  }
}

export function registerPartyNotebook() {
  const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);
  Hooks.on("renderJournalDirectory", (app, html) => hidePartyNotebookRows(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => hidePartyNotebookRows(app?.element ?? null));

  Hooks.once("ready", () => {
    if (!isWriterSeat()) return;
    reconcile(campaignsNeedingNotebooks())
      .then(() => dropOldConnectionFlags())
      .catch((err) => console.error(`${MODULE_ID} | party notebook ready pass failed`, err));
  });
  Hooks.on("updateFolder", (folder, changes) => {
    if (!isWriterSeat() || !isCampaignFolder(folder)) return;
    if (changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] === undefined) return;
    // A campaign that lost all writers keeps its notebook but gets its ownership lowered.
    const needs = campaignsNeedingNotebooks().some((c) => c.id === folder.id);
    reconcile([folder], { create: needs });
  });
  Hooks.on("updateSetting", (setting) => {
    if (setting.key !== `${MODULE_ID}.${PLAYER_GROUPS_SETTING}` || !isWriterSeat()) return;
    reconcile(getCampaigns(), { create: false }).then(() => reconcile(campaignsNeedingNotebooks()));
  });
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!isPartyNotebook(entry) || changes?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG] === undefined) return;
    refreshViewsMatching(null);
  });
}
```

- [ ] **Step 6: Register and add i18n**

In `scripts/integrations/mej-adapter.mjs`, after the `"relationships ui"` step:

```js
  await step("party notebook", async () => {
    const { registerPartyNotebook } = await import("../hooks/party-notebook.mjs");
    registerPartyNotebook();
  });
```

In `lang/en.json`, under the module's root object add a `"party"` block (Task 5 extends it):

```json
"party": {
  "notebookName": "Party relationships — {campaign}"
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run` — Expected: PASS (whole suite; the 0.25.0 tests still pass at this point).

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/campaigns.mjs scripts/data/campaign-store.mjs scripts/hooks/retro-link.mjs scripts/data/party-notebook.mjs scripts/hooks/party-notebook.mjs scripts/integrations/mej-adapter.mjs lang/en.json test/campaigns.test.js test/party-notebook-directory.test.js
git commit -m "feat: per-campaign party notebook with Contributor ownership"
```

---

### Task 4: Relationships tab visibility on party rows

**Files:**
- Modify: `scripts/logic/rel-tab-visibility.mjs:14-17`
- Modify: `scripts/hooks/rel-tab-wrap.mjs` (whole `relTabDecision`, imports)
- Test: `test/rel-tab-visibility.test.js`

**Interfaces:**
- Consumes: `readableNotebooks`, `writeNotebookFor` (Task 3); `linesForEntry` (Task 1).
- Produces: `relationshipsTabVisible({ isGM, visibleGmRows, visiblePartyRows, canAdd })`; `playerConnectionsEnabled()` stays exported from `rel-tab-wrap.mjs`; new export `canAddParty(sheet, entry): boolean` from `rel-tab-wrap.mjs`.

- [ ] **Step 1: Update the tests**

In `test/rel-tab-visibility.test.js` replace `visiblePlayerRows` with `visiblePartyRows` (both the `none` fixture and the rule-2 test; rename the rule-2 title to `"rule 2: a readable party row"`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/rel-tab-visibility.test.js` — Expected: FAIL on rule 2.

- [ ] **Step 3: Implement**

`rel-tab-visibility.mjs`:

```js
export function relationshipsTabVisible({ isGM, visibleGmRows, visiblePartyRows, canAdd }) {
  if (isGM) return true;
  return visibleGmRows > 0 || visiblePartyRows > 0 || canAdd === true;
}
```

Update its header comment: "rule 2: a readable party row (spec 2026-10-10 §3.1)".

In `rel-tab-wrap.mjs`: drop the imports of `PLAYER_CONNECTIONS_FLAG`, `normalizeConnections`, `canSeeConnection`, `incomingConnections`; add

```js
import { readableNotebooks, writeNotebookFor } from "../data/party-notebook.mjs";
import { linesForEntry } from "../logic/party-rows.mjs";

/** Spec §2.5 write rule for adding from this entry: setting on, writer on the notebook, allowed types. */
export function canAddParty(sheet, entry) {
  if (!playerConnectionsEnabled()) return false;
  if ((sheet.allowedRelationships?.length ?? 0) === 0) return false;
  const nb = writeNotebookFor(entry);
  return !!nb && (game.user.isGM || nb.isOwner === true) && entry.testUserPermission(game.user, "LIMITED") === true;
}
```

and in `relTabDecision` replace the `see`/`visiblePlayerRows`/`canAdd` lines with:

```js
  const visiblePartyRows = linesForEntry(entry.uuid, readableNotebooks(), { canLimited }).length;
  const canAdd = canAddParty(sheet, entry);
  return {
    hiddenBySetting,
    visible: relationshipsTabVisible({ isGM: false, visibleGmRows, visiblePartyRows, canAdd })
  };
```

Update the file header's spec reference to 2026-10-10 §3.1.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/rel-tab-visibility.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/rel-tab-visibility.mjs scripts/hooks/rel-tab-wrap.mjs test/rel-tab-visibility.test.js
git commit -m "feat: relationships tab counts party rows"
```

---

### Task 5: Party lines in MEJ's list (UI, drop, Add picker)

**Files:**
- Create: `scripts/apps/inline-edit.mjs` (move `trackEditing`, `shouldKeepBlock` from `hooks/player-connections-ui.mjs:115-176`, and `debounce`, `DEBOUNCE_MS` from `apps/player-connections-block.mjs:15-34`, verbatim; widen the draft selector to `.mej-cc-party-line` — see step 3)
- Create: `scripts/apps/party-lines.mjs`
- Create: `scripts/apps/party-target-picker.mjs`
- Create: `scripts/hooks/party-relationships-ui.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (register UI step after "party notebook")
- Modify: `lang/en.json` (`party` block), `styles/campaign-companion.css` (new rules)
- Test: `test/inline-edit.test.js` (move the `trackEditing`/`shouldKeepBlock` tests from `test/player-connections-ui.test.js` and the `debounce` tests from `test/player-connections-block.test.js`, retargeting imports), `test/party-lines.test.js`

**Interfaces:**
- Consumes: Task 1 (`linesForEntry`, `findPair`, `createRowUpdate`, `labelUpdate`, `deleteUpdate`, `targetProblem`, `eligibleTargets`, `LABEL_MAX`); Task 3 (`readableNotebooks`, `writeNotebookFor`); Task 4 (`canAddParty`, `playerConnectionsEnabled`).
- Produces:
  - `buildPartyLine(doc, { line, editable, labels }, handlers): HTMLElement` — `div.mej-cc-party-line[data-notebook-uuid][data-key]`
  - `buildPartyRow(doc, { line, target, editable, labels }, handlers): HTMLLIElement` — `li.item.flexrow.mej-cc-party-only[data-uuid]`
  - `buildAddButton(doc, { labels }, onClick): HTMLElement` — `div.mej-cc-party-add`
  - `placeLines(list, lines, { gmRowFor(uuid), groupFor(type), build }): void`
  - `dropMode({ isGM, isOwner, canAdd }): "mej"|"party"|"none"`
  - `pickPartyTarget({ sourceName, rows }): Promise<string|null>`
  - `registerPartyRelationshipsUi()`

- [ ] **Step 1: Move `inline-edit.mjs` and its tests**

Create `scripts/apps/inline-edit.mjs` with the header

```js
// Inline edit plumbing shared by Relationships-tab injections: debounced
// saves, and keeping a live block (and the caret) across the re-render a
// save causes (Review Focus 2). Moved from the 0.25.0 player-connections
// modules unchanged except the draft selector.
```

followed by the moved `DEBOUNCE_MS`, `debounce`, `trackEditing`, `shouldKeepBlock` code. In `trackEditing` change `draftOf` to:

```js
  const draftOf = (target) => target?.closest?.(".mej-cc-party-line.new");
```

and the `editing` check's selector to `".mej-cc-party-line.new[data-unsent]"`. Create `test/inline-edit.test.js` from the moved test blocks with imports from `../scripts/apps/inline-edit.mjs`, replacing `mej-cc-pc-note new` fixtures with `mej-cc-party-line new`.

Run: `npx vitest run test/inline-edit.test.js` — Expected: PASS.

- [ ] **Step 2: Failing tests for the DOM builders**

`test/party-lines.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPartyLine, buildPartyRow, buildAddButton, placeLines, dropMode } from "../scripts/apps/party-lines.mjs";
import { DEBOUNCE_MS } from "../scripts/apps/inline-edit.mjs";

const labels = {
  party: "Party", addLabel: "Party: add a label", edited: (n) => `edited by ${n}`,
  remove: "Remove party relationship", add: "Add relationship", fallbackImg: "fallback.svg"
};
const line = (over = {}) => ({ notebookUuid: "JournalEntry.nb", key: "k1", campaignName: "", other: "JournalEntry.m",
  side: "a", label: "Sister of", otherLabel: "", editedName: "Jo", ...over });

afterEach(() => vi.useRealTimers());

describe("buildPartyLine", () => {
  it("read-only: text, no input, no delete; label is text not HTML", () => {
    const el = buildPartyLine(document, { line: line({ label: "<b>x</b>" }), editable: false, labels }, {});
    expect(el.querySelector("input")).toBeNull();
    expect(el.querySelector(".mej-cc-party-label").textContent).toBe("<b>x</b>");
    expect(el.querySelector(".mej-cc-party-delete")).toBeNull();
    expect(el.querySelector(".mej-cc-party-edited").textContent).toBe("edited by Jo");
  });
  it("editable: debounced save with the side and value", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const el = buildPartyLine(document, { line: line(), editable: true, labels }, { save });
    const input = el.querySelector("input");
    input.value = "Rival";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(save).toHaveBeenCalledWith(line(), "Rival");
  });
  it("editable: delete calls remove", () => {
    const remove = vi.fn();
    const el = buildPartyLine(document, { line: line(), editable: true, labels }, { remove });
    el.querySelector(".mej-cc-party-delete").click();
    expect(remove).toHaveBeenCalledWith(line());
  });
  it("an empty-placeholder line (no row yet) creates on first input", () => {
    vi.useFakeTimers();
    const create = vi.fn();
    const el = buildPartyLine(document, { line: null, editable: true, labels }, { create });
    expect(el.classList.contains("new")).toBe(true);
    expect(el.querySelector("input").placeholder).toBe("Party: add a label");
    el.querySelector("input").value = "Ally";
    el.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(create).toHaveBeenCalledWith("Ally");
  });
  it("shows the campaign name when the line carries one", () => {
    const el = buildPartyLine(document, { line: line({ campaignName: "Red" }), editable: false, labels }, {});
    expect(el.querySelector(".mej-cc-party-campaign").textContent).toBe("Red");
  });
});

describe("buildPartyRow", () => {
  it("MEJ row classes, image, clickable name, party line inside", () => {
    const open = vi.fn();
    const li = buildPartyRow(document, {
      line: line(), target: { uuid: "JournalEntry.m", name: "Mara", img: "m.png", type: "person" }, editable: false, labels
    }, { open });
    expect(li.matches("li.item.flexrow.mej-cc-party-only")).toBe(true);
    expect(li.dataset.uuid).toBe("JournalEntry.m");
    expect(li.querySelector("img.item-image.large").getAttribute("src")).toBe("m.png");
    li.querySelector(".item-name a").click();
    expect(open).toHaveBeenCalledWith("JournalEntry.m");
    expect(li.querySelector(".mej-cc-party-line")).not.toBeNull();
  });
});

describe("placeLines (Review Focus 4)", () => {
  it("lines under a GM row go into that row; party-only rows go into their type group", () => {
    document.body.innerHTML = `<ol class="item-list">
      <li><header><div class="name">Person</div></header></li>
      <li class="item" data-uuid="JournalEntry.g"><div class="item-relationship"></div></li>
    </ol>`;
    const list = document.querySelector("ol");
    const built = [];
    placeLines(list, [line({ other: "JournalEntry.g" }), line({ other: "JournalEntry.m", key: "k2" })], {
      gmRowFor: (uuid) => list.querySelector(`li.item[data-uuid="${uuid}"]`),
      typeOf: () => "person",
      groupHeader: () => list.querySelector("li:first-child"),
      buildLine: (l) => { const d = document.createElement("div"); d.className = "line"; built.push(l.key); return d; },
      buildRow: (l) => { const li = document.createElement("li"); li.className = "party-only"; li.dataset.key = l.key; return li; }
    });
    expect(list.querySelector('li[data-uuid="JournalEntry.g"] .item-relationship .line')).not.toBeNull();
    expect(list.querySelector("li.party-only").previousElementSibling.dataset.uuid).toBe("JournalEntry.g");
  });
});

describe("dropMode (Review Focus 3)", () => {
  it("GM and entry owners keep MEJ's drop", () => {
    expect(dropMode({ isGM: true, isOwner: false, canAdd: true })).toBe("mej");
    expect(dropMode({ isGM: false, isOwner: true, canAdd: true })).toBe("mej");
  });
  it("other writers get the party drop; non-writers none", () => {
    expect(dropMode({ isGM: false, isOwner: false, canAdd: true })).toBe("party");
    expect(dropMode({ isGM: false, isOwner: false, canAdd: false })).toBe("none");
  });
});

describe("buildAddButton", () => {
  it("click calls back", () => {
    const onClick = vi.fn();
    buildAddButton(document, { labels }, onClick).querySelector("button").click();
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/party-lines.test.js` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement `scripts/apps/party-lines.mjs`**

```js
// DOM builders for party relationships inside MEJ's Relationships list
// (spec 2026-10-10 §3.2). Pure DOM: the document is injected, every Foundry
// touch comes in through handlers, all row text goes in via textContent.
import { debounce } from "./inline-edit.mjs";
import { LABEL_MAX } from "../logic/party-rows.mjs";

function el(doc, tag, className, text) {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** `line === null` = the empty "Party: add a label" line under a GM row with no party row yet. */
export function buildPartyLine(doc, { line, editable, labels }, handlers = {}) {
  const root = el(doc, "div", `mej-cc-party-line${line ? "" : " new"}`);
  if (line) {
    root.dataset.notebookUuid = line.notebookUuid;
    root.dataset.key = line.key;
  }
  const icon = el(doc, "i", "fa-solid fa-users mej-cc-party-icon");
  icon.dataset.tooltip = labels.party;
  root.append(icon);
  if (editable) {
    const input = el(doc, "input", "item-field mej-cc-party-input");
    input.type = "text";
    input.maxLength = LABEL_MAX;
    input.value = line?.label ?? "";
    input.placeholder = labels.addLabel;
    const send = debounce((value) => (line ? handlers.save?.(line, value) : handlers.create?.(value)));
    input.addEventListener("input", () => send(input.value));
    root.append(input);
  } else {
    root.append(el(doc, "span", "mej-cc-party-label", line?.label ?? ""));
  }
  if (line?.campaignName) root.append(el(doc, "span", "mej-cc-party-campaign", line.campaignName));
  if (line?.editedName) root.append(el(doc, "span", "mej-cc-party-edited", labels.edited(line.editedName)));
  if (line && editable) {
    const del = el(doc, "a", "mej-cc-party-delete");
    del.dataset.tooltip = labels.remove;
    del.append(el(doc, "i", "fas fa-trash"));
    del.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.remove?.(line);
    });
    root.append(del);
  }
  return root;
}

/** A party-only pair as a MEJ-styled row (sheet-relationships.hbs markup). */
export function buildPartyRow(doc, { line, target, editable, labels }, handlers = {}) {
  const li = el(doc, "li", "item flexrow mej-cc-party-only");
  li.dataset.uuid = target.uuid;
  const name = el(doc, "div", "item-name clickable");
  const img = el(doc, "img", "item-image large actor-icon");
  img.src = target.img || labels.fallbackImg;
  img.addEventListener("error", () => { img.src = labels.fallbackImg; }, { once: true });
  const a = el(doc, "a", null, target.name);
  a.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.open?.(target.uuid);
  });
  const wrap = el(doc, "div");
  wrap.append(a);
  name.append(img, wrap);
  const rel = el(doc, "div", "item-relationship flexcol");
  rel.append(buildPartyLine(doc, { line, editable, labels }, handlers));
  li.append(name, rel);
  return li;
}

export function buildAddButton(doc, { labels }, onClick) {
  const root = el(doc, "div", "mej-cc-party-add");
  const button = el(doc, "button", null);
  button.type = "button";
  button.append(el(doc, "i", "fa-solid fa-plus"), doc.createTextNode(` ${labels.add}`));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  root.append(button);
  return root;
}

/**
 * Put each line in MEJ's list: under its GM row's relationship cell when one
 * is rendered, else as a party-only row at the end of its type group (a
 * header is created by `groupHeader` when MEJ rendered none).
 */
export function placeLines(list, lines, { gmRowFor, typeOf, groupHeader, buildLine, buildRow }) {
  for (const line of lines) {
    const gmRow = gmRowFor(line.other);
    if (gmRow) {
      (gmRow.querySelector(".item-relationship:last-of-type") ?? gmRow).append(buildLine(line));
      continue;
    }
    const header = groupHeader(typeOf(line.other));
    let anchor = header;
    while (anchor.nextElementSibling && anchor.nextElementSibling.matches("li.item")) anchor = anchor.nextElementSibling;
    anchor.after(buildRow(line));
  }
}

/** Whose drop handles an entry dropped on the tab (spec §3.3). */
export function dropMode({ isGM, isOwner, canAdd }) {
  if (isGM || isOwner) return "mej";
  return canAdd ? "party" : "none";
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/party-lines.test.js` — Expected: PASS.

- [ ] **Step 6: Implement the picker `scripts/apps/party-target-picker.mjs`**

```js
// Add-relationship picker (spec 2026-10-10 §3.3): a search box and a list,
// nothing else. Resolves the chosen entry uuid, or null on close.
import { I18N } from "../constants.mjs";

export async function pickPartyTarget({ sourceName, rows }) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.map((r) => `<li class="mej-cc-party-pick" data-uuid="${esc(r.uuid)}" data-name="${esc(r.name.toLocaleLowerCase())}">
      <img src="${esc(r.img)}" alt=""><span class="name">${esc(r.name)}</span><span class="type">${esc(r.typeLabel)}</span></li>`).join("");
  let chosen = null;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format(`${I18N}.party.pickTitle`, { name: sourceName }) },
    classes: ["mej-cc-party-picker"],
    content: `<input type="search" name="q" placeholder="${esc(game.i18n.localize(`${I18N}.party.search`))}" autofocus>
      <ol class="mej-cc-party-picks">${items}</ol>`,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const search = root.querySelector('input[name="q"]');
      search.addEventListener("input", () => {
        const q = search.value.trim().toLocaleLowerCase();
        for (const li of root.querySelectorAll(".mej-cc-party-pick")) li.hidden = !!q && !li.dataset.name.includes(q);
      });
      for (const li of root.querySelectorAll(".mej-cc-party-pick")) {
        li.addEventListener("click", () => {
          chosen = li.dataset.uuid;
          dialog.close();
        });
      }
    }
  });
  return chosen;
}
```

- [ ] **Step 7: Implement `scripts/hooks/party-relationships-ui.mjs`**

```js
// Party relationships inside MEJ's own Relationships list (spec 2026-10-10
// §3). After MEJ renders, lines go under matching GM rows, party-only pairs
// become MEJ-styled rows, writers get an Add button and (when MEJ would
// refuse them) a drop target. Writes go straight to the campaign's
// notebook - no relay, no GM needed. Idempotent per render; a live edit is
// carried across the re-render its own save causes (inline-edit.mjs).
import { MODULE_ID, I18N } from "../constants.mjs";
import {
  linesForEntry, findPair, createRowUpdate, labelUpdate, deleteUpdate, targetProblem, eligibleTargets, normalizeRows
} from "../logic/party-rows.mjs";
import { readableNotebooks, writeNotebookFor } from "../data/party-notebook.mjs";
import { canAddParty, playerConnectionsEnabled } from "./rel-tab-wrap.mjs";
import { buildPartyLine, buildPartyRow, buildAddButton, placeLines, dropMode } from "../apps/party-lines.mjs";
import { trackEditing, shouldKeepBlock } from "../apps/inline-edit.mjs";
import { pickPartyTarget } from "../apps/party-target-picker.mjs";
import { imageFor } from "../logic/default-image.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { PARTY_ROWS_FLAG } from "../constants.mjs";

const FALLBACK_IMG = "icons/svg/book.svg";
const MARK = "mej-cc-party-injected";
const L = (key) => game.i18n.localize(`${I18N}.party.${key}`);
const F = (key, data) => game.i18n.format(`${I18N}.party.${key}`, data);

const asElement = (html) => (html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null);
const typedPageOf = (entry) => entry?.pages?.contents?.find((p) => mejType(p)) ?? null;
const entryType = (entry) => (typedPageOf(entry) ? mejType(typedPageOf(entry)) || null : null);
const canLimitedUuid = (uuid) => {
  const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
};

function labels() {
  return {
    party: L("party"), addLabel: L("addLabel"), edited: (name) => F("edited", { name }),
    remove: L("remove"), add: L("add"), fallbackImg: FALLBACK_IMG
  };
}

function targetInfo(uuid) {
  const entry = fromUuidSync(uuid);
  if (!(entry instanceof JournalEntry)) return null;
  const type = entryType(entry) ?? "";
  return { uuid, name: entry.name, img: imageFor(typedPageOf(entry)?.src, type) ?? FALLBACK_IMG, type };
}

function typeLabel(type) {
  const known = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  return game.i18n.localize(known[type] ?? type);
}

/** Can this viewer edit rows in this notebook (spec §2.5)? */
function canWriteIn(notebookUuid) {
  if (!playerConnectionsEnabled() && !game.user.isGM) return false;
  const nb = fromUuidSync(notebookUuid);
  return !!nb && (game.user.isGM || nb.isOwner === true);
}

async function write(notebookUuid, update) {
  const nb = fromUuidSync(notebookUuid);
  try {
    await nb.update(update);
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | party relationship write failed`, err);
    ui.notifications.error(L("writeFailed"));
    return false;
  }
}

const stamp = () => ({ user: { id: game.user.id, name: game.user.name }, now: Date.now() });

async function addTarget(sheet, entry, targetUuid) {
  const nb = writeNotebookFor(entry);
  if (!nb) return void ui.notifications.warn(L("noNotebook"));
  const ctx = { sourceUuid: entry.uuid, allowed: [...(sheet.allowedRelationships ?? [])], typeOf: entryType,
    canLimited: (doc) => doc.testUserPermission(game.user, "LIMITED") === true };
  const target = fromUuidSync(targetUuid);
  const problem = targetProblem(target instanceof JournalEntry ? target : null, ctx);
  if (problem) return void ui.notifications.warn(L(`drop.${problem}`));
  const rows = normalizeRows(nb.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]);
  const existing = findPair(rows, entry.uuid, targetUuid);
  if (existing) return focusLine(sheet, nb.uuid, existing.key);           // spec §3.4
  const { key, update } = createRowUpdate({ sourceUuid: entry.uuid, targetUuid, ...stamp() });
  pendingFocus = { notebookUuid: nb.uuid, key };
  await write(nb.uuid, update);
}

let pendingFocus = null;
function focusLine(sheet, notebookUuid, key) {
  const root = sheet.element instanceof HTMLElement ? sheet.element : document;
  const line = root.querySelector(`.mej-cc-party-line[data-notebook-uuid="${CSS.escape(notebookUuid)}"][data-key="${CSS.escape(key)}"]`);
  line?.scrollIntoView({ block: "nearest" });
  line?.querySelector("input")?.focus();
}

async function openPicker(sheet, entry) {
  const ctx = { sourceUuid: entry.uuid, allowed: [...(sheet.allowedRelationships ?? [])], typeOf: entryType,
    canLimited: (doc) => doc.testUserPermission(game.user, "LIMITED") === true };
  const rows = eligibleTargets(game.journal.contents, ctx).map((r) => ({
    uuid: r.uuid, name: r.name, img: targetInfo(r.uuid)?.img ?? FALLBACK_IMG, typeLabel: typeLabel(r.type)
  }));
  if (!rows.length) return void ui.notifications.info(L("noTargets"));
  const uuid = await pickPartyTarget({ sourceName: entry.name, rows });
  if (uuid) await addTarget(sheet, entry, uuid);
}

async function onDrop(event, sheet, entry) {
  event.preventDefault();
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  let uuid = null;
  if (data?.type === "JournalEntry") uuid = data.uuid;
  else if (data?.type === "JournalEntryPage") uuid = (await fromUuid(data.uuid))?.parent?.uuid ?? null;
  if (!uuid) return void ui.notifications.warn(L("drop.not-journal"));
  await addTarget(sheet, entry, uuid);
}

function ensureList(host) {
  let list = host.querySelector(".relationships .items-list ol.item-list");
  if (list) return list;
  const container = host.querySelector(".relationships .items-list");
  if (!container) return null;
  container.querySelector(".instruction")?.remove();
  list = document.createElement("ol");
  list.className = "item-list";
  list.dataset.container = "relationships";
  container.append(list);
  return list;
}

function groupHeaderIn(list) {
  return (type) => {
    const name = typeLabel(type);
    const found = [...list.querySelectorAll(":scope > li > header .name")].find((n) => n.textContent === name);
    if (found) return found.closest("li");
    const li = document.createElement("li");
    li.innerHTML = `<header><div class="name"></div><div class="relationship"></div></header>`;
    li.querySelector(".name").textContent = name;
    li.querySelector(".relationship").textContent = game.i18n.localize("MonksEnhancedJournal.Relationship");
    list.append(li);
    return li;
  };
}

function inject(sheet, html) {
  const element = asElement(html);
  const page = sheet?.document;
  if (!element || !(page instanceof JournalEntryPage) || !mejType(page)) return;
  const entry = page.parent;
  const tab = element.querySelector('.tab[data-tab="relationships"]');
  if (!entry || !tab || tab.classList.contains(MARK)) return;
  tab.classList.add(MARK);

  const lines = linesForEntry(entry.uuid, readableNotebooks(), { canLimited: canLimitedUuid });
  const canAdd = canAddParty(sheet, entry);
  if (!lines.length && !canAdd) return;
  const list = ensureList(tab);
  if (!list) return;
  const lbl = labels();
  const handlers = {
    open: (uuid) => { const doc = fromUuidSync(uuid); if (doc) game.MonksEnhancedJournal.openJournalEntry(doc); },
    save: (line, value) => {
      const nb = fromUuidSync(line.notebookUuid);
      const row = normalizeRows(nb?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]).find((r) => r.key === line.key);
      const update = row ? labelUpdate(row, line.side, value, stamp()) : null;
      if (update) write(line.notebookUuid, update);
    },
    remove: (line) => write(line.notebookUuid, deleteUpdate(line.key))
  };
  const seen = new Set(lines.map((l) => l.other));
  placeLines(list, lines, {
    gmRowFor: (uuid) => list.querySelector(`li.item:not(.mej-cc-party-only)[data-uuid="${CSS.escape(uuid)}"]`),
    typeOf: (uuid) => entryType(fromUuidSync(uuid)) ?? "",
    groupHeader: groupHeaderIn(list),
    buildLine: (line) => buildPartyLine(document, { line, editable: canWriteIn(line.notebookUuid), labels: lbl }, handlers),
    buildRow: (line) => buildPartyRow(document, {
      line, target: targetInfo(line.other) ?? { uuid: line.other, name: L("unresolved"), img: FALLBACK_IMG, type: "" },
      editable: canWriteIn(line.notebookUuid), labels: lbl
    }, handlers)
  });
  if (canAdd) {
    // Empty "Party: add a label" lines under GM rows with no party row yet.
    for (const gmRow of list.querySelectorAll("li.item:not(.mej-cc-party-only)[data-uuid]")) {
      const uuid = gmRow.dataset.uuid;
      if (seen.has(uuid) || !canLimitedUuid(uuid)) continue;
      const cell = gmRow.querySelector(".item-relationship:last-of-type") ?? gmRow;
      cell.append(buildPartyLine(document, { line: null, editable: true, labels: lbl }, {
        create: async (value) => {
          await addTarget(sheet, entry, uuid);
          const nb = writeNotebookFor(entry);
          const row = findPair(normalizeRows(nb?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG]), entry.uuid, uuid);
          const update = row ? labelUpdate(row, row.a === entry.uuid ? "a" : "b", value, stamp()) : null;
          if (update) await write(nb.uuid, update);
        }
      }));
    }
    tab.querySelector(".relationships")?.append(buildAddButton(document, { labels: lbl }, () =>
      openPicker(sheet, entry).catch((err) => console.error(`${MODULE_ID} | party add failed`, err))));
  }
  const mode = dropMode({ isGM: game.user.isGM, isOwner: entry.isOwner === true, canAdd });
  if (mode === "party") {
    const zone = tab.querySelector(".relationships .items-list");
    zone?.addEventListener("dragover", (event) => event.preventDefault());
    zone?.addEventListener("drop", (event) => onDrop(event, sheet, entry)
      .catch((err) => console.error(`${MODULE_ID} | party drop failed`, err)));
  }
  if (pendingFocus) {
    const { notebookUuid, key } = pendingFocus;
    pendingFocus = null;
    focusLine({ element }, notebookUuid, key);
  }
}

export function registerPartyRelationshipsUi() {
  const safe = (sheet, html) => {
    try {
      inject(sheet, html);
    } catch (err) {
      console.error(`${MODULE_ID} | party relationships render failed`, err);
    }
  };
  Hooks.on("renderJournalPageSheet", safe);
  Hooks.on("renderEnhancedJournalSheet", safe);
}
```

Carrying a live edit across re-renders (Review Focus 2): wrap the per-window state exactly like 0.25.0's `inject` did (`hooks/player-connections-ui.mjs:282-319`): keep a `WeakMap` keyed by `host.closest(".application") ?? sheet` holding `{ tab, pageUuid, tracker }`, where `tracker = trackEditing(list, onSettled)`. On a render while `shouldKeepBlock({ prevPageUuid, pageUuid, editing: tracker.editing() })` holds, move the previous `ol.item-list` into the new tab's `.items-list` (replacing MEJ's freshly rendered one), call `tracker.restoreFocus()`, mark the state stale, and rebuild (re-run `inject` on the sheet with `sheet.render()`) when `onSettled` fires. Copy those 0.25.0 lines over with `block` → the list element.

- [ ] **Step 8: Register, i18n, CSS**

`mej-adapter.mjs`, after "party notebook":

```js
  await step("party relationships ui", async () => {
    const { registerPartyRelationshipsUi } = await import("../hooks/party-relationships-ui.mjs");
    registerPartyRelationshipsUi();
  });
```

`lang/en.json` `party` block becomes:

```json
"party": {
  "notebookName": "Party relationships — {campaign}",
  "party": "Party relationship",
  "addLabel": "Party: add a label",
  "edited": "edited by {name}",
  "remove": "Remove party relationship",
  "add": "Add relationship",
  "pickTitle": "Add a relationship to {name}",
  "search": "Search entries",
  "noTargets": "There are no entries you can relate to this one.",
  "noNotebook": "A GM must open the world once before party relationships can be added in this campaign.",
  "writeFailed": "Couldn't save the party relationship.",
  "unresolved": "Unknown entry",
  "drop": {
    "not-journal": "Only journal entries in this world can be related.",
    "self": "An entry can't be related to itself.",
    "no-access": "You can't see that entry.",
    "type-not-allowed": "This kind of entry can't be related here."
  }
}
```

`styles/campaign-companion.css` — append (keep the 0.25.0 `.mej-cc-player-connections` rules until Task 8):

```css
/* Party relationships inside MEJ's Relationships list (spec 2026-10-10 §3.2). */
.monks-journal-sheet .relationships .mej-cc-party-line {
  display: flex; align-items: center; gap: 0.4em; margin-top: 2px;
  color: var(--mej-cc-ink); font-size: var(--font-size-13, 13px);
}
.monks-journal-sheet .relationships .mej-cc-party-line .mej-cc-party-icon { color: var(--mej-cc-ink-muted); flex: 0 0 auto; }
.monks-journal-sheet .relationships .mej-cc-party-line input.mej-cc-party-input { flex: 1 1 auto; color: var(--mej-cc-ink); }
.monks-journal-sheet .relationships .mej-cc-party-line input.mej-cc-party-input::placeholder { color: var(--mej-cc-ink-muted); }
.monks-journal-sheet .relationships .mej-cc-party-line .mej-cc-party-label { flex: 1 1 auto; }
.monks-journal-sheet .relationships .mej-cc-party-line .mej-cc-party-edited,
.monks-journal-sheet .relationships .mej-cc-party-line .mej-cc-party-campaign {
  color: var(--mej-cc-ink-muted); font-size: 0.85em; white-space: nowrap;
}
.monks-journal-sheet .relationships .mej-cc-party-line .mej-cc-party-campaign {
  background: var(--mej-cc-chip-bg); border-radius: 3px; padding: 0 4px;
}
.monks-journal-sheet .relationships .mej-cc-party-add { padding: 6px 0; }
.mej-cc-party-picker .mej-cc-party-picks { list-style: none; margin: 6px 0 0; padding: 0; max-height: 50vh; overflow-y: auto; }
.mej-cc-party-picker .mej-cc-party-pick { display: flex; align-items: center; gap: 8px; padding: 4px; cursor: pointer; }
.mej-cc-party-picker .mej-cc-party-pick:hover { background: var(--mej-cc-chip-bg); }
.mej-cc-party-picker .mej-cc-party-pick img { width: 32px; height: 32px; object-fit: cover; border: none; }
.mej-cc-party-picker .mej-cc-party-pick .type { margin-left: auto; color: var(--mej-cc-ink-muted); }
```

- [ ] **Step 9: Run unit suite**

Run: `npx vitest run` — Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/apps/inline-edit.mjs scripts/apps/party-lines.mjs scripts/apps/party-target-picker.mjs scripts/hooks/party-relationships-ui.mjs scripts/integrations/mej-adapter.mjs lang/en.json styles/campaign-companion.css test/inline-edit.test.js test/party-lines.test.js
git commit -m "feat: party relationship lines in MEJ's list, drop and Add picker"
```

---

### Task 6: Graph — party edges with stable ids

**Files:**
- Modify: `scripts/logic/graph-rows.mjs` (replace `playerConnectionsOf`/`canSeeEntry` with `partyLinesOf(entryUuid)`)
- Modify: `scripts/logic/graph-data.mjs:28-66` (party edges; stable `id` on every edge; option `includeParty`)
- Modify: `scripts/apps/hub-graph-pane.mjs:45-70`, `scripts/apps/CampaignHubPage.mjs:84,1904-1910`, `templates/hub.hbs:201-202`, `lang/en.json` (`graph.playerConnections` → `graph.partyRelationships: "Show party relationships"`), `styles/campaign-companion.css` (`.mej-cc-graph-edge.player` → `.party`)
- Test: `test/graph-data.test.js`, `test/graph-rows.test.js`

**Interfaces:**
- Consumes: `linesForEntry`, `readableNotebooks`.
- Produces: row field `partyLines: { other, label, otherLabel, editedName, notebookUuid, key }[]`; edge shape `{ id, source, target, kind: "relationship"|"party"|"backlink", label, tooltip?, hidden? }` with ids `rel:<relId>`, `party:<notebookUuid>:<key>`, `link:<pairKey>`; `buildGraph(..., { includeParty = true })`.

- [ ] **Step 1: Update tests**

In `test/graph-data.test.js`, replace the `"buildGraph player edges (spec 2026-10-09 §6.1)"` describe with:

```js
describe("buildGraph party edges (spec 2026-10-10 §5.1)", () => {
  const pl = (other, over = {}) => ({ other, label: "Sister of", otherLabel: "Older sister", editedName: "Jo",
    notebookUuid: "JournalEntry.nb", key: "k1", ...over });
  const rows = (aRels = [], aParty = [], bParty = []) => [
    { uuid: "J.a", name: "A", type: "person", relationships: aRels, partyLines: aParty },
    { uuid: "J.b", name: "B", type: "person", relationships: [], partyLines: bParty }
  ];
  it("one party edge per pair with a stable id and both labels in the tooltip", () => {
    const g = buildGraph(rows([], [pl("J.b")], [pl("J.a", { label: "Older sister", otherLabel: "Sister of" })]), [], { isGM: false });
    expect(g.edges).toEqual([{ id: "party:JournalEntry.nb:k1", source: "J.a", target: "J.b", kind: "party", label: "",
      tooltip: "Sister of / Older sister\nedited by Jo" }]);
  });
  it("a visible GM edge wins", () => {
    const g = buildGraph(rows([{ id: "r1", uuid: "J.b", hidden: false, label: "x" }], [pl("J.b")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["relationship"]);
    expect(g.edges[0].id).toBe("rel:r1");
  });
  it("a GM edge hidden from this player leaves the party edge", () => {
    const g = buildGraph(rows([{ id: "r1", uuid: "J.b", hidden: true, label: "x" }], [pl("J.b")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["party"]);
  });
  it("includeParty false drops party edges as data, not styling", () => {
    const g = buildGraph(rows([], [pl("J.b")]), [], { isGM: false, includeParty: false });
    expect(g.edges).toEqual([]);
  });
});
```

Add `id` to every expected edge elsewhere in the file: relationship edges `id: "rel:<rel.id>"`, backlinks `id: "link:<a>|<b>"` (sorted). In `test/graph-rows.test.js` replace the player-connections describe with:

```js
describe("graphRowsFor party lines", () => {
  it("attaches partyLines from the injected reader", () => {
    const rows = graphRowsFor([entry("J.a", "person")], ctx({ partyLinesOf: (uuid) => (uuid === "J.a" ? [{ other: "J.b" }] : []) }));
    expect(rows[0].partyLines).toEqual([{ other: "J.b" }]);
  });
  it("defaults to [] without a reader", () => {
    expect(graphRowsFor([entry("J.a", "person")], ctx())[0].partyLines).toEqual([]);
  });
});
```

(`entry` and `ctx` are the file's existing fixtures; replace `playerConnections: []` in other expectations with `partyLines: []`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/graph-data.test.js test/graph-rows.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement**

`graph-rows.mjs`: remove the player-connections import and code; signature `graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf, imageOf, partyLinesOf })`; inside the loop:

```js
      const partyLines = typeof partyLinesOf === "function" ? partyLinesOf(entry.uuid) : [];
      rows.push({ uuid: entry.uuid, name: entry.name, type, img: typeof img === "string" && img.length ? img : null, relationships, partyLines });
```

Update its doc comment: "partyLinesOf(uuid) → readable party lines for the entry (spec 2026-10-10 §5.1)".

`graph-data.mjs`: signature option `includeParty = true` replacing `includePlayer`. Relationship edges push `{ id: \`rel:${rel.id}\`, source, target, kind: "relationship", label, hidden }`. Replace the player block with:

```js
  // Party relationships (spec 2026-10-10 §5.1): after GM relationships (a GM
  // edge the viewer has wins), before mention links. Filtered here, as data,
  // so later tag/highlight filters sit beside it.
  if (includeParty) {
    for (const row of rows) {
      for (const pl of row.partyLines ?? []) {
        if (!byUuid.has(pl.other)) continue;
        const key = pairKey(row.uuid, pl.other);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const labels = [pl.label, pl.otherLabel].filter((s) => typeof s === "string" && s.length).join(" / ");
        const tooltip = [labels, pl.editedName ? `edited by ${pl.editedName}` : ""].filter(Boolean).join("\n");
        edges.push({ id: `party:${pl.notebookUuid}:${pl.key}`, source: row.uuid, target: pl.other, kind: "party", label: "", tooltip });
      }
    }
  }
```

Backlinks push `{ id: \`link:${key}\`, source, target, kind: "backlink" }`. The tooltip's "edited by" text: pass a localized formatter as option `editedLabel = (n) => \`edited by ${n}\`` and use it, so the pane can localize (`game.i18n.format("MEJCampaignCompanion.party.edited", { name })`).

`hub-graph-pane.mjs`: replace `playerConnectionsOf`/`canSeeEntry` ctx fields with

```js
    partyLinesOf: (uuid) => linesForEntry(uuid, notebooks, { canLimited: canLimitedUuid }),
```

where `const notebooks = readableNotebooks();` is computed once per build, `canLimitedUuid` as in Task 5; `includePlayer` → `includeParty = state.graphPartyRelationships !== false`; pass `editedLabel`. `CampaignHubPage.mjs`: state key `graphPlayerConnections` → `graphPartyRelationships`, action `toggleGraphPlayerConnections` → `toggleGraphPartyRelationships`. `hub.hbs:201-202`: same action name, `graph.includeParty`, label key `MEJCampaignCompanion.graph.partyRelationships`. CSS: rename the `.mej-cc-graph-edge.player` selector to `.mej-cc-graph-edge.party`, and in the pane's edge class mapping use `e.kind`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/graph-rows.mjs scripts/logic/graph-data.mjs scripts/apps/hub-graph-pane.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json styles/campaign-companion.css test/graph-data.test.js test/graph-rows.test.js
git commit -m "feat: party relationship edges in the graph, stable edge ids"
```

---

### Task 7: Doc export — party list

**Files:**
- Modify: `scripts/apps/export-dialog.mjs:16-29,140-166`
- Modify: `scripts/logic/doc-export-snapshot.mjs:125,179-186` (rename `playerConnections` → `partyRelationships`, `playerConnectionsHtml` → `partyRelationshipsHtml`)
- Modify: `lang/en.json` (`export.playerConnections` → `export.partyRelationships: "Party relationships"`)
- Test: `test/doc-export-snapshot.test.js` (rename fields), delete `test/player-connections-export.test.js` (its coverage moves to `exportLines` in Task 1)

**Interfaces:**
- Consumes: `linesForEntry`, `readableNotebooks`, `exportLines` (Task 1).

- [ ] **Step 1: Update tests**

In `test/doc-export-snapshot.test.js` rename every `playerConnections` option/label to `partyRelationships` and `playerConnectionsHtml` to `partyRelationshipsHtml`; add:

```js
it("party relationships list renders after Relationships with escaped text", () => {
  const html = partyRelationshipsHtml([{ text: "Mara — <i>Sister</i> (edited by Jo)", children: [] }], "Party relationships");
  expect(html).toContain("Party relationships");
  expect(html).toContain("Mara — &lt;i&gt;Sister&lt;/i&gt; (edited by Jo)");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/doc-export-snapshot.test.js` — Expected: FAIL (export name).

- [ ] **Step 3: Implement**

Rename in `doc-export-snapshot.mjs` (function, JSDoc, destructured option, label key). In `export-dialog.mjs` replace the player-connections imports with

```js
import { linesForEntry, exportLines } from "../logic/party-rows.mjs";
import { readableNotebooks } from "../data/party-notebook.mjs";
```

and `playerConnectionLines` with

```js
function partyLines(row, notebooks) {
  const canLimited = (uuid) => {
    const doc = fromUuidSync(uuid);
    return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
  };
  const lines = linesForEntry(row.uuid, notebooks, { canLimited })
    .map((l) => ({ ...l, otherName: fromUuidSync(l.other)?.name ?? game.i18n.localize(`${I18N}.party.unresolved`) }));
  return exportLines(lines, { edited: (name) => game.i18n.format(`${I18N}.party.edited`, { name }) });
}
```

Compute `const notebooks = readableNotebooks();` once per export, and pass `partyRelationships: partyLines(row, notebooks)` with label `partyRelationships: game.i18n.localize(\`${I18N}.export.partyRelationships\`)`. GM and players use the same rule (spec §5.2), so `includeGM` no longer applies here.

- [ ] **Step 4: Run tests**

Run: `npx vitest run` — Expected: PASS (after deleting `test/player-connections-export.test.js`).

- [ ] **Step 5: Commit**

```bash
git rm test/player-connections-export.test.js
git add scripts/apps/export-dialog.mjs scripts/logic/doc-export-snapshot.mjs lang/en.json test/doc-export-snapshot.test.js
git commit -m "feat: party relationships in Word export"
```

---

### Task 8: Remove Player Connections

**Files:**
- Delete: `scripts/logic/player-connections.mjs`, `scripts/hooks/player-connections-ui.mjs`, `scripts/hooks/player-connections-relay.mjs`, `scripts/hooks/player-connections-index.mjs`, `scripts/apps/player-connection-dialog.mjs`, `scripts/apps/player-connections-block.mjs`
- Delete tests: `test/player-connections.test.js`, `test/player-connections-validate.test.js`, `test/player-connections-ui.test.js`, `test/player-connections-relay.test.js`, `test/player-connections-index.test.js`, `test/player-connections-block.test.js`, `test/player-connection-dialog.test.js`
- Modify: `scripts/hooks/socket.mjs` (drop the two actions), `test/socket-dispatcher.test.js` (drop their cases), `scripts/constants.mjs:166-169` (drop `PLAYER_CONNECTION_ACTION`, `PLAYER_CONNECTION_RESULT_ACTION`; keep `PLAYER_CONNECTIONS_FLAG` — used by the cleanup in Task 3 — and `PLAYER_CONNECTIONS_SETTING`), `scripts/integrations/mej-adapter.mjs` (drop the two player-connections steps), `scripts/campaign-companion.mjs:64-79` (setting onChange → `refreshViewsMatching(null)` from `hooks/view-refresh.mjs`), `scripts/hooks/view-refresh.mjs:2` (comment), `lang/en.json` (delete the `playerConnections` block; rename setting name/hint), `styles/campaign-companion.css` (delete `.mej-cc-player-connections`/`.mej-cc-pc-*` rules)

- [ ] **Step 1: Delete and edit**

```bash
git rm scripts/logic/player-connections.mjs scripts/hooks/player-connections-ui.mjs scripts/hooks/player-connections-relay.mjs \
  scripts/hooks/player-connections-index.mjs scripts/apps/player-connection-dialog.mjs scripts/apps/player-connections-block.mjs \
  test/player-connections.test.js test/player-connections-validate.test.js test/player-connections-ui.test.js \
  test/player-connections-relay.test.js test/player-connections-index.test.js test/player-connections-block.test.js \
  test/player-connection-dialog.test.js
```

`campaign-companion.mjs` setting registration becomes:

```js
  // Party relationships (spec 2026-10-10 §4.7): off hides Add, the drop
  // target and empty party lines, and makes labels read-only for players;
  // existing rows still display. Open sheets re-render on change.
  game.settings.register(MODULE_ID, PLAYER_CONNECTIONS_SETTING, {
    name: `${I18N}.settings.playerConnectionsEnabled.name`,
    hint: `${I18N}.settings.playerConnectionsEnabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      import("./hooks/view-refresh.mjs")
        .then((m) => m.refreshViewsMatching(null))
        .catch((err) => console.error(`${MODULE_ID} | party relationships refresh failed`, err));
    }
  });
```

`lang/en.json` setting strings:

```json
"playerConnectionsEnabled": {
  "name": "Players can add party relationships",
  "hint": "Campaign Contributors can add, label and remove the party's relationships between entries. Off: existing party relationships still show, read-only for players."
}
```

- [ ] **Step 2: Verify nothing references the removed code**

Run: `grep -rn "player-connection\|playerConnection\|PLAYER_CONNECTION_ACTION\|PLAYER_CONNECTION_RESULT\|mej-cc-pc-\|mej-cc-player-connections" scripts templates styles lang test`
Expected: only `PLAYER_CONNECTIONS_FLAG` / `PLAYER_CONNECTIONS_SETTING` / `playerConnectionsEnabled` hits.

- [ ] **Step 3: Run the suite**

Run: `npx vitest run` — Expected: PASS, no missing-module errors.

- [ ] **Step 4: Commit**

```bash
git add -A scripts test lang styles
git commit -m "refactor: remove 0.25.0 player connections (block, dialog, relay, index)"
```

---

### Task 9: End-to-end, readability, docs

**Files:**
- Delete: `tests/e2e/33-player-connections.spec.mjs`
- Create: `tests/e2e/33-party-relationships.spec.mjs`
- Modify: `tests/e2e/29-readability.spec.mjs` (party line + picker surfaces in place of `.mej-cc-player-connections`)
- Modify: `README.md`, `docs/` player guide and GM guide sections, `CHANGELOG.md` (`## Unreleased`)

- [ ] **Step 1: Write the e2e spec**

`tests/e2e/33-party-relationships.spec.mjs` reuses 0.25.0 spec 33's helpers verbatim (`newSeat`, `createEntry`, `openEntry`, `closeShell`, `relTabLink`, `toast`; copy lines 1-60 of the old spec with `PREFIX = "TT-Party"`). Setup as GM: a campaign folder (`createCampaign` via `game.modules.get(MOD)`'s Hub API, or `Folder.create` with the campaign flag as spec 30 does), User 1 and User 2 as Contributors (`folder.update({ "flags.mej-campaign-companion.campaign.contributors": { userIds: [u1, u2], groupIds: [] } })`), entries Ilva/Mara/Bram (person, OBSERVER) and Quest Q inside it, a GM relationship Ilva→Bram via `sheet.addRelationship`. Wait until `game.journal.find((e) => e.flags?.[MOD]?.partyNotebook)` exists and User 1/2 are OWNER on it. Then **close the GM seat** so the player steps run with no GM online. Tests:

```js
test("drop creates a row with an empty label; typing saves; both ends show it", async () => { /* User 1 opens Ilva, drags Mara's sidebar row onto .relationships .items-list (page.dragAndDrop from `#sidebar [data-entry-id="<mara>"]`), expects li.mej-cc-party-only[data-uuid=<mara>] with an empty input focused; types "Sister of"; waits 600ms; reopens on User 2 at Mara: the row for Ilva shows label "" for Mara's side and the tooltip/other label is not shown; on Ilva shows "Sister of" with "edited by User 1". */ });
test("Add button opens a search-only picker; choosing creates the row", async () => { /* User 1 on Ilva clicks .mej-cc-party-add button; dialog .mej-cc-party-picker has exactly one input (type=search) and no other form fields; types "Bra", clicks Bram; expects the party line under Bram's GM row (li.item:not(.mej-cc-party-only)[data-uuid=<bram>] .mej-cc-party-line) */ });
test("another Contributor edits and deletes the row", async () => { /* User 2 on Ilva edits Mara line to "Rival", User 1 sees "Rival" and "edited by User 2"; User 2 deletes; line gone for User 1 */ });
test("duplicate add focuses the existing line", async () => { /* User 1 adds Mara twice via the picker; one line; its input is document.activeElement */ });
test("a non-Contributor reads rows but has no controls", async () => { /* GM (re-opened in setup of this test only, then closed) removes User 2 from contributors; User 2 sees the label text, no input, no .mej-cc-party-add, no .mej-cc-party-delete */ });
test("graph shows a party edge", async () => { /* User 1 opens the Hub graph tab; expects an element .mej-cc-graph-edge.party */ });
test("typing survives a save from another seat (Review Focus 2)", async () => { /* User 1 types slowly in the Mara line while User 2 edits the Bram line; User 1's input keeps its text and focus */ });
```

Each test body is written in full in the spec file using the helpers above; every test ends with `assertNoConsoleErrors(errors)`; `test.afterAll` runs `cleanupAsGm` + `deleteJournalsByPrefix(PREFIX)` + `cleanupStrandedTestFolders`.

- [ ] **Step 2: Retarget spec 29**

In `tests/e2e/29-readability.spec.mjs`, replace the `"person relationships player connections"` surface (selector `#MonksEnhancedJournal .mej-cc-player-connections`) with `"person relationships party line"` → `#MonksEnhancedJournal .mej-cc-party-line`, seeding one party row in setup (GM writes the notebook flag directly with `createRowUpdate`'s shape), and add `"party picker"` → `.mej-cc-party-picker` opened from the Add button.

- [ ] **Step 3: Run live (time-boxed)**

Check the e2e lock first (`npm run e2e:unlock` only if stale and yours). Then:

Run: `npx playwright test tests/e2e/33-party-relationships.spec.mjs tests/e2e/29-readability.spec.mjs` (v14)
Run: `npm run e2e:v13 -- tests/e2e/33-party-relationships.spec.mjs tests/e2e/29-readability.spec.mjs`
Expected: PASS. While the run is live, verify the ownership-replacement call from Task 3 step 4 (a removed Contributor loses OWNER on v13 and v14); if it doesn't, switch to the `ownership.-=<id>` fallback and rerun spec 33 only. Report any failure with its output; do not loop on the full suite.

- [ ] **Step 4: Docs**

- `README.md`: replace the Player connections feature section with "Party relationships": what it is (the party's beliefs, beside the GM's canon), who can write (Contributors), how to add (drop or Add), one row per pair, editable by any Contributor, no GM needed online.
- Player guide: "Recording relationships" rewritten to the drop/Add + inline label flow.
- GM guide: Contributors control who can write; the hidden notebook entry per campaign (don't delete it; it's recreated empty on next load if you do); the setting.
- `CHANGELOG.md` at the top:

```md
## Unreleased

- Party relationships replace Player connections. Players' relationships
  now live in MEJ's own Relationships list, one per pair of entries,
  editable by any campaign Contributor, beside (never overwriting) the
  GM's. Add by dropping an entry or with Add relationship (pick the entry,
  then label it inline). No GM needs to be online. Secrets, private
  connections and per-player notes are gone; 0.25.0 connection data is not
  carried over.
```

- [ ] **Step 5: Final checks and commit**

Run: `npx vitest run && npm run check:links`
Expected: PASS.

```bash
git rm tests/e2e/33-player-connections.spec.mjs
git add tests/e2e/33-party-relationships.spec.mjs tests/e2e/29-readability.spec.mjs README.md docs CHANGELOG.md
git commit -m "test+docs: party relationships e2e, readability, guides, changelog"
```

Push the branch and open a PR (no Claude attribution footer). No merge, no release, until the user says so.
