# Notes and the Current Session Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give players a low-friction way to write during play: a note primitive stored per campaign, a current session with a Tonight strip and capture box, a `/note` chat command, a notes stream on the Session page, party notes and a session-ordered History on entry pages, notes on the timeline, and a recap draft at End session.

**Architecture:** Pure, Foundry-free logic (`logic/notes.mjs`, `logic/notes-access.mjs`, `logic/current-session.mjs`, `logic/note-command.mjs`, `logic/recap-draft.mjs`, `logic/tonight.mjs`, `logic/history.mjs`) holds the model and rules. A GM-seat hook keeps one hidden notes JournalEntry per campaign (the PR #49 party-notebook pattern, separate entry) owned by every non-GM user at a campaign baseline of Observer or above, so players write with no GM online. The current session is a flag on the campaign folder. Hub, Session sheet, knowledge panel and timeline read the same notes.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, ApplicationV2, DialogV2), Monk's Enhanced Journal 13.06/14.01, vitest 3 (+ jsdom where DOM is built), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-15-companion-ui-review-design.md` — change-list items 1, 1a, 2, 3, 6, 16; §9 reviewer's calls; §11 owner decisions.

## Global Constraints

- Stock MEJ (native mode) and the API-carrying fork must both keep working; nothing here may depend on the MEJ extension API beyond what the Hub already uses.
- Foundry 13 and 14.
- The companion never patches MEJ; party layers live in the companion's own flags or its own hidden entries.
- Secret text stays soft-hidden (client-side filtering) as documented; notes that mention a secret entry are subject to the same audience containment rule auto-link already enforces.
- Pre-1.0: no migration ceremony is required for the notes store, but existing party notebooks (PR #49) must keep working.
- Anti-goals (spec §3): no new Hub tab; no new settings toggle beyond `autoStartSession`; no GM online needed for a player's own note; party notes never mix into the GM's canon text.
- Writes are per-note keyed `update()` paths (`flags.mej-campaign-companion.notes.<id>`), never a whole-flag `setFlag`.
- Unit tests: `npx vitest run` from the worktree root. e2e: spec 35 only, v14 (`npx playwright test tests/e2e/35-session-notes.spec.mjs`); not run as part of this plan; time-box live runs.
- PR bodies carry no Claude attribution footer (user rule).

## Deviations from the spec (decided while planning — confirm at review)

1. **The recap draft is applied from a dialog, not typed into the live editor.** The collaborative ProseMirror editor's content cannot be set from outside without racing another owner's session (see `SessionSheet.mjs` header and `_ingestRecapImage`'s comment). End session opens a dialog showing the draft; **Append to recap** writes it with `page.update`, **Not now** does nothing. "Never saved without a click" holds.
2. **Store functions take a campaign Folder (or its id).** The cross-plan interface named `campaignFolderId`; every function resolves an id through `game.folders.get` so both forms work.
3. **`autoStartSession` offers, never silently starts.** On the active GM's login it asks once per campaign that has no open session and none started today.

## Review Focus

1. **Two players writing at once:** every write is one keyed path per note; a second author's note must survive the first author's concurrent write. Test in Task 1 (`noteCreateUpdate` shape) and Task 2 (`addNote` writes one key).
2. **A group reveal note must stay hidden** from a player outside the group, and a retracted note must vanish for players while the GM still sees it. Test in Task 1 (`visibleNotes`).
3. **`/note` from a GM running two parties** with two open sessions must refuse, never pick one. Test in Task 3 (`routeNote`) and Task 5 (`parseNoteCommand` + handler branch).
4. **A player who connects after Start session** must become a recap owner; a disconnect never removes ownership. Test in Task 3 (`recapOwnershipUpdate` never emits a removal) and Task 4 (the `userConnected` grant).
5. **Held notes belong to their own campaign:** a note taken with no session open is adopted only by the next session of *that* campaign. Test in Task 3 (`adoptHeldUpdate` ignores other campaigns' notes because notes live per campaign entry) and Task 4 (`startSession` adopts).

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/constants.mjs` | New flag/setting keys |
| `scripts/logic/notes.mjs` (new) | Pure note model: normalize, update paths, visibility, mentions, counts |
| `scripts/logic/notes-access.mjs` (new) | Pure seam: who owns the notes entry |
| `scripts/data/notes-store.mjs` (new) | Foundry glue: ensure/sync the notes entry, add/list/update/delete/retract |
| `scripts/hooks/notes-entry.mjs` (new) | GM-seat lifecycle, sidebar hide, view refresh on note change |
| `scripts/hooks/note-links.mjs` (new) | Auto-link a note's text against the campaign scope |
| `scripts/logic/current-session.mjs` (new) | Pure: current-session flag, numbering, recap ownership, `/note` routing, held-note adoption |
| `scripts/hooks/current-session.mjs` (new) | GM actions `startSession` / `endSession`, `userConnected` grant, login offer |
| `scripts/logic/recap-draft.mjs` (new) | Pure: draft HTML from notes |
| `scripts/logic/note-command.mjs`, `scripts/hooks/note-command.mjs` (new) | `/note` parser and chat hook |
| `scripts/logic/tonight.mjs`, `templates/hub-tonight.hbs` (new) | Tonight strip view model and partial |
| `scripts/apps/CampaignHubPage.mjs`, `templates/hub.hbs` | Strip under the header; start/end/capture actions; timeline notes series |
| `scripts/sheets/SessionSheet.mjs`, `templates/session.hbs` | Strip on Recap tab; notes stream with capture, edit, delete |
| `scripts/logic/history.mjs` (new), `scripts/hooks/knowledge-ui.mjs`, `templates/knowledge-panel.hbs` | Party notes section; History view; "Note about this" |
| `scripts/logic/hub-timeline.mjs` | Optional `notes` input interleaved in Campaign Date order |
| `scripts/logic/campaigns.mjs`, `scripts/data/campaign-store.mjs`, `scripts/hooks/party-notebook-directory.mjs` | Exclude the notes entry everywhere the party notebook is excluded |
| `scripts/integrations/mej-adapter.mjs`, `scripts/campaign-companion.mjs` | Registration, setting, template preload |
| `styles/campaign-companion.css`, `lang/en.json` | Strip, stream, panel styles; strings |
| `tests/e2e/35-session-notes.spec.mjs` (new) | One live spec |
| `README.md`, `docs/player-guide.md`, `docs/gm-guide.md` | Feature docs |

---

### Task 1: Pure note model

**Files:**
- Create: `scripts/logic/notes.mjs`
- Modify: `scripts/constants.mjs` (append after line 172, `PARTY_ROWS_FLAG`)
- Test: `test/notes.test.js`

**Interfaces:**
- Produces:
  - constants `NOTES_ENTRY_FLAG = "notesEntry"`, `NOTES_FLAG = "notes"`, `CURRENT_SESSION_KEY = "currentSession"`, `AUTO_START_SESSION_SETTING = "autoStartSession"`, `NOTE_TEXT_MAX = 2000`
  - `NOTE_KINDS = ["player", "gm", "reveal"]`
  - `Note = { id, text, authorId, authorName, at, worldDate, sessionUuid, mentions, audience, kind, editedAt, retracted, ref }` (`audience` null = everyone, else `{ users, groups, all }`; `ref` is any plain object the caller passed, persisted and read back untouched (Plan C stores `{ pageUuid, blockId }` there), or null)
  - `noteAudienceUpdate(id, audience): object` — one keyed path setting the normalized audience (Plan C widens a reveal's audience through this)
  - `validNoteText(raw): string|null` — trimmed, 1..NOTE_TEXT_MAX chars, else null
  - `normalizeNotes(flagValue): Note[]` sorted by `at` ascending
  - `mentionsOf(text): string[]` — unique JournalEntry uuids from `@UUID[...]` shorthand (page uuids collapse to their entry)
  - `noteCreateUpdate(fields): { id, update }` — one keyed path
  - `noteEditUpdate(note, text, { now }): object|null`
  - `noteDeleteUpdate(id): object`
  - `noteRetractUpdate(id, { now }): object`
  - `canEditNote(note, user): boolean` — author or GM
  - `visibleNotes(notes, user, groups): Note[]` — GM sees all; players never see retracted, and see an audienced note only when `canSee` passes
  - `notesForSession(notes, sessionUuid)`, `notesMentioning(notes, entryUuid)`, `heldNotes(notes)` (sessionUuid null)
  - `noteCountsBySession(notes): Map<string, number>`

- [ ] **Step 1: Add constants**

Append to `scripts/constants.mjs`:

```js
/** Session notes (spec 2026-10-15 items 1-3): the hidden per-campaign notes entry and its note map. */
export const NOTES_ENTRY_FLAG = "notesEntry";
export const NOTES_FLAG = "notes";
/** Key on the campaign flag holding { uuid, startedAt } of the open session. */
export const CURRENT_SESSION_KEY = "currentSession";
/** World setting: offer to start a session when the active GM logs in on a new day. */
export const AUTO_START_SESSION_SETTING = "autoStartSession";
export const NOTE_TEXT_MAX = 2000;
```

- [ ] **Step 2: Write the failing tests**

`test/notes.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  NOTE_KINDS, validNoteText, normalizeNotes, mentionsOf, noteCreateUpdate, noteEditUpdate, noteDeleteUpdate,
  noteRetractUpdate, noteAudienceUpdate, canEditNote, visibleNotes, notesForSession, notesMentioning, heldNotes, noteCountsBySession
} from "../scripts/logic/notes.mjs";
import { NOTE_TEXT_MAX } from "../scripts/constants.mjs";

const P = "mej-campaign-companion";
const S1 = "JournalEntry.s1.JournalEntryPage.p1";
const E1 = "JournalEntry.e1";
const E2 = "JournalEntry.e2";
const gm = { id: "gm", isGM: true };
const u1 = { id: "u1", isGM: false };
const u2 = { id: "u2", isGM: false };
const groups = [{ id: "g1", name: "Inner", members: ["u1"] }];

describe("validNoteText", () => {
  it("trims and bounds", () => {
    expect(validNoteText("  the duke is lying ")).toBe("the duke is lying");
    expect(validNoteText("   ")).toBeNull();
    expect(validNoteText(null)).toBeNull();
    expect(validNoteText("x".repeat(NOTE_TEXT_MAX + 1))).toBeNull();
    expect(validNoteText("x".repeat(NOTE_TEXT_MAX))).toHaveLength(NOTE_TEXT_MAX);
  });
});

describe("normalizeNotes", () => {
  it("coerces fields, drops malformed, sorts by at", () => {
    const notes = normalizeNotes({
      b: { text: "second", authorId: "u1", at: 20, sessionUuid: S1 },
      a: { text: "first", authorId: "u1", authorName: "Jo", at: 10, mentions: [E1], kind: "gm", audience: { users: ["u2"] } },
      bad1: { authorId: "u1" },
      bad2: "nope"
    });
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(notes[0]).toEqual({
      id: "a", text: "first", authorId: "u1", authorName: "Jo", at: 10, worldDate: null, sessionUuid: null,
      mentions: [E1], audience: { users: ["u2"], groups: [], all: false }, kind: "gm", editedAt: null, retracted: null, ref: null
    });
    expect(notes[1].kind).toBe("player");
    expect(notes[1].audience).toBeNull();
  });
  it("nullish gives []", () => expect(normalizeNotes(undefined)).toEqual([]));
  it("unknown kind falls back to player", () => {
    expect(normalizeNotes({ a: { text: "t", authorId: "u1", at: 1, kind: "weird" } })[0].kind).toBe("player");
    expect(NOTE_KINDS).toEqual(["player", "gm", "reveal"]);
  });
});

describe("mentionsOf", () => {
  it("collects unique entry uuids, collapsing page uuids", () => {
    const text = `met @UUID[${E1}]{Duke} and @UUID[${E1}.JournalEntryPage.x]{Duke} at @UUID[${E2}]{Inn} @UUID[Actor.a1]{Bob}`;
    expect(mentionsOf(text)).toEqual([E1, E2]);
  });
  it("empty for plain text", () => expect(mentionsOf("nothing here")).toEqual([]));
});

describe("update paths (Review Focus 1: one keyed path per note)", () => {
  it("noteCreateUpdate writes exactly one key", () => {
    const { id, update } = noteCreateUpdate({ id: "n1", text: "hi", authorId: "u1", authorName: "Jo", at: 5, sessionUuid: S1 });
    expect(id).toBe("n1");
    expect(Object.keys(update)).toEqual([`flags.${P}.notes.n1`]);
    expect(update[`flags.${P}.notes.n1`]).toEqual({
      text: "hi", authorId: "u1", authorName: "Jo", at: 5, worldDate: null, sessionUuid: S1,
      mentions: [], audience: null, kind: "player", editedAt: null, retracted: null, ref: null
    });
  });
  it("noteCreateUpdate derives mentions from text when not given", () => {
    const { update } = noteCreateUpdate({ id: "n2", text: `saw @UUID[${E2}]{Inn}`, authorId: "u1", authorName: "Jo", at: 1 });
    expect(update[`flags.${P}.notes.n2`].mentions).toEqual([E2]);
  });
  it("noteEditUpdate touches text, mentions and editedAt only", () => {
    const note = normalizeNotes({ n1: { text: "old", authorId: "u1", at: 1 } })[0];
    expect(noteEditUpdate(note, ` new @UUID[${E1}]{D} `, { now: 9 })).toEqual({
      [`flags.${P}.notes.n1.text`]: `new @UUID[${E1}]{D}`,
      [`flags.${P}.notes.n1.mentions`]: [E1],
      [`flags.${P}.notes.n1.editedAt`]: 9
    });
    expect(noteEditUpdate(note, "   ", { now: 9 })).toBeNull();
  });
  it("delete, retract, audience", () => {
    expect(noteDeleteUpdate("n1")).toEqual({ [`flags.${P}.notes.-=n1`]: null });
    expect(noteRetractUpdate("n1", { now: 4 })).toEqual({ [`flags.${P}.notes.n1.retracted`]: 4 });
    expect(noteAudienceUpdate("n1", { users: ["u1", "u2"] })).toEqual({ [`flags.${P}.notes.n1.audience`]: { users: ["u1", "u2"], groups: [], all: false } });
    expect(noteAudienceUpdate("n1", null)).toEqual({ [`flags.${P}.notes.n1.audience`]: null });
  });
  it("ref is persisted and read back untouched (Plan C)", () => {
    const ref = { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "secret-1" };
    const { update } = noteCreateUpdate({ id: "n3", text: "t", authorId: "gm", at: 1, kind: "reveal", audience: { groups: ["g1"] }, ref });
    expect(update[`flags.${P}.notes.n3`].ref).toEqual(ref);
    expect(normalizeNotes({ n3: update[`flags.${P}.notes.n3`] })[0].ref).toEqual(ref);
  });
});

describe("canEditNote", () => {
  const note = normalizeNotes({ n: { text: "t", authorId: "u1", at: 1 } })[0];
  it("author and GM only", () => {
    expect(canEditNote(note, u1)).toBe(true);
    expect(canEditNote(note, gm)).toBe(true);
    expect(canEditNote(note, u2)).toBe(false);
  });
});

describe("visibleNotes (Review Focus 2)", () => {
  const notes = normalizeNotes({
    open: { text: "a", authorId: "u2", at: 1 },
    grp: { text: "b", authorId: "gm", at: 2, kind: "reveal", audience: { groups: ["g1"] } },
    usr: { text: "c", authorId: "gm", at: 3, kind: "reveal", audience: { users: ["u2"] } },
    gone: { text: "d", authorId: "gm", at: 4, kind: "reveal", audience: { all: true }, retracted: 5 }
  });
  it("GM sees everything including retracted", () => {
    expect(visibleNotes(notes, gm, groups).map((n) => n.id)).toEqual(["open", "grp", "usr", "gone"]);
  });
  it("a group member sees the group note, not the other user's", () => {
    expect(visibleNotes(notes, u1, groups).map((n) => n.id)).toEqual(["open", "grp"]);
  });
  it("a non-member sees only open and their own audience; retracted never", () => {
    expect(visibleNotes(notes, u2, groups).map((n) => n.id)).toEqual(["open", "usr"]);
  });
});

describe("selectors", () => {
  const notes = normalizeNotes({
    a: { text: "a", authorId: "u1", at: 1, sessionUuid: S1, mentions: [E1] },
    b: { text: "b", authorId: "u1", at: 2, sessionUuid: null, mentions: [E1, E2] },
    c: { text: "c", authorId: "u1", at: 3, sessionUuid: "JournalEntry.s2.JournalEntryPage.p2" }
  });
  it("by session, by mention, held", () => {
    expect(notesForSession(notes, S1).map((n) => n.id)).toEqual(["a"]);
    expect(notesMentioning(notes, E2).map((n) => n.id)).toEqual(["b"]);
    expect(heldNotes(notes).map((n) => n.id)).toEqual(["b"]);
  });
  it("counts per session, skipping held", () => {
    const m = noteCountsBySession(notes);
    expect(m.get(S1)).toBe(1);
    expect(m.get("JournalEntry.s2.JournalEntryPage.p2")).toBe(1);
    expect(m.has(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/notes.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/logic/notes.mjs"`.

- [ ] **Step 4: Write the implementation**

`scripts/logic/notes.mjs`:

```js
// Pure note model (spec 2026-10-15 items 1-3). No Foundry imports. A note
// is one keyed object under flags[MODULE_ID].notes on the campaign's hidden
// notes entry (data/notes-store.mjs); every write is one keyed path so two
// authors never clobber each other.
import { MODULE_ID, NOTES_FLAG, NOTE_TEXT_MAX } from "../constants.mjs";
import { canSee, normalizeAudience } from "./reveal-state.mjs";

export const NOTE_KINDS = ["player", "gm", "reveal"];

const path = (id, field) => `flags.${MODULE_ID}.${NOTES_FLAG}.${id}${field ? `.${field}` : ""}`;

export function validNoteText(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.length || text.length > NOTE_TEXT_MAX) return null;
  return text;
}

const UUID_RE = /@UUID\[([^\]]+)\]/g;

/** Unique JournalEntry uuids mentioned in `text`; a page uuid collapses to its entry. */
export function mentionsOf(text) {
  const out = [];
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(UUID_RE)) {
    const parts = m[1].split(".");
    if (parts[0] !== "JournalEntry" || !parts[1]) continue;
    const uuid = `JournalEntry.${parts[1]}`;
    if (!out.includes(uuid)) out.push(uuid);
  }
  return out;
}

function normalizeAudienceOrNull(raw) {
  if (raw == null) return null;
  const a = normalizeAudience(raw);
  return { users: a.users, groups: a.groups, all: a.all };
}

function normalizeOne(id, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.text !== "string" || typeof raw.authorId !== "string") return null;
  return {
    id,
    text: raw.text,
    authorId: raw.authorId,
    authorName: typeof raw.authorName === "string" ? raw.authorName : "",
    at: typeof raw.at === "number" ? raw.at : 0,
    worldDate: raw.worldDate && typeof raw.worldDate === "object" ? raw.worldDate : null,
    sessionUuid: typeof raw.sessionUuid === "string" ? raw.sessionUuid : null,
    mentions: Array.isArray(raw.mentions) ? raw.mentions.filter((m) => typeof m === "string") : [],
    audience: normalizeAudienceOrNull(raw.audience),
    kind: NOTE_KINDS.includes(raw.kind) ? raw.kind : "player",
    editedAt: typeof raw.editedAt === "number" ? raw.editedAt : null,
    retracted: typeof raw.retracted === "number" ? raw.retracted : null,
    ref: raw.ref && typeof raw.ref === "object" && !Array.isArray(raw.ref) ? { ...raw.ref } : null
  };
}

export function normalizeNotes(flagValue) {
  if (!flagValue || typeof flagValue !== "object" || Array.isArray(flagValue)) return [];
  return Object.entries(flagValue)
    .map(([id, raw]) => normalizeOne(id, raw))
    .filter(Boolean)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function noteCreateUpdate({ id, text, authorId, authorName = "", at, worldDate = null, sessionUuid = null, mentions, audience = null, kind = "player", ref = null }) {
  const value = {
    text, authorId, authorName, at, worldDate, sessionUuid: sessionUuid ?? null,
    mentions: mentions ?? mentionsOf(text),
    audience: normalizeAudienceOrNull(audience),
    kind: NOTE_KINDS.includes(kind) ? kind : "player",
    editedAt: null, retracted: null, ref
  };
  return { id, update: { [path(id)]: value } };
}

export function noteEditUpdate(note, rawText, { now }) {
  const text = validNoteText(rawText);
  if (!text) return null;
  return { [path(note.id, "text")]: text, [path(note.id, "mentions")]: mentionsOf(text), [path(note.id, "editedAt")]: now };
}

export function noteDeleteUpdate(id) {
  return { [`flags.${MODULE_ID}.${NOTES_FLAG}.-=${id}`]: null };
}

export function noteRetractUpdate(id, { now }) {
  return { [path(id, "retracted")]: now };
}

export function noteAudienceUpdate(id, audience) {
  return { [path(id, "audience")]: normalizeAudienceOrNull(audience) };
}

export function canEditNote(note, user) {
  return !!user && (user.isGM === true || note?.authorId === user.id);
}

export function visibleNotes(notes, user, groups) {
  if (user?.isGM) return [...(notes ?? [])];
  return (notes ?? []).filter((n) => {
    if (n.retracted !== null) return false;
    if (n.audience === null || n.audience.all) return true;
    return canSee(n.audience, user?.id, groups);
  });
}

export const notesForSession = (notes, sessionUuid) => (notes ?? []).filter((n) => n.sessionUuid === sessionUuid);
export const notesMentioning = (notes, entryUuid) => (notes ?? []).filter((n) => n.mentions.includes(entryUuid));
export const heldNotes = (notes) => (notes ?? []).filter((n) => n.sessionUuid === null);

export function noteCountsBySession(notes) {
  const m = new Map();
  for (const n of notes ?? []) {
    if (n.sessionUuid === null) continue;
    m.set(n.sessionUuid, (m.get(n.sessionUuid) ?? 0) + 1);
  }
  return m;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/notes.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/constants.mjs scripts/logic/notes.mjs test/notes.test.js
git commit -m "feat(notes): pure note model and keyed update paths"
```

---

### Task 2: Notes entry store, access seam, lifecycle hook, auto-link of note text

**Files:**
- Create: `scripts/logic/notes-access.mjs`, `scripts/data/notes-store.mjs`, `scripts/hooks/notes-entry.mjs`, `scripts/hooks/note-links.mjs`
- Modify: `scripts/logic/campaigns.mjs` (add `isNotesEntry`, exclude in `isLinkableEntity`), `scripts/data/campaign-store.mjs:171-181` (exclude in `campaignEntries` / `unfiledEntries`), `scripts/hooks/party-notebook-directory.mjs:11-16` (hide notes entries too), `scripts/integrations/mej-adapter.mjs:157-160` (register), `lang/en.json`
- Test: `test/notes-access.test.js`, `test/campaigns.test.js` (append)

**Interfaces:**
- Consumes: Task 1; `notebookOwnership`, `ownershipUpdate` from `logic/party-access.mjs`; `selectCandidates` from `logic/auto-link-candidates.mjs`; `viewerIds`, `audienceContains` from `logic/link-audience.mjs`; `autoLinkAdded` from `logic/auto-link.mjs`; `refreshViewsMatching` from `hooks/view-refresh.mjs`.
- Produces:
  - `isNotesEntry(entry): boolean` (`logic/campaigns.mjs`)
  - `notesWriters(campaign, users, levels): string[]` — every non-GM user id when the baseline is ≥ OBSERVER, else `[]`
  - `notesEntryOf(campaign): JournalEntry|null`, `ensureNotesEntry(campaign)`, `syncNotesOwnership(campaign)`
  - `readNotes(campaign): Note[]` (all), `listNotes(campaign, { sessionUuid, mentionsUuid, user } = {}): Note[]` (visibility-filtered)
  - `addNote(campaign, fields): Promise<Note>`, `updateNote(campaign, id, { text?, audience? })`, `deleteNote(campaign, id)`, `retractNote(campaign, id)` — each throws `NotesStoreError` with `.reason` `"noEntry" | "noAccess" | "badText" | "notFound"`
  - **Guarantees Plan C is written against:** (1) `addNote` resolves to the created note object, which carries `.id`; (2) a `ref` field in the payload (any plain object, e.g. `{ pageUuid, blockId }`) is persisted on the note untouched and read back as given; (3) `currentSession(campaignFolder)` (Task 3) returns `{ uuid, startedAt }` or `null`; (4) `updateNote` accepts an audience-only patch — a text patch needs `canEditNote` (author or GM), an audience patch needs a GM. All store functions accept a campaign Folder or its id.
  - `linkNoteText(campaign, text): string` — HTML-escaped text with campaign-scope entity names turned into `@UUID` links
  - `registerNotesEntry()`

- [ ] **Step 1: Write the failing tests**

`test/notes-access.test.js`:

```js
import { describe, it, expect } from "vitest";
import { notesWriters } from "../scripts/logic/notes-access.mjs";
import { isNotesEntry, isLinkableEntity } from "../scripts/logic/campaigns.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const campaign = (ownershipDefault) => ({ flags: { [P]: { campaign: { ownershipDefault } } } });
const users = [{ id: "gm", isGM: true }, { id: "u1", isGM: false }, { id: "u2", isGM: false }];

describe("notesWriters (owner decision §11.1)", () => {
  it("every non-GM at observer baseline", () => {
    expect(notesWriters(campaign("observer"), users, LEVELS)).toEqual(["u1", "u2"]);
    expect(notesWriters(campaign("owner"), users, LEVELS)).toEqual(["u1", "u2"]);
  });
  it("nobody at a none baseline", () => {
    expect(notesWriters(campaign("none"), users, LEVELS)).toEqual([]);
  });
  it("missing flag reads as observer (ownershipLevelFor default)", () => {
    expect(notesWriters({ flags: {} }, users, LEVELS)).toEqual(["u1", "u2"]);
  });
});

describe("isNotesEntry", () => {
  it("matches the flag and is never a linkable entity", () => {
    const e = { flags: { [P]: { notesEntry: true } } };
    expect(isNotesEntry(e)).toBe(true);
    expect(isNotesEntry({ flags: {} })).toBe(false);
    expect(isLinkableEntity(e, () => "person")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/notes-access.test.js`
Expected: FAIL — cannot resolve `notes-access.mjs`; `isNotesEntry` is not exported.

- [ ] **Step 3: Implement the pure parts**

`scripts/logic/notes-access.mjs`:

```js
// Who owns the notes entry (owner decision 2026-10-15 §11.1): every non-GM
// user when the campaign baseline is Observer or above. Separate from
// party-access.mjs so notes never widen party-relationship writers.
import { campaignFlagOf, ownershipLevelFor } from "./campaigns.mjs";

export function notesWriters(campaign, users, levels) {
  const baseline = ownershipLevelFor(campaignFlagOf(campaign)?.ownershipDefault, levels);
  if (baseline < levels.OBSERVER) return [];
  return (users ?? []).filter((u) => !u.isGM).map((u) => u.id);
}
```

In `scripts/logic/campaigns.mjs`, import `NOTES_ENTRY_FLAG` from constants (line 5) and add after `isPartyNotebook`:

```js
/** Is this the campaign's hidden session-notes entry (spec 2026-10-15 item 1)? */
export function isNotesEntry(entry) {
  return entry?.flags?.[MODULE_ID]?.[NOTES_ENTRY_FLAG] === true;
}
```

and change `isLinkableEntity`'s return to:

```js
  return !!mejTypeOf(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry) && !isPartyNotebook(entry) && !isNotesEntry(entry);
```

In `scripts/data/campaign-store.mjs` import `isNotesEntry` and add `&& !isNotesEntry(e)` to both filters in `campaignEntries` (line 174) and `unfiledEntries` (line 180).

In `scripts/hooks/party-notebook-directory.mjs` line 6 import `isNotesEntry` too and change line 14 to:

```js
    const entry = game.journal.get(li.dataset.entryId);
    if (isPartyNotebook(entry) || isNotesEntry(entry)) li.remove();
```

- [ ] **Step 4: Run to verify the pure tests pass**

Run: `npx vitest run test/notes-access.test.js test/campaigns.test.js`
Expected: PASS.

- [ ] **Step 5: Write the Foundry glue**

`scripts/data/notes-store.mjs`:

```js
// Foundry glue for the per-campaign notes entry (spec 2026-10-15 item 1).
// Mirrors data/party-notebook.mjs; GM-only writers self-check isGM.
import { MODULE_ID, I18N, NOTES_ENTRY_FLAG, NOTES_FLAG, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { isNotesEntry, isCampaignFolder } from "../logic/campaigns.mjs";
import { notebookOwnership, ownershipUpdate } from "../logic/party-access.mjs";
import { notesWriters } from "../logic/notes-access.mjs";
import {
  normalizeNotes, visibleNotes, notesForSession, notesMentioning, noteCreateUpdate, noteEditUpdate,
  noteDeleteUpdate, noteRetractUpdate, noteAudienceUpdate, canEditNote, validNoteText
} from "../logic/notes.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";

export class NotesStoreError extends Error {
  constructor(reason) {
    super(`notes store: ${reason}`);
    this.reason = reason;
  }
}

/** Accept a Folder or a folder id. */
export function resolveCampaign(campaign) {
  const folder = typeof campaign === "string" ? game.folders.get(campaign) : campaign;
  return folder && isCampaignFolder(folder) ? folder : null;
}

export function notesEntryOf(campaign) {
  const folder = resolveCampaign(campaign);
  return (folder?.contents ?? []).find((e) => isNotesEntry(e)) ?? null;
}

function desiredOwnership(folder, current) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return notebookOwnership(current ?? {}, {
    defaultLevel: L.NONE,
    writerIds: notesWriters(folder, game.users.contents, L),
    ownerLevel: L.OWNER,
    gmIds: game.users.filter((u) => u.isGM).map((u) => u.id)
  });
}

const creating = new Map();

/** GM-only. The campaign's notes entry, created when missing. */
export async function ensureNotesEntry(campaign) {
  const folder = resolveCampaign(campaign);
  if (!game.user.isGM || !folder) return null;
  const existing = notesEntryOf(folder);
  if (existing) return existing;
  const pending = creating.get(folder.id);
  if (pending) return pending;
  const p = JournalEntry.create({
    name: game.i18n.format(`${I18N}.notes.entryName`, { campaign: folder.name }),
    folder: folder.id,
    ownership: desiredOwnership(folder, {}) ?? { default: 0 },
    flags: { [MODULE_ID]: { [NOTES_ENTRY_FLAG]: true, [NOTES_FLAG]: {} } }
  }).finally(() => creating.delete(folder.id));
  creating.set(folder.id, p);
  return p;
}

/** GM-only. Ownership follows the baseline and the user list. */
export async function syncNotesOwnership(campaign) {
  const folder = resolveCampaign(campaign);
  if (!game.user.isGM || !folder) return;
  const entry = notesEntryOf(folder);
  if (!entry) return;
  const update = ownershipUpdate(entry.ownership, desiredOwnership(folder, entry.ownership), {
    replace: typeof globalThis._replace === "function" ? globalThis._replace : null
  });
  if (update) await entry.update(update);
}

export function readNotes(campaign) {
  const entry = notesEntryOf(campaign);
  return entry ? normalizeNotes(entry.flags?.[MODULE_ID]?.[NOTES_FLAG]) : [];
}

export function listNotes(campaign, { sessionUuid, mentionsUuid, user = game.user } = {}) {
  const entry = notesEntryOf(campaign);
  if (!entry || !(user.isGM || entry.testUserPermission(user, "OBSERVER"))) return [];
  const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
  let notes = visibleNotes(readNotes(campaign), user, groups);
  if (sessionUuid !== undefined) notes = notesForSession(notes, sessionUuid);
  if (mentionsUuid !== undefined) notes = notesMentioning(notes, mentionsUuid);
  return notes;
}

function writable(campaign) {
  const entry = notesEntryOf(campaign);
  if (!entry) throw new NotesStoreError("noEntry");
  if (!entry.isOwner) throw new NotesStoreError("noAccess");
  return entry;
}

/** Append a note; `text` is already linked HTML (hooks/note-links.mjs). Returns the stored note. */
export async function addNote(campaign, { text, authorId = game.user.id, authorName = game.user.name, at = Date.now(), worldDate = null, sessionUuid = null, mentions, audience = null, kind = "player", ref = null }) {
  const entry = writable(campaign);
  if (!validNoteText(text)) throw new NotesStoreError("badText");
  const { id, update } = noteCreateUpdate({
    id: foundry.utils.randomID(10), text, authorId, authorName, at, worldDate, sessionUuid, mentions, audience, kind, ref
  });
  await entry.update(update);
  return readNotes(campaign).find((n) => n.id === id) ?? null;
}

/** Patch `{ text?, audience? }`: text by author or GM; audience by a GM only (Plan C widens reveal audiences here). */
export async function updateNote(campaign, id, patch = {}) {
  const entry = writable(campaign);
  const note = readNotes(campaign).find((n) => n.id === id);
  if (!note) throw new NotesStoreError("notFound");
  const update = {};
  if (patch.text !== undefined) {
    if (!canEditNote(note, game.user)) throw new NotesStoreError("noAccess");
    const edit = noteEditUpdate(note, patch.text, { now: Date.now() });
    if (!edit) throw new NotesStoreError("badText");
    Object.assign(update, edit);
  }
  if (patch.audience !== undefined) {
    if (!game.user.isGM) throw new NotesStoreError("noAccess");
    Object.assign(update, noteAudienceUpdate(id, patch.audience));
  }
  if (Object.keys(update).length) await entry.update(update);
}

export async function deleteNote(campaign, id) {
  const entry = writable(campaign);
  const note = readNotes(campaign).find((n) => n.id === id);
  if (!note) throw new NotesStoreError("notFound");
  if (!canEditNote(note, game.user)) throw new NotesStoreError("noAccess");
  await entry.update(noteDeleteUpdate(id));
}

/** GM-only (Plan C's un-reveal path). */
export async function retractNote(campaign, id) {
  if (!game.user.isGM) throw new NotesStoreError("noAccess");
  const entry = writable(campaign);
  if (!readNotes(campaign).some((n) => n.id === id)) throw new NotesStoreError("notFound");
  await entry.update(noteRetractUpdate(id, { now: Date.now() }));
}
```

`scripts/hooks/note-links.mjs`:

```js
// Turn entity names in a note into @UUID links, bounded exactly like the
// typing-path auto-link: campaign scope and audience containment, with the
// notes entry's own readers as the audience. Pure pieces come from
// logic/auto-link*.mjs; this file only gathers Foundry inputs.
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isLinkableEntity } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { notesEntryOf } from "../data/notes-store.mjs";

const escape = (s) => foundry.utils.escapeHTML(s);

export function linkNoteText(campaign, text) {
  const html = escape(text);
  const notesEntry = notesEntryOf(campaign);
  if (!notesEntry) return html;
  const users = game.users.contents;
  const readers = viewerIds(notesEntry, users, isVisibleToUser);
  const campaignId = campaignIdOf(notesEntry);
  const pages = game.journal
    .filter((entry) => isLinkableEntity(entry, mejType) && sameLinkScope(campaignId, campaignIdOf(entry)))
    .map((entry) => ({
      id: entry.id, uuid: entry.uuid, name: entry.name, indexable: true,
      visible: audienceContains(readers, viewerIds(entry, users, isVisibleToUser))
    }));
  const candidates = dropAmbiguousNames(selectCandidates({ pages, selfId: null })).kept;
  return autoLinkAdded("", html, candidates);
}
```

`scripts/hooks/notes-entry.mjs`:

```js
// Notes entry lifecycle (spec 2026-10-15 item 1), the party-notebook pattern:
// the GM writer seat creates one notes entry per campaign and keeps its
// ownership in step with the baseline and the user list. Every seat
// re-renders views that show a changed note's session or mentioned entries.
import { MODULE_ID, CAMPAIGN_FLAG, NOTES_FLAG } from "../constants.mjs";
import { isCampaignFolder, isNotesEntry, campaignOf } from "../logic/campaigns.mjs";
import { normalizeNotes } from "../logic/notes.mjs";
import { ensureNotesEntry, syncNotesOwnership } from "../data/notes-store.mjs";
import { getCampaigns } from "../data/campaign-store.mjs";
import { refreshViewsMatching } from "./view-refresh.mjs";

const isWriterSeat = () => game.user.isGM && game.user === game.users.activeGM;

async function reconcile(campaigns) {
  for (const c of campaigns) {
    try {
      await ensureNotesEntry(c);
      await syncNotesOwnership(c);
    } catch (err) {
      console.error(`${MODULE_ID} | notes entry sync failed for campaign ${c.id}`, err);
    }
  }
}

const reconcileAll = () => (isWriterSeat() ? reconcile(getCampaigns()) : Promise.resolve());

/** Views to refresh for a note change: the session it belongs to, every entry it mentions, and the Hub. */
export function refreshForNoteChange(entry, noteChanges) {
  const notes = normalizeNotes(entry.flags?.[MODULE_ID]?.[NOTES_FLAG]);
  const ids = noteChanges && typeof noteChanges === "object" ? Object.keys(noteChanges).map((k) => k.replace(/^-=/, "")) : null;
  const touched = ids ? notes.filter((n) => ids.includes(n.id)) : notes;
  const uuids = new Set();
  for (const n of touched) {
    if (n.sessionUuid) uuids.add(n.sessionUuid.split(".JournalEntryPage.")[0]);
    for (const m of n.mentions) uuids.add(m);
  }
  const campaignId = campaignOf(entry)?.id ?? null;
  refreshViewsMatching((uuid) => {
    if (!uuid || uuids.has(uuid)) return true; // the shell's synthetic hub page has no uuid: always refresh it
    try {
      const doc = fromUuidSync(uuid);
      return !!campaignId && campaignOf(doc)?.id === campaignId && (doc?.documentName === "JournalEntryPage" ? false : uuids.has(doc?.uuid));
    } catch {
      return false;
    }
  });
}

export function registerNotesEntry() {
  const readyPass = () => reconcileAll().catch((err) => console.error(`${MODULE_ID} | notes entry ready pass failed`, err));
  if (game.ready) readyPass();
  else Hooks.once("ready", readyPass);
  Hooks.on("createFolder", (folder) => {
    if (isWriterSeat() && isCampaignFolder(folder)) reconcile([folder]);
  });
  Hooks.on("updateFolder", (folder, changes) => {
    if (!isWriterSeat() || !isCampaignFolder(folder)) return;
    if (changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] === undefined) return;
    reconcile([folder]);
  });
  Hooks.on("createUser", () => reconcileAll());
  Hooks.on("deleteUser", () => reconcileAll());
  Hooks.on("updateUser", (user, changes) => {
    if (changes?.role !== undefined) reconcileAll();
  });
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!isNotesEntry(entry)) return;
    try {
      const noteChanges = changes?.flags?.[MODULE_ID]?.[NOTES_FLAG];
      if (noteChanges !== undefined) refreshForNoteChange(entry, noteChanges);
    } catch (err) {
      console.error(`${MODULE_ID} | notes refresh failed`, err);
    }
  });
}
```

Register in `scripts/integrations/mej-adapter.mjs` after the "party notebook" step (line 160):

```js
  await step("notes entry", async () => {
    const { registerNotesEntry } = await import("../hooks/notes-entry.mjs");
    registerNotesEntry();
  });
```

Add to `lang/en.json` under `MEJCampaignCompanion` a new `"notes"` block (keep it; later tasks extend it):

```json
"notes": {
  "entryName": "Notes — {campaign}",
  "noEntry": "A GM must open the world once before notes can be taken in this campaign.",
  "noAccess": "You can't write notes in this campaign.",
  "badText": "A note needs some text (2000 characters at most).",
  "notFound": "That note no longer exists.",
  "writeFailed": "Couldn't save the note."
}
```

- [ ] **Step 6: Write the store test with stubbed Foundry globals**

`notes-store.mjs` touches only `game`, `CONST`, `foundry.utils.randomID` and `JournalEntry.create`, all stubbable, and every module it imports is pure. `test/notes-store.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { addNote, updateNote, readNotes, listNotes, NotesStoreError } from "../scripts/data/notes-store.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function fakeWorld({ isGM = false, userId = "u1" } = {}) {
  const entry = {
    flags: { [P]: { notesEntry: true, notes: {} } },
    ownership: { default: 0, u1: 3 },
    isOwner: true,
    testUserPermission: () => true,
    async update(update) {
      // Minimal Foundry merge: "a.b.c" paths and "-=" deletes, enough for the keyed note writes.
      for (const [key, value] of Object.entries(update)) {
        const parts = key.split(".");
        let o = this;
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else o[last] = value;
      }
    }
  };
  const folder = { id: "c1", name: "Vale", flags: { [P]: { campaign: { ownershipDefault: "observer" } } }, contents: [entry] };
  globalThis.game = {
    user: { id: userId, name: "Jo", isGM },
    users: { contents: [], filter: () => [] },
    folders: { get: (id) => (id === "c1" ? folder : null) },
    settings: { get: () => [] }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: LEVELS };
  globalThis.foundry = { utils: { randomID: () => "n1" } };
  return { folder, entry };
}

describe("notes store (Plan C guarantees)", () => {
  beforeEach(() => fakeWorld());

  it("addNote resolves to the created note carrying .id, by Folder or by id, and keeps ref untouched", async () => {
    const ref = { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "s1" };
    const note = await addNote("c1", { text: "hello", kind: "gm", ref });
    expect(note.id).toBe("n1");
    expect(note.ref).toEqual(ref);
    expect(readNotes(game.folders.get("c1"))[0]).toEqual(note);
  });

  it("updateNote with an audience-only patch needs a GM and leaves text alone", async () => {
    await addNote("c1", { text: "t", kind: "reveal", audience: { users: ["u2"] } });
    await expect(updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } })).rejects.toMatchObject({ reason: "noAccess" });
    fakeWorld({ isGM: true, userId: "gm" });
    await addNote("c1", { text: "t", kind: "reveal", audience: { users: ["u2"] } });
    await updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } });
    const [n] = readNotes("c1");
    expect(n.audience).toEqual({ users: ["u2", "u3"], groups: [], all: false });
    expect(n.text).toBe("t");
    expect(n.editedAt).toBeNull();
  });

  it("text patch by a non-author fails; listNotes hides an audienced note from outsiders", async () => {
    await addNote("c1", { text: "mine", authorId: "u9", audience: { users: ["u9"] } });
    await expect(updateNote("c1", "n1", { text: "x" })).rejects.toMatchObject({ reason: "noAccess" });
    expect(listNotes("c1")).toEqual([]);
    expect(() => new NotesStoreError("noEntry").reason).not.toThrow();
  });
});
```

Run: `npx vitest run test/notes-store.test.js`
Expected: PASS, 3 tests. Then `npx vitest run` — all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/notes-access.mjs scripts/data/notes-store.mjs scripts/hooks/notes-entry.mjs scripts/hooks/note-links.mjs scripts/logic/campaigns.mjs scripts/data/campaign-store.mjs scripts/hooks/party-notebook-directory.mjs scripts/integrations/mej-adapter.mjs lang/en.json test/notes-access.test.js test/notes-store.test.js
git commit -m "feat(notes): hidden per-campaign notes entry, store and lifecycle"
```

---

### Task 3: Pure current-session rules, `/note` routing, recap draft

**Files:**
- Create: `scripts/logic/current-session.mjs`, `scripts/logic/recap-draft.mjs`, `scripts/logic/note-command.mjs`
- Test: `test/current-session.test.js`, `test/recap-draft.test.js`, `test/note-command.test.js`

**Interfaces:**
- Produces:
  - `currentSession(campaign): { uuid, startedAt }|null`
  - `currentSessionUpdate(uuid, now): object`, `clearCurrentSessionUpdate(): object`
  - `nextSessionNumber(numbers: (number|null)[]): number`
  - `startedToday(startedAt, now): boolean` (local calendar day)
  - `recapOwnershipUpdate(ownership, userIds, { ownerLevel }): object|null` — adds only, never removes
  - `routeNote({ openSessions: {campaignId, sessionUuid}[], visibleCampaignIds: string[] }): { kind: "session", campaignId, sessionUuid } | { kind: "held", campaignId } | { kind: "refuse", reason: "ambiguous"|"none" }`
  - `adoptHeldUpdate(notes, sessionUuid): object|null` — sets `sessionUuid` on every held note
  - `recapDraft(notes, { formatTime }): string` — HTML; skips retracted; `""` when nothing
  - `parseNoteCommand(message): { text }|null` — `/note <text>` or `/n <text>`
  - `attendeeUuidsFor(users, current): string[]` (in `scripts/logic/attendee-player.mjs`) — `current` plus the assigned character uuid (`user.character.uuid`) of every non-GM user in `users` that has one, de-duplicated, order preserved (spec item 9's "attendees default to the players connected", deferred here from Plan A)

- [ ] **Step 1: Write the failing tests**

`test/current-session.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  currentSession, currentSessionUpdate, clearCurrentSessionUpdate, nextSessionNumber, startedToday,
  recapOwnershipUpdate, routeNote, adoptHeldUpdate
} from "../scripts/logic/current-session.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

const P = "mej-campaign-companion";
const S = "JournalEntry.s.JournalEntryPage.p";

describe("current session flag", () => {
  it("reads and writes under the campaign flag", () => {
    const folder = { flags: { [P]: { campaign: { ownershipDefault: "observer", currentSession: { uuid: S, startedAt: 5 } } } } };
    expect(currentSession(folder)).toEqual({ uuid: S, startedAt: 5 });
    expect(currentSession({ flags: {} })).toBeNull();
    expect(currentSessionUpdate(S, 7)).toEqual({ [`flags.${P}.campaign.currentSession`]: { uuid: S, startedAt: 7 } });
    expect(clearCurrentSessionUpdate()).toEqual({ [`flags.${P}.campaign.-=currentSession`]: null });
  });
});

describe("numbering and day check", () => {
  it("next number is max+1, 1 when none", () => {
    expect(nextSessionNumber([3, null, 7])).toBe(8);
    expect(nextSessionNumber([])).toBe(1);
  });
  it("startedToday compares local calendar days", () => {
    const now = new Date(2026, 9, 15, 20, 0).getTime();
    expect(startedToday(new Date(2026, 9, 15, 1, 0).getTime(), now)).toBe(true);
    expect(startedToday(new Date(2026, 9, 14, 23, 59).getTime(), now)).toBe(false);
    expect(startedToday(null, now)).toBe(false);
  });
});

describe("recapOwnershipUpdate (Review Focus 4: adds, never removes)", () => {
  it("grants OWNER to missing or lower users only", () => {
    expect(recapOwnershipUpdate({ default: 2, u1: 3 }, ["u1", "u2"], { ownerLevel: 3 })).toEqual({ "ownership.u2": 3 });
  });
  it("null when nothing to add; never emits -= keys", () => {
    expect(recapOwnershipUpdate({ default: 2, u1: 3, u2: 3 }, ["u1"], { ownerLevel: 3 })).toBeNull();
    const up = recapOwnershipUpdate({ u9: 3 }, ["u1"], { ownerLevel: 3 });
    expect(Object.keys(up).some((k) => k.includes("-="))).toBe(false);
  });
});

describe("routeNote (Review Focus 3)", () => {
  it("one open session wins regardless of visibility list", () => {
    expect(routeNote({ openSessions: [{ campaignId: "c1", sessionUuid: S }], visibleCampaignIds: ["c1", "c2"] }))
      .toEqual({ kind: "session", campaignId: "c1", sessionUuid: S });
  });
  it("two open sessions refuse", () => {
    expect(routeNote({ openSessions: [{ campaignId: "c1", sessionUuid: S }, { campaignId: "c2", sessionUuid: "x" }], visibleCampaignIds: ["c1", "c2"] }))
      .toEqual({ kind: "refuse", reason: "ambiguous" });
  });
  it("no open session: held for the single visible campaign, else refuse", () => {
    expect(routeNote({ openSessions: [], visibleCampaignIds: ["c1"] })).toEqual({ kind: "held", campaignId: "c1" });
    expect(routeNote({ openSessions: [], visibleCampaignIds: ["c1", "c2"] })).toEqual({ kind: "refuse", reason: "ambiguous" });
    expect(routeNote({ openSessions: [], visibleCampaignIds: [] })).toEqual({ kind: "refuse", reason: "none" });
  });
});

describe("adoptHeldUpdate (Review Focus 5)", () => {
  it("stamps every held note and leaves filed ones alone", () => {
    const notes = normalizeNotes({ a: { text: "a", authorId: "u", at: 1 }, b: { text: "b", authorId: "u", at: 2, sessionUuid: "x" } });
    expect(adoptHeldUpdate(notes, S)).toEqual({ [`flags.${P}.notes.a.sessionUuid`]: S });
    expect(adoptHeldUpdate(notes.filter((n) => n.id === "b"), S)).toBeNull();
  });
});
```

`test/recap-draft.test.js`:

```js
import { describe, it, expect } from "vitest";
import { recapDraft } from "../scripts/logic/recap-draft.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

describe("recapDraft", () => {
  const formatTime = (ms) => `T${ms}`;
  it("one paragraph per live note in order, author and time bolded, text kept as stored HTML", () => {
    const notes = normalizeNotes({
      b: { text: "second @UUID[JournalEntry.x]{X}", authorId: "u2", authorName: "Kim", at: 2 },
      a: { text: "first", authorId: "u1", authorName: "Jo", at: 1 },
      r: { text: "gone", authorId: "gm", authorName: "GM", at: 3, kind: "reveal", retracted: 4 }
    });
    expect(recapDraft(notes, { formatTime })).toBe(
      "<p><strong>T1 Jo</strong> first</p><p><strong>T2 Kim</strong> second @UUID[JournalEntry.x]{X}</p>"
    );
  });
  it("empty string for no notes", () => expect(recapDraft([], { formatTime })).toBe(""));
  it("escapes an author name", () => {
    const notes = normalizeNotes({ a: { text: "t", authorId: "u", authorName: "<b>", at: 1 } });
    expect(recapDraft(notes, { formatTime })).toBe("<p><strong>T1 &lt;b&gt;</strong> t</p>");
  });
});
```

Append to `test/attendee-player.test.js`:

```js
import { attendeeUuidsFor } from "../scripts/logic/attendee-player.mjs";

describe("attendeeUuidsFor (spec item 9: attendees default to connected players)", () => {
  const users = [
    { id: "gm", isGM: true, character: { uuid: "Actor.gmpc" } },
    { id: "u1", isGM: false, character: { uuid: "Actor.a1" } },
    { id: "u2", isGM: false, character: null },
    { id: "u3", isGM: false, character: { uuid: "Actor.a3" } }
  ];
  it("adds each non-GM user's character once, keeping what is already there", () => {
    expect(attendeeUuidsFor(users, ["Actor.a3", "Actor.npc"])).toEqual(["Actor.a3", "Actor.npc", "Actor.a1"]);
  });
  it("empty inputs", () => {
    expect(attendeeUuidsFor([], [])).toEqual([]);
    expect(attendeeUuidsFor(users, undefined)).toEqual(["Actor.a1", "Actor.a3"]);
  });
});
```

`test/note-command.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseNoteCommand } from "../scripts/logic/note-command.mjs";

describe("parseNoteCommand", () => {
  it("accepts /note and /n with text", () => {
    expect(parseNoteCommand("/note the duke is lying")).toEqual({ text: "the duke is lying" });
    expect(parseNoteCommand("/n  trailing  ")).toEqual({ text: "trailing" });
    expect(parseNoteCommand("/NOTE caps")).toEqual({ text: "caps" });
  });
  it("rejects other commands, bare command, and prefixes of longer words", () => {
    expect(parseNoteCommand("/roll 1d20")).toBeNull();
    expect(parseNoteCommand("/note")).toBeNull();
    expect(parseNoteCommand("/notes x")).toBeNull();
    expect(parseNoteCommand("/nothing x")).toBeNull();
    expect(parseNoteCommand("plain text")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/current-session.test.js test/recap-draft.test.js test/note-command.test.js test/attendee-player.test.js`
Expected: FAIL — three unresolved imports, and `attendeeUuidsFor` is not exported.

- [ ] **Step 3: Implement**

`scripts/logic/current-session.mjs`:

```js
// Pure rules for the one open session per campaign (spec 2026-10-15 item 2,
// §9 calls). Foundry wiring: hooks/current-session.mjs.
import { MODULE_ID, CAMPAIGN_FLAG, CURRENT_SESSION_KEY, NOTES_FLAG } from "../constants.mjs";
import { campaignFlagOf } from "./campaigns.mjs";
import { heldNotes } from "./notes.mjs";

export function currentSession(campaign) {
  const cs = campaignFlagOf(campaign)?.[CURRENT_SESSION_KEY];
  return cs && typeof cs.uuid === "string" ? { uuid: cs.uuid, startedAt: typeof cs.startedAt === "number" ? cs.startedAt : 0 } : null;
}

export const currentSessionUpdate = (uuid, now) => ({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}.${CURRENT_SESSION_KEY}`]: { uuid, startedAt: now } });
export const clearCurrentSessionUpdate = () => ({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}.-=${CURRENT_SESSION_KEY}`]: null });

export function nextSessionNumber(numbers) {
  const max = Math.max(0, ...(numbers ?? []).filter((n) => typeof n === "number"));
  return max + 1;
}

export function startedToday(startedAt, now) {
  if (typeof startedAt !== "number") return false;
  const a = new Date(startedAt);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Grant OWNER on the session entry to `userIds` that lack it. Adds only (Review Focus 4). */
export function recapOwnershipUpdate(ownership, userIds, { ownerLevel }) {
  const update = {};
  for (const id of userIds ?? []) {
    if ((ownership?.[id] ?? -1) < ownerLevel) update[`ownership.${id}`] = ownerLevel;
  }
  return Object.keys(update).length ? update : null;
}

/** Where a `/note` goes (spec §9): the one open session; else held for the one visible campaign; else refuse. */
export function routeNote({ openSessions, visibleCampaignIds }) {
  const open = openSessions ?? [];
  if (open.length === 1) return { kind: "session", campaignId: open[0].campaignId, sessionUuid: open[0].sessionUuid };
  if (open.length > 1) return { kind: "refuse", reason: "ambiguous" };
  const visible = visibleCampaignIds ?? [];
  if (visible.length === 1) return { kind: "held", campaignId: visible[0] };
  return { kind: "refuse", reason: visible.length ? "ambiguous" : "none" };
}

/** Stamp every held note of this campaign's entry with the session that just started. */
export function adoptHeldUpdate(notes, sessionUuid) {
  const update = {};
  for (const n of heldNotes(notes)) update[`flags.${MODULE_ID}.${NOTES_FLAG}.${n.id}.sessionUuid`] = sessionUuid;
  return Object.keys(update).length ? update : null;
}
```

`scripts/logic/recap-draft.mjs`:

```js
// Recap draft from a session's notes (spec item 1a). Note text is stored
// escaped+linked HTML (hooks/note-links.mjs), so it is emitted as-is; the
// author name is escaped here.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function recapDraft(notes, { formatTime }) {
  return (notes ?? [])
    .filter((n) => n.retracted === null)
    .map((n) => `<p><strong>${esc(formatTime(n.at))} ${esc(n.authorName || n.authorId)}</strong> ${n.text}</p>`)
    .join("");
}
```

Append to `scripts/logic/attendee-player.mjs`:

```js
/** `current` attendee uuids plus every non-GM user's assigned character, once each (spec 2026-10-15 item 9). */
export function attendeeUuidsFor(users, current) {
  const out = [...(current ?? [])];
  for (const u of users ?? []) {
    const uuid = !u.isGM ? u.character?.uuid : null;
    if (uuid && !out.includes(uuid)) out.push(uuid);
  }
  return out;
}
```

`scripts/logic/note-command.mjs`:

```js
// `/note <text>` and `/n <text>` (spec item 3). Pure; the chat hook is in hooks/note-command.mjs.
const RE = /^\/(?:note|n)\s+(\S[\s\S]*)$/i;

export function parseNoteCommand(message) {
  const m = typeof message === "string" ? message.match(RE) : null;
  if (!m) return null;
  const text = m[1].trim();
  return text ? { text } : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/current-session.test.js test/recap-draft.test.js test/note-command.test.js test/attendee-player.test.js`
Expected: PASS (15 new tests plus the file's existing ones).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/current-session.mjs scripts/logic/recap-draft.mjs scripts/logic/note-command.mjs scripts/logic/attendee-player.mjs test/current-session.test.js test/recap-draft.test.js test/note-command.test.js test/attendee-player.test.js
git commit -m "feat(session): pure current-session rules, note routing, recap draft, /note parser, attendee defaults"
```

---

### Task 4: Start / End session, live recap ownership, login offer, `autoStartSession` setting

**Files:**
- Create: `scripts/hooks/current-session.mjs`
- Modify: `scripts/campaign-companion.mjs` (settings block after line 128), `scripts/integrations/mej-adapter.mjs` (register after the notes-entry step), `lang/en.json`
- Test: `test/current-session-hook.test.js` (the pure `grantForConnectedUser` seam)

**Interfaces:**
- Consumes: Task 1–3; `buildSessionPageData` (`logic/session-page-data.mjs`), `openSessionPage` (`integrations/mej-adapter.mjs`), `currentWorldComponents` (`logic/campaign-calendar.mjs`), `baselineOwnership`, `getCampaigns` (`data/campaign-store.mjs`), `sessionData` (`sheets/session-data.mjs`), `readNotes`, `notesEntryOf` (Task 2).
- Produces:
  - `openSessionPage(campaign): JournalEntryPage|null` — the current session's page; a stale uuid reads as null
  - `openSessions(): { campaign, page }[]` across every campaign the user can see
  - `startSession(campaign, { sessionUuid = null } = {}): Promise<JournalEntryPage|null>` (GM-only) — also sets the Session's attendees to the connected non-GM users' assigned characters via `attendeeUuidsFor`, keeping any the GM already listed
  - `endSession(campaign): Promise<void>` (GM-only; clears, offers the draft)
  - the `userConnected` hook appends a late joiner's character to the open session's attendees (GM can still edit the list on the sheet)
  - `grantForConnectedUser(userId, sessions, { ownerLevel, baselineOf }): { entry, update }[]` pure helper
  - `registerCurrentSession()`

- [ ] **Step 1: Write the failing test for the pure seam**

`test/current-session-hook.test.js`:

```js
import { describe, it, expect } from "vitest";
import { grantForConnectedUser } from "../scripts/hooks/current-session.mjs";

describe("grantForConnectedUser (Review Focus 4)", () => {
  const entry = (ownership) => ({ id: "e", ownership });
  it("grants on sessions whose campaign baseline allows viewing", () => {
    const sessions = [{ campaign: { id: "c1" }, entry: entry({ default: 2 }) }, { campaign: { id: "c2" }, entry: entry({ default: 0 }) }];
    const out = grantForConnectedUser("u1", sessions, { ownerLevel: 3, baselineOf: (c) => (c.id === "c1" ? 2 : 0) });
    expect(out).toEqual([{ entry: sessions[0].entry, update: { "ownership.u1": 3 } }]);
  });
  it("nothing when already an owner", () => {
    const sessions = [{ campaign: { id: "c1" }, entry: entry({ default: 2, u1: 3 }) }];
    expect(grantForConnectedUser("u1", sessions, { ownerLevel: 3, baselineOf: () => 2 })).toEqual([]);
  });
});
```

The hook module imports Foundry-served modules, so to keep it vitest-loadable the pure function lives at the top of the file and the Foundry imports are dynamic inside the functions that need them (see Step 3).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/current-session-hook.test.js`
Expected: FAIL — cannot resolve `hooks/current-session.mjs`.

- [ ] **Step 3: Implement**

`scripts/hooks/current-session.mjs`:

```js
// Start / End session (spec 2026-10-15 item 2; §9 recap ownership on users,
// added live). GM-only writers; the login offer runs on the writer seat.
// Pure helpers at the top keep this file importable by vitest: everything
// Foundry-served is imported lazily inside the functions that run in-game.
import { MODULE_ID, I18N, AUTO_START_SESSION_SETTING } from "../constants.mjs";
import { currentSession, currentSessionUpdate, clearCurrentSessionUpdate, nextSessionNumber, startedToday, recapOwnershipUpdate, adoptHeldUpdate } from "../logic/current-session.mjs";
import { recapDraft } from "../logic/recap-draft.mjs";
import { notesForSession } from "../logic/notes.mjs";
import { attendeeUuidsFor } from "../logic/attendee-player.mjs";

const connectedPlayers = () => game.users.filter((u) => u.active && !u.isGM);

/** Attendee update for the session page, or null when every connected character is already listed. */
async function attendeeUpdateFor(page, users) {
  const { sessionData } = await import("../sheets/session-data.mjs");
  const current = sessionData(page).attendees;
  const next = attendeeUuidsFor(users, current);
  return next.length === current.length ? null : { [`flags.${MODULE_ID}.session.attendees`]: next };
}

/** Session entries a newly connected player should own: those whose campaign baseline lets players view. */
export function grantForConnectedUser(userId, sessions, { ownerLevel, baselineOf }) {
  const out = [];
  for (const { campaign, entry } of sessions ?? []) {
    if (baselineOf(campaign) < 2) continue;
    const update = recapOwnershipUpdate(entry.ownership, [userId], { ownerLevel });
    if (update) out.push({ entry, update });
  }
  return out;
}

export function openSessionPage(campaign) {
  const cs = currentSession(campaign);
  if (!cs) return null;
  try {
    const page = fromUuidSync(cs.uuid);
    return page?.documentName === "JournalEntryPage" ? page : null;
  } catch {
    return null;
  }
}

export async function openSessions() {
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const { isVisibleToUser } = await import("../logic/hub-index.mjs");
  return getCampaigns()
    .map((campaign) => ({ campaign, page: openSessionPage(campaign) }))
    .filter(({ page }) => page && isVisibleToUser(page.parent, game.user));
}

const connectedPlayerIds = () => connectedPlayers().map((u) => u.id);

async function createSessionFor(campaign) {
  const { buildSessionPageData } = await import("../logic/session-page-data.mjs");
  const { baselineOwnership } = await import("../data/campaign-store.mjs");
  const { currentWorldComponents } = await import("../logic/campaign-calendar.mjs");
  const { sessionData } = await import("../sheets/session-data.mjs");
  const { SESSION_DOCUMENT_TYPE } = await import("../constants.mjs");
  const numbers = campaign.contents.flatMap((e) => e.pages.contents)
    .filter((p) => p.type === SESSION_DOCUMENT_TYPE || p._source?.type === SESSION_DOCUMENT_TYPE)
    .map((p) => sessionData(p).sessionNumber);
  const n = nextSessionNumber(numbers);
  const name = game.i18n.format(`${I18N}.session.autoName`, { n });
  const entry = await JournalEntry.create({
    name, folder: campaign.id, ownership: { default: baselineOwnership(campaign) },
    pages: [buildSessionPageData(name, "", currentWorldComponents(), n)]
  });
  return entry?.pages?.contents?.[0] ?? null;
}

/** GM-only. Open a session: create (or promote `sessionUuid`), flag the campaign, grant recap ownership, adopt held notes. */
export async function startSession(campaign, { sessionUuid = null } = {}) {
  if (!game.user.isGM || !campaign) return null;
  const { baselineOwnership } = await import("../data/campaign-store.mjs");
  const { notesEntryOf, readNotes } = await import("../data/notes-store.mjs");
  const { openSessionPage: open } = await import("../integrations/mej-adapter.mjs");
  let page = sessionUuid ? await fromUuid(sessionUuid) : null;
  if (!page) page = await createSessionFor(campaign);
  if (!page) return null;
  await campaign.update(currentSessionUpdate(page.uuid, Date.now()));
  if (baselineOwnership(campaign) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
    const update = recapOwnershipUpdate(page.parent.ownership, connectedPlayerIds(), { ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    if (update) await page.parent.update(update);
  }
  // Spec item 9: attendees default to the connected players' characters; the GM edits the list on the sheet afterwards.
  const attendees = await attendeeUpdateFor(page, connectedPlayers());
  if (attendees) await page.update(attendees);
  const notesEntry = notesEntryOf(campaign);
  const adopt = notesEntry ? adoptHeldUpdate(readNotes(campaign), page.uuid) : null;
  if (adopt) await notesEntry.update(adopt);
  await open(page);
  return page;
}

/** GM-only. Clear the open session and offer a recap draft built from its notes (deviation 1: applied from a dialog). */
export async function endSession(campaign) {
  if (!game.user.isGM || !campaign) return;
  const page = openSessionPage(campaign);
  await campaign.update(clearCurrentSessionUpdate());
  if (!page) return;
  const { readNotes } = await import("../data/notes-store.mjs");
  const draft = recapDraft(notesForSession(readNotes(campaign), page.uuid), {
    formatTime: (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  });
  if (!draft) return;
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(draft, { relativeTo: page, async: true });
  const append = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${I18N}.session.draftTitle`) },
    content: `<p>${game.i18n.localize(`${I18N}.session.draftHint`)}</p><div class="mej-cc-draft-preview">${enriched}</div>`,
    yes: { label: game.i18n.localize(`${I18N}.session.draftAppend`) },
    no: { label: game.i18n.localize(`${I18N}.session.draftSkip`) },
    rejectClose: false
  });
  if (!append) return;
  const current = page.system?.recap ?? "";
  await page.update({ "system.recap": `${current}${draft}` });
  ui.notifications.info(game.i18n.localize(`${I18N}.session.draftAppended`));
}

async function offerStartOnLogin() {
  if (!game.settings.get(MODULE_ID, AUTO_START_SESSION_SETTING)) return;
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const now = Date.now();
  for (const campaign of getCampaigns()) {
    if (currentSession(campaign)) continue;
    const last = campaign.getFlag(MODULE_ID, "campaign")?.lastSessionStartedAt ?? null;
    if (startedToday(last, now)) continue;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.session.start`) },
      content: `<p>${game.i18n.format(`${I18N}.session.startOffer`, { campaign: foundry.utils.escapeHTML(campaign.name) })}</p>`,
      rejectClose: false
    });
    if (ok) await startSession(campaign);
  }
}

export function registerCurrentSession() {
  const writerSeat = () => game.user.isGM && game.user === game.users.activeGM;
  Hooks.on("userConnected", async (user, connected) => {
    if (!connected || user.isGM || !writerSeat()) return;
    try {
      const { baselineOwnership } = await import("../data/campaign-store.mjs");
      const open = await openSessions();
      const sessions = open.map(({ campaign, page }) => ({ campaign, entry: page.parent }));
      for (const { entry, update } of grantForConnectedUser(user.id, sessions, { ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, baselineOf: baselineOwnership })) {
        await entry.update(update);
      }
      // Late joiner with a character: append to every open session's attendees.
      for (const { page } of open) {
        const attendees = await attendeeUpdateFor(page, [user]);
        if (attendees) await page.update(attendees);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recap ownership grant failed`, err);
    }
  });
  // Remember when a session last started, for the login offer.
  Hooks.on("updateFolder", (folder, changes) => {
    const cs = changes?.flags?.[MODULE_ID]?.campaign?.currentSession;
    if (!writerSeat() || !cs?.startedAt) return;
    folder.update({ [`flags.${MODULE_ID}.campaign.lastSessionStartedAt`]: cs.startedAt }).catch(() => {});
  });
  const readyPass = () => {
    if (!writerSeat()) return;
    offerStartOnLogin().catch((err) => console.error(`${MODULE_ID} | start-session offer failed`, err));
  };
  if (game.ready) readyPass();
  else Hooks.once("ready", readyPass);
}
```

Register in `scripts/integrations/mej-adapter.mjs` after the notes-entry step:

```js
  await step("current session", async () => {
    const { registerCurrentSession } = await import("../hooks/current-session.mjs");
    registerCurrentSession();
  });
```

Setting, in `scripts/campaign-companion.mjs` after the `PLAYERS_WRITE_SESSIONS_SETTING` block (import `AUTO_START_SESSION_SETTING` on line 6):

```js
  // Spec 2026-10-15 §5.1: offer to start a session when the GM logs in on a new day. Off by default.
  game.settings.register(MODULE_ID, AUTO_START_SESSION_SETTING, {
    name: `${I18N}.settings.autoStartSession.name`,
    hint: `${I18N}.settings.autoStartSession.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
```

`lang/en.json` additions — under `settings`:

```json
"autoStartSession": {
  "name": "Offer to start a session at login",
  "hint": "When a GM logs in and no session is open in a campaign that hasn't had one today, ask whether to start one."
}
```

under `session`:

```json
"autoName": "Session {n}",
"start": "Start session",
"end": "End session",
"startOffer": "Start a session in {campaign} now?",
"draftTitle": "Recap draft",
"draftHint": "Assembled from tonight's notes. Append it to the recap to edit it there, or skip.",
"draftAppend": "Append to recap",
"draftSkip": "Not now",
"draftAppended": "Draft appended to the recap."
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/current-session-hook.test.js`
Expected: PASS, 2 tests. Then `npx vitest run` — all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/current-session.mjs scripts/campaign-companion.mjs scripts/integrations/mej-adapter.mjs lang/en.json test/current-session-hook.test.js
git commit -m "feat(session): start/end session, live recap ownership, login offer"
```

---

### Task 5: `/note` chat command

**Files:**
- Create: `scripts/hooks/note-command.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (register), `lang/en.json`
- Test: `test/note-command-handler.test.js`

**Interfaces:**
- Consumes: `parseNoteCommand` (Task 3), `routeNote`, `openSessions` (Task 4), `addNote`, `NotesStoreError` (Task 2), `linkNoteText` (Task 2).
- Produces:
  - `handleNoteCommand(text, env): Promise<{ ok: boolean, key: string, data?: object }>` — pure-ish handler taking an injected env `{ openSessions, visibleCampaignIds, addNote, link, worldDate }`; the hook wires the real env
  - `registerNoteCommand()`

- [ ] **Step 1: Write the failing test**

`test/note-command-handler.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { handleNoteCommand } from "../scripts/hooks/note-command.mjs";

const env = (over = {}) => ({
  openSessions: [{ campaignId: "c1", sessionUuid: "S" }],
  visibleCampaignIds: ["c1"],
  addNote: vi.fn(async (campaignId, fields) => ({ id: "n1", ...fields })),
  link: (campaignId, text) => `${text}!`,
  worldDate: null,
  ...over
});

describe("handleNoteCommand", () => {
  it("files into the open session with linked text", async () => {
    const e = env();
    const r = await handleNoteCommand("duke lies", e);
    expect(e.addNote).toHaveBeenCalledWith("c1", expect.objectContaining({ text: "duke lies!", sessionUuid: "S", kind: "player" }));
    expect(r).toEqual({ ok: true, key: "filed", data: { session: "S" } });
  });
  it("holds when no session is open and one campaign is visible", async () => {
    const e = env({ openSessions: [] });
    const r = await handleNoteCommand("x", e);
    expect(e.addNote).toHaveBeenCalledWith("c1", expect.objectContaining({ sessionUuid: null }));
    expect(r).toEqual({ ok: true, key: "held", data: {} });
  });
  it("refuses two open sessions (Review Focus 3) and no campaign", async () => {
    expect(await handleNoteCommand("x", env({ openSessions: [{ campaignId: "c1", sessionUuid: "a" }, { campaignId: "c2", sessionUuid: "b" }] })))
      .toEqual({ ok: false, key: "ambiguous" });
    expect(await handleNoteCommand("x", env({ openSessions: [], visibleCampaignIds: [] }))).toEqual({ ok: false, key: "none" });
  });
  it("maps a store error to its reason", async () => {
    const e = env({ addNote: vi.fn(async () => { const err = new Error("x"); err.reason = "noEntry"; throw err; }) });
    expect(await handleNoteCommand("x", e)).toEqual({ ok: false, key: "noEntry" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/note-command-handler.test.js`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement**

`scripts/hooks/note-command.mjs`:

```js
// `/note <text>` (spec 2026-10-15 item 3). The handler takes an injected env
// so the routing and error mapping are unit-tested; registerNoteCommand
// builds the real env from Foundry.
import { MODULE_ID, I18N } from "../constants.mjs";
import { parseNoteCommand } from "../logic/note-command.mjs";
import { routeNote } from "../logic/current-session.mjs";

export async function handleNoteCommand(text, env) {
  const route = routeNote({ openSessions: env.openSessions, visibleCampaignIds: env.visibleCampaignIds });
  if (route.kind === "refuse") return { ok: false, key: route.reason };
  const sessionUuid = route.kind === "session" ? route.sessionUuid : null;
  try {
    await env.addNote(route.campaignId, {
      text: env.link(route.campaignId, text), sessionUuid, kind: "player", worldDate: env.worldDate ?? null
    });
  } catch (err) {
    return { ok: false, key: err?.reason ?? "writeFailed" };
  }
  return route.kind === "session" ? { ok: true, key: "filed", data: { session: sessionUuid } } : { ok: true, key: "held", data: {} };
}

async function realEnv() {
  const { openSessions } = await import("./current-session.mjs");
  const { getCampaigns } = await import("../data/campaign-store.mjs");
  const { notesEntryOf, addNote } = await import("../data/notes-store.mjs");
  const { linkNoteText } = await import("./note-links.mjs");
  const { currentWorldComponents } = await import("../logic/campaign-calendar.mjs");
  const open = (await openSessions()).map(({ campaign, page }) => ({ campaignId: campaign.id, sessionUuid: page.uuid }));
  // "Visible" for routing = campaigns whose notes entry this user can read (GM: all).
  const visible = getCampaigns().filter((c) => {
    const e = notesEntryOf(c);
    return e && (game.user.isGM || e.testUserPermission(game.user, "OBSERVER"));
  }).map((c) => c.id);
  return {
    openSessions: open, visibleCampaignIds: visible,
    addNote: (campaignId, fields) => addNote(campaignId, fields),
    link: (campaignId, text) => linkNoteText(game.folders.get(campaignId), text),
    worldDate: currentWorldComponents()
  };
}

async function echo(result) {
  const key = result.ok ? `notes.command.${result.key}` : `notes.${result.key === "none" || result.key === "ambiguous" ? `command.${result.key}` : result.key}`;
  let name = "";
  if (result.ok && result.data?.session) {
    try { name = fromUuidSync(result.data.session)?.name ?? ""; } catch { name = ""; }
  }
  const content = `<p class="mej-cc-note-echo">${game.i18n.format(`${I18N}.${key}`, { session: foundry.utils.escapeHTML(name) })}</p>`;
  await ChatMessage.implementation.create({ content, whisper: [game.user.id] });
}

export function registerNoteCommand() {
  Hooks.on("chatMessage", (log, message) => {
    const parsed = parseNoteCommand(message);
    if (!parsed) return true;
    (async () => {
      try {
        await echo(await handleNoteCommand(parsed.text, await realEnv()));
      } catch (err) {
        console.error(`${MODULE_ID} | /note failed`, err);
        ui.notifications.warn(game.i18n.localize(`${I18N}.notes.writeFailed`));
      }
    })();
    return false;
  });
}
```

Register in `mej-adapter.mjs` after the current-session step:

```js
  await step("note command", async () => {
    const { registerNoteCommand } = await import("../hooks/note-command.mjs");
    registerNoteCommand();
  });
```

`lang/en.json`, inside `notes`:

```json
"command": {
  "filed": "Noted in {session}.",
  "held": "Noted. No session is open yet — it will join the next one your GM starts.",
  "ambiguous": "More than one campaign could take that note. Open the one you mean and use its capture box.",
  "none": "You aren't in a campaign that takes notes yet."
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/note-command-handler.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/note-command.mjs scripts/integrations/mej-adapter.mjs lang/en.json test/note-command-handler.test.js
git commit -m "feat(notes): /note chat command with routing and whispered echo"
```

---

### Task 6: Tonight strip in the Hub

**Files:**
- Create: `scripts/logic/tonight.mjs`, `templates/hub-tonight.hbs`
- Modify: `scripts/apps/CampaignHubPage.mjs` (actions list lines 164-201; `_prepareBodyContext` after line 418; `activateListeners`), `templates/hub.hbs:4` (partial after the header), `scripts/campaign-companion.mjs:35-37` (preload), `styles/campaign-companion.css`, `lang/en.json`
- Test: `test/tonight.test.js`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `tonightContext({ campaign, session, notes, user, now, formatTime, nameOf }): object|null` — null when no campaign; else `{ campaignName, open, sessionName, sessionUuid, startedLabel, noteCount, heldCount, recent: [{id, authorName, timeLabel, text}], canCapture, canStart, canEnd }`
  - Hub actions `startSession`, `endSession`; a capture input `input[name="tonight-note"]` that files on Enter
  - Partial `hub-tonight.hbs` expecting `tonight` in context; Plan A's header work does not touch it

- [ ] **Step 1: Write the failing test**

`test/tonight.test.js`:

```js
import { describe, it, expect } from "vitest";
import { tonightContext } from "../scripts/logic/tonight.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

const S = "JournalEntry.s.JournalEntryPage.p";
const notes = normalizeNotes({
  a: { text: "a", authorId: "u1", authorName: "Jo", at: 1, sessionUuid: S },
  b: { text: "b", authorId: "u1", authorName: "Jo", at: 2, sessionUuid: S },
  c: { text: "c", authorId: "u1", authorName: "Jo", at: 3, sessionUuid: S },
  d: { text: "d", authorId: "u1", authorName: "Jo", at: 4, sessionUuid: S },
  held: { text: "h", authorId: "u1", authorName: "Jo", at: 5 }
});
const base = { campaign: { name: "Vale" }, user: { isGM: false, id: "u1" }, now: 10, formatTime: (ms) => `T${ms}`, nameOf: (id) => id, canWrite: true };

describe("tonightContext", () => {
  it("null without a campaign", () => expect(tonightContext({ ...base, campaign: null, notes, session: null })).toBeNull());
  it("open session: last three notes newest first, counts, player cannot start/end", () => {
    const ctx = tonightContext({ ...base, notes, session: { uuid: S, name: "Session 3", startedAt: 1 } });
    expect(ctx).toMatchObject({ campaignName: "Vale", open: true, sessionName: "Session 3", sessionUuid: S, startedLabel: "T1", noteCount: 4, heldCount: 1, canCapture: true, canStart: false, canEnd: false });
    expect(ctx.recent.map((n) => n.id)).toEqual(["d", "c", "b"]);
    expect(ctx.recent[0]).toEqual({ id: "d", authorName: "Jo", timeLabel: "T4", text: "d" });
  });
  it("no session: GM can start; held count shows; capture allowed when writable", () => {
    const ctx = tonightContext({ ...base, user: { isGM: true, id: "gm" }, notes, session: null });
    expect(ctx).toMatchObject({ open: false, canStart: true, canEnd: false, heldCount: 1, canCapture: true, recent: [] });
  });
  it("GM with an open session can end it; a non-writer cannot capture", () => {
    expect(tonightContext({ ...base, user: { isGM: true, id: "gm" }, notes, session: { uuid: S, name: "S", startedAt: 1 } })).toMatchObject({ canEnd: true, canStart: false });
    expect(tonightContext({ ...base, canWrite: false, notes, session: null }).canCapture).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tonight.test.js`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement the view model**

`scripts/logic/tonight.mjs`:

```js
// View model for the Tonight strip (spec 2026-10-15 §5.1). Pure.
import { notesForSession, heldNotes } from "./notes.mjs";

export function tonightContext({ campaign, session, notes, user, formatTime, canWrite }) {
  if (!campaign) return null;
  const open = !!session;
  const own = open ? notesForSession(notes, session.uuid) : [];
  const recent = [...own].sort((a, b) => b.at - a.at).slice(0, 3)
    .map((n) => ({ id: n.id, authorName: n.authorName || n.authorId, timeLabel: formatTime(n.at), text: n.text }));
  return {
    campaignName: campaign.name,
    open,
    sessionName: open ? session.name : "",
    sessionUuid: open ? session.uuid : null,
    startedLabel: open ? formatTime(session.startedAt) : "",
    noteCount: own.length,
    heldCount: heldNotes(notes).length,
    recent,
    canCapture: canWrite === true,
    canStart: user.isGM === true && !open,
    canEnd: user.isGM === true && open
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/tonight.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Template, Hub wiring, styles**

`templates/hub-tonight.hbs`:

```hbs
{{#if tonight}}
<section class="mej-cc-tonight{{#unless tonight.open}} closed{{/unless}}" data-cc-tonight>
    <div class="mej-cc-tonight-head">
        {{#if tonight.open}}
        <span class="mej-cc-tonight-title"><i class="fa-solid fa-dice-d20"></i> {{tonight.sessionName}}</span>
        <span class="mej-cc-tonight-meta">{{localize "MEJCampaignCompanion.notes.tonight.started" time=tonight.startedLabel}} · {{localize "MEJCampaignCompanion.notes.tonight.count" count=tonight.noteCount}}</span>
        {{#if tonight.canEnd}}<button type="button" class="mej-cc-tonight-end" data-action="endSession"><i class="fa-solid fa-flag-checkered"></i> {{localize "MEJCampaignCompanion.session.end"}}</button>{{/if}}
        {{else}}
        <span class="mej-cc-tonight-title mej-cc-tonight-none">{{localize "MEJCampaignCompanion.notes.tonight.none"}}</span>
        {{#if tonight.heldCount}}<span class="mej-cc-tonight-meta">{{localize "MEJCampaignCompanion.notes.tonight.held" count=tonight.heldCount}}</span>{{/if}}
        {{#if tonight.canStart}}<button type="button" class="mej-cc-tonight-start" data-action="startSession"><i class="fa-solid fa-play"></i> {{localize "MEJCampaignCompanion.session.start"}}</button>{{/if}}
        {{/if}}
    </div>
    {{#if tonight.canCapture}}
    <div class="mej-cc-tonight-capture">
        <input type="text" name="tonight-note" autocomplete="off" maxlength="2000"
               placeholder="{{localize 'MEJCampaignCompanion.notes.capturePlaceholder'}}" />
        <button type="button" data-action="captureTonightNote" data-tooltip="{{localize 'MEJCampaignCompanion.notes.capture'}}"><i class="fa-solid fa-paper-plane"></i></button>
    </div>
    {{/if}}
    {{#if tonight.recent.length}}
    <ol class="mej-cc-tonight-recent">
        {{#each tonight.recent}}
        <li><span class="mej-cc-note-meta">{{this.timeLabel}} {{this.authorName}}</span> <span class="mej-cc-note-text">{{{this.text}}}</span></li>
        {{/each}}
    </ol>
    {{/if}}
</section>
{{/if}}
```

Note: `{{{this.text}}}` is safe because note text is stored escaped+linked by `linkNoteText` and the Hub enriches it (Step 5c below) before rendering.

In `templates/hub.hbs`, after line 4 (`{{> ...hub-header.hbs}}`) add:

```hbs
            {{> "modules/mej-campaign-companion/templates/hub-tonight.hbs"}}
```

In `scripts/campaign-companion.mjs` lines 35-37 preload both partials:

```js
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/hub-header.hbs`,
    `modules/${MODULE_ID}/templates/hub-tonight.hbs`
  ]);
```

In `scripts/apps/CampaignHubPage.mjs`:

(a) imports, after line 50:

```js
import { tonightContext } from "../logic/tonight.mjs";
import { currentSession } from "../logic/current-session.mjs";
import { listNotes, notesEntryOf, addNote } from "../data/notes-store.mjs";
import { linkNoteText } from "../hooks/note-links.mjs";
import { startSession, endSession, openSessionPage } from "../hooks/current-session.mjs";
import { currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { validNoteText } from "../logic/notes.mjs";
```

(b) actions, inside `DEFAULT_OPTIONS.actions` after `linkMentions`:

```js
      startSession: CampaignHubPage.onStartSession,
      endSession: CampaignHubPage.onEndSession,
      captureTonightNote: CampaignHubPage.onCaptureTonightNote
```

(c) context, in `_prepareBodyContext` right after `context.campaignControls = ...` (line 418):

```js
    context.tonight = await this.#tonightContext(campaign);
```

and the new private method next to `#scope()`:

```js
  /** The strip's campaign: the scope's campaign, else the only campaign this user can see (spec §5.1). */
  #tonightCampaign(scopedCampaign) {
    if (scopedCampaign) return scopedCampaign;
    const visible = getCampaigns().filter((c) => !!notesEntryOf(c) && (game.user.isGM || notesEntryOf(c).testUserPermission(game.user, "OBSERVER")));
    return visible.length === 1 ? visible[0] : null;
  }

  async #tonightContext(scopedCampaign) {
    const campaign = this.#tonightCampaign(scopedCampaign);
    if (!campaign) return null;
    const page = openSessionPage(campaign);
    const cs = currentSession(campaign);
    const session = page && cs ? { uuid: page.uuid, name: page.name, startedAt: cs.startedAt } : null;
    const notes = listNotes(campaign);
    const entry = notesEntryOf(campaign);
    const ctx = tonightContext({
      campaign, session, notes, user: game.user,
      formatTime: (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      canWrite: !!entry?.isOwner
    });
    if (!ctx) return null;
    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { async: true });
    ctx.recent = await Promise.all(ctx.recent.map(async (n) => ({ ...n, text: await enrich(n.text) })));
    ctx.campaignId = campaign.id;
    return ctx;
  }
```

(d) actions, after `onNewSession`:

```js
  static async onStartSession() {
    if (!game.user.isGM) return;
    const campaign = this.#tonightCampaign(this.#scope().campaign) ?? await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.session.start`), { alwaysPrompt: true });
    if (!campaign) return;
    try {
      await startSession(campaign);
    } catch (err) {
      console.error(`${MODULE_ID} | start session failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.hub.newSessionFailed`));
    }
    this.render();
  }

  static async onEndSession() {
    if (!game.user.isGM) return;
    const campaign = this.#tonightCampaign(this.#scope().campaign);
    if (!campaign) return;
    try {
      await endSession(campaign);
    } catch (err) {
      console.error(`${MODULE_ID} | end session failed`, err);
    }
    this.render();
  }

  static async onCaptureTonightNote(event, target) {
    const root = target.closest("[data-cc-tonight]");
    const input = root?.querySelector('input[name="tonight-note"]');
    await this.#captureFromInput(input);
  }

  async #captureFromInput(input) {
    const text = validNoteText(input?.value ?? "");
    if (!text) return;
    const campaign = this.#tonightCampaign(this.#scope().campaign);
    if (!campaign) return;
    const page = openSessionPage(campaign);
    try {
      await addNote(campaign, { text: linkNoteText(campaign, text), sessionUuid: page?.uuid ?? null, worldDate: currentWorldComponents() });
      input.value = "";
      ui.notifications.info(game.i18n.localize(page ? `${I18N}.notes.captured` : `${I18N}.notes.command.held`));
    } catch (err) {
      const key = err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`;
      ui.notifications.warn(game.i18n.localize(key));
    }
    this.render();
  }
```

(e) Enter-to-capture, in `activateListeners(html)` (find the existing method; add at its end):

```js
    $('input[name="tonight-note"]', html).on("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#captureFromInput(event.currentTarget);
    });
```

(f) `styles/campaign-companion.css`, append:

```css
/* Tonight strip (spec 2026-10-15 §5.1) */
.mej-cc-tonight { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; margin: 0 0 6px; border: 1px solid var(--mej-cc-chip-bg, rgba(255,255,255,.12)); border-radius: 4px; color: var(--mej-cc-ink); }
.mej-cc-tonight-head { display: flex; align-items: center; gap: 10px; }
.mej-cc-tonight-title { font-weight: 700; }
.mej-cc-tonight-none { opacity: .8; font-weight: 400; }
.mej-cc-tonight-meta { color: var(--mej-cc-ink-muted); font-size: .9em; flex: 1; }
.mej-cc-tonight-capture { display: flex; gap: 4px; }
.mej-cc-tonight-capture input { flex: 1; }
.mej-cc-tonight-recent { list-style: none; margin: 0; padding: 0; font-size: .9em; }
.mej-cc-tonight-recent li { padding: 1px 0; }
.mej-cc-note-meta { color: var(--mej-cc-ink-muted); margin-right: 6px; }
.mej-cc-draft-preview { max-height: 40vh; overflow: auto; border: 1px solid var(--mej-cc-chip-bg, rgba(255,255,255,.12)); padding: 6px; }
```

(g) `lang/en.json`, inside `notes`:

```json
"tonight": {
  "started": "started {time}",
  "count": "{count} notes",
  "none": "No session running",
  "held": "{count} notes waiting for the next session"
},
"capturePlaceholder": "Note something…",
"capture": "Note it",
"captured": "Noted."
```

- [ ] **Step 6: Run the unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/tonight.mjs templates/hub-tonight.hbs templates/hub.hbs scripts/apps/CampaignHubPage.mjs scripts/campaign-companion.mjs styles/campaign-companion.css lang/en.json test/tonight.test.js
git commit -m "feat(hub): Tonight strip with capture box, start and end session"
```

---

### Task 7: Notes stream on the Session page

**Files:**
- Modify: `templates/session.hbs` (Recap tab, after line 55), `scripts/sheets/SessionSheet.mjs` (PARTS templates line 78-83, actions line 61-71, `_prepareBodyContext`, `activateListeners`), `styles/campaign-companion.css`, `lang/en.json`
- Test: `test/notes-stream-rows.test.js` for the pure row builder added to `scripts/logic/tonight.mjs`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `streamRows(notes, user, { formatTime }): { id, authorName, timeLabel, text, edited, canEdit }[]` in `logic/tonight.mjs`
  - Session sheet actions `captureSessionNote`, `editNote`, `deleteNote`; input `input[name="session-note"]`

- [ ] **Step 1: Write the failing test**

`test/notes-stream-rows.test.js`:

```js
import { describe, it, expect } from "vitest";
import { streamRows } from "../scripts/logic/tonight.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

describe("streamRows", () => {
  const notes = normalizeNotes({
    a: { text: "a", authorId: "u1", authorName: "Jo", at: 1, editedAt: 2 },
    b: { text: "b", authorId: "u2", authorName: "Kim", at: 3 }
  });
  it("in order, with edit stamps and per-user canEdit", () => {
    const rows = streamRows(notes, { id: "u1", isGM: false }, { formatTime: (ms) => `T${ms}` });
    expect(rows).toEqual([
      { id: "a", authorName: "Jo", timeLabel: "T1", text: "a", edited: true, canEdit: true },
      { id: "b", authorName: "Kim", timeLabel: "T3", text: "b", edited: false, canEdit: false }
    ]);
  });
  it("GM can edit all", () => {
    expect(streamRows(notes, { id: "gm", isGM: true }, { formatTime: () => "" }).every((r) => r.canEdit)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/notes-stream-rows.test.js`
Expected: FAIL — `streamRows` is not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/tonight.mjs`:

```js
import { canEditNote } from "./notes.mjs";

/** Rows for the Session page's notes stream: oldest first. */
export function streamRows(notes, user, { formatTime }) {
  return [...(notes ?? [])].sort((a, b) => a.at - b.at).map((n) => ({
    id: n.id, authorName: n.authorName || n.authorId, timeLabel: formatTime(n.at), text: n.text,
    edited: n.editedAt !== null, canEdit: canEditNote(n, user)
  }));
}
```

(Move that import to the top of the file with the existing one.)

In `templates/session.hbs`, after the recap `editor-parent` div closes (line 55) and before `</div>` of `tab-inner`, insert:

```hbs
                        {{> "modules/mej-campaign-companion/templates/hub-tonight.hbs"}}
                        <section class="mej-cc-notes-stream">
                            <h3>{{localize 'MEJCampaignCompanion.notes.streamTitle'}}</h3>
                            {{#if notesStream.canWrite}}
                            <div class="mej-cc-tonight-capture">
                                <input type="text" name="session-note" autocomplete="off" maxlength="2000"
                                       placeholder="{{localize 'MEJCampaignCompanion.notes.capturePlaceholder'}}" />
                                <button type="button" data-action="captureSessionNote" data-tooltip="{{localize 'MEJCampaignCompanion.notes.capture'}}"><i class="fa-solid fa-paper-plane"></i></button>
                            </div>
                            {{/if}}
                            <ol class="mej-cc-notes-list">
                                {{#each notesStream.rows}}
                                <li class="mej-cc-note" data-note-id="{{this.id}}">
                                    <span class="mej-cc-note-meta">{{this.timeLabel}} {{this.authorName}}{{#if this.edited}} · {{localize 'MEJCampaignCompanion.notes.edited'}}{{/if}}</span>
                                    <span class="mej-cc-note-text">{{{this.text}}}</span>
                                    {{#if this.canEdit}}
                                    <a class="mej-cc-note-edit" data-action="editNote" data-tooltip="{{localize 'MEJCampaignCompanion.notes.edit'}}"><i class="fa-solid fa-pen"></i></a>
                                    <a class="mej-cc-note-delete" data-action="deleteNote" data-tooltip="{{localize 'MEJCampaignCompanion.notes.delete'}}"><i class="fa-solid fa-trash"></i></a>
                                    {{/if}}
                                </li>
                                {{else}}
                                <li class="instruction">{{localize 'MEJCampaignCompanion.notes.none'}}</li>
                                {{/each}}
                            </ol>
                        </section>
```

In `scripts/sheets/SessionSheet.mjs`:

(a) imports after line 27:

```js
import { campaignOf } from "../logic/campaigns.mjs";
import { listNotes, notesEntryOf, addNote, updateNote, deleteNote } from "../data/notes-store.mjs";
import { linkNoteText } from "../hooks/note-links.mjs";
import { currentSession } from "../logic/current-session.mjs";
import { openSessionPage } from "../hooks/current-session.mjs";
import { tonightContext, streamRows } from "../logic/tonight.mjs";
import { validNoteText } from "../logic/notes.mjs";
import { currentWorldComponents } from "../logic/campaign-calendar.mjs";
```

(b) `PARTS.main.templates` add `` `modules/${MODULE_ID}/templates/hub-tonight.hbs` ``; `scrollable` add `".mej-cc-notes-list"`.

(c) actions:

```js
      captureSessionNote: SessionSheet.onCaptureSessionNote,
      editNote: SessionSheet.onEditNote,
      deleteNote: SessionSheet.onDeleteNote
```

(d) in `_prepareBodyContext`, before `return context;`:

```js
    const campaign = campaignOf(this.document);
    const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: this.document, async: true });
    if (campaign) {
      const entry = notesEntryOf(campaign);
      const rows = streamRows(listNotes(campaign, { sessionUuid: this.document.uuid }), game.user, { formatTime });
      context.notesStream = {
        canWrite: !!entry?.isOwner,
        rows: await Promise.all(rows.map(async (r) => ({ ...r, text: await enrich(r.text) })))
      };
      const open = openSessionPage(campaign);
      const cs = currentSession(campaign);
      const tonight = tonightContext({
        campaign, session: open && cs ? { uuid: open.uuid, name: open.name, startedAt: cs.startedAt } : null,
        notes: listNotes(campaign), user: game.user, formatTime, canWrite: false
      });
      // On a Session page the capture box is the stream's own (below); the strip only reports state.
      context.tonight = tonight;
    } else {
      context.notesStream = { canWrite: false, rows: [] };
      context.tonight = null;
    }
```

(e) actions:

```js
  static async onCaptureSessionNote(event, target) {
    const input = this.trueElement?.querySelector?.('input[name="session-note"]') ?? $('input[name="session-note"]', this.trueElement).get(0);
    await this._captureNote(input);
  }

  async _captureNote(input) {
    const text = validNoteText(input?.value ?? "");
    const campaign = campaignOf(this.document);
    if (!text || !campaign) return;
    try {
      await addNote(campaign, { text: linkNoteText(campaign, text), sessionUuid: this.document.uuid, worldDate: currentWorldComponents() });
      input.value = "";
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    this.render();
  }

  static async onEditNote(event, target) {
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    const campaign = campaignOf(this.document);
    const note = listNotes(campaign, { sessionUuid: this.document.uuid }).find((n) => n.id === id);
    if (!note) return;
    const plain = note.text.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
    const text = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.notes.edit`) },
      content: `<textarea name="text" rows="4" maxlength="2000" style="width:100%">${foundry.utils.escapeHTML(plain)}</textarea>`,
      ok: { label: game.i18n.localize(`${I18N}.hub.save`), callback: (ev, button) => button.form.elements.text.value },
      rejectClose: false
    });
    if (typeof text !== "string") return;
    try {
      await updateNote(campaign, id, { text: linkNoteText(campaign, text) });
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    this.render();
  }

  static async onDeleteNote(event, target) {
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    const campaign = campaignOf(this.document);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.notes.delete`) },
      content: `<p>${game.i18n.localize(`${I18N}.notes.deleteConfirm`)}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    try {
      await deleteNote(campaign, id);
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    this.render();
  }
```

(f) in `activateListeners(html)` add:

```js
    $('input[name="session-note"]', html).on("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this._captureNote(event.currentTarget);
    });
```

(g) CSS append:

```css
.mej-cc-notes-stream { margin-top: 10px; }
.mej-cc-notes-stream h3 { margin: 0 0 4px; }
.mej-cc-notes-list { list-style: none; margin: 0; padding: 0; }
.mej-cc-note { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; border-bottom: 1px dotted var(--mej-cc-chip-bg, rgba(255,255,255,.12)); }
.mej-cc-note .mej-cc-note-text { flex: 1; }
.mej-cc-note-edit, .mej-cc-note-delete { opacity: .6; cursor: pointer; }
.mej-cc-note-edit:hover, .mej-cc-note-delete:hover { opacity: 1; }
```

(h) `lang/en.json` inside `notes`:

```json
"streamTitle": "Notes",
"none": "No notes yet. Type one above, or use /note in chat.",
"edited": "edited",
"edit": "Edit note",
"delete": "Delete note",
"deleteConfirm": "Delete this note? This cannot be undone."
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/session.hbs scripts/sheets/SessionSheet.mjs scripts/logic/tonight.mjs styles/campaign-companion.css lang/en.json test/notes-stream-rows.test.js
git commit -m "feat(session): notes stream with capture, edit and delete on the Recap tab"
```

---

### Task 8: Party notes and History on entry pages (item 6)

**Files:**
- Create: `scripts/logic/history.mjs`
- Modify: `scripts/hooks/knowledge-ui.mjs` (`injectPanel` context lines 142-165; `bindPanel`), `templates/knowledge-panel.hbs` (new section above Tags; History under Mentioned in), `scripts/logic/knowledge-summary.mjs` (count), `styles/campaign-companion.css`, `lang/en.json`
- Test: `test/history.test.js`, `test/knowledge-summary.test.js` (append one case)

**Interfaces:**
- Consumes: `listNotes`, `addNote`, `notesEntryOf`, `linkNoteText`, `openSessionPage`, `streamRows`.
- Produces:
  - `historyGroups(backlinks, sessions): { session: {uuid, name, order}|null, rows: backlink[] }[]` — session groups ordered by `order` ascending, then one `session: null` group for the rest; empty groups omitted
  - knowledge panel context gains `partyNotes: { canWrite, rows }` and `history: groups`; a "Note about this" button `[data-action="noteAbout"]`

- [ ] **Step 1: Write the failing tests**

`test/history.test.js`:

```js
import { describe, it, expect } from "vitest";
import { historyGroups } from "../scripts/logic/history.mjs";

describe("historyGroups", () => {
  const sessions = [
    { uuid: "JournalEntry.s2", name: "Session 2", order: 2 },
    { uuid: "JournalEntry.s1", name: "Session 1", order: 1 }
  ];
  const backlinks = [
    { uuid: "JournalEntry.s2", name: "Session 2", count: 1 },
    { uuid: "JournalEntry.p", name: "Place", count: 2 },
    { uuid: "JournalEntry.s1", name: "Session 1", count: 3 }
  ];
  it("groups session mentions in session order, then the rest", () => {
    expect(historyGroups(backlinks, sessions)).toEqual([
      { session: sessions[1], rows: [backlinks[2]] },
      { session: sessions[0], rows: [backlinks[0]] },
      { session: null, rows: [backlinks[1]] }
    ]);
  });
  it("omits empty groups", () => {
    expect(historyGroups([backlinks[1]], sessions)).toEqual([{ session: null, rows: [backlinks[1]] }]);
    expect(historyGroups([], sessions)).toEqual([]);
  });
});
```

Append to `test/knowledge-summary.test.js` (read its existing shape first; the summary function takes counts and a `format(key, data)`): a case asserting that `{ tags: 0, attributes: 0, backlinks: 0, notes: 2 }` yields a string containing the formatted `knowledge.summary.notes` key with `{count: 2}`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/history.test.js test/knowledge-summary.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/logic/history.mjs`:

```js
// History view of an entry's backlinks (spec 2026-10-15 §5.4): grouped by
// session, in session order, then everything else. Pure.
export function historyGroups(backlinks, sessions) {
  const byUuid = new Map((sessions ?? []).map((s) => [s.uuid, s]));
  const ordered = [...(sessions ?? [])].sort((a, b) => a.order - b.order);
  const groups = ordered.map((session) => ({ session, rows: (backlinks ?? []).filter((b) => b.uuid === session.uuid) }));
  groups.push({ session: null, rows: (backlinks ?? []).filter((b) => !byUuid.has(b.uuid)) });
  return groups.filter((g) => g.rows.length);
}
```

In `scripts/logic/knowledge-summary.mjs`, add a `notes` count to the summary: when `counts.notes > 0`, emit `format("MEJCampaignCompanion.knowledge.summary.notes", { count })` (or the `notesOne` key for 1) first in the list, following the existing pattern for tags/attributes/mentions.

In `scripts/hooks/knowledge-ui.mjs`:

(a) imports:

```js
import { campaignOf } from "../logic/campaigns.mjs";
import { listNotes, notesEntryOf, addNote } from "../data/notes-store.mjs";
import { linkNoteText } from "./note-links.mjs";
import { openSessionPage } from "./current-session.mjs";
import { streamRows } from "../logic/tonight.mjs";
import { historyGroups } from "../logic/history.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { currentWorldComponents } from "../logic/campaign-calendar.mjs";
```

(b) in `injectPanel`, after `const tags = getTags(page);`:

```js
  const campaign = campaignOf(page);
  const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: page, async: true });
  const noteRows = campaign ? streamRows(listNotes(campaign, { mentionsUuid: entryUuid }), game.user, { formatTime }).reverse() : [];
  const partyNotes = {
    canWrite: !!campaign && !!notesEntryOf(campaign)?.isOwner,
    rows: await Promise.all(noteRows.map(async (r) => ({ ...r, text: await enrich(r.text) })))
  };
  const sessions = campaign ? campaign.contents.flatMap((e) => e.pages.contents
    .filter((p) => p.type === SESSION_DOCUMENT_TYPE || p._source?.type === SESSION_DOCUMENT_TYPE)
    .map((p) => ({ uuid: e.uuid, name: e.name, order: sessionData(p).sessionNumber ?? Number.MAX_SAFE_INTEGER }))) : [];
  const history = historyGroups(backlinks, sessions);
```

add `partyNotes`, `history` to the template context, and pass `notes: partyNotes.rows.length` into `knowledgeSummary`'s counts.

(c) in `bindPanel`, before the `if (!game.user.isGM)` early return, bind the Note-about button for everyone:

```js
  panel.querySelector('[data-action="noteAbout"]')?.addEventListener("click", async () => {
    const campaign = campaignOf(page);
    if (!campaign) return;
    const entryName = page.parent?.name ?? page.name;
    const text = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format(`${I18N}.notes.aboutTitle`, { name: entryName }) },
      content: `<textarea name="text" rows="3" maxlength="2000" style="width:100%" placeholder="${game.i18n.localize(`${I18N}.notes.capturePlaceholder`)}"></textarea>`,
      ok: { label: game.i18n.localize(`${I18N}.notes.capture`), callback: (ev, button) => button.form.elements.text.value },
      rejectClose: false
    });
    if (typeof text !== "string" || !text.trim()) return;
    const entryUuid = page.parent?.uuid ?? page.uuid;
    const linked = `@UUID[${entryUuid}]{${foundry.utils.escapeHTML(entryName)}} ${linkNoteText(campaign, text.trim())}`;
    try {
      await addNote(campaign, { text: linked, sessionUuid: openSessionPage(campaign)?.uuid ?? null, worldDate: currentWorldComponents() });
      ui.notifications.info(game.i18n.localize(`${I18N}.notes.captured`));
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
  });
```

(d) refresh: in `registerKnowledgePanel`, add a hook so a notes-entry change refreshes panels:

```js
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (changes?.flags?.[MODULE_ID]?.notes !== undefined) scheduleRefresh();
  });
```

(e) `templates/knowledge-panel.hbs`: insert before the `<details class="mej-cc-knowledge-tags" open>` block:

```hbs
    <details class="mej-cc-knowledge-notes" open>
        <summary><i class="fa-solid fa-comment-dots"></i> {{localize "MEJCampaignCompanion.notes.partyNotes"}} ({{partyNotes.rows.length}})
            {{#if partyNotes.canWrite}}<a class="mej-cc-note-about" data-action="noteAbout" title="{{localize 'MEJCampaignCompanion.notes.about'}}"><i class="fa-solid fa-plus"></i> {{localize "MEJCampaignCompanion.notes.about"}}</a>{{/if}}
        </summary>
        <ol class="mej-cc-notes-list">
            {{#each partyNotes.rows}}
            <li class="mej-cc-note" data-note-id="{{this.id}}">
                <span class="mej-cc-note-meta">{{this.timeLabel}} {{this.authorName}}</span>
                <span class="mej-cc-note-text">{{{this.text}}}</span>
            </li>
            {{/each}}
        </ol>
        {{#unless partyNotes.rows}}<span class="mej-cc-knowledge-empty">{{localize "MEJCampaignCompanion.notes.noPartyNotes"}}</span>{{/unless}}
    </details>
```

and replace the backlinks `<ol class="mej-cc-backlink-list">…</ol>` body with the grouped form, keeping the same row markup so `bindBacklinks` still works:

```hbs
        {{#each history}}
        <div class="mej-cc-history-group">
            {{#if this.session}}<h4 class="mej-cc-history-session">{{this.session.name}}</h4>{{else}}{{#if @root.history.length}}<h4 class="mej-cc-history-session">{{localize "MEJCampaignCompanion.notes.elsewhere"}}</h4>{{/if}}{{/if}}
            <ol class="mej-cc-backlink-list">
                {{#each this.rows}}
                <li class="mej-cc-backlink-row" data-uuid="{{this.uuid}}">
                    <i class="{{this.icon}}"></i>
                    <span class="mej-cc-backlink-name">{{this.name}}</span>
                    {{#if this.gmOnly}}<i class="fa-solid fa-eye-slash mej-cc-backlink-gm" title="{{localize 'MEJCampaignCompanion.knowledge.gmOnlyMention'}}"></i>{{/if}}
                    <span class="mej-cc-backlink-count">×{{this.count}}</span>
                </li>
                {{/each}}
            </ol>
        </div>
        {{/each}}
```

(f) `lang/en.json` inside `notes`:

```json
"partyNotes": "Party notes",
"noPartyNotes": "Nothing noted about this yet.",
"about": "Note about this",
"aboutTitle": "Note about {name}",
"elsewhere": "Elsewhere"
```

and inside `knowledge.summary`: `"notes": "{count} notes", "notesOne": "1 note"`.

(g) CSS append:

```css
.mej-cc-knowledge-notes summary .mej-cc-note-about { float: right; font-size: .85em; cursor: pointer; }
.mej-cc-history-session { margin: 6px 0 2px; font-size: .9em; color: var(--mej-cc-ink-muted); }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/history.mjs scripts/hooks/knowledge-ui.mjs templates/knowledge-panel.hbs scripts/logic/knowledge-summary.mjs styles/campaign-companion.css lang/en.json test/history.test.js test/knowledge-summary.test.js
git commit -m "feat(knowledge): party notes section, Note about this, session-ordered History"
```

---

### Task 9: Notes on the timeline (item 16)

**Files:**
- Modify: `scripts/logic/hub-timeline.mjs`, `scripts/apps/CampaignHubPage.mjs` (`#timelineContext` lines 673-708; state; one action), `templates/hub.hbs` (timeline controls lines 101-118 and row loop 131-164), `lang/en.json`
- Test: `test/hub-timeline.test.js` (append)

**Interfaces:**
- Consumes: `campaignSortKey` (`logic/campaign-date.mjs`), `listNotes`.
- Produces: `buildTimelineRows(timepoints, order, { canEdit, formatDate, resolveRowLinks, notes = [], formatNoteDate })` — when `order === "campaign"` and `notes` is given, dated notes are interleaved as rows `{ kind: "note", id, label, dateLabel, authorName, position: -1, canEdit: false, links: [] }`; in other orders notes are ignored. Hub state `timelineShowNotes` (default true), action `toggleTimelineNotes`.

- [ ] **Step 1: Write the failing test**

Append to `test/hub-timeline.test.js`:

```js
describe("buildTimelineRows with notes (spec item 16)", () => {
  const tps = [
    { id: "a", label: "A", sort: 1, createdAt: 1, campaignDate: { year: 1490, month: 0, day: 5 } },
    { id: "b", label: "B", sort: 2, createdAt: 2, campaignDate: { year: 1490, month: 2, day: 1 } }
  ];
  const notes = [
    { id: "n1", text: "between", authorName: "Jo", at: 9, worldDate: { year: 1490, month: 1, day: 1 } },
    { id: "n2", text: "undated", authorName: "Jo", at: 10, worldDate: null }
  ];
  const opts = { canEdit: true, formatDate: () => "d", resolveRowLinks: () => [], notes, formatNoteDate: () => "nd" };
  it("interleaves dated notes in Campaign Date order and skips undated ones", () => {
    const rows = buildTimelineRows(tps, "campaign", opts);
    expect(rows.map((r) => r.id)).toEqual(["a", "n1", "b"]);
    expect(rows[1]).toMatchObject({ kind: "note", label: "between", dateLabel: "nd", authorName: "Jo", canEdit: false, position: -1 });
  });
  it("ignores notes in manual and created order", () => {
    expect(buildTimelineRows(tps, "manual", opts).map((r) => r.id)).toEqual(["a", "b"]);
    expect(buildTimelineRows(tps, "created", opts).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/hub-timeline.test.js`
Expected: FAIL — rows contain no note.

- [ ] **Step 3: Implement**

Replace `buildTimelineRows` in `scripts/logic/hub-timeline.mjs`:

```js
import { campaignSortKey } from "./campaign-date.mjs";

export function buildTimelineRows(timepoints, order, { canEdit, formatDate, resolveRowLinks, notes = [], formatNoteDate = () => "" }) {
  const ordered = orderTimepoints(timepoints ?? [], order);
  const rows = ordered.map((tp, i) => ({ ...tp, position: i, canEdit, dateLabel: formatDate(tp), links: resolveRowLinks(tp) }));
  if (order !== "campaign" || !notes?.length) return rows;
  const noteRows = notes
    .filter((n) => campaignSortKey(n.worldDate) != null)
    .map((n) => ({ kind: "note", id: n.id, label: n.text, dateLabel: formatNoteDate(n.worldDate), authorName: n.authorName || "", position: -1, canEdit: false, links: [], _key: campaignSortKey(n.worldDate) }));
  const keyed = rows.map((r) => ({ row: r, key: campaignSortKey(r.campaignDate) }));
  const merged = [];
  let ni = 0;
  noteRows.sort((a, b) => a._key - b._key);
  for (const { row, key } of keyed) {
    while (ni < noteRows.length && key != null && noteRows[ni]._key < key) merged.push(noteRows[ni++]);
    merged.push(row);
  }
  while (ni < noteRows.length) merged.push(noteRows[ni++]);
  return merged.map(({ _key, ...r }) => r);
}
```

In `CampaignHubPage.mjs`:

- state: where `HUB_STATE` defaults are declared (search `timelineOrder:`), add `timelineShowNotes: true`.
- action: `toggleTimelineNotes: CampaignHubPage.onToggleTimelineNotes` and

```js
  static onToggleTimelineNotes(event, target) {
    this.state.timelineShowNotes = !!target.checked;
    this.render({ parts: ["main"] });
  }
```

- `#timelineContext(journal, isGM)` gains a third parameter `campaign` (pass `campaign` from each call site in `_prepareBodyContext`; `null` for world/legacy stacks) and passes notes:

```js
    const notes = campaign && this.state.timelineShowNotes ? listNotes(campaign).filter((n) => n.kind !== "reveal" || game.user.isGM || true) : [];
    const rows = buildTimelineRows(timepoints, order, {
      canEdit, formatDate: ..., resolveRowLinks: ...,
      notes, formatNoteDate: (d) => formatCampaignDate(d)
    });
    return { hasJournal: true, rows, order, showDateColumn: order !== "manual", orderOptions: ..., canEdit, journalId: journal.id, showNotes: this.state.timelineShowNotes, notesToggleEnabled: order === "campaign" && !!campaign };
```

(`listNotes` is already visibility-filtered; the filter expression above is a no-op kept simple: use `listNotes(campaign)` directly.)

In `templates/hub.hbs`, inside the `mej-cc-order-menu` group (after the order buttons), add:

```hbs
                                <label class="mej-cc-timeline-notes-toggle" {{#unless this.notesToggleEnabled}}data-tooltip="{{localize 'MEJCampaignCompanion.notes.timelineOnlyCampaignOrder'}}"{{/unless}}>
                                    <input type="checkbox" data-action-change="toggleTimelineNotes" {{#if this.showNotes}}checked{{/if}} {{#unless this.notesToggleEnabled}}disabled{{/unless}}>
                                    {{localize "MEJCampaignCompanion.notes.timelineToggle"}}
                                </label>
```

Wire `data-action-change` the same way the graph's `toggleGraphBacklinks` checkbox is wired in `activateListeners` (search for `toggleGraphBacklinks` and add a parallel `change` binding for `toggleTimelineNotes`).

In the row loop, make the note row distinct: change the `<li class="mej-cc-timepoint"` opening to add `{{#if this.kind}} mej-cc-timepoint-note{{/if}}` to its class and render `{{#if this.kind}}<span class="mej-cc-note-meta">{{this.authorName}}</span>{{/if}}` after the label; the pen/trash are already gated on `this.canEdit` (false for notes) and drag on `canEdit` too.

CSS append: `.mej-cc-timepoint-note { border-left: 3px solid var(--mej-cc-ink-muted); opacity: .9; }`

`lang/en.json` in `notes`: `"timelineToggle": "Show party notes"`, `"timelineOnlyCampaignOrder": "Party notes appear in Campaign Date order."`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-timeline.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs styles/campaign-companion.css lang/en.json test/hub-timeline.test.js
git commit -m "feat(timeline): party notes as a second series in Campaign Date order"
```

---

### Task 10: Live e2e spec 35 (written, not run in this plan)

**Files:**
- Create: `tests/e2e/35-session-notes.spec.mjs`

**Interfaces:** consumes every surface above as a user would.

- [ ] **Step 1: Write the spec**

```js
// Session notes and the current session (spec 2026-10-15 items 1-3, 6, 1a).
// GM creates a campaign and starts a session; players (no GM needed for the
// write itself, but a GM stays online here to keep the run short) note via
// /note and the Session page; the GM ends the session and appends the draft.
import { test, expect } from "@playwright/test";
import {
  login, withGmPage, trackConsoleErrors, assertNoConsoleErrors, settle,
  deleteJournalsByPrefix, cleanupStrandedTestFolders, ensureMejPlayerAccess, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const MOD = "mej-campaign-companion";
const PREFIX = "TT-Notes";
const RUN = Date.now();
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const tagged = (name) => `${PREFIX}${name}${RUN}`;

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

const notesOf = (page, folderId) => page.evaluate(({ MOD, folderId }) => {
  const e = game.journal.find((j) => j.flags?.[MOD]?.notesEntry === true && j.folder?.id === folderId);
  return e ? Object.values(foundry.utils.deepClone(e.flags[MOD].notes ?? {})) : null;
}, { MOD, folderId });

let gm; let u1; let folderId; let duke; let sessionUuid;

test.describe("35 session notes", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    gm = await newSeat(browser, "Gamemaster");
    await ensureMejPlayerAccess(gm.page);
    await deleteJournalsByPrefix(gm.page, PREFIX);
    await cleanupStrandedTestFolders(gm.page, { prefix: PREFIX });
    folderId = await gm.page.evaluate(async ({ MOD, name }) => (await Folder.create({
      name, type: "JournalEntry", flags: { [MOD]: { campaign: { ownershipDefault: "observer" } } }
    })).id, { MOD, name: tagged("Camp") });
    duke = await gm.page.evaluate(async ({ name, folder }) => {
      const e = await JournalEntry.create({ name, folder, ownership: { default: 2 },
        pages: [{ name, type: "text", text: { content: `<p>${name}</p>` }, flags: { "monks-enhanced-journal": { type: "person" } } }] });
      return { id: e.id, uuid: e.uuid, name: e.name };
    }, { name: tagged("Duke"), folder: folderId });
    // The GM seat creates the notes entry on createFolder; wait for it and for the player to own it.
    u1 = await newSeat(browser, "User 1");
    const u1Id = await u1.page.evaluate(() => game.user.id);
    await expect.poll(() => gm.page.evaluate(({ MOD, folderId, u1Id }) => {
      const e = game.journal.find((j) => j.flags?.[MOD]?.notesEntry === true && j.folder?.id === folderId);
      return e?.ownership?.[u1Id] ?? null;
    }, { MOD, folderId, u1Id }), { timeout: 30_000 }).toBe(3);
  });

  test.afterAll(async ({ browser }) => {
    await u1?.context.close().catch(() => {});
    await gm?.context.close().catch(() => {});
    await withGmPage(browser, async (p) => {
      if (folderId) await p.evaluate((id) => game.folders.get(id)?.delete({ deleteSubfolders: true, deleteContents: true }), folderId);
      await deleteJournalsByPrefix(p, PREFIX);
      await cleanupStrandedTestFolders(p, { prefix: PREFIX });
    });
  });

  test("GM starts a session: flag set, player owns the recap", async () => {
    test.setTimeout(90_000);
    sessionUuid = await gm.page.evaluate(async (folderId) => {
      const { startSession } = await import("/modules/mej-campaign-companion/scripts/hooks/current-session.mjs");
      const page = await startSession(game.folders.get(folderId));
      return page?.uuid ?? null;
    }, folderId);
    expect(sessionUuid).toBeTruthy();
    const u1Id = await u1.page.evaluate(() => game.user.id);
    await expect.poll(() => u1.page.evaluate(async ({ sessionUuid, u1Id }) => (await fromUuid(sessionUuid))?.parent?.ownership?.[u1Id] ?? null, { sessionUuid, u1Id }), { timeout: 20_000 }).toBe(3);
    assertNoConsoleErrors(gm.errors);
  });

  test("/note files into the open session with the Duke linked", async () => {
    test.setTimeout(90_000);
    await u1.page.evaluate(() => ui.sidebar.changeTab?.("chat", "primary"));
    const box = u1.page.locator("#chat-message, textarea.chat-input").first();
    await box.fill(`/note we think ${duke.name} is lying`);
    await box.press("Enter");
    await expect.poll(async () => (await notesOf(u1.page, folderId))?.length ?? 0, { timeout: 20_000 }).toBe(1);
    const [note] = await notesOf(u1.page, folderId);
    expect(note.sessionUuid).toBe(sessionUuid);
    expect(note.text).toContain(`@UUID[${duke.uuid}]`);
    await expect(u1.page.locator("#chat .message", { hasText: "Noted in" }).last()).toBeVisible({ timeout: 15_000 });
    assertNoConsoleErrors(u1.errors);
  });

  test("the note shows on the Session page stream and on the Duke's Party notes", async () => {
    test.setTimeout(90_000);
    await u1.page.evaluate(async (uuid) => game.MonksEnhancedJournal.openJournalEntry(await fromUuid(uuid)), sessionUuid);
    await settle(u1.page, 800);
    await expect(u1.page.locator("#MonksEnhancedJournal .mej-cc-notes-stream .mej-cc-note")).toHaveCount(1, { timeout: 15_000 });
    await u1.page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), duke.id);
    await settle(u1.page, 800);
    await expect(u1.page.locator("#MonksEnhancedJournal .mej-cc-knowledge-notes .mej-cc-note")).toHaveCount(1, { timeout: 15_000 });
    assertNoConsoleErrors(u1.errors);
  });

  test("End session offers the draft; appending writes the recap", async () => {
    test.setTimeout(90_000);
    const done = gm.page.evaluate(async (folderId) => {
      const { endSession } = await import("/modules/mej-campaign-companion/scripts/hooks/current-session.mjs");
      await endSession(game.folders.get(folderId));
    }, folderId);
    const dialog = gm.page.locator("dialog.application", { hasText: "Recap draft" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator("button", { hasText: "Append to recap" }).click();
    await done;
    const recap = await gm.page.evaluate(async (uuid) => (await fromUuid(uuid))?.system?.recap ?? "", sessionUuid);
    expect(recap).toContain("is lying");
    const flag = await gm.page.evaluate(({ MOD, folderId }) => game.folders.get(folderId).flags?.[MOD]?.campaign?.currentSession ?? null, { MOD, folderId });
    expect(flag).toBeNull();
    assertNoConsoleErrors(gm.errors);
  });
});
```

- [ ] **Step 2: Lint by listing**

Run: `npx playwright test --list tests/e2e/35-session-notes.spec.mjs`
Expected: 4 tests listed, no syntax errors. (Do not run the spec in this plan.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/35-session-notes.spec.mjs
git commit -m "test(e2e): session notes spec 35"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md` (Features: new "Session notes and the current session" subsection after "Sessions"; Settings table row for `autoStartSession`), `docs/player-guide.md` (new section "Taking notes during play" after "Reading session pages & writing your recap"), `docs/gm-guide.md` (new section "Running a session: Start, notes, End" after "Running your first session"; settings reference entry), `CHANGELOG.md`

- [ ] **Step 1: README feature subsection**

Add under Features:

```markdown
### Session notes and the current session

- A **note** is short text with its author, the time, the in-world date, the session it belongs to and the entries it mentions. Notes live on a hidden per-campaign entry (`Notes — <campaign>`, flag `notesEntry`) owned by every player at a campaign baseline of **Players can view** or above, so players write with no GM online. Each note is its own flag key, so simultaneous authors never overwrite each other.
- A GM **starts a session** from the Hub's Tonight strip (or the Companion offers to at login with **Offer to start a session at login**). Starting creates `Session N`, flags the campaign's open session, grants recap ownership to every connected player (and to players who connect later), and adopts notes taken while no session was open.
- Players write with the Tonight strip's capture box, the Session page's notes stream, **Note about this** on an entry, or `/note <text>` (`/n`) in chat. Entity names in a note become links under the same campaign-scope and audience rules as auto-link.
- A note's author and any GM can edit or delete it; edits are stamped. Notes mentioning an entry show under **Party notes** in its knowledge panel; **Mentioned in** groups backlinks by session in order.
- **End session** clears the open session and offers a recap draft assembled from the session's notes; **Append to recap** writes it, nothing is written otherwise.
- Dated notes appear on the Hub Timeline in Campaign Date order (**Show party notes**).
```

- [ ] **Step 2: Guides and changelog**

Player guide section (≈150 words) covering: where the capture box is, `/note`, what "No session running" means, that notes are signed and editable by their author, Party notes on an entry. GM guide section covering Start/End, the draft dialog, the login offer setting, that notes are not canon. CHANGELOG entry under Unreleased: "Session notes, current session, `/note`, party notes, History, timeline notes, recap draft (spec 2026-10-15 Plan B)".

- [ ] **Step 3: Link check and commit**

Run: `npm run check:links`
Expected: PASS.

```bash
git add README.md docs/player-guide.md docs/gm-guide.md CHANGELOG.md
git commit -m "docs: session notes, current session and /note"
```

---

## Self-review

**Spec coverage.** Item 9's "attendees default to the players connected when the session started" (deferred from Plan A) → Task 3 `attendeeUuidsFor`, Task 4 `startSession` and the `userConnected` append. Plan C's store guarantees (note object with `.id`, untouched `ref`, `currentSession` shape, audience-only `updateNote` patch) → Task 1 tests, Task 2 Interfaces and `test/notes-store.test.js`. Item 1 → Tasks 1, 2, 7. Item 1a → Tasks 3 (draft), 4 (End session dialog). Item 2 → Tasks 3, 4, 6. Item 3 → Tasks 3, 5, 8 (Note about this). Item 6 → Task 8. Item 16 → Task 9. §9 calls: author+GM edit (Task 1 `canEditNote`, Task 7 actions); `/note` routing (Task 3, 5); recap ownership on users, added live (Task 3, 4); reveal notes carry audience and retract (Task 1 `audience`/`retracted`, Task 2 `retractNote`, Task 1 `visibleNotes`). §11: writers = every player at baseline ≥ view on a separate entry (Task 2 `notesWriters`, `ensureNotesEntry`); stream beside recap with draft at End (Tasks 7, 4). `autoStartSession` only new setting (Task 4). No new Hub tab (strip is a partial). Plan C hooks: `addNote(..., { kind: "reveal", audience, ref })` and `retractNote` exist and are tested (Tasks 1, 2).

**Placeholder scan.** Task 8 Step 1 asks the implementer to "read its existing shape first" for `knowledge-summary.test.js` and describes the case rather than printing it — acceptable because the function's signature is shown in Task 8 Step 3 and the assertion is spelled out; Task 11 Step 2 describes prose to write (documentation, not code). Everything else carries code.

**Type consistency.** `addNote(campaign, fields)` returns the stored note (Task 2) and is called with a Folder from Tasks 6–8 and with a folder id from Task 5's env (`resolveCampaign` accepts both). `openSessionPage(campaign)` (Task 4) is used by Tasks 6, 7, 8. `tonightContext` takes `canWrite` (Task 6 test and implementation agree; Task 7 passes `false`). `streamRows` lives in `logic/tonight.mjs` (Tasks 7, 8). `historyGroups(backlinks, sessions)` with `sessions[].order` (Task 8). `buildTimelineRows` keeps its three-argument signature with new optional fields (Task 9). `NotesStoreError.reason` keys match `lang.notes.*` keys (`noEntry`, `noAccess`, `badText`, `notFound`).

**Review Focus pins.** 1 → `test/notes.test.js` "one keyed path". 2 → `test/notes.test.js` `visibleNotes`. 3 → `test/current-session.test.js` `routeNote` and `test/note-command-handler.test.js`. 4 → `recapOwnershipUpdate` and `grantForConnectedUser` tests. 5 → `adoptHeldUpdate` test (notes are per campaign entry, so adoption cannot cross campaigns) and spec 35's held→adopt path is covered by `startSession`.
