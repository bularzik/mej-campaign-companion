# Player Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players record connections between MEJ journal entries (per-side labels, secrets and per-player notes, shared with the party by default) on the Relationships tab. The connections show from both ends, in the relationship graph and in doc export, and every write goes through the active GM.

**Architecture:** Pure, vitest-covered logic first: `logic/player-connections.mjs` covers the model, visibility, GM-side validation, keyed update paths, the reverse index, target eligibility and export lines, and `logic/rel-tab-visibility.mjs` decides the tab. A DOM-only block builder (`apps/player-connections-block.mjs`, jsdom-tested) and a DialogV2 (`apps/player-connection-dialog.mjs`) sit on top of that. Foundry glue lives in `hooks/`: the reverse index, the socket relay, render-hook injection, and a `_prepareTabs` wrap installed through `logic/mej-wraps.mjs`. Storage is `flags["mej-campaign-companion"].playerConnections` on the "from" entry's MEJ-typed page, written only through keyed paths by the GM client.

**Tech Stack:** Foundry VTT 13.351 / 14.368 client API (DialogV2, Hooks, game.socket, game.settings), Monk's Enhanced Journal 13.06 / 14.x as read-only reference, vitest 3 (+ jsdom for DOM builders), Playwright 1.6x e2e harness.

**Spec:** `docs/superpowers/specs/2026-10-09-player-connections-design.md`

## Global Constraints

- Companion features never patch MEJ: every MEJ touch is a companion-side wrap (`scripts/logic/mej-wraps.mjs` `installWraps`, libWrapper when active, manual fallback otherwise) or a render-hook DOM injection. Nothing under `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` is edited.
- Storage: `flags["mej-campaign-companion"].playerConnections = { [id]: { id, to, authorId, authorName, shared, created, sides: { from: { notes: { [userId]: Note } }, to: { notes: { [userId]: Note } } } } }` on the "from" entry's MEJ-typed page. Note = `{ authorName, label, secret, revealed, updated }`.
- `label`: plain text, trimmed, 0–200 chars (`LABEL_MAX = 200`); `secret`: plain text, trimmed, 0–500 chars (`SECRET_MAX = 500`). A note with both empty is deleted rather than stored. Creating a connection requires the author's `from` label.
- `shared` is `true` unless strictly `false`; `revealed` is `false` unless strictly `true`. Absent flag = no connections. No data migration, no `dataVersion` bump.
- Writes use keyed paths: `"flags.mej-campaign-companion.playerConnections.<id>"`, `"….<id>.sides.<side>.notes.<userId>"`, `"….<id>.shared"`, and `-=` keys for deletes. Never a whole-object `setFlag`.
- The GM trusts only the socket-supplied sender id, never a payload field; only `game.users.activeGM` handles relay requests; replies are correlated by `requestId`; player timeout = `ENTITY_RELAY_TIMEOUT_MS` (15000).
- World setting `playerConnectionsEnabled`: Boolean, default `true`, `config: true`, name "Players can create connections".
- All client-writable text (`label`, `secret`, `authorName`) reaches the DOM through `textContent` or `escapeHtml`/`foundry.utils.escapeHTML`, never as markup, and never inside `data-tooltip`.
- All user-visible strings live in `lang/en.json` under `MEJCampaignCompanion.playerConnections.*`, `MEJCampaignCompanion.settings.playerConnectionsEnabled.*`, `MEJCampaignCompanion.graph.playerConnections` and `MEJCampaignCompanion.export.{playerConnections,secret,private}`.
- Styling reads the readability ink tokens (`--mej-cc-ink`, `--mej-cc-ink-muted`, `--mej-cc-field-ink`, `--mej-cc-field-bg`, `--mej-cc-field-border`, `--mej-cc-chip-bg`, `--mej-cc-surface`). `29-readability` must pass in both schemes.
- Works on Foundry 13 + stock MEJ 13.06 (v13 World B, port 30013) and Foundry 14 + MEJ 14.x (v14 World A, port 30000). e2e spec number **32**; e2e documents carry the prefix `TT-Pc`.
- Unit baseline is 1106 passing (`npm test`); every task ends green.
- Release target **0.25.0** via the tag-triggered `.github/workflows/release.yml`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`. PR bodies carry no Claude attribution.

## Review Focus

1. **A Place entry.** MEJ's `PlaceSheet._prepareTabs` (`sheets/PlaceSheet.js:61-76`, same in 13.06/14.01) deletes the Relationships tab for non-GMs *after* the base class returns, so a wrap on `EnhancedJournalSheet` alone would be undone there. A player expects the tab (and the Add button) on a Place just as on a Person. Task 4 wraps both prototypes with one idempotent decision, its unit test runs the decision twice, and e2e test 3 opens a Place as User 1.
2. **The player was last looking at the Relationships tab when they lose it** (setting turned off, a connection made private, a GM row re-hidden). With no active tab the sheet renders blank; a reasonable person expects to land on the first remaining tab. Task 4's `applyRelationshipsTab` activates it and reports it so the wrap updates `tabGroups`. There is a unit test for this.
3. **The block is in the DOM but off-screen.** MEJ sizes `.tab .relationships` to `height: 100%` inside a `tab-inner` with `overflow: hidden` (`css/monks-journal-sheet.css:570-580`), so anything appended after it is clipped. Playwright's `toBeVisible` doesn't catch clipping. Task 7's CSS shrinks MEJ's list when the block is present. e2e test 1 asserts with `elementFromPoint` that the row is actually hit-testable.
4. **Labels, secrets and author names containing markup** (`<img src=x onerror=…>`, `<b>`), in the block, the graph tooltip and the Word export. They must show as literal text. Task 6 has a jsdom test that no extra element is created, Task 9 sets the SVG `<title>` with `textContent`, and Task 10 has an escaping test.
5. **Typing in an inline field and pressing Enter, or the `change` event bubbling.** MEJ's sheet is a `<form>` with `submitOnChange: true` (`EnhancedJournalSheet.js:21,75`), so an owner's Enter or a bubbling `change` would submit MEJ's own form. The person expects their note to save and nothing else to happen. Task 6 blurs on Enter (default prevented) and stops `change`/`input` at the block root; jsdom tests cover both.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/logic/player-connections.mjs` (create) | Pure: normalize, visibility, per-side view model, validation, keyed update builder, reverse index, target eligibility, export lines |
| `scripts/logic/rel-tab-visibility.mjs` (create) | Pure: is the Relationships tab visible for this non-GM; count visible GM rows; apply the decision to a tabs record |
| `scripts/hooks/player-connections-index.mjs` (create) | In-memory reverse index over every journal page, patched by CRUD hooks; re-renders affected sheets |
| `scripts/hooks/rel-tab-wrap.mjs` (create) | `_prepareTabs` wrap on `EnhancedJournalSheet` and `PlaceSheet` via `installWraps`; `playerConnectionsEnabled()` |
| `scripts/hooks/player-connections-relay.mjs` (create) | Player → active-GM relay (`requestConnectionOp`), GM handler, `applyConnectionOp`, outcome toasts |
| `scripts/apps/player-connections-block.mjs` (create) | Pure DOM builder for the "Player connections" block (MEJ row markup), jsdom-tested |
| `scripts/hooks/player-connections-ui.mjs` (create) | Render-hook injection into the Relationships tab; wires block handlers to the relay; Add/drop |
| `scripts/apps/player-connection-dialog.mjs` (create) | DialogV2: searchable target list, both sides' labels/secrets, Share with party |
| `scripts/constants.mjs` (modify) | flag, setting and socket action names |
| `scripts/hooks/socket.mjs` (modify) | route the two new actions; request is a GM action |
| `scripts/campaign-companion.mjs` (modify) | register the setting; install the tab wrap on ready |
| `scripts/integrations/mej-adapter.mjs` (modify) | register index + UI in `registerCore` |
| `scripts/logic/graph-rows.mjs`, `scripts/logic/graph-data.mjs`, `scripts/apps/hub-graph-pane.mjs`, `scripts/apps/CampaignHubPage.mjs`, `templates/hub.hbs` (modify) | `player` edges, toggle, tooltip |
| `scripts/logic/doc-export-snapshot.mjs`, `scripts/apps/export-dialog.mjs` (modify) | "Player connections" list in Word export |
| `lang/en.json`, `styles/campaign-companion.css` (modify) | strings, block/dialog/graph styles on the ink tokens |
| `test/player-connections.test.js`, `test/player-connections-validate.test.js`, `test/player-connections-index.test.js`, `test/rel-tab-visibility.test.js`, `test/player-connections-relay.test.js`, `test/player-connections-block.test.js`, `test/player-connection-dialog.test.js`, `test/player-connections-export.test.js` (create); `test/graph-rows.test.js`, `test/graph-data.test.js`, `test/socket-dispatcher.test.js`, `test/constants.test.js`, `test/doc-export-snapshot.test.js` (modify) | unit tests |
| `tests/e2e/32-player-connections.spec.mjs` (create), `tests/e2e/29-readability.spec.mjs` (modify) | e2e |
| `README.md`, `docs/player-guide.md`, `docs/gm-guide.md`, `CHANGELOG.md`, `module.json` (modify) | docs and 0.25.0 |

---

### Task 1: Connection model, visibility and per-side view (pure)

**Files:**
- Create: `scripts/logic/player-connections.mjs`
- Test: `test/player-connections.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all from `scripts/logic/player-connections.mjs`):
  - `LABEL_MAX = 200`, `SECRET_MAX = 500`, `SIDES = ["from", "to"]`
  - `cleanText(value: unknown, max: number) → string | null`: `""` for null/undefined, trimmed string within `max`, `null` when not a string or too long
  - `normalizeConnections(flagValue: unknown, fromUuid: string|null = null) → Connection[]`, where `Connection = { id, from, to, authorId, authorName, shared, created, sides: { from: { notes: Record<userId, Note> }, to: { notes: Record<userId, Note> } } }` and `Note = { authorName, label, secret, revealed, updated }`
  - `canSeeConnection(row: Connection, { userId: string, isGM: boolean, canSeeEntry: (uuid) => boolean }) → boolean`
  - `visibleNote(note: Note, writerId: string, { userId, isGM }) → { writerId, authorName, label, revealed, secretVisible: boolean, secret: string }`
  - `sideView(row: Connection, side: "from"|"to", { userId, isGM, enabled, knownUserIds: Set<string>, canObserveSide: boolean }) → SideView`, where `SideView = { id, side, from, to, otherUuid, reverse, shared, authorId, authorName, foreignAuthor, isAuthor, showAuthor, viewerId, main: NoteView|null, others: NoteView[], canAddNote, canToggleShare, canDelete }` and `NoteView = visibleNote(...) & { editable, canReveal, canDelete }`
  - `countOtherNotes(row: Connection) → number`: notes on both sides not written by the connection author

- [ ] **Step 1: Write the failing tests**

`test/player-connections.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  LABEL_MAX, SECRET_MAX, cleanText, normalizeConnections, canSeeConnection, visibleNote, sideView, countOtherNotes
} from "../scripts/logic/player-connections.mjs";

const note = (over = {}) => ({ authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1, ...over });
const raw = (over = {}) => ({
  id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 5,
  sides: { from: { notes: { u1: note({ secret: "owes her a debt" }) } }, to: { notes: { u1: note({ label: "Brother of" }) } } },
  ...over
});

describe("cleanText", () => {
  it("trims, accepts empty and nullish, rejects non-strings and overlong text", () => {
    expect(cleanText("  Sister of ", LABEL_MAX)).toBe("Sister of");
    expect(cleanText(undefined, LABEL_MAX)).toBe("");
    expect(cleanText(null, LABEL_MAX)).toBe("");
    expect(cleanText(42, LABEL_MAX)).toBeNull();
    expect(cleanText("x".repeat(LABEL_MAX), LABEL_MAX)).toBe("x".repeat(LABEL_MAX));
    expect(cleanText(` ${"x".repeat(LABEL_MAX + 1)} `, LABEL_MAX)).toBeNull();
    expect(cleanText("y".repeat(SECRET_MAX + 1), SECRET_MAX)).toBeNull();
  });
});

describe("normalizeConnections (spec §2 defensive parse)", () => {
  it("returns [] for an absent or non-object flag", () => {
    expect(normalizeConnections(undefined)).toEqual([]);
    expect(normalizeConnections(null)).toEqual([]);
    expect(normalizeConnections("x")).toEqual([]);
    expect(normalizeConnections([raw()])).toEqual([]);
  });
  it("parses a well-formed row and stamps the from uuid", () => {
    const [row] = normalizeConnections({ c1: raw() }, "JournalEntry.ilva");
    expect(row).toEqual({
      id: "c1", from: "JournalEntry.ilva", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana",
      shared: true, created: 5,
      sides: {
        from: { notes: { u1: { authorName: "Dana", label: "Sister of", secret: "owes her a debt", revealed: false, updated: 1 } } },
        to: { notes: { u1: { authorName: "Dana", label: "Brother of", secret: "", revealed: false, updated: 1 } } }
      }
    });
  });
  it("skips rows without a string id/to, rows whose id differs from their key, and non-object rows", () => {
    const rows = normalizeConnections({
      a: raw({ id: "a", to: 7 }), b: raw({ id: undefined }), c: raw({ id: "other" }), d: "junk", e: null,
      f: raw({ id: "f" })
    }, "X");
    expect(rows.map((r) => r.id)).toEqual(["f"]);
  });
  it("defaults shared to true unless strictly false, revealed to false unless strictly true", () => {
    const rows = normalizeConnections({
      a: raw({ id: "a", shared: undefined }), b: raw({ id: "b", shared: "no" }), c: raw({ id: "c", shared: false }),
      d: raw({ id: "d", sides: { from: { notes: { u1: note({ revealed: "yes" }), u2: note({ revealed: true }) } } } })
    });
    expect(rows.map((r) => r.shared)).toEqual([true, true, false, true]);
    expect(rows[3].sides.from.notes.u1.revealed).toBe(false);
    expect(rows[3].sides.from.notes.u2.revealed).toBe(true);
  });
  it("coerces label/secret/authorName to strings, skips non-object notes, tolerates missing sides", () => {
    const [row] = normalizeConnections({
      c1: raw({ authorName: 9, sides: { from: { notes: { u1: { label: 12, secret: null, authorName: undefined }, u2: "junk", u3: [1] } } } })
    });
    expect(row.authorName).toBe("9");
    expect(row.sides.from.notes).toEqual({ u1: { authorName: "", label: "12", secret: "", revealed: false, updated: 0 } });
    expect(row.sides.to.notes).toEqual({});
  });
});

describe("canSeeConnection (spec §3)", () => {
  const [shared] = normalizeConnections({ c1: raw() }, "JournalEntry.ilva");
  const [priv] = normalizeConnections({ c1: raw({ shared: false }) }, "JournalEntry.ilva");
  const all = () => true;
  it("GM sees everything, including unresolved targets", () => {
    expect(canSeeConnection(priv, { userId: "gm", isGM: true, canSeeEntry: () => false })).toBe(true);
  });
  it("author sees their private connection; others don't", () => {
    expect(canSeeConnection(priv, { userId: "u1", isGM: false, canSeeEntry: all })).toBe(true);
    expect(canSeeConnection(priv, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(false);
  });
  it("shared connections are party-visible", () => {
    expect(canSeeConnection(shared, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(true);
  });
  it("needs LIMITED+ on both endpoints; an unresolved target hides the row from players", () => {
    const only = (uuid) => (u) => u === uuid;
    expect(canSeeConnection(shared, { userId: "u2", isGM: false, canSeeEntry: only("JournalEntry.ilva") })).toBe(false);
    expect(canSeeConnection(shared, { userId: "u1", isGM: false, canSeeEntry: only("JournalEntry.mara") })).toBe(false);
  });
  it("a foreign author's private connection is GM-only; a shared one stays visible", () => {
    const [foreignPriv] = normalizeConnections({ c1: raw({ authorId: "ghost", shared: false }) }, "JournalEntry.ilva");
    const [foreignShared] = normalizeConnections({ c1: raw({ authorId: "ghost" }) }, "JournalEntry.ilva");
    expect(canSeeConnection(foreignPriv, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(false);
    expect(canSeeConnection(foreignShared, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(true);
  });
  it("a row with no from uuid is hidden from players", () => {
    const [row] = normalizeConnections({ c1: raw() });
    expect(canSeeConnection(row, { userId: "u2", isGM: false, canSeeEntry: (u) => typeof u === "string" })).toBe(false);
  });
});

describe("visibleNote (spec §3 secrets)", () => {
  const n = note({ secret: "owes her a debt" });
  it("writer and GM see the secret; others only once revealed", () => {
    expect(visibleNote(n, "u1", { userId: "u1", isGM: false })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
    expect(visibleNote(n, "u1", { userId: "gm", isGM: true })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
    expect(visibleNote(n, "u1", { userId: "u2", isGM: false })).toMatchObject({ secretVisible: false, secret: "" });
    expect(visibleNote({ ...n, revealed: true }, "u1", { userId: "u2", isGM: false })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
  });
  it("labels are always visible", () => {
    expect(visibleNote(n, "u1", { userId: "u2", isGM: false }).label).toBe("Sister of");
  });
});

describe("sideView (spec §3, §4.5)", () => {
  const known = new Set(["u1", "u2", "gm"]);
  const rowWith = (over = {}) => normalizeConnections({ c1: raw({
    sides: {
      from: { notes: { u1: note({ secret: "debt" }), u2: note({ authorName: "Jo", label: "half-sister", secret: "jealous" }) } },
      to: { notes: { u1: note({ label: "Brother of" }) } }
    }, ...over }) }, "JournalEntry.ilva")[0];
  const viewer = (over = {}) => ({ userId: "u1", isGM: false, enabled: true, knownUserIds: known, canObserveSide: true, ...over });

  it("the author's note is the main label; others list beneath, attributed", () => {
    const v = sideView(rowWith(), "from", viewer());
    expect(v.main).toMatchObject({ writerId: "u1", label: "Sister of", secret: "debt", editable: true, canReveal: true });
    expect(v.others).toEqual([expect.objectContaining({ writerId: "u2", authorName: "Jo", label: "half-sister", secret: "", editable: false, canDelete: false })]);
    expect(v).toMatchObject({ otherUuid: "JournalEntry.mara", reverse: false, isAuthor: true, showAuthor: false, viewerId: "u1", canToggleShare: true, canDelete: true, canAddNote: false });
  });
  it("the reverse side points back at the from entry and shows the author to others", () => {
    const v = sideView(rowWith(), "to", viewer({ userId: "u2" }));
    expect(v).toMatchObject({ otherUuid: "JournalEntry.ilva", reverse: true, showAuthor: true, isAuthor: false, canToggleShare: false, canDelete: false, canAddNote: true });
    expect(v.main).toMatchObject({ label: "Brother of", editable: false });
  });
  it("GM: author shown, every note deletable, nothing editable that isn't theirs", () => {
    const v = sideView(rowWith(), "from", viewer({ userId: "gm", isGM: true }));
    expect(v.showAuthor).toBe(true);
    expect(v.canDelete).toBe(true);
    expect(v.others[0]).toMatchObject({ canDelete: true, editable: false, secret: "jealous" });
  });
  it("setting off: nothing editable, no Add a note, writers can still delete their own note", () => {
    const v = sideView(rowWith(), "from", viewer({ userId: "u2", enabled: false }));
    expect(v.canAddNote).toBe(false);
    expect(v.others[0]).toMatchObject({ editable: false, canReveal: false, canDelete: true });
  });
  it("Add a note needs OBSERVER on this side and, on a private connection, authorship", () => {
    expect(sideView(rowWith(), "to", viewer({ userId: "u2", canObserveSide: false })).canAddNote).toBe(false);
    expect(sideView(rowWith({ shared: false }), "to", viewer({ userId: "u2" })).canAddNote).toBe(false);
    expect(sideView(rowWith({ shared: false }), "to", viewer({ userId: "gm", isGM: true })).canAddNote).toBe(true);
  });
  it("a foreign writer's note is never editable", () => {
    const row = rowWith({ sides: { from: { notes: { ghost: note({ authorName: "Old Friend" }) } } } });
    const v = sideView(row, "from", viewer({ userId: "ghost", knownUserIds: known }));
    expect(v.others[0].editable).toBe(false);
  });
  it("no main note when the author wrote none on this side", () => {
    const row = rowWith({ sides: { from: { notes: { u1: note() } }, to: { notes: {} } } });
    expect(sideView(row, "to", viewer()).main).toBeNull();
    expect(sideView(row, "to", viewer()).canAddNote).toBe(true);
  });
});

describe("countOtherNotes", () => {
  it("counts notes on both sides not written by the connection author", () => {
    const [row] = normalizeConnections({ c1: raw({ sides: {
      from: { notes: { u1: note(), u2: note() } }, to: { notes: { u1: note(), u3: note(), u2: note() } }
    } }) });
    expect(countOtherNotes(row)).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections.test.js`
Expected: FAIL with `Failed to resolve import "../scripts/logic/player-connections.mjs"`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/player-connections.mjs`:

```js
// Player connections (spec 2026-10-09). Pure and Foundry-free: the model,
// who sees what, and the per-side view the Relationships block renders.
// Storage lives on the "from" entry's MEJ-typed page at
// flags["mej-campaign-companion"].playerConnections = {[id]: Connection};
// every reader goes through normalizeConnections so hand-edited or
// half-synced flags are skipped, never thrown on (spec §2, §7).

export const LABEL_MAX = 200;
export const SECRET_MAX = 500;
export const SIDES = ["from", "to"];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** Trimmed text within `max` chars; "" for null/undefined; null when not a string or too long. */
export function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > max ? null : text;
}

function normalizeNotes(side) {
  const notes = {};
  const raw = isObj(side) && isObj(side.notes) ? side.notes : {};
  for (const [userId, n] of Object.entries(raw)) {
    if (!isObj(n)) continue;
    notes[userId] = {
      authorName: str(n.authorName),
      label: str(n.label),
      secret: str(n.secret),
      revealed: n.revealed === true,
      updated: Number.isFinite(n.updated) ? n.updated : 0
    };
  }
  return { notes };
}

/**
 * Defensive parse of the playerConnections flag (spec §2). A row must carry
 * a string `id` equal to its own key (writes address rows by that id, so a
 * mismatch would write beside the row instead of into it) and a string `to`.
 * `fromUuid` is the entry the flag lives on; every row carries it so the
 * reverse side can name its other end.
 */
export function normalizeConnections(flagValue, fromUuid = null) {
  if (!isObj(flagValue)) return [];
  const rows = [];
  for (const [key, raw] of Object.entries(flagValue)) {
    if (!isObj(raw)) continue;
    if (typeof raw.id !== "string" || !raw.id.length || raw.id !== key) continue;
    if (typeof raw.to !== "string" || !raw.to.length) continue;
    const sides = isObj(raw.sides) ? raw.sides : {};
    rows.push({
      id: raw.id,
      from: fromUuid,
      to: raw.to,
      authorId: typeof raw.authorId === "string" ? raw.authorId : "",
      authorName: str(raw.authorName),
      shared: raw.shared !== false,
      created: Number.isFinite(raw.created) ? raw.created : 0,
      sides: { from: normalizeNotes(sides.from), to: normalizeNotes(sides.to) }
    });
  }
  return rows;
}

/**
 * Spec §3: GM sees every row; anyone else needs LIMITED+ on both endpoints
 * (an unresolved target therefore hides the row) and to be the author or the
 * row to be shared. A foreign author (no such user here) can never match
 * userId, so their private rows fall to GM-only on their own.
 */
export function canSeeConnection(row, { userId, isGM, canSeeEntry }) {
  if (!row) return false;
  if (isGM) return true;
  if (!canSeeEntry(row.from) || !canSeeEntry(row.to)) return false;
  return row.authorId === userId || row.shared === true;
}

/** A note as `viewer` may see it: the secret is blanked unless writer, GM, or revealed. */
export function visibleNote(note, writerId, { userId, isGM }) {
  const secretVisible = isGM === true || writerId === userId || note.revealed === true;
  return {
    writerId,
    authorName: note.authorName,
    label: note.label,
    revealed: note.revealed,
    secretVisible,
    secret: secretVisible ? note.secret : ""
  };
}

/**
 * Everything the block needs to draw one connection on one side (spec §4.5):
 * the author's note is the row's main label, other writers' notes list
 * beneath, and each control is decided here so the DOM layer only renders.
 */
export function sideView(row, side, { userId, isGM, enabled, knownUserIds, canObserveSide }) {
  const notes = row.sides[side].notes;
  const known = (id) => knownUserIds?.has?.(id) === true;
  const noteView = (writerId) => {
    const own = writerId === userId;
    const editable = own && enabled === true && known(writerId);
    return {
      ...visibleNote(notes[writerId], writerId, { userId, isGM }),
      editable,
      canReveal: editable && notes[writerId].secret.length > 0,
      canDelete: own || isGM === true
    };
  };
  const isAuthor = row.authorId === userId;
  const others = Object.keys(notes)
    .filter((id) => id !== row.authorId)
    .sort((a, b) => notes[a].authorName.localeCompare(notes[b].authorName) || a.localeCompare(b))
    .map(noteView);
  return {
    id: row.id,
    side,
    from: row.from,
    to: row.to,
    otherUuid: side === "from" ? row.to : row.from,
    reverse: side === "to",
    shared: row.shared,
    authorId: row.authorId,
    authorName: row.authorName,
    foreignAuthor: !known(row.authorId),
    isAuthor,
    showAuthor: isGM === true || !isAuthor,
    viewerId: userId,
    main: notes[row.authorId] ? noteView(row.authorId) : null,
    others,
    canAddNote: enabled === true && canObserveSide === true && !notes[userId] && (row.shared || isAuthor || isGM === true),
    canToggleShare: isAuthor && known(userId),
    canDelete: isAuthor || isGM === true
  };
}

/** Notes on either side written by someone other than the connection author (spec §3 confirmations). */
export function countOtherNotes(row) {
  return SIDES.reduce((n, side) => n + Object.keys(row.sides[side].notes).filter((id) => id !== row.authorId).length, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/player-connections.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass (1106 + the new ones).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/player-connections.mjs test/player-connections.test.js
git commit -m "feat(player-connections): pure model, visibility and per-side view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GM-side validation and keyed update paths (pure)

**Files:**
- Modify: `scripts/constants.mjs` (append after line 159)
- Modify: `scripts/logic/player-connections.mjs` (add an import at the top; append the new exports)
- Modify: `test/constants.test.js`
- Test: `test/player-connections-validate.test.js`

**Interfaces:**
- Consumes: Task 1 `cleanText`, `normalizeConnections`, `canSeeConnection`, `SIDES`, `LABEL_MAX`, `SECRET_MAX`.
- Produces:
  - constants: `PLAYER_CONNECTIONS_FLAG = "playerConnections"`, `PLAYER_CONNECTIONS_SETTING = "playerConnectionsEnabled"`, `PLAYER_CONNECTION_ACTION = "player-connection"`, `PLAYER_CONNECTION_RESULT_ACTION = "player-connection-result"`
  - `OPS = ["add", "setShared", "delete", "setNote", "deleteNote", "setRevealed"]`
  - `validateRequest(op: string, request: { fromUuid, connectionId?, side?, payload? }, ctx) → { ok: true } | { ok: true, noop: true } | { ok: false, reason }`. Here `ctx = { sender: { id, isGM }, enabled: boolean, source: { uuid, typed, locked, allowed: string[] } | null, typeOf: (uuid) => string|null, canAccess: (uuid, level: "LIMITED"|"OBSERVER") => boolean, connections: Connection[] }`. Reasons: `bad-request`, `no-entry`, `locked`, `disabled`, `self`, `no-access`, `type-not-allowed`, `duplicate`, `bad-label`, `not-author`, `gone`.
  - `connectionUpdate(op, request, { senderId, senderName, now, newId, connections }) → Record<string, unknown>`: the keyed `page.update()` data
  - Request payloads: `add {to, shared, fromNote:{label,secret}, toNote?:{label,secret}}`, `setShared {shared}`, `delete {}`, `setNote {label, secret}`, `deleteNote {noteUserId?}`, `setRevealed {revealed}`.

- [ ] **Step 1: Write the failing tests**

Append to `test/constants.test.js` inside the existing `describe("constants", ...)` block (and extend its import line with the four names):

```js
  it("player connections names (spec 2026-10-09)", () => {
    expect(PLAYER_CONNECTIONS_FLAG).toBe("playerConnections");
    expect(PLAYER_CONNECTIONS_SETTING).toBe("playerConnectionsEnabled");
    expect(PLAYER_CONNECTION_ACTION).toBe("player-connection");
    expect(PLAYER_CONNECTION_RESULT_ACTION).toBe("player-connection-result");
  });
```

The import line becomes:

```js
import {
  MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE, SOCKET,
  PLAYER_CONNECTIONS_FLAG, PLAYER_CONNECTIONS_SETTING, PLAYER_CONNECTION_ACTION, PLAYER_CONNECTION_RESULT_ACTION
} from "../scripts/constants.mjs";
```

`test/player-connections-validate.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeConnections, validateRequest, connectionUpdate, OPS } from "../scripts/logic/player-connections.mjs";

const BASE = "flags.mej-campaign-companion.playerConnections";
const note = (over = {}) => ({ authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1, ...over });
const conn = (over = {}) => ({
  id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 1,
  sides: { from: { notes: { u1: note({ secret: "debt" }) } }, to: { notes: { u2: note({ authorName: "Jo", label: "half-sister" }) } } },
  ...over
});
const rows = (flag) => normalizeConnections(flag, "JournalEntry.ilva");
const TYPES = { "JournalEntry.mara": "person", "JournalEntry.ilva": "person", "JournalEntry.ledger": "list" };
const ctx = (over = {}) => ({
  sender: { id: "u1", isGM: false },
  enabled: true,
  source: { uuid: "JournalEntry.ilva", typed: true, locked: false, allowed: ["person", "place"] },
  typeOf: (uuid) => TYPES[uuid] ?? null,
  canAccess: () => true,
  connections: rows({ c1: conn() }),
  ...over
});
const add = (payload = {}) => ({ fromUuid: "JournalEntry.ilva", payload: {
  to: "JournalEntry.bren", shared: true, fromNote: { label: "Owes money to", secret: "" }, ...payload } });
const on = (op, connectionId = "c1", side = "from", payload = {}) => ({ fromUuid: "JournalEntry.ilva", connectionId, side, payload });
const withBren = (over = {}) => ctx({ typeOf: (u) => ({ ...TYPES, "JournalEntry.bren": "person" })[u] ?? null, ...over });

describe("validateRequest - shared gates (spec §5)", () => {
  it("rejects an unknown op", () => {
    expect(validateRequest("rename", on(), ctx())).toEqual({ ok: false, reason: "bad-request" });
    expect(OPS).toEqual(["add", "setShared", "delete", "setNote", "deleteNote", "setRevealed"]);
  });
  it("no-entry when the source doesn't resolve to a MEJ-typed page, for every op", () => {
    for (const op of OPS) {
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: null }))).toEqual({ ok: false, reason: "no-entry" });
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: { uuid: "x", typed: false, locked: false, allowed: [] } })))
        .toEqual({ ok: false, reason: "no-entry" });
    }
  });
  it("locked compendium, for every op", () => {
    for (const op of OPS) {
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: { uuid: "JournalEntry.ilva", typed: true, locked: true, allowed: ["person"] } })))
        .toEqual({ ok: false, reason: "locked" });
    }
  });
});

describe("validateRequest - add", () => {
  it("accepts a valid request", () => {
    expect(validateRequest("add", add(), withBren())).toEqual({ ok: true });
  });
  it("disabled when the setting is off", () => {
    expect(validateRequest("add", add(), withBren({ enabled: false }))).toEqual({ ok: false, reason: "disabled" });
  });
  it("self", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.ilva" }), ctx())).toEqual({ ok: false, reason: "self" });
  });
  it("no-access: no OBSERVER on the source, no LIMITED on the target, or an unknown target", () => {
    const deny = (uuid, level) => (u, l) => !(u === uuid && l === level);
    expect(validateRequest("add", add(), withBren({ canAccess: deny("JournalEntry.ilva", "OBSERVER") }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("add", add(), withBren({ canAccess: deny("JournalEntry.bren", "LIMITED") }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("add", add({ to: "JournalEntry.nowhere" }), ctx())).toEqual({ ok: false, reason: "no-access" });
  });
  it("type-not-allowed", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.ledger" }), ctx())).toEqual({ ok: false, reason: "type-not-allowed" });
  });
  it("duplicate: this author already connected source to target; another author may", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.mara" }), ctx())).toEqual({ ok: false, reason: "duplicate" });
    expect(validateRequest("add", add({ to: "JournalEntry.mara" }), ctx({ sender: { id: "u2", isGM: false } }))).toEqual({ ok: true });
  });
  it("bad-label: empty, non-string or overlong from label; overlong secret; overlong to label", () => {
    for (const payload of [
      { fromNote: { label: "   " } }, { fromNote: { label: 5 } }, { fromNote: { label: "x".repeat(201) } },
      { fromNote: { label: "ok", secret: "s".repeat(501) } }, { toNote: { label: "x".repeat(201) } }, { fromNote: null }
    ]) {
      expect(validateRequest("add", add(payload), withBren())).toEqual({ ok: false, reason: "bad-label" });
    }
  });
  it("bad-request when `to` is missing", () => {
    expect(validateRequest("add", { fromUuid: "JournalEntry.ilva", payload: { fromNote: { label: "x" } } }, ctx()))
      .toEqual({ ok: false, reason: "bad-request" });
  });
});

describe("validateRequest - connection ops", () => {
  const u2 = { sender: { id: "u2", isGM: false } };
  const gm = { sender: { id: "gm", isGM: true } };
  it("setShared: author only (the GM is not excepted); gone when missing", () => {
    expect(validateRequest("setShared", on(), ctx())).toEqual({ ok: true });
    expect(validateRequest("setShared", on(), ctx(u2))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("setShared", on(), ctx(gm))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("setShared", on("nope"), ctx())).toEqual({ ok: false, reason: "gone" });
  });
  it("delete: author or GM; a missing connection is a no-op success", () => {
    expect(validateRequest("delete", on(), ctx())).toEqual({ ok: true });
    expect(validateRequest("delete", on(), ctx(gm))).toEqual({ ok: true });
    expect(validateRequest("delete", on(), ctx(u2))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("delete", on("nope"), ctx(u2))).toEqual({ ok: true, noop: true });
  });
  it("setNote: disabled, gone, bad side, invisible, no OBSERVER on that side, bad label", () => {
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx(u2))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, enabled: false }))).toEqual({ ok: false, reason: "disabled" });
    expect(validateRequest("setNote", on("nope", "to", { label: "x" }), ctx(u2))).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("setNote", on("c1", "middle", { label: "x" }), ctx(u2))).toEqual({ ok: false, reason: "bad-request" });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, connections: rows({ c1: conn({ shared: false }) }) })))
      .toEqual({ ok: false, reason: "no-access" });
    const noObserveMara = (u, l) => !(u === "JournalEntry.mara" && l === "OBSERVER");
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, canAccess: noObserveMara }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("setNote", on("c1", "from", { label: "x" }), ctx({ ...u2, canAccess: noObserveMara }))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x".repeat(201) }), ctx(u2))).toEqual({ ok: false, reason: "bad-label" });
    expect(validateRequest("setNote", on("c1", "to", { label: "", secret: "s".repeat(501) }), ctx(u2))).toEqual({ ok: false, reason: "bad-label" });
    expect(validateRequest("setNote", on("c1", "to", { label: "", secret: "" }), ctx(u2))).toEqual({ ok: true });
  });
  it("setNote on a private connection: only the author or the GM", () => {
    const priv = { connections: rows({ c1: conn({ shared: false }) }) };
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx(priv))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...priv, ...gm }))).toEqual({ ok: true });
  });
  it("deleteNote: writer or GM; missing note or connection is a no-op success; setting off doesn't block it", () => {
    expect(validateRequest("deleteNote", on("c1", "to"), ctx({ ...u2, enabled: false }))).toEqual({ ok: true });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "u2" }), ctx())).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "u2" }), ctx(gm))).toEqual({ ok: true });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "nobody" }), ctx(gm))).toEqual({ ok: true, noop: true });
    expect(validateRequest("deleteNote", on("nope", "to"), ctx(u2))).toEqual({ ok: true, noop: true });
  });
  it("setRevealed: own note only (gone otherwise), disabled when off", () => {
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx())).toEqual({ ok: true });
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx(u2))).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx({ enabled: false }))).toEqual({ ok: false, reason: "disabled" });
  });
  it("a forged connectionId that would walk the flag path never matches a row", () => {
    expect(validateRequest("setShared", on("c1.sides"), ctx())).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("delete", on("-=c1"), ctx())).toEqual({ ok: true, noop: true });
  });
});

describe("connectionUpdate (spec §5 keyed paths)", () => {
  const opts = { senderId: "u1", senderName: "Dana", now: 99, newId: "n1", connections: rows({ c1: conn() }) };
  it("add writes one keyed connection with the author's notes", () => {
    expect(connectionUpdate("add", add({ to: "JournalEntry.bren", fromNote: { label: " Owes money to ", secret: " x " }, toNote: { label: "Lender to" } }), opts)).toEqual({
      [`${BASE}.n1`]: {
        id: "n1", to: "JournalEntry.bren", authorId: "u1", authorName: "Dana", shared: true, created: 99,
        sides: {
          from: { notes: { u1: { authorName: "Dana", label: "Owes money to", secret: "x", revealed: false, updated: 99 } } },
          to: { notes: { u1: { authorName: "Dana", label: "Lender to", secret: "", revealed: false, updated: 99 } } }
        }
      }
    });
  });
  it("add without a to-side note stores an empty notes map; shared:false sticks", () => {
    const data = connectionUpdate("add", add({ shared: false, toNote: { label: "", secret: "" } }), opts);
    expect(data[`${BASE}.n1`].sides.to).toEqual({ notes: {} });
    expect(data[`${BASE}.n1`].shared).toBe(false);
  });
  it("setShared, delete, setRevealed", () => {
    expect(connectionUpdate("setShared", on("c1", "from", { shared: false }), opts)).toEqual({ [`${BASE}.c1.shared`]: false });
    expect(connectionUpdate("delete", on("c1"), opts)).toEqual({ [`${BASE}.-=c1`]: null });
    expect(connectionUpdate("setRevealed", on("c1", "from", { revealed: true }), opts)).toEqual({ [`${BASE}.c1.sides.from.notes.u1.revealed`]: true });
  });
  it("setNote writes the sender's note, keeps revealed while a secret remains", () => {
    const revealedRows = rows({ c1: conn({ sides: { from: { notes: { u1: note({ secret: "debt", revealed: true }) } } } }) });
    expect(connectionUpdate("setNote", on("c1", "from", { label: " Sister of ", secret: "new debt" }), { ...opts, connections: revealedRows }))
      .toEqual({ [`${BASE}.c1.sides.from.notes.u1`]: { authorName: "Dana", label: "Sister of", secret: "new debt", revealed: true, updated: 99 } });
    expect(connectionUpdate("setNote", on("c1", "from", { label: "Sister of", secret: "" }), { ...opts, connections: revealedRows }))
      .toEqual({ [`${BASE}.c1.sides.from.notes.u1`]: { authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 99 } });
  });
  it("setNote with both fields empty deletes the note instead", () => {
    expect(connectionUpdate("setNote", on("c1", "to", { label: " ", secret: "" }), opts)).toEqual({ [`${BASE}.c1.sides.to.notes.-=u1`]: null });
  });
  it("deleteNote targets the named writer (GM) or the sender", () => {
    expect(connectionUpdate("deleteNote", on("c1", "to", { noteUserId: "u2" }), { ...opts, senderId: "gm" })).toEqual({ [`${BASE}.c1.sides.to.notes.-=u2`]: null });
    expect(connectionUpdate("deleteNote", on("c1", "from"), opts)).toEqual({ [`${BASE}.c1.sides.from.notes.-=u1`]: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections-validate.test.js test/constants.test.js`
Expected: FAIL. `validateRequest`/`connectionUpdate`/`OPS` are not exported, and the four constants are undefined.

- [ ] **Step 3: Write the implementation**

Append to `scripts/constants.mjs`:

```js

// Player connections (spec 2026-10-09). Page flag, world setting, and the
// player -> active GM relay pair (hooks/player-connections-relay.mjs).
export const PLAYER_CONNECTIONS_FLAG = "playerConnections";
export const PLAYER_CONNECTIONS_SETTING = "playerConnectionsEnabled";
export const PLAYER_CONNECTION_ACTION = "player-connection";
export const PLAYER_CONNECTION_RESULT_ACTION = "player-connection-result";
```

At the very top of `scripts/logic/player-connections.mjs`, below the header comment, add:

```js
import { MODULE_ID, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
```

Append to `scripts/logic/player-connections.mjs`:

```js
// ---- GM-side validation and writes (spec §5) ------------------------------

export const OPS = ["add", "setShared", "delete", "setNote", "deleteNote", "setRevealed"];
const BASE = `flags.${MODULE_ID}.${PLAYER_CONNECTIONS_FLAG}`;
const fail = (reason) => ({ ok: false, reason });
const OK = Object.freeze({ ok: true });
const NOOP = Object.freeze({ ok: true, noop: true });

/** {label, secret} cleaned to the spec limits, or null when either is invalid (or the label is required and empty). */
function notePair(note, { required }) {
  if (note !== undefined && note !== null && !isObj(note)) return null;
  const label = cleanText(note?.label, LABEL_MAX);
  const secret = cleanText(note?.secret, SECRET_MAX);
  if (label === null || secret === null) return null;
  if (required && !label) return null;
  return { label, secret };
}

/**
 * Every check the active GM runs before writing (spec §5). `ctx` is built
 * GM-side from the live documents and the SOCKET sender - never from the
 * payload. Writes address rows by connectionId and notes by sender id, so a
 * connection/note that isn't found is never written to (gone / no-op).
 */
export function validateRequest(op, request, ctx) {
  if (!OPS.includes(op)) return fail("bad-request");
  const { sender, enabled, source, typeOf, canAccess, connections } = ctx;
  if (!source || source.typed !== true) return fail("no-entry");
  if (source.locked === true) return fail("locked");
  const payload = isObj(request?.payload) ? request.payload : {};

  if (op === "add") {
    if (!enabled) return fail("disabled");
    const to = payload.to;
    if (typeof to !== "string" || !to.length) return fail("bad-request");
    if (to === source.uuid) return fail("self");
    if (!canAccess(source.uuid, "OBSERVER")) return fail("no-access");
    const type = typeOf(to);
    if (!type || !canAccess(to, "LIMITED")) return fail("no-access");
    if (!(source.allowed ?? []).includes(type)) return fail("type-not-allowed");
    if (connections.some((c) => c.authorId === sender.id && c.to === to)) return fail("duplicate");
    if (!notePair(payload.fromNote ?? null, { required: true })) return fail("bad-label");
    if (payload.toNote !== undefined && !notePair(payload.toNote, { required: false })) return fail("bad-label");
    return OK;
  }

  const conn = connections.find((c) => c.id === request?.connectionId) ?? null;
  const sees = (c) => canSeeConnection(c, { userId: sender.id, isGM: sender.isGM === true, canSeeEntry: (u) => canAccess(u, "LIMITED") });
  const side = request?.side;
  switch (op) {
    case "setShared":
      if (!conn) return fail("gone");
      if (conn.authorId !== sender.id) return fail("not-author");
      return OK;
    case "delete":
      if (!conn) return NOOP;
      if (conn.authorId !== sender.id && sender.isGM !== true) return fail("not-author");
      return OK;
    case "setNote": {
      if (!enabled) return fail("disabled");
      if (!conn) return fail("gone");
      if (!SIDES.includes(side)) return fail("bad-request");
      if (!sees(conn)) return fail("no-access");
      const sideUuid = side === "from" ? source.uuid : conn.to;
      if (sender.isGM !== true && !canAccess(sideUuid, "OBSERVER")) return fail("no-access");
      if (!notePair(payload, { required: false })) return fail("bad-label");
      return OK;
    }
    case "deleteNote": {
      if (!conn) return NOOP;
      if (!SIDES.includes(side)) return fail("bad-request");
      const writer = typeof payload.noteUserId === "string" ? payload.noteUserId : sender.id;
      if (!conn.sides[side].notes[writer]) return NOOP;
      if (writer !== sender.id && sender.isGM !== true) return fail("not-author");
      return OK;
    }
    case "setRevealed":
      if (!enabled) return fail("disabled");
      if (!conn) return fail("gone");
      if (!SIDES.includes(side)) return fail("bad-request");
      if (!conn.sides[side].notes[sender.id]) return fail("gone");
      if (!sees(conn)) return fail("no-access");
      return OK;
  }
  return fail("bad-request");
}

/**
 * The page.update() data for a validated request (spec §5): keyed paths
 * and `-=` deletes only, so two players writing at once never overwrite
 * each other. Call only after validateRequest returned { ok: true } without
 * `noop` - the path segments (connectionId, side, note writer) are trusted
 * here because validation found them in the stored flag.
 */
export function connectionUpdate(op, request, { senderId, senderName, now, newId, connections }) {
  const payload = isObj(request?.payload) ? request.payload : {};
  const cid = request?.connectionId;
  const side = request?.side;
  const noteKey = (s, uid) => `${BASE}.${cid}.sides.${s}.notes.${uid}`;
  const noteDelete = (s, uid) => `${BASE}.${cid}.sides.${s}.notes.-=${uid}`;
  const makeNote = ({ label, secret }, revealed = false) => ({ authorName: senderName, label, secret, revealed, updated: now });
  switch (op) {
    case "add": {
      const fromNote = notePair(payload.fromNote, { required: true });
      const toNote = payload.toNote === undefined ? null : notePair(payload.toNote, { required: false });
      const toNotes = toNote && (toNote.label || toNote.secret) ? { [senderId]: makeNote(toNote) } : {};
      return {
        [`${BASE}.${newId}`]: {
          id: newId, to: payload.to, authorId: senderId, authorName: senderName,
          shared: payload.shared !== false, created: now,
          sides: { from: { notes: { [senderId]: makeNote(fromNote) } }, to: { notes: toNotes } }
        }
      };
    }
    case "setShared":
      return { [`${BASE}.${cid}.shared`]: payload.shared === true };
    case "delete":
      return { [`${BASE}.-=${cid}`]: null };
    case "setNote": {
      const { label, secret } = notePair(payload, { required: false });
      if (!label && !secret) return { [noteDelete(side, senderId)]: null };
      const prior = connections.find((c) => c.id === cid)?.sides[side].notes[senderId];
      return { [noteKey(side, senderId)]: makeNote({ label, secret }, prior?.revealed === true && secret.length > 0) };
    }
    case "deleteNote": {
      const writer = typeof payload.noteUserId === "string" ? payload.noteUserId : senderId;
      return { [noteDelete(side, writer)]: null };
    }
    case "setRevealed":
      return { [`${noteKey(side, senderId)}.revealed`]: payload.revealed === true };
  }
  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/player-connections-validate.test.js test/constants.test.js test/player-connections.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/constants.mjs scripts/logic/player-connections.mjs test/constants.test.js test/player-connections-validate.test.js
git commit -m "feat(player-connections): GM-side validation and keyed update paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reverse index (pure core + live hook module)

**Files:**
- Modify: `scripts/logic/player-connections.mjs` (append)
- Create: `scripts/hooks/player-connections-index.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs:152-155` (add a `registerCore` step after "relationships ui")
- Test: `test/player-connections-index.test.js`

**Interfaces:**
- Consumes: Task 1 `normalizeConnections`; `mejType` from `scripts/integrations/mej-adapter.mjs:76`.
- Produces:
  - pure: `createReverseIndex() → { inbound: Map<toUuid, {fromUuid, row}[]>, outbound: Map<fromUuid, Set<toUuid>> }`, `buildReverseIndex(sources: Iterable<{fromUuid, flag}>) → index`, `reindexSource(index, {fromUuid, flag}) → Set<uuid>` (affected entries: old and new targets plus the source), `removeSource(index, fromUuid) → Set<uuid>`, `incomingFor(index, toUuid) → {fromUuid, row}[]`
  - hooks: `typedPageOf(entry) → JournalEntryPage|null`, `ensureConnectionIndex() → index`, `incomingConnections(toUuid) → {fromUuid, row}[]`, `refreshConnectionViews(uuids: Set<string>|null) → void`, `registerPlayerConnectionsIndex() → void`

- [ ] **Step 1: Write the failing tests**

`test/player-connections-index.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildReverseIndex, reindexSource, removeSource, incomingFor, createReverseIndex } from "../scripts/logic/player-connections.mjs";

const row = (id, to) => ({ id, to, authorId: "u1", authorName: "Dana", sides: { from: { notes: { u1: { label: id } } } } });
const flag = (...rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("reverse index (spec §4.3)", () => {
  it("indexes each connection under its target, from every source", () => {
    const index = buildReverseIndex([
      { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara"), row("c2", "J.bren")) },
      { fromUuid: "J.bren", flag: flag(row("c3", "J.mara")) },
      { fromUuid: "J.empty", flag: undefined }
    ]);
    expect(incomingFor(index, "J.mara").map((e) => [e.fromUuid, e.row.id])).toEqual([["J.ilva", "c1"], ["J.bren", "c3"]]);
    expect(incomingFor(index, "J.bren").map((e) => e.row.from)).toEqual(["J.ilva"]);
    expect(incomingFor(index, "J.nobody")).toEqual([]);
    expect(incomingFor(null, "J.mara")).toEqual([]);
  });
  it("add: reindexing a source picks up a new connection and reports what changed", () => {
    const index = createReverseIndex();
    const affected = reindexSource(index, { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) });
    expect([...affected].sort()).toEqual(["J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toHaveLength(1);
  });
  it("update: a retargeted or removed connection leaves its old target, and both are reported", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) }]);
    const affected = reindexSource(index, { fromUuid: "J.ilva", flag: flag(row("c1", "J.bren")) });
    expect([...affected].sort()).toEqual(["J.bren", "J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toEqual([]);
    expect(incomingFor(index, "J.bren")).toHaveLength(1);
  });
  it("update: other sources' entries for the same target survive", () => {
    const index = buildReverseIndex([
      { fromUuid: "J.ilva", flag: flag(row("c1", "J.mara")) },
      { fromUuid: "J.bren", flag: flag(row("c3", "J.mara")) }
    ]);
    reindexSource(index, { fromUuid: "J.ilva", flag: {} });
    expect(incomingFor(index, "J.mara").map((e) => e.fromUuid)).toEqual(["J.bren"]);
  });
  it("delete: removing a source drops all its connections and reports its targets", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: flag(row("c1", "J.mara"), row("c2", "J.bren")) }]);
    expect([...removeSource(index, "J.ilva")].sort()).toEqual(["J.bren", "J.ilva", "J.mara"]);
    expect(incomingFor(index, "J.mara")).toEqual([]);
    expect(index.outbound.has("J.ilva")).toBe(false);
    expect([...removeSource(index, "J.unknown")]).toEqual(["J.unknown"]);
  });
  it("malformed rows never enter the index", () => {
    const index = buildReverseIndex([{ fromUuid: "J.ilva", flag: { bad: { id: "bad" }, c1: row("c1", "J.mara") } }]);
    expect(incomingFor(index, "J.mara")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections-index.test.js`
Expected: FAIL. `buildReverseIndex` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `scripts/logic/player-connections.mjs`:

```js
// ---- Reverse index (spec §4.3) ---------------------------------------------
// Only the "from" end stores a connection; the "to" end finds it here.
// `outbound` remembers each source's targets so a source can be re-indexed
// or dropped without scanning every target.

export function createReverseIndex() {
  return { inbound: new Map(), outbound: new Map() };
}

export function removeSource(index, fromUuid) {
  const affected = new Set([fromUuid]);
  const targets = index.outbound.get(fromUuid);
  if (!targets) return affected;
  for (const to of targets) {
    const kept = (index.inbound.get(to) ?? []).filter((e) => e.fromUuid !== fromUuid);
    if (kept.length) index.inbound.set(to, kept);
    else index.inbound.delete(to);
    affected.add(to);
  }
  index.outbound.delete(fromUuid);
  return affected;
}

export function reindexSource(index, { fromUuid, flag }) {
  const affected = removeSource(index, fromUuid);
  const targets = new Set();
  for (const row of normalizeConnections(flag, fromUuid)) {
    const list = index.inbound.get(row.to) ?? [];
    list.push({ fromUuid, row });
    index.inbound.set(row.to, list);
    targets.add(row.to);
    affected.add(row.to);
  }
  if (targets.size) index.outbound.set(fromUuid, targets);
  return affected;
}

export function buildReverseIndex(sources) {
  const index = createReverseIndex();
  for (const source of sources ?? []) reindexSource(index, source);
  return index;
}

export function incomingFor(index, toUuid) {
  return index?.inbound.get(toUuid) ?? [];
}
```

`scripts/hooks/player-connections-index.mjs`:

```js
// Live reverse index for player connections (spec §4.3): which connections
// point AT an entry. Built lazily on first use (the tab wrap or the block
// asks for it on a sheet's first render), then patched from the journal CRUD
// hooks - updates that arrive through an Omnipresence sync fire the same
// hooks, so they show without a reload. Every patch re-renders the sheets
// showing an affected entry, because the "to" end's page never changes when
// a connection to it is written.
import { MODULE_ID, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { buildReverseIndex, reindexSource, removeSource, incomingFor } from "../logic/player-connections.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

let index = null;
let registered = false;

/** The entry's MEJ-typed page (first typed page wins, like graphRowsFor). */
export function typedPageOf(entry) {
  return entry?.pages?.contents?.find((p) => mejType(p)) ?? null;
}

function sourceOf(entry) {
  return { fromUuid: entry.uuid, flag: typedPageOf(entry)?.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] };
}

export function ensureConnectionIndex() {
  if (!index) index = buildReverseIndex((game.journal?.contents ?? []).map(sourceOf));
  return index;
}

/** Connections stored on other entries that point at `toUuid`. */
export function incomingConnections(toUuid) {
  return incomingFor(ensureConnectionIndex(), toUuid);
}

/** Popped-out MEJ page sheets (the shell's own subsheet excluded); same probe as secrets-ui.mjs. */
function poppedOutPageSheets() {
  const registry = foundry.applications?.instances;
  if (!registry?.values) return [];
  const shellSubsheet = game.MonksEnhancedJournal?.journal?.subsheet ?? null;
  return [...registry.values()].filter((app) =>
    app && app !== shellSubsheet && app.rendered && app.document instanceof JournalEntryPage);
}

/**
 * Re-render the shell and popped-out sheets showing any entry in `uuids`;
 * `null` = every one (a setting change implicates no single entry).
 */
export function refreshConnectionViews(uuids) {
  const hit = (uuid) => !uuids || uuids.has(uuid);
  const shell = game.MonksEnhancedJournal?.journal;
  if (shell?.rendered) {
    const shown = shell.document?.parent ?? shell.document;
    if (shown && hit(shown.uuid)) shell.render({ tempOwnership: shell.tempOwnership, reload: true });
  }
  for (const app of poppedOutPageSheets()) {
    if (hit(app.document?.parent?.uuid)) app.render?.();
  }
}

export function registerPlayerConnectionsIndex() {
  if (registered) return;
  registered = true;
  const patch = (entry) => {
    if (!index || !entry?.uuid) return;
    refreshConnectionViews(reindexSource(index, sourceOf(entry)));
  };
  Hooks.on("createJournalEntry", (entry) => patch(entry));
  Hooks.on("createJournalEntryPage", (page) => patch(page.parent));
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    const ours = changes?.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] !== undefined;
    const retyped = changes?.flags?.["monks-enhanced-journal"]?.type !== undefined;
    if (ours || retyped) patch(page.parent);
  });
  Hooks.on("deleteJournalEntryPage", (page) => patch(page.parent));
  // Deleting the "from" entry removes its connections with it (spec §2);
  // deleting a "to" entry leaves rows pointing at it, which now render
  // unresolved (GM-only) on their source entries - refresh those too.
  Hooks.on("deleteJournalEntry", (entry) => {
    if (!index) return;
    const sources = incomingFor(index, entry.uuid).map((e) => e.fromUuid);
    const affected = removeSource(index, entry.uuid);
    for (const uuid of sources) affected.add(uuid);
    refreshConnectionViews(affected);
  });
}
```

In `scripts/integrations/mej-adapter.mjs`, directly after the "relationships ui" step (lines 152-155), add:

```js
  await step("player connections index", async () => {
    const { registerPlayerConnectionsIndex } = await import("../hooks/player-connections-index.mjs");
    registerPlayerConnectionsIndex();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/player-connections-index.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/player-connections.mjs scripts/hooks/player-connections-index.mjs scripts/integrations/mej-adapter.mjs test/player-connections-index.test.js
git commit -m "feat(player-connections): reverse index for the to-end of a connection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Relationships tab visibility: setting, decision, `_prepareTabs` wrap

**Files:**
- Create: `scripts/logic/rel-tab-visibility.mjs`
- Create: `scripts/hooks/rel-tab-wrap.mjs`
- Modify: `scripts/campaign-companion.mjs` (imports lines 1-30; `init` after the `warnPlayerAccess` registration, lines 53-62; `ready` after line 312)
- Modify: `lang/en.json` (`settings`, after `warnPlayerAccess` at line 38)
- Test: `test/rel-tab-visibility.test.js`

**Interfaces:**
- Consumes: `visibleRelRows` (`scripts/logic/rel-reveals.mjs:20`); Task 1 `normalizeConnections`, `canSeeConnection`; Task 3 `incomingConnections`, `refreshConnectionViews`; `installWraps` (`scripts/logic/mej-wraps.mjs:27`); `wrapEnv` (`scripts/integrations/wrap-env.mjs:11`); Task 2 `PLAYER_CONNECTIONS_SETTING`, `PLAYER_CONNECTIONS_FLAG`.
- Produces:
  - `relationshipsTabVisible({ isGM, visibleGmRows: number, visiblePlayerRows: number, canAdd: boolean }) → boolean`
  - `countVisibleGmRows(relationships, relReveals, { userId, groups, sheetType: string, canSeeTarget: (uuid) => boolean }) → number`
  - `applyRelationshipsTab(tabs, { visible, hiddenBySetting, fullTabs }) → { tabs, activate: string|null }`
  - `playerConnectionsEnabled() → boolean` (from `scripts/hooks/rel-tab-wrap.mjs`), `registerRelationshipsTabWrap() → Promise<void>`
  - world setting `playerConnectionsEnabled` registered at `init`

- [ ] **Step 1: Write the failing tests**

`test/rel-tab-visibility.test.js`:

```js
import { describe, it, expect } from "vitest";
import { relationshipsTabVisible, countVisibleGmRows, applyRelationshipsTab } from "../scripts/logic/rel-tab-visibility.mjs";

describe("relationshipsTabVisible (spec §3 tab rules)", () => {
  const none = { isGM: false, visibleGmRows: 0, visiblePlayerRows: 0, canAdd: false };
  it("GM always", () => expect(relationshipsTabVisible({ ...none, isGM: true })).toBe(true));
  it("rule 1: a visible GM row", () => expect(relationshipsTabVisible({ ...none, visibleGmRows: 1 })).toBe(true));
  it("rule 2: a visible player connection", () => expect(relationshipsTabVisible({ ...none, visiblePlayerRows: 1 })).toBe(true));
  it("rule 3: can add", () => expect(relationshipsTabVisible({ ...none, canAdd: true })).toBe(true));
  it("nothing visible and can't add (LIMITED viewer, or setting off): hidden", () => expect(relationshipsTabVisible(none)).toBe(false));
});

describe("countVisibleGmRows", () => {
  const rels = {
    r1: { id: "r1", uuid: "J.a", hidden: false, type: "person" },
    r2: { id: "r2", uuid: "J.b", hidden: true, type: "place" },
    r3: { id: "r3", uuid: "J.c", hidden: false, type: "quest" },
    r4: { id: "r4", uuid: "J.gone", hidden: false, type: "quest" }
  };
  const base = { userId: "u1", groups: [], sheetType: "person", canSeeTarget: (u) => u !== "J.gone" };
  it("counts non-hidden rows whose target the viewer can see", () => {
    expect(countVisibleGmRows(rels, {}, base)).toBe(2);
  });
  it("counts a hidden row revealed to this player through relReveals", () => {
    expect(countVisibleGmRows(rels, { r2: { row: { users: ["u1"], groups: [], all: false } } }, base)).toBe(3);
  });
  it("on a Place, person/shop rows live on their own tabs and don't count", () => {
    expect(countVisibleGmRows(rels, {}, { ...base, sheetType: "place" })).toBe(1);
  });
  it("tolerates the legacy array form and nullish", () => {
    expect(countVisibleGmRows([{ id: "x", uuid: "J.a" }], {}, base)).toBe(1);
    expect(countVisibleGmRows(undefined, undefined, base)).toBe(0);
  });
});

describe("applyRelationshipsTab (spec §4.7)", () => {
  const tab = (id, active = false) => ({ id, group: "primary", active, cssClass: active ? "active" : "" });
  const full = { description: tab("description", true), relationships: tab("relationships"), notes: tab("notes") };
  it("removes the tab when not visible", () => {
    const { tabs, activate } = applyRelationshipsTab({ ...full }, { visible: false, hiddenBySetting: false, fullTabs: null });
    expect(Object.keys(tabs)).toEqual(["description", "notes"]);
    expect(activate).toBeNull();
  });
  it("activates the first remaining tab when the removed one was active", () => {
    const tabs = { description: tab("description"), relationships: tab("relationships", true), notes: tab("notes") };
    const out = applyRelationshipsTab(tabs, { visible: false, hiddenBySetting: false, fullTabs: null });
    expect(out.activate).toBe("description");
    expect(out.tabs.description).toMatchObject({ active: true, cssClass: "active" });
  });
  it("restores the tab MEJ removed for an empty raw flag, in its original position, inactive", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: false, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "relationships", "notes"]);
    expect(tabs.relationships).toMatchObject({ active: false, cssClass: "" });
  });
  it("never restores a tab the sheet-type setting hid (shown: false still wins)", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: true, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "notes"]);
  });
  it("keeps tabs a subclass added after the base list", () => {
    const mejOut = { description: tab("description", true), notes: tab("notes"), townsfolk: tab("townsfolk") };
    const { tabs } = applyRelationshipsTab(mejOut, { visible: true, hiddenBySetting: false, fullTabs: full });
    expect(Object.keys(tabs)).toEqual(["description", "relationships", "notes", "townsfolk"]);
  });
  it("is a no-op on a sheet without a relationships tab, and idempotent (Place runs it twice)", () => {
    const hub = { index: tab("index", true) };
    expect(applyRelationshipsTab(hub, { visible: true, hiddenBySetting: false, fullTabs: { index: tab("index") } }).tabs).toBe(hub);
    const once = applyRelationshipsTab({ description: tab("description", true) }, { visible: true, hiddenBySetting: false, fullTabs: full }).tabs;
    const twice = applyRelationshipsTab(once, { visible: true, hiddenBySetting: false, fullTabs: full }).tabs;
    expect(twice).toEqual(once);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/rel-tab-visibility.test.js`
Expected: FAIL with `Failed to resolve import "../scripts/logic/rel-tab-visibility.mjs"`.

- [ ] **Step 3: Write the pure module**

`scripts/logic/rel-tab-visibility.mjs`:

```js
// Relationships tab for non-GMs (spec 2026-10-09 §3, §4.7). MEJ removes the
// tab when the raw relationships flag is empty (EnhancedJournalSheet.js:228-232)
// and PlaceSheet removes it again when no non-person/shop rows exist
// (PlaceSheet.js:74-76) - both on RAW rows, so a player whose rows are all
// hidden sees an empty tab while a player who could contribute sees none.
// These pure functions decide and apply the companion's rule instead.
import { visibleRelRows } from "./rel-reveals.mjs";

const KEY = "relationships";
// PlaceSheet shows person and shop rows on its own Townsfolk / Shops tabs.
const PLACE_OWN_TABS = new Set(["person", "shop"]);

export function relationshipsTabVisible({ isGM, visibleGmRows, visiblePlayerRows, canAdd }) {
  if (isGM) return true;
  return visibleGmRows > 0 || visiblePlayerRows > 0 || canAdd === true;
}

function relTypeById(relationships) {
  const entries = Array.isArray(relationships)
    ? relationships.map((rel) => [rel?.id ?? "", rel])
    : relationships && typeof relationships === "object" ? Object.entries(relationships) : [];
  return new Map(entries.map(([key, rel]) => [String(rel?.id ?? key), rel?.type]));
}

/** GM rows this player sees on the Relationships tab itself (rule 1). */
export function countVisibleGmRows(relationships, relReveals, { userId, groups, sheetType, canSeeTarget }) {
  const types = relTypeById(relationships);
  return visibleRelRows(relationships, relReveals ?? {}, { userId, groups, isGM: false })
    .filter((r) => sheetType !== "place" || !PLACE_OWN_TABS.has(types.get(r.id)))
    .filter((r) => canSeeTarget(r.uuid))
    .length;
}

/**
 * Apply the decision to a prepared tabs record. Removing an active tab
 * activates the first remaining one (returned as `activate` so the caller
 * can update tabGroups); restoring takes the pre-MEJ-filtering tab object
 * from `fullTabs` and keeps the original order. A tab hidden by MEJ's
 * per-sheet-type `shown: false` setting is never restored.
 */
export function applyRelationshipsTab(tabs, { visible, hiddenBySetting, fullTabs }) {
  if (!tabs) return { tabs, activate: null };
  if (hiddenBySetting || !visible) {
    if (!(KEY in tabs)) return { tabs, activate: null };
    const wasActive = tabs[KEY]?.active === true;
    const next = { ...tabs };
    delete next[KEY];
    if (!wasActive) return { tabs: next, activate: null };
    const first = Object.keys(next)[0] ?? null;
    if (first) next[first] = { ...next[first], active: true, cssClass: "active" };
    return { tabs: next, activate: first };
  }
  if (KEY in tabs || !fullTabs?.[KEY]) return { tabs, activate: null };
  const anyActive = Object.values(tabs).some((t) => t?.active === true);
  const restored = anyActive ? { ...fullTabs[KEY], active: false, cssClass: "" } : { ...fullTabs[KEY] };
  const next = {};
  for (const key of Object.keys(fullTabs)) {
    if (key === KEY) next[key] = restored;
    else if (key in tabs) next[key] = tabs[key];
  }
  for (const key of Object.keys(tabs)) if (!(key in next)) next[key] = tabs[key];
  return { tabs: next, activate: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/rel-tab-visibility.test.js` → Expected: PASS.

- [ ] **Step 5: Write the wrap**

`scripts/hooks/rel-tab-wrap.mjs`:

```js
// Companion wrap of MEJ's _prepareTabs (spec 2026-10-09 §4.7). MEJ deletes
// the relationships tab INSIDE the wrapped method, so the wrap works on its
// result: for a non-GM and the "primary" group it removes the tab when §3
// says hidden, and restores it from the parent class's _prepareTabs (the
// pre-MEJ-filtering tab object) when §3 says visible. PlaceSheet re-deletes
// the tab after calling super (PlaceSheet.js:61-76, in 13.06 and 14.01
// alike), so it is wrapped too; the decision is idempotent. Subclasses that
// call super._prepareTabs (SessionSheet, CampaignHubPage) inherit it.
// Never patches MEJ: installWraps (libWrapper when usable, manual otherwise).
import { MODULE_ID, PLAYER_GROUPS_SETTING, PLAYER_CONNECTIONS_SETTING, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { installWraps } from "../logic/mej-wraps.mjs";
import { wrapEnv } from "../integrations/wrap-env.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { normalizeConnections, canSeeConnection } from "../logic/player-connections.mjs";
import { relationshipsTabVisible, countVisibleGmRows, applyRelationshipsTab } from "../logic/rel-tab-visibility.mjs";
import { incomingConnections } from "./player-connections-index.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";

/** World setting "Players can create connections"; false if unreadable. */
export function playerConnectionsEnabled() {
  try {
    return game.settings.get(MODULE_ID, PLAYER_CONNECTIONS_SETTING) !== false;
  } catch {
    return false;
  }
}

const canLimited = (uuid) => {
  const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
};

function relTabDecision(sheet) {
  const page = sheet.document;
  const entry = page?.parent;
  if (!(page instanceof JournalEntryPage) || !entry) return null;
  let hiddenBySetting = false;
  try {
    hiddenBySetting = sheet.sheetSettings?.()?.tabs?.relationships?.shown === false;
  } catch {
    hiddenBySetting = false;
  }
  const visibleGmRows = countVisibleGmRows(
    page.flags?.[MEJ_FLAGS]?.relationships,
    entry.getFlag(MODULE_ID, "relReveals") ?? {},
    {
      userId: game.user.id,
      groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
      sheetType: sheet.constructor?.type,
      canSeeTarget: canLimited
    }
  );
  const see = (row) => canSeeConnection(row, { userId: game.user.id, isGM: false, canSeeEntry: canLimited });
  const visiblePlayerRows =
    normalizeConnections(page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], entry.uuid).filter(see).length
    + incomingConnections(entry.uuid).filter(({ row }) => see(row)).length;
  const canAdd = playerConnectionsEnabled()
    && entry.testUserPermission(game.user, "OBSERVER") === true
    && (sheet.allowedRelationships?.length ?? 0) > 0;
  return {
    hiddenBySetting,
    visible: relationshipsTabVisible({ isGM: false, visibleGmRows, visiblePlayerRows, canAdd })
  };
}

function makeWrapper(baseProto) {
  return function relationshipsTabWrapper(wrapped, group) {
    const tabs = wrapped(group);
    if (group !== "primary" || game.user.isGM) return tabs;
    try {
      const decision = relTabDecision(this);
      if (!decision) return tabs;
      const fullTabs = decision.visible && !decision.hiddenBySetting && !tabs?.relationships
        ? baseProto._prepareTabs.call(this, group)
        : null;
      const { tabs: next, activate } = applyRelationshipsTab(tabs, { ...decision, fullTabs });
      if (activate && this.tabGroups) this.tabGroups[group] = activate;
      return next;
    } catch (err) {
      console.error(`${MODULE_ID} | relationships tab decision failed`, err);
      return tabs;
    }
  };
}

export async function registerRelationshipsTabWrap() {
  let EnhancedJournalSheet;
  let PlaceSheet = null;
  try {
    ({ EnhancedJournalSheet } = await import("/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js"));
  } catch (err) {
    console.warn(`${MODULE_ID} | relationships tab visibility unavailable: MEJ sheet class not importable`, err);
    return;
  }
  try {
    ({ PlaceSheet } = await import("/modules/monks-enhanced-journal/sheets/PlaceSheet.js"));
  } catch {
    PlaceSheet = null;
  }
  const wrapper = makeWrapper(Object.getPrototypeOf(EnhancedJournalSheet.prototype));
  const specs = [{ name: "EnhancedJournalSheet._prepareTabs", object: EnhancedJournalSheet?.prototype, key: "_prepareTabs", wrapper }];
  if (PlaceSheet?.prototype && Object.hasOwn(PlaceSheet.prototype, "_prepareTabs")) {
    specs.push({ name: "PlaceSheet._prepareTabs", object: PlaceSheet.prototype, key: "_prepareTabs", wrapper });
  }
  const result = installWraps(specs, wrapEnv("relationships tab"));
  if (result.failed) console.warn(`${MODULE_ID} | relationships tab visibility unavailable (wrap not installable)`);
}
```

- [ ] **Step 6: Register the setting and the wrap**

In `scripts/campaign-companion.mjs`, add `PLAYER_CONNECTIONS_SETTING` to the `./constants.mjs` import (line 6), and add below line 23 (`import { registerEntityFromSelection } ...`):

```js
import { registerRelationshipsTabWrap } from "./hooks/rel-tab-wrap.mjs";
```

In the `init` hook, directly after the `WARN_PLAYER_ACCESS_SETTING` registration (ends line 62):

```js
  // Player connections (spec 2026-10-09 §4.8): off hides Add connection, Add
  // a note and the drop target and makes notes read-only; existing
  // connections still display. Open sheets re-render on change.
  game.settings.register(MODULE_ID, PLAYER_CONNECTIONS_SETTING, {
    name: `${I18N}.settings.playerConnectionsEnabled.name`,
    hint: `${I18N}.settings.playerConnectionsEnabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      import("./hooks/player-connections-index.mjs")
        .then((m) => m.refreshConnectionViews(null))
        .catch((err) => console.error(`${MODULE_ID} | player connections refresh failed`, err));
    }
  });
```

In the `ready` hook, directly after line 312 (`... registerEntityFromSelection();`):

```js
  // Player connections (spec 2026-10-09 §4.7): sheets render after ready, so
  // the _prepareTabs wrap is in place before any Relationships tab is built.
  if (game.modules.get("monks-enhanced-journal")?.active) {
    registerRelationshipsTabWrap().catch((err) => console.error(`${MODULE_ID} | relationships tab wrap failed`, err));
  }
```

In `lang/en.json`, inside `MEJCampaignCompanion.settings`, after the `"warnPlayerAccess": { ... }` object (line 38), add a comma and:

```json
      "playerConnectionsEnabled": {
        "name": "Players can create connections",
        "hint": "Let players record connections between journal entries on the Relationships tab. Off hides Add connection and Add a note and makes notes read-only; existing connections still show, and their writers can still delete them."
      }
```

Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))"` → Expected: no output.

- [ ] **Step 7: Run tests and smoke the wrap**

Run: `npm test` → Expected: all pass.

Smoke on v14 World A. Point the module symlink at this worktree first, and restore it in Task 11 Step 6 or right after the smoke:

```bash
L=~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion; readlink "$L"   # expected: /Users/danbularzik/Claude/Projects/mej-campaign-companion
ln -sfn ~/Claude/Projects/mej-campaign-companion/.claude/worktrees/player-connections "$L"
```

As User 1 (Playwright `login(page, "User 1")`), open an OBSERVER Person with no relationships and confirm `#MonksEnhancedJournal nav.tabs a[data-tab="relationships"]` exists. Turn `playerConnectionsEnabled` off as GM and confirm it is gone after re-opening. Turn it back on. Restore: `ln -sfn ~/Claude/Projects/mej-campaign-companion "$L"`.

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/rel-tab-visibility.mjs scripts/hooks/rel-tab-wrap.mjs scripts/campaign-companion.mjs lang/en.json test/rel-tab-visibility.test.js
git commit -m "feat(player-connections): Relationships tab visibility for players via a _prepareTabs wrap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Player → GM relay and apply

**Files:**
- Create: `scripts/hooks/player-connections-relay.mjs`
- Modify: `scripts/hooks/socket.mjs:22-39` (imports, `HANDLERS`, `GM_ACTIONS`)
- Modify: `lang/en.json` (new `MEJCampaignCompanion.playerConnections` object after `playerAccess`, line 477-493)
- Modify: `test/socket-dispatcher.test.js`
- Test: `test/player-connections-relay.test.js`

**Interfaces:**
- Consumes: Task 2 `validateRequest`, `connectionUpdate`, constants; Task 1 `normalizeConnections`; `mejTypeWith` (`scripts/logic/mej-type.mjs:38`); `ENTITY_RELAY_TIMEOUT_MS` (`scripts/constants.mjs:153`).
- Produces (from `scripts/hooks/player-connections-relay.mjs`):
  - `applyConnectionOp(request: { op, fromUuid, connectionId?, side?, payload? }, senderId: string, env?) → Promise<{ ok: true, connectionId, noop? } | { ok: false, reason }>`
  - `handleConnectionRequest(payload, senderId, env?)`: GM socket handler; replies `{ action: PLAYER_CONNECTION_RESULT_ACTION, requestId, recipient: senderId, ...outcome }`
  - `handleConnectionResult(payload, senderId, env?)`: requester socket handler
  - `requestConnectionOp(request, env?) → Promise<outcome>`: GM applies directly; with no active GM it resolves `{ ok: false, reason: "no-gm" }` at once; times out to `{ ok: false, reason: "timeout" }`
  - `connectionReasonKey(reason) → string` (i18n key), `showConnectionOutcome(outcome) → void` (warn toast on failure)
  - Extra reason codes beyond §5: `bad-sender`, `no-gm`, `timeout`, `failed`.
  - `env = { emit, users: { get(id) }, knownUserIds(): Set, userId, isGM, activeGM(), randomId(), now(), enabled(), resolveSource(uuid) → Promise<{ uuid, page, typed, locked, allowed } | null>, typeOf(uuid), canAccess(user, uuid, level), update(page, data) }`

- [ ] **Step 1: Write the failing tests**

`test/player-connections-relay.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyConnectionOp, handleConnectionRequest, handleConnectionResult, requestConnectionOp, connectionReasonKey
} from "../scripts/hooks/player-connections-relay.mjs";
import { ENTITY_RELAY_TIMEOUT_MS } from "../scripts/constants.mjs";

const BASE = "flags.mej-campaign-companion.playerConnections";
const stored = {
  c1: { id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 1,
    sides: { from: { notes: { u1: { authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1 } } }, to: { notes: {} } } }
};

function env(over = {}) {
  const page = { flags: { "mej-campaign-companion": { playerConnections: stored } } };
  return {
    page,
    emitted: [],
    emit(msg) { this.emitted.push(msg); },
    users: new Map([
      ["u1", { id: "u1", name: "Dana", isGM: false }], ["u2", { id: "u2", name: "Jo", isGM: false }],
      ["gm", { id: "gm", name: "Gamemaster", isGM: true }]
    ]),
    knownUserIds: () => new Set(["u1", "u2", "gm"]),
    userId: "u1",
    isGM: false,
    activeGM: () => ({ id: "gm" }),
    randomId: () => "new1",
    now: () => 500,
    enabled: () => true,
    resolveSource: vi.fn(async (uuid) => (uuid === "JournalEntry.ilva"
      ? { uuid, page, typed: true, locked: false, allowed: ["person", "place"] } : null)),
    typeOf: (uuid) => ({ "JournalEntry.mara": "person", "JournalEntry.bren": "person", "JournalEntry.ilva": "person" })[uuid] ?? null,
    canAccess: vi.fn(() => true),
    update: vi.fn(async () => {}),
    ...over
  };
}
const addReq = (to = "JournalEntry.bren") => ({ op: "add", fromUuid: "JournalEntry.ilva",
  payload: { to, shared: true, fromNote: { label: "Owes money to", secret: "" } } });

afterEach(() => vi.useRealTimers());

describe("applyConnectionOp (GM side)", () => {
  it("validates against the socket sender and writes keyed paths", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq(), "u2", e)).toEqual({ ok: true, connectionId: "new1" });
    const [page, data] = e.update.mock.calls[0];
    expect(page).toBe(e.page);
    expect(Object.keys(data)).toEqual([`${BASE}.new1`]);
    expect(data[`${BASE}.new1`]).toMatchObject({ authorId: "u2", authorName: "Jo", to: "JournalEntry.bren" });
    expect(e.canAccess).toHaveBeenCalledWith(e.users.get("u2"), "JournalEntry.ilva", "OBSERVER");
  });
  it("rejects an unknown sender without resolving anything", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq(), "ghost", e)).toEqual({ ok: false, reason: "bad-sender" });
    expect(e.resolveSource).not.toHaveBeenCalled();
    expect(e.update).not.toHaveBeenCalled();
  });
  it("passes a rejection through and writes nothing", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq("JournalEntry.mara"), "u1", e)).toEqual({ ok: false, reason: "duplicate" });
    expect(e.update).not.toHaveBeenCalled();
  });
  it("a no-op success writes nothing", async () => {
    const e = env();
    expect(await applyConnectionOp({ op: "delete", fromUuid: "JournalEntry.ilva", connectionId: "gone" }, "u1", e))
      .toEqual({ ok: true, connectionId: "gone", noop: true });
    expect(e.update).not.toHaveBeenCalled();
  });
  it("no-entry when the source doesn't resolve", async () => {
    expect(await applyConnectionOp({ ...addReq(), fromUuid: "JournalEntry.nope" }, "u1", env())).toEqual({ ok: false, reason: "no-entry" });
  });
  it("a failing write reports failed", async () => {
    const e = env({ update: vi.fn(async () => { throw new Error("boom"); }) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyConnectionOp(addReq(), "u1", e)).toEqual({ ok: false, reason: "failed" });
    spy.mockRestore();
  });
});

describe("handleConnectionRequest", () => {
  it("replies to the socket sender, ignoring any payload user id", async () => {
    const e = env();
    await handleConnectionRequest({ action: "player-connection", requestId: "r1", userId: "u1", ...addReq() }, "u2", e);
    expect(e.emitted).toEqual([{ action: "player-connection-result", requestId: "r1", recipient: "u2", ok: true, connectionId: "new1" }]);
    expect(e.update.mock.calls[0][1][`${BASE}.new1`].authorId).toBe("u2");
  });
  it("drops malformed messages silently", async () => {
    const e = env();
    await handleConnectionRequest({ requestId: 5 }, "u2", e);
    await handleConnectionRequest({ requestId: "r1" }, undefined, e);
    expect(e.emitted).toEqual([]);
  });
});

describe("requestConnectionOp + handleConnectionResult (requester side)", () => {
  it("GM applies directly, no socket hop", async () => {
    const e = env({ isGM: true, userId: "gm" });
    expect(await requestConnectionOp({ op: "delete", fromUuid: "JournalEntry.ilva", connectionId: "c1" }, e)).toEqual({ ok: true, connectionId: "c1" });
    expect(e.emitted).toEqual([]);
    expect(e.update).toHaveBeenCalledWith(e.page, { [`${BASE}.-=c1`]: null });
  });
  it("no active GM: resolves no-gm at once and emits nothing", async () => {
    const e = env({ activeGM: () => null });
    expect(await requestConnectionOp(addReq(), e)).toEqual({ ok: false, reason: "no-gm" });
    expect(e.emitted).toEqual([]);
  });
  it("emits the request and settles on the GM's correlated result", async () => {
    const e = env({ randomId: () => "req9" });
    const pending = requestConnectionOp(addReq(), e);
    expect(e.emitted[0]).toMatchObject({ action: "player-connection", requestId: "req9", op: "add", fromUuid: "JournalEntry.ilva" });
    handleConnectionResult({ action: "player-connection-result", requestId: "req9", recipient: "u1", ok: true, connectionId: "c7" }, "gm", e);
    expect(await pending).toEqual({ ok: true, connectionId: "c7" });
  });
  it("ignores a result from a non-GM or for someone else", async () => {
    vi.useFakeTimers();
    const e = env({ randomId: () => "req8" });
    const pending = requestConnectionOp(addReq(), e);
    handleConnectionResult({ requestId: "req8", recipient: "u1", ok: true }, "u2", e);
    handleConnectionResult({ requestId: "req8", recipient: "u2", ok: true }, "gm", e);
    vi.advanceTimersByTime(ENTITY_RELAY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("connectionReasonKey", () => {
  it("maps known reasons and falls back to failed", () => {
    expect(connectionReasonKey("duplicate")).toBe("MEJCampaignCompanion.playerConnections.reasons.duplicate");
    expect(connectionReasonKey("weird")).toBe("MEJCampaignCompanion.playerConnections.reasons.failed");
  });
});
```

Append to `test/socket-dispatcher.test.js`:

```js
describe("player connection actions (spec 2026-10-09 §4.4)", () => {
  it("request is GM-only; result reaches every client", () => {
    expect(isAuthorizedForAction("player-connection", false)).toBe(false);
    expect(isAuthorizedForAction("player-connection", true)).toBe(true);
    expect(isAuthorizedForAction("player-connection-result", false)).toBe(true);
    expect(GM_ACTIONS.has("player-connection-result")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections-relay.test.js test/socket-dispatcher.test.js`
Expected: FAIL. The relay module doesn't exist, and `player-connection` is not routed.

- [ ] **Step 3: Write the relay**

`scripts/hooks/player-connections-relay.mjs`:

```js
// Player -> active GM relay for player connections (spec 2026-10-09 §4.4),
// the entity-from-selection-relay.mjs pattern: the player emits
// { action, requestId, op, fromUuid, connectionId, side, payload }; only
// game.users.activeGM handles it (socket.mjs GM_ACTIONS); the sender id is
// the one Foundry's server appends to the socket message, never a payload
// field; the reply is correlated by requestId; the player times out after
// ENTITY_RELAY_TIMEOUT_MS. A GM writes directly through applyConnectionOp.
import {
  MODULE_ID, I18N, SOCKET, PLAYER_CONNECTION_ACTION, PLAYER_CONNECTION_RESULT_ACTION,
  PLAYER_CONNECTIONS_FLAG, PLAYER_CONNECTIONS_SETTING, ENTITY_RELAY_TIMEOUT_MS
} from "../constants.mjs";
import { normalizeConnections, validateRequest, connectionUpdate } from "../logic/player-connections.mjs";
import { mejTypeWith } from "../logic/mej-type.mjs";

const FIELDS = ["op", "fromUuid", "connectionId", "side", "payload"];
const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p?.[k]]));
const REASONS = new Set([
  "no-entry", "disabled", "no-access", "type-not-allowed", "self", "duplicate", "bad-label", "not-author",
  "gone", "locked", "bad-request", "bad-sender", "no-gm", "timeout", "failed"
]);

const getMEJType = (doc) => game.MonksEnhancedJournal?.getMEJType?.(doc);

function foundryEnv() {
  return {
    emit: (msg) => game.socket.emit(SOCKET, msg),
    users: game.users,
    knownUserIds: () => new Set(game.users.map((u) => u.id)),
    userId: game.user.id,
    isGM: game.user.isGM === true,
    activeGM: () => game.users.activeGM ?? null,
    randomId: () => foundry.utils.randomID(),
    now: () => Date.now(),
    enabled: () => game.settings.get(MODULE_ID, PLAYER_CONNECTIONS_SETTING) !== false,
    resolveSource: async (uuid) => {
      const entry = typeof uuid === "string" ? await fromUuid(uuid) : null;
      if (!(entry instanceof JournalEntry)) return null;
      const page = entry.pages.contents.find((p) => mejTypeWith(p, getMEJType)) ?? null;
      if (!page) return null;
      let allowed = [];
      try {
        // MEJ's own addRelationship reads the target page's sheet the same way.
        allowed = [...(page.sheet?.allowedRelationships ?? [])];
      } catch {
        allowed = [];
      }
      return { uuid: entry.uuid, page, typed: true, locked: entry.compendium?.locked === true, allowed };
    },
    typeOf: (uuid) => {
      const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
      return entry instanceof JournalEntry ? (mejTypeWith(entry, getMEJType) || null) : null;
    },
    canAccess: (user, uuid, level) => {
      const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
      return entry instanceof JournalEntry && entry.testUserPermission(user, level) === true;
    },
    update: (page, data) => page.update(data)
  };
}

/** Validate and write one op for `senderId`. Never throws. */
export async function applyConnectionOp(request, senderId, env = foundryEnv()) {
  try {
    const sender = typeof senderId === "string" ? env.users.get(senderId) ?? null : null;
    if (!sender) return { ok: false, reason: "bad-sender" };
    const source = await env.resolveSource(request?.fromUuid);
    const connections = source
      ? normalizeConnections(source.page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], source.uuid)
      : [];
    const verdict = validateRequest(request?.op, request, {
      sender: { id: sender.id, isGM: sender.isGM === true },
      enabled: env.enabled(),
      source: source && { uuid: source.uuid, typed: source.typed, locked: source.locked, allowed: source.allowed },
      typeOf: env.typeOf,
      canAccess: (uuid, level) => env.canAccess(sender, uuid, level),
      connections
    });
    if (!verdict.ok) return verdict;
    if (verdict.noop) return { ok: true, connectionId: request.connectionId, noop: true };
    const newId = request.op === "add" ? env.randomId() : null;
    const data = connectionUpdate(request.op, request, {
      senderId: sender.id, senderName: sender.name ?? "", now: env.now(), newId, connections
    });
    await env.update(source.page, data);
    return { ok: true, connectionId: newId ?? request.connectionId };
  } catch (err) {
    console.error(`${MODULE_ID} | player connection: ${request?.op} failed`, err);
    return { ok: false, reason: "failed" };
  }
}

/** GM side. `senderId` comes from the socket, never from the payload. */
export async function handleConnectionRequest(payload, senderId, env = foundryEnv()) {
  if (typeof senderId !== "string" || typeof payload?.requestId !== "string") return;
  const outcome = await applyConnectionOp(pick(payload), senderId, env);
  env.emit({ action: PLAYER_CONNECTION_RESULT_ACTION, requestId: payload.requestId, recipient: senderId, ...outcome });
}

const pending = new Map(); // requestId -> { resolve, timer }

export function requestConnectionOp(request, env = foundryEnv()) {
  if (env.isGM) return applyConnectionOp(pick(request), env.userId, env);
  if (!env.activeGM()) return Promise.resolve({ ok: false, reason: "no-gm" });
  const requestId = env.randomId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, ENTITY_RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    env.emit({ action: PLAYER_CONNECTION_ACTION, requestId, ...pick(request) });
  });
}

/** Requester side: settle our own pending request, only from a GM's reply. */
export function handleConnectionResult(payload, senderId, env = foundryEnv()) {
  if (payload?.recipient !== env.userId) return;
  if (env.users?.get(senderId)?.isGM !== true) return;
  const { action, requestId, recipient, ...outcome } = payload;
  const waiting = pending.get(requestId);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  pending.delete(requestId);
  waiting.resolve(outcome);
}

export function connectionReasonKey(reason) {
  return `${I18N}.playerConnections.reasons.${REASONS.has(reason) ? reason : "failed"}`;
}

/** Spec §7: a localized warning per reason; nothing on success. */
export function showConnectionOutcome(outcome) {
  if (outcome?.ok) return;
  ui.notifications.warn(game.i18n.localize(connectionReasonKey(outcome?.reason)));
}
```

In `scripts/hooks/socket.mjs`, extend the constants import (lines 22-25) with `PLAYER_CONNECTION_ACTION, PLAYER_CONNECTION_RESULT_ACTION`, add after line 27:

```js
import { handleConnectionRequest, handleConnectionResult } from "./player-connections-relay.mjs";
```

add to `HANDLERS` (lines 29-34):

```js
  [PLAYER_CONNECTION_ACTION]: handleConnectionRequest,
  [PLAYER_CONNECTION_RESULT_ACTION]: handleConnectionResult
```

and change line 39 to:

```js
export const GM_ACTIONS = new Set([UPLOAD_MEDIA_ACTION, ENTITY_FROM_SELECTION_ACTION, PLAYER_CONNECTION_ACTION]);
```

- [ ] **Step 4: Add the strings**

In `lang/en.json`, after the closing `}` of `"playerAccess": { ... }` (line 493), add a comma and:

```json
    "playerConnections": {
      "heading": "Player connections",
      "add": "Add connection",
      "addNote": "Add a note",
      "empty": "No player connections yet.",
      "by": "by {name}",
      "shared": "Shared with the party",
      "private": "Private: only its author and the GM see it",
      "reveal": "Reveal",
      "hide": "Hide",
      "revealTooltip": "Show or hide this secret to everyone who sees the connection",
      "deleteConnection": "Delete connection",
      "deleteNote": "Delete note",
      "unresolved": "Unknown entry",
      "unknownWriter": "Unknown player",
      "labelPlaceholder": "Connection",
      "secretPlaceholder": "Secret (only you and the GM)",
      "noTargets": "There are no entries you can connect this one to.",
      "deleteTitle": "Delete connection",
      "deleteBody": "Delete this connection?",
      "deleteBodyNotes": "Delete this connection? {count} note(s) by other players will be deleted with it.",
      "privateTitle": "Make connection private",
      "privateBody": "Make this connection private? {count} note(s) by other players will be hidden from them until you share it again.",
      "dialog": {
        "title": "Add connection",
        "from": "From {name}",
        "filter": "Filter entries…",
        "fromLabel": "Connection (this entry)",
        "fromSecret": "Secret (this entry)",
        "toLabel": "Connection (other entry)",
        "toSecret": "Secret (other entry)",
        "shared": "Share with party",
        "save": "Add connection",
        "pickTarget": "Pick an entry to connect to.",
        "labelRequired": "Describe the connection first."
      },
      "drop": {
        "not-journal": "Only journal entries can be connected.",
        "self": "An entry can't be connected to itself.",
        "no-access": "You can't see that entry.",
        "type-not-allowed": "That kind of entry can't be connected from here.",
        "duplicate": "You've already connected these two entries."
      },
      "reasons": {
        "no-entry": "That entry can't hold connections.",
        "disabled": "Your GM has turned player connections off.",
        "no-access": "You don't have access to do that.",
        "type-not-allowed": "That kind of entry can't be connected from here.",
        "self": "An entry can't be connected to itself.",
        "duplicate": "You've already connected these two entries.",
        "bad-label": "A connection needs a label of at most 200 characters; secrets are limited to 500.",
        "not-author": "Only its author can change that.",
        "gone": "That connection or note no longer exists.",
        "locked": "That entry is in a locked compendium.",
        "bad-request": "That request wasn't understood.",
        "bad-sender": "That request wasn't understood.",
        "no-gm": "A GM must be connected to save connections.",
        "timeout": "Couldn't save the connection — try again.",
        "failed": "Couldn't save the connection. See the console for details."
      }
    }
```

Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))"` → Expected: no output.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/player-connections-relay.test.js test/socket-dispatcher.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/player-connections-relay.mjs scripts/hooks/socket.mjs lang/en.json test/player-connections-relay.test.js test/socket-dispatcher.test.js
git commit -m "feat(player-connections): player to active-GM relay with keyed writes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The block's DOM builder (pure, jsdom)

**Files:**
- Create: `scripts/apps/player-connections-block.mjs`
- Test: `test/player-connections-block.test.js`

**Interfaces:**
- Consumes: Task 1 `SideView`/`NoteView` shapes, `LABEL_MAX`, `SECRET_MAX`.
- Produces (from `scripts/apps/player-connections-block.mjs`):
  - `DEBOUNCE_MS = 400`, `debounce(fn, ms = DEBOUNCE_MS) → (...args) => void`
  - `groupSideViews(entries: { view: SideView, target: {uuid, name, img, type} | null }[], { typeLabel: (type) => string }) → { type, name, rows }[]`. Unresolved targets group as `"defunct"`, sorted last.
  - `buildConnectionsBlock(doc: Document, { groups, canAdd, labels }, handlers) → HTMLElement`, root `section.mej-cc-player-connections`
  - `labels = { heading, relationship, add, addNote, empty, by(name), you, shared, private, reveal, hide, revealTooltip, deleteConnection, deleteNote, unresolved, labelPlaceholder, secretPlaceholder, fallbackImg, unknownWriter }`
  - `handlers` (all optional; a control renders only when its handler exists): `open(uuid)`, `saveNote(view, {label, secret})`, `toggleReveal(view, note)`, `deleteNote(view, note)`, `toggleShare(view)`, `deleteConnection(view)`, `add()`, `drop(event)`
  - DOM contract used by e2e: rows `li.item.mej-cc-pc-row[data-connection-id][data-side][data-uuid]`; notes row `li.mej-cc-pc-notes-row[data-connection-id]`; note `li.mej-cc-pc-note[data-writer-id]` (`.new` for a draft); inputs `input.mej-cc-pc-label-input`, `input.mej-cc-pc-secret-input`; text `.mej-cc-pc-label`, `.mej-cc-pc-secret`, `.mej-cc-pc-author`; controls `.mej-cc-pc-reveal`, `.mej-cc-pc-share`, `.mej-cc-pc-delete`, `.mej-cc-pc-note-delete`, `.mej-cc-pc-add-note`, `.mej-cc-pc-add`

- [ ] **Step 1: Write the failing tests**

`test/player-connections-block.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildConnectionsBlock, groupSideViews, DEBOUNCE_MS } from "../scripts/apps/player-connections-block.mjs";

const labels = {
  heading: "Player connections", relationship: "Relationship", add: "Add connection", addNote: "Add a note",
  empty: "No player connections yet.", by: (n) => `by ${n}`, you: "Me", shared: "Shared", private: "Private",
  reveal: "Reveal", hide: "Hide", revealTooltip: "Reveal tip", deleteConnection: "Delete connection",
  deleteNote: "Delete note", unresolved: "Unknown entry", labelPlaceholder: "Connection",
  secretPlaceholder: "Secret", fallbackImg: "fallback.svg", unknownWriter: "Unknown player"
};
const note = (over = {}) => ({ writerId: "u2", authorName: "Jo", label: "half-sister", revealed: false, secretVisible: false,
  secret: "", editable: false, canReveal: false, canDelete: false, ...over });
const view = (over = {}) => ({
  id: "c1", side: "from", from: "JournalEntry.ilva", to: "JournalEntry.mara", otherUuid: "JournalEntry.mara", reverse: false,
  shared: true, authorId: "u1", authorName: "Dana", foreignAuthor: false, isAuthor: false, showAuthor: true, viewerId: "u3",
  main: note({ writerId: "u1", authorName: "Dana", label: "Sister of" }), others: [],
  canAddNote: false, canToggleShare: false, canDelete: false, ...over
});
const mara = { uuid: "JournalEntry.mara", name: "Mara", img: "mara.png", type: "person" };
const build = (entries, opts = {}, handlers = {}) => buildConnectionsBlock(document,
  { groups: groupSideViews(entries, { typeLabel: (t) => t.toUpperCase() }), canAdd: false, labels, ...opts }, handlers);

afterEach(() => vi.useRealTimers());

describe("buildConnectionsBlock - markup (spec §4.5)", () => {
  it("reuses MEJ's relationship list markup, without MEJ's .relationships drop-zone wrapper", () => {
    const root = build([{ view: view(), target: mara }]);
    expect(root.matches("section.mej-cc-player-connections")).toBe(true);
    expect(root.classList.contains("relationships")).toBe(false);
    expect(root.querySelector("h3").textContent).toBe("Player connections");
    expect(root.querySelector(".items-list ol.item-list li header .name").textContent).toBe("PERSON");
    const row = root.querySelector('li.item.flexrow.mej-cc-pc-row[data-connection-id="c1"]');
    expect(row.dataset.side).toBe("from");
    expect(row.dataset.uuid).toBe("JournalEntry.mara");
    expect(row.querySelector(".item-name img.item-image.large").getAttribute("src")).toBe("mara.png");
    expect(row.querySelector(".mej-cc-pc-open").textContent).toBe("Mara");
    expect(row.querySelector(".item-relationship .mej-cc-pc-label").textContent).toBe("Sister of");
    expect(row.querySelector(".mej-cc-pc-author").textContent).toBe("by Dana");
  });
  it("reverse rows read ← name; own rows carry no author line", () => {
    const root = build([{ view: view({ reverse: true, side: "to", otherUuid: "JournalEntry.ilva", showAuthor: false }),
      target: { ...mara, uuid: "JournalEntry.ilva", name: "Ilva" } }]);
    expect(root.querySelector(".mej-cc-pc-open").textContent).toBe("← Ilva");
    expect(root.querySelector(".mej-cc-pc-author")).toBeNull();
  });
  it("client-writable text is never parsed as markup (Review Focus 4)", () => {
    const evil = '<img src=x onerror="window.__pwn=1"><b>bold</b>';
    const root = build([{ view: view({ authorName: evil, main: note({ writerId: "u1", label: evil, secret: evil, secretVisible: true }),
      others: [note({ authorName: evil, label: evil })] }), target: { ...mara, name: evil } }]);
    expect(root.querySelectorAll("img").length).toBe(1);
    expect(root.querySelectorAll("b").length).toBe(0);
    expect(root.textContent).toContain(evil);
    expect(window.__pwn).toBeUndefined();
  });
  it("a secret shows only when visible", () => {
    const hidden = build([{ view: view({ main: note({ writerId: "u1", label: "x", secret: "", secretVisible: false }) }), target: mara }]);
    expect(hidden.querySelector(".mej-cc-pc-secret")).toBeNull();
    const shown = build([{ view: view({ main: note({ writerId: "u1", label: "x", secret: "owes", secretVisible: true }) }), target: mara }]);
    expect(shown.querySelector(".mej-cc-pc-secret").textContent).toBe("owes");
  });
  it("other players' notes list beneath the row, attributed", () => {
    const root = build([{ view: view({ others: [note()] }), target: mara }]);
    const li = root.querySelector('li.mej-cc-pc-notes-row[data-connection-id="c1"] li.mej-cc-pc-note[data-writer-id="u2"]');
    expect(li.querySelector(".mej-cc-pc-writer").textContent).toBe("Jo");
    expect(li.querySelector(".mej-cc-pc-label").textContent).toBe("half-sister");
    expect(li.querySelector("input")).toBeNull();
  });
  it("an unresolved target renders as MEJ's defunct row, grouped last, not openable", () => {
    const open = vi.fn();
    const root = build([{ view: view({ id: "c2" }), target: null }, { view: view(), target: mara }], {}, { open });
    const headers = [...root.querySelectorAll("header .name")].map((h) => h.textContent);
    expect(headers).toEqual(["PERSON", "DEFUNCT"]);
    const row = root.querySelector('li[data-connection-id="c2"]');
    expect(row.classList.contains("defunct")).toBe(true);
    row.querySelector(".mej-cc-pc-open").click();
    expect(open).not.toHaveBeenCalled();
    expect(row.querySelector(".mej-cc-pc-open").textContent).toBe("Unknown entry");
  });
  it("empty state and Add connection", () => {
    const add = vi.fn();
    const root = build([], { canAdd: true }, { add });
    expect(root.querySelector(".mej-cc-pc-empty").textContent).toBe("No player connections yet.");
    root.querySelector(".mej-cc-pc-add").click();
    expect(add).toHaveBeenCalledOnce();
    expect(build([], { canAdd: false }, { add }).querySelector(".mej-cc-pc-add")).toBeNull();
    expect(build([], { canAdd: true }).querySelector(".mej-cc-pc-add")).toBeNull();
  });
  it("clicking the name opens the other entry", () => {
    const open = vi.fn();
    build([{ view: view(), target: mara }], {}, { open }).querySelector(".mej-cc-pc-open").click();
    expect(open).toHaveBeenCalledWith("JournalEntry.mara");
  });
});

describe("buildConnectionsBlock - editing (spec §4.5)", () => {
  const editable = () => view({ isAuthor: true, showAuthor: false, viewerId: "u1",
    main: note({ writerId: "u1", authorName: "Dana", label: "Sister of", secret: "owes", secretVisible: true, editable: true, canReveal: true, canDelete: true }) });

  it("the writer gets inputs that save on change, debounced", () => {
    vi.useFakeTimers();
    const saveNote = vi.fn();
    const v = editable();
    const root = build([{ view: v, target: mara }], {}, { saveNote });
    const label = root.querySelector("input.mej-cc-pc-label-input");
    const secret = root.querySelector("input.mej-cc-pc-secret-input");
    expect(label.value).toBe("Sister of");
    expect(secret.value).toBe("owes");
    label.value = "Twin of";
    label.dispatchEvent(new Event("change", { bubbles: true }));
    secret.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saveNote).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).toHaveBeenCalledWith(v, { label: "Twin of", secret: "owes" });
  });
  it("change/input never reach MEJ's submitOnChange form; Enter blurs instead of submitting (Review Focus 5)", () => {
    const form = document.createElement("form");
    const seen = vi.fn();
    form.addEventListener("change", seen);
    form.addEventListener("input", seen);
    const root = build([{ view: editable(), target: mara }], {}, { saveNote: vi.fn() });
    form.append(root);
    const label = root.querySelector("input.mej-cc-pc-label-input");
    label.dispatchEvent(new Event("input", { bubbles: true }));
    label.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    label.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });
  it("no inputs without a saveNote handler or for someone else's note", () => {
    expect(build([{ view: editable(), target: mara }]).querySelector("input")).toBeNull();
    expect(build([{ view: view({ others: [note()] }), target: mara }], {}, { saveNote: vi.fn() }).querySelector("input")).toBeNull();
  });
  it("Reveal/Hide for the writer's secret", () => {
    const toggleReveal = vi.fn();
    const v = editable();
    const root = build([{ view: v, target: mara }], {}, { saveNote: vi.fn(), toggleReveal });
    const btn = root.querySelector(".mej-cc-pc-reveal");
    expect(btn.textContent.trim()).toBe("Reveal");
    btn.click();
    expect(toggleReveal).toHaveBeenCalledWith(v, v.main);
    const revealed = view({ main: { ...editable().main, revealed: true } });
    expect(build([{ view: revealed, target: mara }], {}, { saveNote: vi.fn(), toggleReveal }).querySelector(".mej-cc-pc-reveal").textContent.trim()).toBe("Hide");
    const noSecret = view({ main: { ...editable().main, canReveal: false } });
    expect(build([{ view: noSecret, target: mara }], {}, { saveNote: vi.fn(), toggleReveal }).querySelector(".mej-cc-pc-reveal")).toBeNull();
  });
  it("share toggle and delete for the author; state icon for everyone else", () => {
    const toggleShare = vi.fn();
    const deleteConnection = vi.fn();
    const v = view({ canToggleShare: true, canDelete: true });
    const root = build([{ view: v, target: mara }], {}, { toggleShare, deleteConnection });
    root.querySelector(".mej-cc-pc-share").click();
    root.querySelector(".mej-cc-pc-delete").click();
    expect(toggleShare).toHaveBeenCalledWith(v);
    expect(deleteConnection).toHaveBeenCalledWith(v);
    const other = build([{ view: view(), target: mara }], {}, { toggleShare, deleteConnection });
    expect(other.querySelector(".mej-cc-pc-share")).toBeNull();
    expect(other.querySelector(".mej-cc-pc-delete")).toBeNull();
    expect(other.querySelector(".mej-cc-pc-share-state")).not.toBeNull();
  });
  it("note delete for its writer or the GM", () => {
    const deleteNote = vi.fn();
    const n = note({ canDelete: true });
    const v = view({ others: [n] });
    build([{ view: v, target: mara }], {}, { deleteNote }).querySelector(".mej-cc-pc-note-delete").click();
    expect(deleteNote).toHaveBeenCalledWith(v, n);
  });
  it("Add a note opens an inline draft that saves through saveNote", () => {
    vi.useFakeTimers();
    const saveNote = vi.fn();
    const v = view({ canAddNote: true, viewerId: "u3" });
    const root = build([{ view: v, target: mara }], {}, { saveNote });
    root.querySelector(".mej-cc-pc-add-note").click();
    expect(root.querySelector(".mej-cc-pc-add-note")).toBeNull();
    const draft = root.querySelector('li.mej-cc-pc-note.new[data-writer-id="u3"]');
    expect(draft.querySelector(".mej-cc-pc-writer").textContent).toBe("Me");
    const input = draft.querySelector("input.mej-cc-pc-label-input");
    input.value = "half-sister, actually";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveNote).toHaveBeenCalledWith(v, { label: "half-sister, actually", secret: "" });
  });
});

describe("buildConnectionsBlock - drop", () => {
  it("calls drop and stops the event; no drop target without the handler", () => {
    const drop = vi.fn();
    const root = build([], {}, { drop });
    const outer = vi.fn();
    const wrap = document.createElement("div");
    wrap.addEventListener("drop", outer);
    wrap.append(root);
    const event = new Event("drop", { bubbles: true, cancelable: true });
    root.dispatchEvent(event);
    expect(drop).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    build([]).dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });
});

describe("groupSideViews", () => {
  it("groups by target type, sorts rows by name and groups by label, defunct last", () => {
    const groups = groupSideViews([
      { view: view({ id: "b" }), target: { ...mara, name: "Zed" } },
      { view: view({ id: "a" }), target: { ...mara, name: "Abe" } },
      { view: view({ id: "q" }), target: { ...mara, name: "Hunt", type: "quest" } },
      { view: view({ id: "x" }), target: null }
    ], { typeLabel: (t) => ({ person: "Person", quest: "Quest", defunct: "Unknown" })[t] });
    expect(groups.map((g) => g.name)).toEqual(["Person", "Quest", "Unknown"]);
    expect(groups[0].rows.map((r) => r.view.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections-block.test.js`
Expected: FAIL with `Failed to resolve import "../scripts/apps/player-connections-block.mjs"`.

- [ ] **Step 3: Write the builder**

`scripts/apps/player-connections-block.mjs`:

```js
// "Player connections" block (spec 2026-10-09 §4.5). Pure DOM, no Foundry
// globals (jsdom-tested): rows reuse MEJ's relationship list markup and
// classes (templates/sheets/partials/sheet-relationships.hbs) so the block
// reads as native - but not MEJ's `.relationships` wrapper, whose
// `.relationships .items-list` is MEJ's own GM drop zone
// (EnhancedJournalSheet.js:835-838).
//
// Every label, secret and author name is client-writable flag data, so it
// is set with textContent only; data-tooltip carries localized UI strings
// only (Foundry may render tooltips as HTML). MEJ's sheet is a
// submitOnChange <form>: the root stops change/input from bubbling into it
// and Enter in a field blurs (saving) instead of submitting it.
import { LABEL_MAX, SECRET_MAX } from "../logic/player-connections.mjs";

export const DEBOUNCE_MS = 400;

export function debounce(fn, ms = DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

export function groupSideViews(entries, { typeLabel }) {
  const groups = new Map();
  for (const entry of entries ?? []) {
    const type = entry.target ? entry.target.type || "unknown" : "defunct";
    if (!groups.has(type)) groups.set(type, { type, name: typeLabel(type), rows: [] });
    groups.get(type).rows.push(entry);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.rows.sort((a, b) => (a.target?.name ?? "").localeCompare(b.target?.name ?? "") || a.view.id.localeCompare(b.view.id));
  }
  return list.sort((a, b) => (a.type === "defunct") - (b.type === "defunct") || String(a.name).localeCompare(String(b.name)));
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(doc, className, tooltip) {
  const i = el(doc, "i", className);
  if (tooltip) i.dataset.tooltip = tooltip;
  return i;
}

function button(doc, className, iconClass, text, tooltip, onClick) {
  const a = el(doc, "a", className);
  a.setAttribute("role", "button");
  a.tabIndex = 0;
  a.append(icon(doc, iconClass));
  if (text) a.append(doc.createTextNode(` ${text}`));
  if (tooltip) a.dataset.tooltip = tooltip;
  a.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return a;
}

function field(doc, className, value, placeholder, maxLength) {
  const input = el(doc, "input", `item-field ${className}`);
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = placeholder ?? "";
  input.maxLength = maxLength;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  });
  return input;
}

function revealButton(doc, view, note, handlers, labels) {
  return button(doc, "item-reveal mej-cc-pc-reveal", note.revealed ? "fas fa-eye-slash" : "fas fa-eye",
    note.revealed ? labels.hide : labels.reveal, labels.revealTooltip, () => handlers.toggleReveal(view, note));
}

/** A note's label + secret: inputs for its writer, text for everyone else. */
function noteFields(doc, view, note, handlers, labels) {
  const cell = el(doc, "div", "item-relationship flexcol");
  if (note?.editable && handlers.saveNote) {
    const label = field(doc, "mej-cc-pc-label-input", note.label, labels.labelPlaceholder, LABEL_MAX);
    const secret = field(doc, "mej-cc-pc-secret-input", note.secret, labels.secretPlaceholder, SECRET_MAX);
    const save = debounce(() => handlers.saveNote(view, { label: label.value, secret: secret.value }));
    label.addEventListener("change", save);
    secret.addEventListener("change", save);
    const secretRow = el(doc, "div", "flexrow");
    secretRow.append(secret);
    if (note.canReveal && handlers.toggleReveal) secretRow.append(revealButton(doc, view, note, handlers, labels));
    cell.append(label, secretRow);
    return cell;
  }
  cell.append(el(doc, "span", "mej-cc-pc-label", note?.label ?? ""));
  if (note?.secretVisible && note.secret) {
    const secretRow = el(doc, "div", "flexrow");
    secretRow.append(el(doc, "em", "mej-cc-pc-secret", note.secret));
    cell.append(secretRow);
  }
  return cell;
}

function buildNote(doc, view, note, handlers, labels) {
  const li = el(doc, "li", "mej-cc-pc-note flexrow");
  li.dataset.writerId = note.writerId;
  li.append(el(doc, "span", "mej-cc-pc-writer", note.authorName || labels.unknownWriter));
  li.append(noteFields(doc, view, note, handlers, labels));
  const controls = el(doc, "div", "item-controls");
  if (note.canDelete && handlers.deleteNote) {
    controls.append(button(doc, "item-delete mej-cc-pc-note-delete", "fas fa-trash", null, labels.deleteNote,
      () => handlers.deleteNote(view, note)));
  }
  li.append(controls);
  return li;
}

function rowControls(doc, view, handlers, labels) {
  const controls = el(doc, "div", "item-controls");
  const shareIcon = view.shared ? "fas fa-users" : "fas fa-lock";
  const shareTip = view.shared ? labels.shared : labels.private;
  if (view.canToggleShare && handlers.toggleShare) {
    controls.append(button(doc, "mej-cc-pc-share", shareIcon, null, shareTip, () => handlers.toggleShare(view)));
  } else {
    controls.append(icon(doc, `${shareIcon} mej-cc-pc-share-state`, shareTip));
  }
  if (view.canDelete && handlers.deleteConnection) {
    controls.append(button(doc, "item-delete mej-cc-pc-delete", "fas fa-trash", null, labels.deleteConnection,
      () => handlers.deleteConnection(view)));
  }
  return controls;
}

function buildRowItems(doc, { view, target }, handlers, labels) {
  const li = el(doc, "li", "item flexrow mej-cc-pc-row");
  if (!target) li.classList.add("defunct", "mej-cc-pc-unresolved");
  li.dataset.connectionId = view.id;
  li.dataset.side = view.side;
  li.dataset.uuid = view.otherUuid ?? "";

  const nameCell = el(doc, "div", "item-name clickable");
  const img = el(doc, "img", "item-image large actor-icon");
  img.setAttribute("src", target?.img || labels.fallbackImg);
  img.alt = "";
  const nameBox = el(doc, "div");
  const link = el(doc, "a", "mej-cc-pc-open", `${view.reverse ? "← " : ""}${target ? target.name : labels.unresolved}`);
  if (target && handlers.open) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.open(view.otherUuid);
    });
  }
  nameBox.append(link);
  if (view.showAuthor) nameBox.append(el(doc, "div", "mej-cc-pc-author", labels.by(view.authorName)));
  nameCell.append(img, nameBox);
  li.append(nameCell, noteFields(doc, view, view.main, handlers, labels), rowControls(doc, view, handlers, labels));

  const canAddNote = view.canAddNote && !!handlers.saveNote;
  if (!view.others.length && !canAddNote) return [li];
  const notesRow = el(doc, "li", "mej-cc-pc-notes-row");
  notesRow.dataset.connectionId = view.id;
  const notes = el(doc, "ol", "mej-cc-pc-notes");
  for (const note of view.others) notes.append(buildNote(doc, view, note, handlers, labels));
  notesRow.append(notes);
  if (canAddNote) {
    const link = button(doc, "mej-cc-pc-add-note", "fas fa-plus", labels.addNote, null, () => {
      const draft = { writerId: view.viewerId, authorName: labels.you, label: "", secret: "", revealed: false,
        secretVisible: true, editable: true, canReveal: false, canDelete: false };
      const draftLi = buildNote(doc, view, draft, handlers, labels);
      draftLi.classList.add("new");
      notes.append(draftLi);
      link.remove();
      draftLi.querySelector("input")?.focus();
    });
    notesRow.append(link);
  }
  return [li, notesRow];
}

export function buildConnectionsBlock(doc, { groups, canAdd = false, labels }, handlers = {}) {
  const root = el(doc, "section", "mej-cc-player-connections flexcol");
  const head = el(doc, "header", "mej-cc-pc-heading flexrow");
  head.append(el(doc, "h3", null, labels.heading));
  if (canAdd && handlers.add) head.append(button(doc, "mej-cc-pc-add", "fas fa-link", labels.add, null, () => handlers.add()));
  root.append(head);

  const list = el(doc, "div", "items-list");
  const ol = el(doc, "ol", "item-list");
  for (const group of groups ?? []) {
    const groupLi = el(doc, "li");
    const header = el(doc, "header");
    header.append(el(doc, "div", "name", group.name), el(doc, "div", "relationship", labels.relationship));
    groupLi.append(header);
    ol.append(groupLi);
    for (const entry of group.rows) ol.append(...buildRowItems(doc, entry, handlers, labels));
  }
  if (!groups?.length) ol.append(el(doc, "li", "instruction mej-cc-pc-empty", labels.empty));
  list.append(ol);
  root.append(list);

  for (const type of ["change", "input"]) root.addEventListener(type, (event) => event.stopPropagation());
  if (handlers.drop) {
    root.addEventListener("dragover", (event) => {
      event.preventDefault();
      root.classList.add("mej-cc-pc-dropping");
    });
    root.addEventListener("dragleave", () => root.classList.remove("mej-cc-pc-dropping"));
    root.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      root.classList.remove("mej-cc-pc-dropping");
      handlers.drop(event);
    });
  }
  return root;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/player-connections-block.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/player-connections-block.mjs test/player-connections-block.test.js
git commit -m "feat(player-connections): DOM builder for the Player connections block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Inject the block into the Relationships tab and wire it to the relay

**Files:**
- Create: `scripts/hooks/player-connections-ui.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (after the Task 3 step)
- Modify: `styles/campaign-companion.css` (append at end, after line 1559)

**Interfaces:**
- Consumes: Task 1 `normalizeConnections`, `canSeeConnection`, `sideView`, `countOtherNotes`; Task 3 `incomingConnections`, `typedPageOf`; Task 4 `playerConnectionsEnabled`; Task 5 `requestConnectionOp`, `showConnectionOutcome`; Task 6 `buildConnectionsBlock`, `groupSideViews`; `imageFor` (`scripts/logic/default-image.mjs:24`); `mejType` (`scripts/integrations/mej-adapter.mjs:76`).
- Produces (from `scripts/hooks/player-connections-ui.mjs`): `registerPlayerConnectionsUi() → void`, `connectionEntries(entry, page) → { row, view, target }[]`, `targetInfo(uuid) → {uuid, name, img, type} | null`, `typeLabel(type) → string`, `canObserve(uuid) → boolean`. The internal `handlersFor(sheet, entry, page, rowsById)` is extended in Task 8.

- [ ] **Step 1: Write the hook module**

`scripts/hooks/player-connections-ui.mjs`:

```js
// Player connections block in the Relationships tab (spec 2026-10-09 §4.5),
// registered beside relationships-ui.mjs on the same two render hooks. Rows
// come from this entry's own flag ("from" side) and the reverse index
// ("to" side), filtered by canSeeConnection; every write goes through the
// relay (a GM writes directly). Idempotent: a re-render replaces the block.
import { MODULE_ID, I18N, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { normalizeConnections, canSeeConnection, sideView, countOtherNotes } from "../logic/player-connections.mjs";
import { buildConnectionsBlock, groupSideViews } from "../apps/player-connections-block.mjs";
import { incomingConnections, typedPageOf } from "./player-connections-index.mjs";
import { playerConnectionsEnabled } from "./rel-tab-wrap.mjs";
import { requestConnectionOp, showConnectionOutcome } from "./player-connections-relay.mjs";
import { imageFor } from "../logic/default-image.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

const FALLBACK_IMG = "icons/svg/book.svg";
const L = (key) => game.i18n.localize(`${I18N}.playerConnections.${key}`);
const F = (key, data) => game.i18n.format(`${I18N}.playerConnections.${key}`, data);

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null;
}

function labels() {
  return {
    heading: L("heading"), relationship: game.i18n.localize("MonksEnhancedJournal.Relationship"),
    add: L("add"), addNote: L("addNote"), empty: L("empty"), by: (name) => F("by", { name }),
    you: game.user.name, shared: L("shared"), private: L("private"), reveal: L("reveal"), hide: L("hide"),
    revealTooltip: L("revealTooltip"), deleteConnection: L("deleteConnection"), deleteNote: L("deleteNote"),
    unresolved: L("unresolved"), labelPlaceholder: L("labelPlaceholder"), secretPlaceholder: L("secretPlaceholder"),
    fallbackImg: FALLBACK_IMG, unknownWriter: L("unknownWriter")
  };
}

const permitted = (level) => (uuid) => {
  const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, level) === true;
};
const canLimited = permitted("LIMITED");
export const canObserve = permitted("OBSERVER");

export function targetInfo(uuid) {
  const entry = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  if (!(entry instanceof JournalEntry)) return null;
  const page = typedPageOf(entry);
  const type = page ? mejType(page) || "" : "";
  return { uuid, name: entry.name, img: imageFor(page?.src, type) ?? FALLBACK_IMG, type };
}

export function typeLabel(type) {
  if (type === "defunct") return game.i18n.localize("MonksEnhancedJournal.Unknown");
  const known = game.MonksEnhancedJournal?.getTypeLabels?.() ?? {};
  return game.i18n.localize(known[type] ?? type);
}

/** Visible connections on this entry, from both ends, as { row, view, target }. */
export function connectionEntries(entry, page) {
  const isGM = game.user.isGM === true;
  const viewer = {
    userId: game.user.id, isGM, enabled: playerConnectionsEnabled(),
    knownUserIds: new Set(game.users.map((u) => u.id)),
    canObserveSide: isGM || canObserve(entry.uuid)
  };
  const see = (row) => canSeeConnection(row, { userId: viewer.userId, isGM, canSeeEntry: canLimited });
  const outgoing = normalizeConnections(page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], entry.uuid)
    .filter(see)
    .map((row) => ({ row, view: sideView(row, "from", viewer), target: targetInfo(row.to) }));
  const incoming = incomingConnections(entry.uuid)
    .map(({ row }) => row)
    .filter(see)
    .map((row) => ({ row, view: sideView(row, "to", viewer), target: targetInfo(row.from) }));
  return [...outgoing, ...incoming];
}

function confirm(title, body) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${foundry.utils.escapeHTML(body)}</p>`,
    rejectClose: false,
    modal: true
  });
}

async function run(request) {
  const outcome = await requestConnectionOp(request);
  showConnectionOutcome(outcome);
  return outcome;
}

const target = (view) => ({ fromUuid: view.from, connectionId: view.id, side: view.side });

function handlersFor(sheet, entry, page, rowsById) {
  return {
    open: (uuid) => {
      const doc = fromUuidSync(uuid);
      if (doc) game.MonksEnhancedJournal.openJournalEntry(doc);
    },
    saveNote: (view, { label, secret }) => run({ op: "setNote", ...target(view), payload: { label, secret } }),
    toggleReveal: (view, note) => run({ op: "setRevealed", ...target(view), payload: { revealed: !note.revealed } }),
    deleteNote: (view, note) => run({ op: "deleteNote", ...target(view), payload: { noteUserId: note.writerId } }),
    toggleShare: async (view) => {
      const others = countOtherNotes(rowsById.get(view.id));
      if (view.shared && others > 0 && !(await confirm(L("privateTitle"), F("privateBody", { count: others })))) return;
      return run({ op: "setShared", ...target(view), payload: { shared: !view.shared } });
    },
    deleteConnection: async (view) => {
      const others = countOtherNotes(rowsById.get(view.id));
      const body = others > 0 ? F("deleteBodyNotes", { count: others }) : L("deleteBody");
      if (!(await confirm(L("deleteTitle"), body))) return;
      return run({ op: "delete", ...target(view) });
    }
  };
}

function inject(sheet, html) {
  const element = asElement(html);
  const page = sheet?.document;
  if (!element || !(page instanceof JournalEntryPage) || !mejType(page)) return;
  const entry = page.parent;
  if (!entry) return;
  const host = element.querySelector('.tab[data-tab="relationships"] .tab-inner');
  if (!host) return;
  host.querySelector(":scope > .mej-cc-player-connections")?.remove();
  host.classList.remove("mej-cc-has-player-connections");
  const entries = connectionEntries(entry, page);
  const canAdd = !game.user.isGM && playerConnectionsEnabled() && canObserve(entry.uuid)
    && (sheet.allowedRelationships?.length ?? 0) > 0;
  if (!entries.length && !canAdd) return;
  const rowsById = new Map(entries.map((e) => [e.view.id, e.row]));
  const block = buildConnectionsBlock(document, {
    groups: groupSideViews(entries, { typeLabel }), canAdd, labels: labels()
  }, handlersFor(sheet, entry, page, rowsById));
  host.classList.add("mej-cc-has-player-connections");
  host.append(block);
}

export function registerPlayerConnectionsUi() {
  const safe = (sheet, html) => {
    try {
      inject(sheet, html);
    } catch (err) {
      console.error(`${MODULE_ID} | player connections block failed`, err);
    }
  };
  Hooks.on("renderJournalPageSheet", safe);
  Hooks.on("renderEnhancedJournalSheet", safe);
}
```

In `scripts/integrations/mej-adapter.mjs`, after the "player connections index" step (Task 3), add:

```js
  await step("player connections ui", async () => {
    const { registerPlayerConnectionsUi } = await import("../hooks/player-connections-ui.mjs");
    registerPlayerConnectionsUi();
  });
```

- [ ] **Step 2: Style the block**

Append to `styles/campaign-companion.css`:

```css
/* Player connections block (spec 2026-10-09 §4.5). MEJ sizes its own list
   to the whole tab (`.tab .relationships { height: 100% }` inside an
   overflow-hidden tab-inner), which would clip anything after it; when the
   block is present the two share the tab instead. Row markup and grid are
   MEJ's; the block is not inside `.relationships`, so its grid columns and
   defunct styling are restated here. */
.monks-journal-sheet .tab[data-tab="relationships"] .tab-inner.mej-cc-has-player-connections > .relationships {
  height: auto;
  flex: 0 1 auto;
  min-height: 0;
  max-height: 55%;
}
.monks-journal-sheet .tab[data-tab="relationships"] .mej-cc-player-connections {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin-top: 6px;
}
.mej-cc-player-connections .mej-cc-pc-heading {
  align-items: center;
  gap: 0.5em;
  flex: 0 0 auto;
  border: none;
}
.mej-cc-player-connections .mej-cc-pc-heading h3 {
  flex: 1;
  margin: 0;
  border-bottom: none;
}
.mej-cc-player-connections .mej-cc-pc-add { flex: 0 0 auto; cursor: pointer; }
.monks-journal-sheet .mej-cc-player-connections .items-list header,
.monks-journal-sheet .mej-cc-player-connections .items-list ol.item-list {
  grid-template-columns: 175px auto 60px;
}
.mej-cc-player-connections .mej-cc-pc-author { font-size: var(--font-size-11, 11px); }
.mej-cc-player-connections .mej-cc-pc-notes-row { display: block; padding: 0 0 4px 175px; }
.mej-cc-player-connections .mej-cc-pc-notes { list-style: none; margin: 0; padding: 0; }
.mej-cc-player-connections .mej-cc-pc-note { align-items: center; gap: 0.5em; }
.mej-cc-player-connections .mej-cc-pc-writer { flex: 0 0 110px; font-weight: bold; overflow-wrap: anywhere; }
.mej-cc-player-connections .mej-cc-pc-add-note { cursor: pointer; font-size: var(--font-size-12, 12px); }
.mej-cc-player-connections .item.defunct :is(input, img, a:not(.item-delete)) {
  pointer-events: none;
  opacity: 0.5;
}
.mej-cc-player-connections.mej-cc-pc-dropping { outline: 2px dashed var(--color-border-highlight, #ff6400); }

/* Readable ink (readability sweep tokens; 29-readability checks the block). */
.monks-enhanced-journal .mej-cc-player-connections {
  color: var(--mej-cc-ink);
  background: var(--mej-cc-surface);
}
.monks-enhanced-journal .mej-cc-player-connections :is(h3, header, .name, .relationship, .mej-cc-pc-label, .mej-cc-pc-writer, .mej-cc-pc-open, .mej-cc-pc-add, .mej-cc-pc-add-note, .item-controls a, .item-controls i) {
  color: var(--mej-cc-ink);
  opacity: 1;
}
.monks-enhanced-journal .mej-cc-player-connections .items-list header {
  background: var(--mej-cc-chip-bg);
}
.monks-enhanced-journal .mej-cc-player-connections :is(.mej-cc-pc-author, .mej-cc-pc-empty) {
  color: var(--mej-cc-ink-muted);
  opacity: 1;
}
.monks-enhanced-journal .mej-cc-player-connections input.item-field {
  color: var(--mej-cc-field-ink);
  background: var(--mej-cc-field-bg);
  border: 1px solid var(--mej-cc-field-border);
}
.monks-enhanced-journal .mej-cc-player-connections .mej-cc-pc-secret {
  color: var(--mej-cc-field-ink);
  background: var(--mej-cc-field-bg);
  padding: 0 0.3em;
  border-radius: 3px;
}
.monks-enhanced-journal .mej-cc-player-connections .item-reveal {
  color: var(--mej-cc-field-ink);
  background: var(--mej-cc-field-bg);
  border: 1px solid var(--mej-cc-field-border);
  flex: 0 0 auto;
  padding: 0 0.4em;
}
```

- [ ] **Step 3: Run tests and smoke**

Run: `npm test` → Expected: all pass. This task adds no unit tests; the DOM is covered by Task 6 and the wiring by Task 11.

Smoke on v14 World A, with the symlink pointed at the worktree as in Task 4 Step 7. As GM, write a connection with the relay from the console of a User 1 page:
`(await import("/modules/mej-campaign-companion/scripts/hooks/player-connections-relay.mjs")).requestConnectionOp({ op: "add", fromUuid: <ilva uuid>, payload: { to: <mara uuid>, shared: true, fromNote: { label: "Sister of" }, toNote: { label: "Brother of" } } })` → `{ ok: true, connectionId }`. Open Ilva → Relationships: the row reads "Mara / Sister of" with inputs. Open Mara: "← Ilva / Brother of". Restore the symlink.

- [ ] **Step 4: Commit**

```bash
git add scripts/hooks/player-connections-ui.mjs scripts/integrations/mej-adapter.mjs styles/campaign-companion.css
git commit -m "feat(player-connections): Player connections block in the Relationships tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Add-connection dialog, Add button and drop

**Files:**
- Modify: `scripts/logic/player-connections.mjs` (append)
- Create: `scripts/apps/player-connection-dialog.mjs`
- Modify: `scripts/hooks/player-connections-ui.mjs` (imports; `handlersFor`; new `targetCtx`, `openAddDialog`, `onDrop`)
- Modify: `styles/campaign-companion.css` (append)
- Test: `test/player-connection-dialog.test.js`

**Interfaces:**
- Consumes: Task 5 `requestConnectionOp`, `showConnectionOutcome`; Task 7 `targetInfo`, `typeLabel`, `handlersFor`.
- Produces:
  - `targetProblem(target: {uuid}|null, ctx) → null | "not-journal" | "self" | "no-access" | "type-not-allowed" | "duplicate"`, with `ctx = { sourceUuid, allowed: string[], authorId, existing: Connection[], typeOf: (entry) => string|null, canLimited: (entry) => boolean }`
  - `eligibleTargets(entries, ctx, filter = "") → { uuid, name, type }[]`, sorted by name
  - `readConnectionForm(form: HTMLElement) → { to, fromNote: {label, secret}, toNote: {label, secret}, shared }`
  - `promptPlayerConnection({ sourceName, rows: {uuid, name, img, typeLabel}[], targetUuid = null, save }) → Promise<boolean>`: `save(values) → Promise<{ ok, reason? }>`; the dialog closes only on `ok`
  - DOM contract: `.mej-cc-pc-dialog`, `input[name=filter]`, `li.mej-cc-pc-target[data-uuid]` (`.selected`), `input[name=target]` (hidden), `input[name=fromLabel|fromSecret|toLabel|toSecret]`, `input[name=shared]`, `button.mej-cc-pc-save`

- [ ] **Step 1: Write the failing tests**

`test/player-connection-dialog.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { targetProblem, eligibleTargets, normalizeConnections } from "../scripts/logic/player-connections.mjs";
import { readConnectionForm } from "../scripts/apps/player-connection-dialog.mjs";

const e = (uuid, name, type, seen = true) => ({ uuid, name, __type: type, __seen: seen });
const existing = normalizeConnections({
  c1: { id: "c1", to: "J.mara", authorId: "u1", sides: {} },
  c2: { id: "c2", to: "J.bren", authorId: "u2", sides: {} }
}, "J.ilva");
const ctx = { sourceUuid: "J.ilva", allowed: ["person", "place"], authorId: "u1", existing,
  typeOf: (x) => x.__type ?? null, canLimited: (x) => x.__seen };

describe("targetProblem (spec §4.6, §7 drop)", () => {
  it("names why a target can't be connected", () => {
    expect(targetProblem(null, ctx)).toBe("not-journal");
    expect(targetProblem(e("J.ilva", "Ilva", "person"), ctx)).toBe("self");
    expect(targetProblem(e("J.hid", "Hid", "person", false), ctx)).toBe("no-access");
    expect(targetProblem(e("J.list", "Ledger", "list"), ctx)).toBe("type-not-allowed");
    expect(targetProblem(e("J.text", "Notes", null), ctx)).toBe("type-not-allowed");
    expect(targetProblem(e("J.mara", "Mara", "person"), ctx)).toBe("duplicate");
    expect(targetProblem(e("J.bren", "Bren", "person"), ctx)).toBeNull();
  });
});

describe("eligibleTargets", () => {
  const entries = [e("J.ilva", "Ilva", "person"), e("J.mara", "Mara", "person"), e("J.bren", "Bren", "person"),
    e("J.town", "aldwick", "place"), e("J.hid", "Hid", "person", false), e("J.list", "Ledger", "list")];
  it("excludes self, invisible, disallowed and already-connected targets; sorted by name", () => {
    expect(eligibleTargets(entries, ctx).map((r) => r.uuid)).toEqual(["J.town", "J.bren"]);
    expect(eligibleTargets(entries, ctx)[0]).toEqual({ uuid: "J.town", name: "aldwick", type: "place" });
  });
  it("filters case-insensitively", () => {
    expect(eligibleTargets(entries, ctx, "  BRE ").map((r) => r.uuid)).toEqual(["J.bren"]);
  });
});

describe("readConnectionForm", () => {
  it("reads the target, both sides trimmed, and Share with party", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input type="hidden" name="target" value="J.bren">'
      + '<input name="fromLabel" value=" Owes money to "><input name="fromSecret" value=" a lot ">'
      + '<input name="toLabel" value=""><input name="toSecret" value="">'
      + '<input type="checkbox" name="shared">';
    expect(readConnectionForm(form)).toEqual({
      to: "J.bren", fromNote: { label: "Owes money to", secret: "a lot" }, toNote: { label: "", secret: "" }, shared: false
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connection-dialog.test.js`
Expected: FAIL. `targetProblem` is not exported, and the dialog module doesn't exist.

- [ ] **Step 3: Write the pure eligibility functions**

Append to `scripts/logic/player-connections.mjs`:

```js
// ---- Targets for the Add dialog and drop (spec §4.6, §7) -------------------

/** Why `target` can't be connected from the source by this author, or null. */
export function targetProblem(target, { sourceUuid, allowed, authorId, existing, typeOf, canLimited }) {
  if (!target) return "not-journal";
  if (target.uuid === sourceUuid) return "self";
  if (!canLimited(target)) return "no-access";
  const type = typeOf(target);
  if (!type || !(allowed ?? []).includes(type)) return "type-not-allowed";
  if ((existing ?? []).some((c) => c.authorId === authorId && c.to === target.uuid)) return "duplicate";
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
```

- [ ] **Step 4: Write the dialog**

`scripts/apps/player-connection-dialog.mjs`:

```js
// Add-connection dialog (spec 2026-10-09 §4.6), modelled on
// actor-picker-dialog.mjs: a filterable list of eligible targets, this
// side's label (required) and secret, the other side's optional label and
// secret, and Share with party (checked). Saving runs `save(values)`; the
// dialog stays open with its values unless that reports ok (spec §7 - no
// GM, timeout and rejections keep it open). Later edits happen inline in
// the block, not here.
import { I18N } from "../constants.mjs";
import { LABEL_MAX, SECRET_MAX } from "../logic/player-connections.mjs";

export function readConnectionForm(form) {
  const value = (name) => (form.querySelector(`[name="${name}"]`)?.value ?? "").trim();
  return {
    to: value("target"),
    fromNote: { label: value("fromLabel"), secret: value("fromSecret") },
    toNote: { label: value("toLabel"), secret: value("toSecret") },
    shared: form.querySelector('[name="shared"]')?.checked === true
  };
}

/** Resolves true once saved, false on cancel. */
export async function promptPlayerConnection({ sourceName = "", rows = [], targetUuid = null, save = async () => ({ ok: false, reason: "failed" }) } = {}) {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => esc(game.i18n.localize(`${I18N}.playerConnections.dialog.${k}`));
  const items = rows.map((r) => `
    <li class="mej-cc-pc-target${r.uuid === targetUuid ? " selected" : ""}" data-uuid="${esc(r.uuid)}"
        data-name="${esc(String(r.name).toLocaleLowerCase())}" tabindex="0">
      <img src="${esc(r.img)}" alt=""><span class="mej-cc-pc-target-name">${esc(r.name)}</span>
      <span class="mej-cc-pc-target-type">${esc(r.typeLabel ?? "")}</span>
    </li>`).join("");
  const content = `
    <div class="mej-cc-pc-dialog">
      <p class="mej-cc-pc-source">${esc(game.i18n.format(`${I18N}.playerConnections.dialog.from`, { name: sourceName }))}</p>
      <input type="search" name="filter" placeholder="${L("filter")}" autocomplete="off">
      <ul class="mej-cc-pc-targets">${items}</ul>
      <input type="hidden" name="target" value="${esc(targetUuid ?? "")}">
      <div class="form-group"><label>${L("fromLabel")}</label><input type="text" name="fromLabel" maxlength="${LABEL_MAX}"></div>
      <div class="form-group"><label>${L("fromSecret")}</label><input type="text" name="fromSecret" maxlength="${SECRET_MAX}"></div>
      <div class="form-group"><label>${L("toLabel")}</label><input type="text" name="toLabel" maxlength="${LABEL_MAX}"></div>
      <div class="form-group"><label>${L("toSecret")}</label><input type="text" name="toSecret" maxlength="${SECRET_MAX}"></div>
      <div class="form-group"><label><input type="checkbox" name="shared" checked> ${L("shared")}</label></div>
      <button type="button" class="mej-cc-pc-save"><i class="fas fa-link"></i> ${L("save")}</button>
    </div>`;
  let saved = false;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.playerConnections.dialog.title`) },
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const form = root.querySelector(".mej-cc-pc-dialog");
      const hidden = root.querySelector("input[name='target']");
      const pick = (li) => {
        root.querySelectorAll(".mej-cc-pc-target.selected").forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        hidden.value = li.dataset.uuid;
      };
      root.querySelectorAll(".mej-cc-pc-target").forEach((li) => {
        li.addEventListener("click", () => pick(li));
        li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); pick(li); } });
      });
      root.querySelector("input[name='filter']")?.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLocaleLowerCase();
        root.querySelectorAll(".mej-cc-pc-target").forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
      });
      // Enter would submit DialogV2's form through its default (Cancel) button.
      form.querySelectorAll("input").forEach((input) => input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") ev.preventDefault();
      }));
      const saveButton = root.querySelector(".mej-cc-pc-save");
      saveButton.addEventListener("click", async () => {
        const values = readConnectionForm(form);
        if (!values.to) return void ui.notifications.warn(game.i18n.localize(`${I18N}.playerConnections.dialog.pickTarget`));
        if (!values.fromNote.label) return void ui.notifications.warn(game.i18n.localize(`${I18N}.playerConnections.dialog.labelRequired`));
        saveButton.disabled = true;
        try {
          const outcome = await save(values);
          if (outcome?.ok) {
            saved = true;
            await dialog.close();
          }
        } finally {
          if (!saved) saveButton.disabled = false;
        }
      });
      root.querySelector(".mej-cc-pc-target.selected")?.scrollIntoView?.({ block: "nearest" });
    }
  });
  return saved;
}
```

- [ ] **Step 5: Wire Add and drop into the block**

In `scripts/hooks/player-connections-ui.mjs`, extend the logic import to:

```js
import {
  normalizeConnections, canSeeConnection, sideView, countOtherNotes, targetProblem, eligibleTargets
} from "../logic/player-connections.mjs";
```

add:

```js
import { promptPlayerConnection } from "../apps/player-connection-dialog.mjs";
```

add these functions above `handlersFor`:

```js
function targetCtx(sheet, entry, page) {
  return {
    sourceUuid: entry.uuid,
    allowed: [...(sheet.allowedRelationships ?? [])],
    authorId: game.user.id,
    existing: normalizeConnections(page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], entry.uuid),
    typeOf: (doc) => mejType(doc) || null,
    canLimited: (doc) => doc.testUserPermission(game.user, "LIMITED") === true
  };
}

async function openAddDialog(sheet, entry, page, targetUuid = null) {
  const rows = eligibleTargets(game.journal.contents, targetCtx(sheet, entry, page)).map((r) => ({
    uuid: r.uuid, name: r.name, img: targetInfo(r.uuid)?.img ?? FALLBACK_IMG, typeLabel: typeLabel(r.type)
  }));
  if (!rows.length) return void ui.notifications.info(L("noTargets"));
  return promptPlayerConnection({
    sourceName: entry.name, rows, targetUuid,
    save: (values) => run({ op: "add", fromUuid: entry.uuid, payload: values })
  });
}

async function onDrop(event, sheet, entry, page) {
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  let dropped = null;
  if (data?.type === "JournalEntry" && typeof data.uuid === "string") dropped = await fromUuid(data.uuid);
  else if (data?.type === "JournalEntryPage" && typeof data.uuid === "string") dropped = (await fromUuid(data.uuid))?.parent ?? null;
  if (!(dropped instanceof JournalEntry)) dropped = null;
  const problem = targetProblem(dropped, targetCtx(sheet, entry, page));
  if (problem) return void ui.notifications.warn(game.i18n.localize(`${I18N}.playerConnections.drop.${problem}`));
  return openAddDialog(sheet, entry, page, dropped.uuid);
}
```

and add these two members to the object `handlersFor` returns, after `deleteConnection`:

```js
    add: () => openAddDialog(sheet, entry, page)
      .catch((err) => console.error(`${MODULE_ID} | add connection failed`, err)),
    // Players only: the GM records relationships with MEJ's own drop zone.
    drop: game.user.isGM ? undefined : (event) => onDrop(event, sheet, entry, page)
      .catch((err) => console.error(`${MODULE_ID} | connection drop failed`, err))
```

Append to `styles/campaign-companion.css`:

```css
/* Add-connection dialog (spec 2026-10-09 §4.6), after the actor picker. */
.mej-cc-pc-dialog { display: flex; flex-direction: column; gap: 6px; }
.mej-cc-pc-dialog .mej-cc-pc-targets {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--color-border-light-tertiary, rgba(0, 0, 0, 0.2));
}
.mej-cc-pc-target { display: flex; align-items: center; gap: 8px; padding: 3px 6px; cursor: pointer; }
.mej-cc-pc-target img { width: 28px; height: 28px; object-fit: cover; border: none; }
.mej-cc-pc-target .mej-cc-pc-target-name { flex: 1; }
.mej-cc-pc-target .mej-cc-pc-target-type { font-size: var(--font-size-11, 11px); }
.mej-cc-pc-target:hover, .mej-cc-pc-target:focus { background: rgba(127, 127, 127, 0.2); outline: none; }
.mej-cc-pc-target.selected { font-weight: bold; background: rgba(127, 127, 127, 0.3); }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/player-connection-dialog.test.js` → Expected: PASS.
Run: `npm test` → Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/player-connections.mjs scripts/apps/player-connection-dialog.mjs scripts/hooks/player-connections-ui.mjs styles/campaign-companion.css test/player-connection-dialog.test.js
git commit -m "feat(player-connections): Add connection dialog and drop onto the block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Player connections in the relationship graph

**Files:**
- Modify: `scripts/logic/graph-rows.mjs:25-43`
- Modify: `scripts/logic/graph-data.mjs:28-53`
- Modify: `scripts/apps/hub-graph-pane.mjs:33-62` (ctx + options), `:145-151` (edge `<title>`)
- Modify: `scripts/apps/CampaignHubPage.mjs:83` (state), `:1888-1895` (toggle listener)
- Modify: `templates/hub.hbs:189-190` (toggle)
- Modify: `styles/campaign-companion.css` (after `.mej-cc-graph-edge.hidden-rel`, line 982-984, and after `.theme-dark .mej-cc-graph-edge`, line 1230-1232)
- Modify: `lang/en.json` (`graph`, line 384-391)
- Test: `test/graph-rows.test.js`, `test/graph-data.test.js`

**Interfaces:**
- Consumes: Task 1 `normalizeConnections`, `canSeeConnection`.
- Produces:
  - `graphRowsFor(entries, ctx)` ctx gains optional `playerConnectionsOf(page)` and `canSeeEntry(uuid)`; every row gains `playerConnections: { id, to, authorName, fromLabel, toLabel }[]` (`[]` without the accessor).
  - `buildGraph(rows, backlinkPairs, opts)` opts gains `includePlayer = true`; edges gain `{ source, target, kind: "player", label: "", tooltip: string }` with precedence relationship > player > backlink, one edge per pair.
  - HUB state `graphPlayerConnections` (default `true`); template control `data-action-change="toggleGraphPlayerConnections"`; context `graph.includePlayer`.

- [ ] **Step 1: Write the failing tests**

In `test/graph-rows.test.js`, update the first expectation (lines 34-37) so each row carries `playerConnections: []`:

```js
    expect(rows).toEqual([
      { uuid: "J.a", name: "A", type: "person", img: null, relationships: [], playerConnections: [] },
      { uuid: "J.b", name: "B", type: "quest", img: null, relationships: [], playerConnections: [] }
    ]);
```

and append:

```js
describe("graphRowsFor player connections (spec 2026-10-09 §6.1)", () => {
  const pcPage = (type, flag) => ({ __type: type, __rels: [], __pc: flag });
  const flag = {
    c1: { id: "c1", to: "J.b", authorId: "u2", authorName: "Jo", shared: true,
      sides: { from: { notes: { u2: { label: "Sister of", secret: "never in the graph" } } }, to: { notes: { u2: { label: "Brother of" } } } } },
    c2: { id: "c2", to: "J.b", authorId: "u2", authorName: "Jo", shared: false, sides: {} }
  };
  const pcCtx = (over = {}) => ctx({ playerConnectionsOf: (p) => p.__pc, canSeeEntry: () => true, ...over });
  it("lists the connections this viewer may see, with the author's main labels and no secrets", () => {
    const rows = graphRowsFor([entry("J.a", "A", [pcPage("person", flag)])], pcCtx());
    expect(rows[0].playerConnections).toEqual([{ id: "c1", to: "J.b", authorName: "Jo", fromLabel: "Sister of", toLabel: "Brother of" }]);
  });
  it("the GM sees private ones too", () => {
    const rows = graphRowsFor([entry("J.a", "A", [pcPage("person", flag)])], pcCtx({ isGM: true }));
    expect(rows[0].playerConnections.map((p) => p.id)).toEqual(["c1", "c2"]);
  });
  it("a target the viewer can't see drops the connection", () => {
    const rows = graphRowsFor([entry("J.a", "A", [pcPage("person", flag)])], pcCtx({ canSeeEntry: (u) => u !== "J.b" }));
    expect(rows[0].playerConnections).toEqual([]);
  });
});
```

Append to `test/graph-data.test.js`:

```js
describe("buildGraph player edges (spec 2026-10-09 §6.1)", () => {
  const pc = (to, authorName, fromLabel = "", toLabel = "") => ({ id: `${authorName}-${to}`, to, authorName, fromLabel, toLabel });
  const rowsWith = (aRels = [], aPcs = [], bPcs = []) => [
    { uuid: "J.a", name: "A", type: "person", relationships: aRels, playerConnections: aPcs },
    { uuid: "J.b", name: "B", type: "person", relationships: [], playerConnections: bPcs }
  ];
  it("one player edge per pair, a tooltip line per connection", () => {
    const g = buildGraph(rowsWith([], [pc("J.b", "Dana", "Sister of", "Brother of"), pc("J.b", "Jo", "Rival")]), [], { isGM: false });
    expect(g.edges).toEqual([{ source: "J.a", target: "J.b", kind: "player", label: "", tooltip: "Dana: Sister of / Brother of\nJo: Rival" }]);
  });
  it("connections stored on either end of the same pair collapse into one edge", () => {
    const g = buildGraph(rowsWith([], [pc("J.b", "Dana", "Sister of")], [pc("J.a", "Jo", "Cousin of")]), [], {});
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].tooltip).toBe("Dana: Sister of\nJo: Cousin of");
  });
  it("a GM relationship on the pair wins", () => {
    const g = buildGraph(rowsWith([{ id: "r1", uuid: "J.b", hidden: false, label: "ally" }], [pc("J.b", "Dana", "x")]), [], {});
    expect(g.edges.map((e) => e.kind)).toEqual(["relationship"]);
  });
  it("a GM edge hidden from this player leaves their player edge", () => {
    const g = buildGraph(rowsWith([{ id: "r1", uuid: "J.b", hidden: true, label: "secret" }], [pc("J.b", "Dana", "x")]), [], { isGM: false });
    expect(g.edges.map((e) => e.kind)).toEqual(["player"]);
  });
  it("player edges beat mention links; includePlayer:false drops them and lets the link through", () => {
    const links = [{ source: "J.a", target: "J.b" }];
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana", "x")]), links, { includeBacklinks: true }).edges.map((e) => e.kind)).toEqual(["player"]);
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana", "x")]), links, { includeBacklinks: true, includePlayer: false }).edges.map((e) => e.kind)).toEqual(["backlink"]);
  });
  it("only the author when both labels are empty; a missing endpoint draws nothing", () => {
    expect(buildGraph(rowsWith([], [pc("J.b", "Dana")]), [], {}).edges[0].tooltip).toBe("Dana");
    expect(buildGraph(rowsWith([], [pc("J.zzz", "Dana", "x")]), [], {}).edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/graph-rows.test.js test/graph-data.test.js`
Expected: FAIL. Rows have no `playerConnections`, and no `player` edges are drawn.

- [ ] **Step 3: Implement rows and edges**

`scripts/logic/graph-rows.mjs`: add below line 6:

```js
import { normalizeConnections, canSeeConnection } from "./player-connections.mjs";
```

Replace the `graphRowsFor` signature/doc lines 18-25 and body push (line 38) so the function reads:

```js
/**
 * One row per MEJ-typed entry in `entries` (single-page convention: the
 * first typed page wins). Scope IS the entries argument - callers decide
 * membership (the Hub passes its #scopedEntries()).
 * ctx: { isGM, userId, groups, getType(page), canObserve(entry),
 *        relRevealsOf(entry), relationshipsOf(page), imageOf?(page, type),
 *        playerConnectionsOf?(page), canSeeEntry?(uuid) }
 * Player connections are the row's OUTGOING ones (spec 2026-10-09 §6.1):
 * an edge needs both endpoints as nodes, and the from-entry's row is always
 * present when they are, so incoming ones would only duplicate the pair.
 * Only the author's main labels travel; notes and secrets never do.
 */
export function graphRowsFor(entries, { isGM, userId, groups, getType, canObserve, relRevealsOf, relationshipsOf, imageOf, playerConnectionsOf, canSeeEntry }) {
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
      const playerConnections = typeof playerConnectionsOf === "function"
        ? normalizeConnections(playerConnectionsOf(page), entry.uuid)
          .filter((row) => canSeeConnection(row, { userId, isGM, canSeeEntry: canSeeEntry ?? (() => false) }))
          .map((row) => ({
            id: row.id, to: row.to, authorName: row.authorName,
            fromLabel: row.sides.from.notes[row.authorId]?.label ?? "",
            toLabel: row.sides.to.notes[row.authorId]?.label ?? ""
          }))
        : [];
      const img = typeof imageOf === "function" ? imageOf(page, type) : null;
      rows.push({ uuid: entry.uuid, name: entry.name, type, img: typeof img === "string" && img.length ? img : null, relationships, playerConnections });
      break;
    }
  }
  return rows;
}
```

`scripts/logic/graph-data.mjs`: change the `buildGraph` signature (line 28) to:

```js
export function buildGraph(rows, backlinkPairs, { mode = "all", centerUuid = null, includeBacklinks = false, includePlayer = true, isGM = false, maxNodes = 200 } = {}) {
```

and insert between the relationship loop (ends line 44) and `if (includeBacklinks) {` (line 45):

```js
  // Player connections (spec 2026-10-09 §6.1): one line per pair, after GM
  // relationships (a GM edge the viewer has wins) and before mention links.
  // Several connections on a pair collapse; the tooltip lists each author
  // with both sides' main labels.
  if (includePlayer) {
    const byPair = new Map();
    for (const row of rows) {
      for (const pc of row.playerConnections ?? []) {
        if (!byUuid.has(pc.to)) continue;
        const key = pairKey(row.uuid, pc.to);
        if (seenPairs.has(key)) continue;
        if (!byPair.has(key)) byPair.set(key, { source: row.uuid, target: pc.to, lines: [] });
        const labels = [pc.fromLabel, pc.toLabel].filter((s) => typeof s === "string" && s.length).join(" / ");
        byPair.get(key).lines.push(labels ? `${pc.authorName}: ${labels}` : pc.authorName);
      }
    }
    for (const [key, edge] of byPair) {
      seenPairs.add(key);
      edges.push({ source: edge.source, target: edge.target, kind: "player", label: "", tooltip: edge.lines.join("\n") });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/graph-rows.test.js test/graph-data.test.js` → Expected: PASS.

- [ ] **Step 5: Wire the Hub pane, toggle and styles**

`scripts/apps/hub-graph-pane.mjs`: replace the `graphRowsFor(...)` call (lines 35-48) with:

```js
  const rows = graphRowsFor(entries, {
    isGM: game.user.isGM,
    userId: game.user.id,
    groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
    getType: (page) => mejType(page),
    canObserve: (entry) => entry.testUserPermission(game.user, "OBSERVER") === true,
    relRevealsOf: (entry) => entry.getFlag(MODULE_ID, "relReveals"),
    relationshipsOf: (page) => page.flags?.[MEJ_FLAGS]?.relationships,
    // Entity picture is the typed page's src (MEJ's own convention, see
    // EnhancedJournalSheet relationship rendering); the per-type default
    // placeholder otherwise (MEJ's own art for its built-in types, the
    // companion's for session/campaign), null for types with no art.
    imageOf: (page, type) => imageFor(page.src, type),
    // Player connections (spec 2026-10-09 §6.1): the from-page's flag, and
    // LIMITED+ on both endpoints for a player (canSeeConnection).
    playerConnectionsOf: (page) => page.flags?.[MODULE_ID]?.playerConnections,
    canSeeEntry: (uuid) => {
      const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
      return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
    }
  });
```

Then replace the `buildGraph` call and context (lines 49-60) with:

```js
  const includePlayer = state.graphPlayerConnections !== false;
  const graph = buildGraph(rows, state.graphBacklinks ? backlinkPairs() : [], {
    mode: state.graphMode, centerUuid: state.graphCenterUuid,
    includeBacklinks: state.graphBacklinks, includePlayer, isGM: game.user.isGM, maxNodes: MAX_NODES
  });
  return {
    graph,
    context: {
      isEgo: state.graphMode === "ego",
      centerUuid: state.graphCenterUuid,
      includeBacklinks: state.graphBacklinks,
      includePlayer,
      truncated: graph.truncated === true
    }
  };
```

In `drawGraphPane`, replace the edge creation (lines 145-151) with:

```js
  const edgeEls = links.map((link) => {
    const line = document.createElementNS(NS, "line");
    line.classList.add("mej-cc-graph-edge", link.kind);
    if (link.hidden) line.classList.add("hidden-rel");
    if (link.tooltip) {
      // Author names and labels are client-writable: textContent only.
      const title = document.createElementNS(NS, "title");
      title.textContent = link.tooltip;
      line.append(title);
    }
    svg.append(line);
    return line;
  });
```

`scripts/apps/CampaignHubPage.mjs` line 83, after `graphBacklinks: false,` add:

```js
  graphPlayerConnections: true,
```

and after the backlinks toggle block (ends line 1895) add:

```js
    const playerToggle = html.querySelector('[data-action-change="toggleGraphPlayerConnections"]');
    if (playerToggle && !playerToggle.dataset.ccBound) {
      playerToggle.dataset.ccBound = "1";
      playerToggle.addEventListener("change", () => {
        this.state.graphPlayerConnections = playerToggle.checked;
        this.render({ parts: ["main"] });
      });
    }
```

`templates/hub.hbs`, after the backlinks `<label>` (lines 189-190):

```hbs
                            <label class="mej-cc-graph-backlinks mej-cc-graph-player"><input type="checkbox" data-action-change="toggleGraphPlayerConnections" {{#if graph.includePlayer}}checked{{/if}}>
                                {{localize "MEJCampaignCompanion.graph.playerConnections"}}</label>
```

`styles/campaign-companion.css`, after `.mej-cc-graph-edge.hidden-rel { ... }` (line 982-984):

```css
/* Player connections (spec 2026-10-09 §6.1): dotted, their own colour. */
.mej-cc-graph-edge.player {
  stroke: #2f7d6d;
  stroke-width: 2;
  stroke-dasharray: 1 4;
  stroke-linecap: round;
  opacity: 0.85;
}
```

and after `.theme-dark .mej-cc-graph-edge { ... }` (line 1230-1232):

```css
.theme-dark .mej-cc-graph-edge.player {
  stroke: #6fd0b9;
}
```

`lang/en.json`, in `graph` after `"backlinks": "Show mention links",` (line 389):

```json
      "playerConnections": "Show player connections",
```

Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))"` → no output. Then `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/graph-rows.mjs scripts/logic/graph-data.mjs scripts/apps/hub-graph-pane.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs styles/campaign-companion.css lang/en.json test/graph-rows.test.js test/graph-data.test.js
git commit -m "feat(player-connections): dotted player edges and a toggle in the relationship graph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Player connections in Word export

**Files:**
- Modify: `scripts/logic/player-connections.mjs` (append)
- Modify: `scripts/logic/doc-export-snapshot.mjs:103-185` (new `playerConnectionsHtml`; `recordSnapshot` appends it)
- Modify: `scripts/apps/export-dialog.mjs:16-27` (imports), `:137-151` (`runExport`)
- Modify: `lang/en.json` (`export`, line 365-380)
- Test: `test/player-connections-export.test.js`, `test/doc-export-snapshot.test.js`

**Interfaces:**
- Consumes: Task 1 `normalizeConnections`; Task 3 `incomingConnections`.
- Produces:
  - `exportLines(items: { row: Connection, side: "from"|"to", otherName: string }[], { includeGM, viewerId, labels: { by(name), private, secret } }) → { text, children: string[] }[]`, sorted by `otherName`
  - `playerConnectionsHtml(lines, heading) → string` (from `doc-export-snapshot.mjs`)
  - `recordSnapshot(row, opts)` opts gains `playerConnections?: lines` and `labels.playerConnections`

- [ ] **Step 1: Write the failing tests**

`test/player-connections-export.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeConnections, exportLines } from "../scripts/logic/player-connections.mjs";
import { playerConnectionsHtml, recordSnapshot } from "../scripts/logic/doc-export-snapshot.mjs";

const labels = { by: (n) => `by ${n}`, private: "private", secret: "Secret" };
const n = (authorName, label, secret = "", revealed = false) => ({ authorName, label, secret, revealed });
const rows = normalizeConnections({
  c1: { id: "c1", to: "J.mara", authorId: "u1", authorName: "Dana", shared: true, sides: {
    from: { notes: { u1: n("Dana", "Sister of", "owes her"), u2: n("Jo", "half-sister, actually", "jealous", true) } },
    to: { notes: { u1: n("Dana", "Brother of") } } } },
  c2: { id: "c2", to: "J.bren", authorId: "u2", authorName: "Jo", shared: false, sides: {
    from: { notes: { u2: n("Jo", "Owes money to", "a lot") } } } }
}, "J.ilva");
const items = [{ row: rows[0], side: "from", otherName: "Mara" }, { row: rows[1], side: "from", otherName: "Bren" }];

describe("exportLines (spec §6.2)", () => {
  it("GM with GM content: every connection, private marked, unrevealed secrets included", () => {
    expect(exportLines(items, { includeGM: true, viewerId: "gm", labels })).toEqual([
      { text: "Bren — Owes money to (by Jo) (private)", children: ["Secret: a lot"] },
      { text: "Mara — Sister of (by Dana)", children: ["Secret: owes her", "Jo: \"half-sister, actually\" — Secret: jealous"] }
    ]);
  });
  it("any other export: shared connections, revealed secrets only", () => {
    expect(exportLines(items, { includeGM: false, viewerId: "gm", labels })).toEqual([
      { text: "Mara — Sister of (by Dana)", children: ["Jo: \"half-sister, actually\" — Secret: jealous"] }
    ]);
  });
  it("the exporter's own private connection and own secrets stay in", () => {
    expect(exportLines(items, { includeGM: false, viewerId: "u2", labels })[0]).toEqual(
      { text: "Bren — Owes money to (by Jo)", children: ["Secret: a lot"] });
  });
  it("uses this entry's side", () => {
    expect(exportLines([{ row: rows[0], side: "to", otherName: "Ilva" }], { includeGM: false, viewerId: "gm", labels }))
      .toEqual([{ text: "Ilva — Brother of (by Dana)", children: [] }]);
  });
  it("omits an empty label", () => {
    expect(exportLines([{ row: rows[1], side: "to", otherName: "Ilva" }], { includeGM: true, viewerId: "gm", labels }))
      .toEqual([{ text: "Ilva (by Jo) (private)", children: [] }]);
  });
});

describe("playerConnectionsHtml", () => {
  it("nests notes under each connection and escapes everything", () => {
    const html = playerConnectionsHtml([{ text: "Mara — <b>Sister</b> (by Dana)", children: ["Jo: \"<i>x</i>\""] }], "Player connections");
    expect(html).toBe("<p><strong>Player connections</strong></p><ul><li>Mara — &lt;b&gt;Sister&lt;/b&gt; (by Dana)<ul><li>Jo: \"&lt;i&gt;x&lt;/i&gt;\"</li></ul></li></ul>");
  });
  it("is empty with nothing to list", () => {
    expect(playerConnectionsHtml([], "Player connections")).toBe("");
    expect(playerConnectionsHtml(undefined, "Player connections")).toBe("");
  });
});

describe("recordSnapshot appends player connections after relationships", () => {
  it("MEJ record", () => {
    const row = { uuid: "J.ilva", name: "Ilva", kind: "person", page: { text: { content: "<p>Body</p>" } } };
    const record = recordSnapshot(row, {
      includeGM: false, relationships: [{ name: "Duke", hidden: false }],
      playerConnections: [{ text: "Mara — Sister of (by Dana)", children: [] }],
      labels: { relationships: "Relationships", playerConnections: "Player connections", sessionNumber: "S", campaignDate: "D" }
    });
    expect(record.html.indexOf("Relationships")).toBeLessThan(record.html.indexOf("Player connections"));
    expect(record.html).toContain("<li>Mara — Sister of (by Dana)</li>");
  });
});
```

`playerConnectionsHtml` uses `escapeHtml` (`scripts/logic/html-escape.mjs:6`), which escapes `&`, `<` and `>` only (text-node escaping), so the `"` characters stay literal in the expectation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/player-connections-export.test.js`
Expected: FAIL. `exportLines` and `playerConnectionsHtml` are not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/player-connections.mjs`:

```js
// ---- Word export (spec §6.2) -----------------------------------------------

/**
 * Lines for one entry's "Player connections" list, from this entry's side:
 * `Mara — Sister of (by Dana)`, other players' notes nested beneath, secrets
 * as `Secret: …`. GM export with GM content: everything, private ones
 * marked. Otherwise: shared connections plus the exporter's own private
 * ones; secrets only when revealed or written by the exporter.
 */
export function exportLines(items, { includeGM, viewerId, labels }) {
  const secretShown = (note, writerId) => includeGM || note.revealed === true || writerId === viewerId;
  return (items ?? [])
    .filter(({ row }) => includeGM || row.shared || row.authorId === viewerId)
    .map(({ row, side, otherName }) => {
      const notes = row.sides[side].notes;
      const main = notes[row.authorId];
      const text = [
        otherName,
        main?.label ? `— ${main.label}` : null,
        `(${labels.by(row.authorName)})`,
        includeGM && !row.shared ? `(${labels.private})` : null
      ].filter(Boolean).join(" ");
      const children = [];
      if (main?.secret && secretShown(main, row.authorId)) children.push(`${labels.secret}: ${main.secret}`);
      const others = Object.entries(notes)
        .filter(([writerId]) => writerId !== row.authorId)
        .sort(([, a], [, b]) => a.authorName.localeCompare(b.authorName));
      for (const [writerId, note] of others) {
        const parts = [];
        if (note.label) parts.push(`"${note.label}"`);
        if (note.secret && secretShown(note, writerId)) parts.push(`${labels.secret}: ${note.secret}`);
        if (parts.length) children.push(`${note.authorName}: ${parts.join(" — ")}`);
      }
      return { text, children, otherName };
    })
    .sort((a, b) => a.otherName.localeCompare(b.otherName))
    .map(({ text, children }) => ({ text, children }));
}
```

In `scripts/logic/doc-export-snapshot.mjs`, after `relationshipsHtml` (ends line 117) add:

```js
/**
 * HTML for an entry's player connections (spec 2026-10-09 §6.2): lines from
 * exportLines(), each with its notes as a nested list. Empty string when
 * nothing renders. Every value is escaped - labels are player-written.
 * @param {{text:string, children:string[]}[]} lines
 * @param {string} heading localized "Player connections" label
 */
export function playerConnectionsHtml(lines, heading) {
  if (!lines?.length) return "";
  const items = lines.map((line) => {
    const nested = line.children.length
      ? `<ul>${line.children.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : "";
    return `<li>${escapeHtml(line.text)}${nested}</li>`;
  }).join("");
  return `<p><strong>${escapeHtml(heading)}</strong></p><ul>${items}</ul>`;
}
```

In `recordSnapshot` (line 166-185) change line 167 to:

```js
  const { includeGM, relationships, playerConnections, labels, formatCampaignDate } = opts;
  const pcHtml = playerConnectionsHtml(playerConnections, labels.playerConnections ?? "");
```

change the session branch's `html:` value to `sessionBodyHtml(...) + pcHtml` (append `+ pcHtml` after the call's closing parenthesis), and line 183 to:

```js
  const html = stripSecretSections(bodyText(row.page), { includeAll: includeGM }) + relationshipsHtml(relationships, includeGM, labels.relationships) + pcHtml;
```

and add `playerConnections?: {text:string, children:string[]}[],` and `playerConnections?:string` (inside `labels`) to its JSDoc.

In `scripts/apps/export-dialog.mjs`, add imports below line 27:

```js
import { normalizeConnections, exportLines } from "../logic/player-connections.mjs";
import { incomingConnections } from "../hooks/player-connections-index.mjs";
import { PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
```

add above `runExport` (line 137):

```js
/** Export lines for one row's player connections, both ends (spec §6.2). Unresolved ends are dropped. */
function playerConnectionLines(row, includeGM, labels) {
  const nameOf = (uuid) => fromUuidSync(uuid)?.name ?? null;
  const items = [
    ...normalizeConnections(row.page?.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG], row.uuid)
      .map((r) => ({ row: r, side: "from", otherName: nameOf(r.to) })),
    ...incomingConnections(row.uuid).map(({ row: r }) => ({ row: r, side: "to", otherName: nameOf(r.from) }))
  ].filter((item) => item.otherName);
  return exportLines(items, { includeGM, viewerId: game.user.id, labels });
}
```

and in `runExport` extend `labels` and `buildRecord` (lines 139-149):

```js
    const labels = {
      relationships: game.i18n.localize(`${I18N}.export.relationships`),
      playerConnections: game.i18n.localize(`${I18N}.export.playerConnections`),
      sessionNumber: game.i18n.localize(`${I18N}.export.sessionNumber`),
      campaignDate: game.i18n.localize(`${I18N}.export.campaignDate`)
    };
    const pcLabels = {
      by: (name) => game.i18n.format(`${I18N}.playerConnections.by`, { name }),
      private: game.i18n.localize(`${I18N}.export.private`),
      secret: game.i18n.localize(`${I18N}.export.secret`)
    };
    const buildRecord = (row) => recordSnapshot(row, {
      includeGM,
      relationships: row.kind === SESSION_KIND ? undefined : resolvedRelationships(row.page),
      playerConnections: playerConnectionLines(row, includeGM, pcLabels),
      labels,
      formatCampaignDate
    });
```

In `lang/en.json` `export` (lines 365-380): after `"relationships": "Relationships",` add:

```json
      "playerConnections": "Player connections",
      "secret": "Secret",
      "private": "private",
```

and replace `includeGMHint` with:

```json
      "includeGMHint": "When checked, session GM notes, relationships hidden from players, and private player connections and their unrevealed secrets are included in the export.",
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/player-connections-export.test.js test/doc-export-snapshot.test.js` → Expected: PASS.
Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))"` and `npm test` → Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/player-connections.mjs scripts/logic/doc-export-snapshot.mjs scripts/apps/export-dialog.mjs lang/en.json test/player-connections-export.test.js
git commit -m "feat(player-connections): Player connections list in Word export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: e2e spec 32 and the readability guard

**Files:**
- Create: `tests/e2e/32-player-connections.spec.mjs`
- Modify: `tests/e2e/29-readability.spec.mjs` (seed ~line 196; GM test after "person page injections" ~line 340; bg test person check ~line 437; player test ~line 480-482)

**Interfaces:**
- Consumes: harness helpers from `tests/e2e/helpers/foundry.mjs`: `login`, `cleanupAsGm`, `trackConsoleErrors`, `assertNoConsoleErrors`, `settle`, `deleteJournalsByPrefix`, `cleanupStrandedTestFolders`, `ensureMejPlayerAccess`, `KNOWN_MEJ_SESSION_ICON_404`. Also the companion modules `/modules/mej-campaign-companion/scripts/hooks/player-connections-relay.mjs` (`requestConnectionOp`) and `/modules/mej-campaign-companion/scripts/apps/hub-graph-pane.mjs` (`prepareGraphContext`). DOM contract from Tasks 6 and 8.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the spec**

`tests/e2e/32-player-connections.spec.mjs`:

```js
// Player connections (spec 2026-10-09 §8, e2e 1-9), on v13 and v14, as User 1
// with a GM connected, plus the plan's Review Focus checks: the block is
// actually on screen (not clipped under MEJ's own list) and a Place gets the
// tab. Content on a non-default sheet tab is display:none until its nav link
// is clicked, so every block assertion goes through openRelTab().
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, ensureMejPlayerAccess, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const MOD_URL = "/modules/mej-campaign-companion/scripts";
const PREFIX = "TT-Pc";
const RUN = Date.now();
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
let seq = 0;
const tagged = (name) => `${PREFIX}${name}${RUN}t${seq}`;

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

/** A MEJ entry of `type`, OBSERVER by default; returns { id, uuid, name }. */
async function createEntry(gm, name, type, { ownership = 2 } = {}) {
  return gm.evaluate(async ({ name, type, ownership }) => {
    const e = await JournalEntry.create({
      name, ownership: { default: ownership },
      pages: [{ name, type: "text", text: { content: `<p>${name}</p>` }, flags: { "monks-enhanced-journal": { type } } }]
    });
    return { id: e.id, uuid: e.uuid, name: e.name };
  }, { name, type, ownership });
}

async function openEntry(page, id) {
  await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, id);
  await settle(page, 600);
}
async function closeShell(page) {
  await page.evaluate(async () => {
    try { await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* none open */ }
  });
  await settle(page, 300);
}
const relTabLink = (page) => page.locator(
  '#MonksEnhancedJournal nav.tabs a[data-tab="relationships"], #MonksEnhancedJournal nav.sheet-tabs a[data-tab="relationships"]').first();
const block = (page) => page.locator('#MonksEnhancedJournal .tab.active[data-tab="relationships"] .mej-cc-player-connections');
const row = (page, cid) => block(page).locator(`li.mej-cc-pc-row[data-connection-id="${cid}"]`);
const notesRow = (page, cid) => block(page).locator(`li.mej-cc-pc-notes-row[data-connection-id="${cid}"]`);
const noteBy = (page, writerId) => block(page).locator(`li.mej-cc-pc-note[data-writer-id="${writerId}"]`);
const pcDialog = (page) => page.locator("dialog.application:has(.mej-cc-pc-dialog)");
const toast = (page, text) => page.locator("#notifications .notification", { hasText: text });

async function openRelTab(page, id) {
  await openEntry(page, id);
  await relTabLink(page).click();
  await settle(page, 400);
}

const pcFlag = (page, entryId) => page.evaluate(({ id, MOD }) =>
  foundry.utils.deepClone(game.journal.get(id)?.pages.contents[0]?.flags?.[MOD]?.playerConnections ?? {}), { id: entryId, MOD });
const relay = (page, request) => page.evaluate(async ({ url, request }) =>
  (await import(url)).requestConnectionOp(request), { url: `${MOD_URL}/hooks/player-connections-relay.mjs`, request });
const playerEdges = (page, uuids) => page.evaluate(async ({ url, uuids }) => {
  const { prepareGraphContext } = await import(url);
  const entries = uuids.map((u) => fromUuidSync(u)).filter(Boolean);
  const { graph } = prepareGraphContext(entries, { graphMode: "all", graphCenterUuid: null, graphBacklinks: false, graphPlayerConnections: true });
  return graph.edges.filter((e) => e.kind === "player");
}, { url: `${MOD_URL}/apps/hub-graph-pane.mjs`, uuids });
const userIds = (page) => page.evaluate(() => ({ u1: game.users.getName("User 1").id, u2: game.users.getName("User 2").id }));
const setEnabled = (gm, value) => gm.evaluate(({ MOD, value }) => game.settings.set(MOD, "playerConnectionsEnabled", value), { MOD, value });

async function confirmYes(page) {
  const yes = page.locator('dialog.application button[data-action="yes"]').last();
  await expect(yes).toBeVisible({ timeout: 10_000 });
  await yes.click();
}

/** Review Focus 3: hit-testable, i.e. not clipped by MEJ's overflow-hidden tab. */
const onScreen = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + Math.min(r.height / 2, 10));
  return !!hit && el.contains(hit);
});

async function addViaDialog(page, { target, fromLabel, toLabel = "", fromSecret = "", shared = true }) {
  await block(page).locator(".mej-cc-pc-add").click();
  const d = pcDialog(page);
  await expect(d).toBeVisible({ timeout: 10_000 });
  await d.locator("input[name='filter']").fill(target.name);
  await d.locator(`li.mej-cc-pc-target[data-uuid="${target.uuid}"]`).click();
  await d.locator("input[name='fromLabel']").fill(fromLabel);
  if (fromSecret) await d.locator("input[name='fromSecret']").fill(fromSecret);
  if (toLabel) await d.locator("input[name='toLabel']").fill(toLabel);
  await d.locator("input[name='shared']").setChecked(shared);
  await d.locator("button.mej-cc-pc-save").click();
}

async function dropOn(page, data) {
  await block(page).evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify(data));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, data);
}

async function cleanup(gm) {
  await closeShell(gm);
  await deleteJournalsByPrefix(gm, PREFIX);
  await cleanupStrandedTestFolders(gm, { prefix: PREFIX });
  await gm.evaluate((MOD) => game.settings.set(MOD, "playerConnectionsEnabled", true), MOD);
}

async function closeSeats(...seats) {
  for (const seat of seats) await seat?.context.close().catch(() => {});
}

test.describe("32 player connections", () => {
  test.beforeEach(() => { seq += 1; });
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("add, both ends, reveal, notes, private, GM moderation (e2e 1-4, 8)", async ({ browser }) => {
    test.setTimeout(300_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      await ensureMejPlayerAccess(gm.page);
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ids = await userIds(gm.page);

      // 1. Add via the dialog with both side labels and a secret.
      await openRelTab(u1.page, ilva.id);
      await expect(block(u1.page)).toBeVisible();
      await addViaDialog(u1.page, { target: mara, fromLabel: "Sister of", toLabel: "Brother of", fromSecret: "owes her a debt" });
      await expect(pcDialog(u1.page)).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(async () => Object.keys(await pcFlag(gm.page, ilva.id)).length, { timeout: 15_000 }).toBe(1);
      const [cid] = Object.keys(await pcFlag(gm.page, ilva.id));
      const stored = (await pcFlag(gm.page, ilva.id))[cid];
      expect(stored).toMatchObject({ id: cid, to: mara.uuid, authorId: ids.u1, shared: true });
      expect(stored.sides.from.notes[ids.u1]).toMatchObject({ label: "Sister of", secret: "owes her a debt", revealed: false });
      expect(stored.sides.to.notes[ids.u1]).toMatchObject({ label: "Brother of" });

      await openRelTab(u1.page, ilva.id);
      await expect(row(u1.page, cid).locator("input.mej-cc-pc-label-input")).toHaveValue("Sister of", { timeout: 15_000 });
      expect(await onScreen(row(u1.page, cid))).toBe(true);
      await openRelTab(u1.page, mara.id);
      await expect(row(u1.page, cid)).toContainText(`← ${ilva.name}`);
      await expect(row(u1.page, cid).locator("input.mej-cc-pc-label-input")).toHaveValue("Brother of");

      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, cid)).toContainText("Sister of");
      await expect(row(u2.page, cid)).toContainText("User 1");
      await expect(block(u2.page)).not.toContainText("owes her a debt");
      await expect(row(u2.page, cid).locator("input")).toHaveCount(0);
      expect(await playerEdges(u2.page, [ilva.uuid, mara.uuid])).toHaveLength(1);

      // 2. User 1 reveals the secret: User 2 now sees it.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-reveal").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.from.notes[ids.u1].revealed, { timeout: 15_000 }).toBe(true);
      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, cid)).toContainText("owes her a debt", { timeout: 15_000 });

      // 3. User 2 adds a note on the "to" side; only User 2 can edit it.
      await openRelTab(u2.page, mara.id);
      await notesRow(u2.page, cid).locator(".mej-cc-pc-add-note").click();
      const draft = notesRow(u2.page, cid).locator("li.mej-cc-pc-note.new input.mej-cc-pc-label-input");
      await draft.fill("half-sister, actually");
      await draft.press("Tab");
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.to.notes[ids.u2]?.label, { timeout: 15_000 })
        .toBe("half-sister, actually");
      await openRelTab(u1.page, mara.id);
      await expect(noteBy(u1.page, ids.u2)).toContainText("half-sister, actually");
      await expect(noteBy(u1.page, ids.u2).locator("input")).toHaveCount(0);
      await openRelTab(u2.page, mara.id);
      await expect(noteBy(u2.page, ids.u2).locator("input.mej-cc-pc-label-input")).toHaveValue("half-sister, actually");

      // 4. Private: gone for User 2 on both ends and in the graph; GM keeps it with the author.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-share").click();
      await confirmYes(u1.page); // User 2's note exists, so the toggle confirms first
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].shared, { timeout: 15_000 }).toBe(false);
      for (const id of [ilva.id, mara.id]) {
        await openRelTab(u2.page, id);
        await expect(row(u2.page, cid)).toHaveCount(0);
      }
      expect(await playerEdges(u2.page, [ilva.uuid, mara.uuid])).toEqual([]);
      await openRelTab(gm.page, ilva.id);
      await expect(row(gm.page, cid)).toContainText("User 1");
      // Shared again (no confirmation this way): User 2's note comes back.
      await openRelTab(u1.page, ilva.id);
      await row(u1.page, cid).locator(".mej-cc-pc-share").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].shared, { timeout: 15_000 }).toBe(true);
      await openRelTab(u2.page, mara.id);
      await expect(noteBy(u2.page, ids.u2)).toHaveCount(1);

      // 8. GM deletes User 2's note, then the connection.
      await openRelTab(gm.page, mara.id);
      await noteBy(gm.page, ids.u2).locator(".mej-cc-pc-note-delete").click();
      await expect.poll(async () => (await pcFlag(gm.page, ilva.id))[cid].sides.to.notes[ids.u2] ?? null, { timeout: 15_000 }).toBeNull();
      for (const seat of [u1, u2]) {
        await openRelTab(seat.page, mara.id);
        await expect(noteBy(seat.page, ids.u2)).toHaveCount(0);
      }
      await openRelTab(gm.page, ilva.id);
      await row(gm.page, cid).locator(".mej-cc-pc-delete").click();
      await confirmYes(gm.page);
      await expect.poll(async () => Object.keys(await pcFlag(gm.page, ilva.id)), { timeout: 15_000 }).toEqual([]);
      for (const seat of [u1, u2]) {
        for (const id of [ilva.id, mara.id]) {
          await openRelTab(seat.page, id);
          await expect(row(seat.page, cid)).toHaveCount(0);
        }
      }
      for (const seat of [gm, u1, u2]) assertNoConsoleErrors(seat.errors);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("dropping an entry on the block opens the dialog with it filled in (e2e 5)", async ({ browser }) => {
    test.setTimeout(120_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ledger = await createEntry(gm.page, tagged("Ledger"), "list");
      await openRelTab(u1.page, ilva.id);
      await dropOn(u1.page, { type: "JournalEntry", uuid: mara.uuid });
      const d = pcDialog(u1.page);
      await expect(d).toBeVisible({ timeout: 10_000 });
      await expect(d.locator("input[name='target']")).toHaveValue(mara.uuid);
      await expect(d.locator(`li.mej-cc-pc-target.selected[data-uuid="${mara.uuid}"]`)).toHaveCount(1);
      await d.locator('button[data-action="cancel"]').click();
      await expect(d).toHaveCount(0);

      await dropOn(u1.page, { type: "Actor", uuid: "Actor.nope" });
      await expect(toast(u1.page, "Only journal entries can be connected.")).toHaveCount(1, { timeout: 10_000 });
      await dropOn(u1.page, { type: "JournalEntry", uuid: ledger.uuid });
      await expect(toast(u1.page, "can't be connected from here")).toHaveCount(1, { timeout: 10_000 });
      await expect(pcDialog(u1.page)).toHaveCount(0);
      assertNoConsoleErrors(u1.errors);
    } finally {
      await closeSeats(u1, gm);
    }
  });

  test("Relationships tab visibility for players (e2e 6, Review Focus 1)", async ({ browser }) => {
    test.setTimeout(180_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    try {
      const locked = await createEntry(gm.page, tagged("Locked"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      // Only a hidden GM row: the raw flag is non-empty, so stock MEJ would show an empty tab.
      await gm.page.evaluate(({ id, uuid }) => game.journal.get(id).pages.contents[0].setFlag("monks-enhanced-journal", "relationships",
        { r1: { id: "r1", uuid, hidden: true, relationship: "secret ally" } }), { id: locked.id, uuid: mara.uuid });

      await setEnabled(gm.page, false);
      await closeShell(u1.page);
      await openEntry(u1.page, locked.id);
      await expect(relTabLink(u1.page)).toHaveCount(0);

      await setEnabled(gm.page, true);
      await closeShell(u1.page);
      await openEntry(u1.page, locked.id);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toBeVisible();
      await expect(block(u1.page)).not.toContainText("secret ally");

      // LIMITED: can't add and sees nothing -> no tab.
      const glimpse = await createEntry(gm.page, tagged("Glimpse"), "person", { ownership: 1 });
      await closeShell(u1.page);
      await openEntry(u1.page, glimpse.id);
      await expect(relTabLink(u1.page)).toHaveCount(0);

      // A Place: MEJ's PlaceSheet removes the tab again after the base class.
      const town = await createEntry(gm.page, tagged("Town"), "place");
      await closeShell(u1.page);
      await openEntry(u1.page, town.id);
      await expect(relTabLink(u1.page)).toHaveCount(1);
      await relTabLink(u1.page).click();
      await expect(block(u1.page).locator(".mej-cc-pc-add")).toBeVisible();
      assertNoConsoleErrors(u1.errors);
    } finally {
      await closeSeats(u1, gm);
    }
  });

  test("rejections: duplicate, type not allowed, editing someone else's note (e2e 7)", async ({ browser }) => {
    test.setTimeout(120_000);
    const gm = await newSeat(browser, "Gamemaster");
    const u1 = await newSeat(browser, "User 1");
    const u2 = await newSeat(browser, "User 2");
    try {
      const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
      const mara = await createEntry(gm.page, tagged("Mara"), "person");
      const ledger = await createEntry(gm.page, tagged("Ledger"), "list");
      const ids = await userIds(gm.page);
      const addMara = { op: "add", fromUuid: ilva.uuid, payload: { to: mara.uuid, shared: true, fromNote: { label: "Sister of", secret: "" } } };
      const first = await relay(u1.page, addMara);
      expect(first).toMatchObject({ ok: true });
      expect(await relay(u1.page, addMara)).toEqual({ ok: false, reason: "duplicate" });
      expect(await relay(u1.page, { ...addMara, payload: { ...addMara.payload, to: ledger.uuid } }))
        .toEqual({ ok: false, reason: "type-not-allowed" });
      expect(await relay(u2.page, { op: "deleteNote", fromUuid: ilva.uuid, connectionId: first.connectionId, side: "from", payload: { noteUserId: ids.u1 } }))
        .toEqual({ ok: false, reason: "not-author" });
      expect(await relay(u2.page, { op: "setShared", fromUuid: ilva.uuid, connectionId: first.connectionId, side: "from", payload: { shared: false } }))
        .toEqual({ ok: false, reason: "not-author" });
      const stored = (await pcFlag(gm.page, ilva.id))[first.connectionId];
      expect(stored.shared).toBe(true);
      expect(stored.sides.from.notes[ids.u1].label).toBe("Sister of");
      // In the UI, User 2 gets no field for User 1's label.
      await openRelTab(u2.page, ilva.id);
      await expect(row(u2.page, first.connectionId).locator("input")).toHaveCount(0);
    } finally {
      await closeSeats(u1, u2, gm);
    }
  });

  test("no GM connected: toast, dialog stays open, nothing written (e2e 9)", async ({ browser }) => {
    test.setTimeout(150_000);
    const gm = await newSeat(browser, "Gamemaster");
    const ilva = await createEntry(gm.page, tagged("Ilva"), "person");
    const mara = await createEntry(gm.page, tagged("Mara"), "person");
    await gm.context.close();
    const u1 = await newSeat(browser, "User 1");
    try {
      await u1.page.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });
      await openRelTab(u1.page, ilva.id);
      await addViaDialog(u1.page, { target: mara, fromLabel: "Sister of" });
      await expect(toast(u1.page, "A GM must be connected to save connections.")).toHaveCount(1, { timeout: 10_000 });
      await expect(pcDialog(u1.page)).toHaveCount(1);
      await expect(pcDialog(u1.page).locator("input[name='fromLabel']")).toHaveValue("Sister of");
      expect(await pcFlag(u1.page, ilva.id)).toEqual({});
    } finally {
      await closeSeats(u1);
    }
  });
});
```

- [ ] **Step 2: Extend 29-readability**

In `tests/e2e/29-readability.spec.mjs`'s `beforeAll` seed, directly after the `secretReveals` update that uses `user1` (~line 192-194), add:

```js
      // A player connection with a revealed secret and another player's note (spec 2026-10-09).
      const user2 = game.users.getName("User 2");
      const now = Date.now();
      await person.pages.contents[0].update({
        [`flags.${MOD}.playerConnections.rdpc1`]: {
          id: "rdpc1", to: ally.uuid, authorId: user1.id, authorName: user1.name, shared: true, created: now,
          sides: {
            from: { notes: {
              [user1.id]: { authorName: user1.name, label: "sworn friend", secret: "saved her life", revealed: true, updated: now },
              [user2.id]: { authorName: user2.name, label: "rivals, really", secret: "", revealed: false, updated: now }
            } },
            to: { notes: { [user1.id]: { authorName: user1.name, label: "owes a life", secret: "", revealed: false, updated: now } } }
          }
        }
      });
```

In the GM test, after the "person page injections" check (~line 340), add:

```js
        await check("person relationships player connections", () => sheetTab(page, "relationships"),
          `${S} .mej-cc-player-connections`);
```

In the background test, after the `${bg}: person page` check (~line 437), add:

```js
          await check(`${bg}: person player connections`, () => sheetTab(page, "relationships"),
            `${S} .mej-cc-player-connections`);
```

and raise that test's `test.setTimeout(420_000)` to `test.setTimeout(600_000)`.

In the player test, replace the "player relationships" check (~line 480-481) with:

```js
        await check("player relationships", () => sheetTab(page, "relationships"),
          [`${S} .mej-cc-rel-secret, ${S} .mej-cc-rel-revealed, ${S} .mej-cc-known-connections`, `${S} .mej-cc-player-connections`]);
        await check("player connection dialog", () => openDialog(page, "player-connection-dialog.mjs", "promptPlayerConnection",
          { sourceName: `${PREFIX}Person`, rows: [{ uuid: seed.allyUuid, name: `${PREFIX}Ally`, img: "icons/svg/book.svg", typeLabel: "Person" }] }),
          "[data-rd-scan]");
        await closeDialogs(page);
```

- [ ] **Step 3: Point both installs at the worktree**

```bash
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do readlink "$L"; done
# both expected: /Users/danbularzik/Claude/Projects/mej-campaign-companion
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do ln -sfn ~/Claude/Projects/mej-campaign-companion/.claude/worktrees/player-connections "$L"; done
df -h /System/Volumes/Data
```

If either `readlink` prints something else, stop and record it; Step 6 restores exactly that value. Free disk must be ≥ 2 GB; if less, stop and report.

- [ ] **Step 4: Run on v14 World A**

Run: `FOUNDRY_TARGET=v14 npx playwright test tests/e2e/32-player-connections.spec.mjs --trace off --reporter=line`
Expected: 5 passed (plus setup).

Run: `FOUNDRY_TARGET=v14 npx playwright test tests/e2e/29-readability.spec.mjs --trace off --reporter=line`
Expected: 6 passed. Any contrast failure names a `.mej-cc-player-connections` or `.mej-cc-pc-dialog` selector: fix the CSS token use (Task 7/8 styles), never the threshold.

Then neighbours: `FOUNDRY_TARGET=v14 npx playwright test tests/e2e/09-secrets.spec.mjs tests/e2e/06-player-collab.spec.mjs tests/e2e/08-query-graph.spec.mjs --trace off --reporter=line`. Expected: same results as on `main`.

If a test fails, read the failure, fix the product code or the spec (never weaken an assertion to pass), and re-run.

- [ ] **Step 5: Run on v13 World B**

Run: `npm run e2e:v13 -- tests/e2e/32-player-connections.spec.mjs tests/e2e/29-readability.spec.mjs`
Expected: all pass.
Then: `npm run e2e:v13 -- tests/e2e/09-secrets.spec.mjs tests/e2e/06-player-collab.spec.mjs tests/e2e/08-query-graph.spec.mjs`. Expected: same as `main`. World B has 5 known pre-existing failures (02×3, 09 dup-section, 10 tracker dup-id), and any of those don't count.

- [ ] **Step 6: Restore the symlinks**

```bash
for L in ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion ~/FoundryVTT/Data/Data/modules/mej-campaign-companion; do ln -sfn ~/Claude/Projects/mej-campaign-companion "$L"; readlink "$L"; done
```

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/32-player-connections.spec.mjs tests/e2e/29-readability.spec.mjs
git commit -m "test(e2e): spec 32 player connections; readability covers the block and dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs and the 0.25.0 release bump

**Files:**
- Modify: `README.md` (Features, after "### Player collaboration", lines 116-119; graph bullet line 57; Settings table and count, lines 195-216)
- Modify: `docs/player-guide.md` (new section after "## The relationship graph", before line 87)
- Modify: `docs/gm-guide.md` ("## Player collaboration" line 324-330; "## Settings reference" lines 356-366)
- Modify: `CHANGELOG.md` (top), `module.json` (`"version"`, line 5)

**Interfaces:**
- Consumes: final UI copy from `lang/en.json` (Tasks 4, 5, 9, 10).
- Produces: release-ready docs; `module.json` version `0.25.0`.

- [ ] **Step 1: README**

After the "### Player collaboration" bullets (line 119) add:

```markdown
### Player connections

- Players record what their characters believe connects people, places and factions, in a **Player connections** block on an entry's Relationships tab. **Add connection** (or dropping a journal entry onto the block) opens a picker of entries they can see whose type the sheet allows, with a label for each side, an optional secret for each, and **Share with party** (on by default; off = only the author and the GM see it).
- A connection shows on both entries, each with its own label, like MEJ's reciprocal rows. Each player can add one note per side; the author's note is the row's label and other players' notes list beneath it, attributed. A note's secret is visible to its writer and the GM until the writer reveals it.
- Every write goes through the active GM's client, which re-checks access, type and authorship; with no GM connected the player is told so and nothing is saved. The GM sees every connection with its author and can delete any note or connection. Players get the Relationships tab whenever they have something to see there or could add a connection, and not otherwise.
- Player connections draw as dotted lines in the relationship graph (toggle **Show player connections**) and appear in Word export under each entry's relationships. The **Players can create connections** setting (on by default) turns adding and editing off; existing connections stay visible.
```

In the "Relationship graph" bullet (line 57) append: ` Player connections draw as dotted lines, toggled by **Show player connections**.`

In "## Settings" change the first sentence to `Nineteen settings are registered: seven visible in the module settings menu, all world-scoped, and twelve internal settings with no UI (\`config: false\`) — six world-scoped and six client-scoped.` and add after the `warnPlayerAccess` row:

```markdown
| `playerConnectionsEnabled` | Yes | On | Players can create connections: shows **Add connection**, **Add a note** and the drop target on the Relationships tab and lets players edit their notes. Off makes notes read-only; existing connections still show and their writers can still delete them. |
```

- [ ] **Step 2: Player guide**

Before "## When secrets are revealed to you" (line 87) add:

```markdown
## Recording connections

You can note what your character thinks ties two entries together — "Sister of", "Owes money to", "Saw them at the docks" — without waiting for your GM to draw it.

Open an entry and go to its **Relationships** tab. Below your GM's relationships is a **Player connections** block. Click **Add connection** (or drag a journal entry from the sidebar onto the block), pick the other entry, and fill in:

- **Connection (this entry)**: how this entry relates to the other one (required).
- **Connection (other entry)**: the same tie seen from the other side (optional). It's what shows on the other entry, which lists your connection as "← this entry".
- A **Secret** for either side (optional). Only you and your GM can read it until you click **Reveal** next to it; **Hide** puts it back.
- **Share with party**: on by default, so the rest of the party sees the connection. Untick it to keep it between you and your GM; the lock/party icon on the row switches it later.

Other players can add one note of their own under your connection on either side ("half-sister, actually"). Their notes show beneath your row with their name, and only they can edit them. You edit your own labels and secrets right in the row; changes save when you leave the field. Clear both fields of a note to remove it, or use the bin to delete the whole connection (it asks first, and says how many other players' notes go with it).

Saving needs your GM to be connected. If they aren't, you'll see "A GM must be connected to save connections." and the dialog keeps what you typed. Your connections also show as dotted lines on the Hub's **Graph** (untick **Show player connections** to hide them).
```

- [ ] **Step 3: GM guide**

At the end of "## Player collaboration" (after line 330) add:

```markdown
**Player connections.** Players can record their own connections between entries on the Relationships tab's **Player connections** block (see the Player Guide's "Recording connections"). They never touch your MEJ relationships. A connection is stored on the entry it starts from and shows on both ends; it is shared with the party unless its author makes it private, and you always see every connection with its author. You can delete any player's note or connection from the block; you can't edit their text. Players get a Relationships tab whenever they can add a connection or have something to see there, so an entry whose only relationships you've hidden no longer shows them an empty tab. That includes Session pages, which used to show players three tabs. Turn **Players can create connections** off in the module settings to freeze editing; existing connections stay visible.
```

In "## Settings reference" change "Six settings are visible" to "Seven settings are visible", and add after the **Warn when Campaign Companion can't work for players** bullet:

```markdown
- **Players can create connections** (on by default) — see [Player collaboration](#player-collaboration). Off hides **Add connection**, **Add a note** and the drop target and makes player notes read-only; existing connections still show and their writers can still delete them.
```

In the "Player collaboration" first paragraph, replace "A player's Session sheet shows three tabs rather than four — Recap, Session and Notes, with no Relationships tab." with "A player's Session sheet shows Recap, Session and Notes, plus Relationships when they can add a player connection there or have one to see."

- [ ] **Step 4: CHANGELOG and version**

Insert under `# Changelog` (use today's date: `date +%F`):

```markdown
## 0.25.0 (YYYY-MM-DD)

Player connections.

- **Added:** players can record connections between journal entries in a new **Player connections** block on the Relationships tab: per-side labels and secrets, one note per player per side, shared with the party by default or private to the author and the GM. Add them with **Add connection** or by dropping a journal entry onto the block. Writes go through the active GM, who sees and can delete every connection and note.
- **Added:** player connections draw as dotted lines in the relationship graph (**Show player connections**) and appear under each entry in Word export.
- **Added:** the **Players can create connections** setting (on by default).
- **Changed:** players now get the Relationships tab when they can add a connection or have something to see there, and no longer get an empty tab when every relationship is hidden from them.
- **Tests:** end-to-end spec `32-player-connections` on Foundry 13 and 14; `29-readability` covers the block and the dialog.
```

replacing `YYYY-MM-DD` with the `date +%F` output. In `module.json` set `"version": "0.25.0"`.

- [ ] **Step 5: Check and commit**

Run: `npm test && npm run check:links` → Expected: all pass, links OK.

```bash
git add README.md docs/player-guide.md docs/gm-guide.md CHANGELOG.md module.json
git commit -m "docs: player connections in README and guides; 0.25.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Release (only after the PR is merged to main and the user says go)**

```bash
git fetch origin && git checkout main && git pull
git tag -a 0.25.0 <merge-commit> -m "0.25.0" && git push origin 0.25.0
```

`release.yml` fails the run if the tag and `module.json` disagree. Confirm the GitHub release shows the 0.25.0 CHANGELOG section and the `module.zip` + `module.json` assets.

---

## Self-review

- **Spec coverage:** §2 data model → Task 1 (normalize), Task 2 (writes, empty-note delete). §3 visibility → Tasks 1 and 4. §3 tab rules → Task 4. §4.1 → Tasks 1, 2, 3, 8, 10. §4.2 → Task 4. §4.3 → Task 3. §4.4 → Task 5. §4.5 → Tasks 6 and 7. §4.6 → Task 8. §4.7 → Task 4. §4.8 → Task 4, with honouring in Tasks 1, 6, 7 and 8. §5 → Task 2. §6.1 → Task 9. §6.2 → Task 10. §6.3 needs no code (the flag travels with the page). §7 → Tasks 5 and 8. §8 unit tests → Tasks 1–10; e2e 1–9 → Task 11. §10 → Task 12.
- **Resolved spec/code mismatches:**
  - `PlaceSheet` also deletes the tab, so the wrap covers both prototypes.
  - Word export is GM-only (`openExportDialog`), so "any other export" is the GM exporting without GM content, and the exporter is the GM.
  - The standalone graph app was retired; the Hub window shares the Hub page, so one toggle covers both.
  - `canSeeConnection` doesn't need `knownUserIds` (foreign rules fall out of the author check); `sideView` uses it for editability.
  - `buildReverseIndex` returns `{inbound, outbound}` so it can be patched in O(1).
  - `validateRequest` takes the full request `(op, request, ctx)`.
  - The index builds lazily on first use rather than on `ready`.
  - Extra reason codes: `bad-request`, `bad-sender`, `no-gm`, `timeout`, `failed`.
  - The GM gets no Add connection button (MEJ's own relationships are the GM's tool) but can moderate.
  - Session pages gain a player Relationships tab under rule 3; the GM guide is updated.
- **Type consistency:** `SideView` fields (`from`, `side`, `viewerId`, `others`, `main`) are produced in Task 1 and consumed in Tasks 6 and 7. The request shape `{op, fromUuid, connectionId, side, payload}` is the same in Tasks 2, 5, 7, 8 and 11. `playerConnectionsEnabled` comes from `rel-tab-wrap.mjs` (Task 4) and is used in Task 7.
