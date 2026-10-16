# Companion UI Review — Plan C: Scoping and GM Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every player-facing surface honour the campaign scope (export, party picker, "Mentioned in", `@CampaignQuery`), let players edit a campaign's session recaps without a world setting, and consolidate the GM's duplicated controls (one reveal control per checklist secret, one GM note field per session, delete confirms, groups editable from campaign settings, auto-capture feedback), with reveals filed as notes on the current session once Plan B's note store exists.

**Architecture:** Pure, Foundry-free logic modules carry every rule (scope filters, checklist audience, prep-notes merge, capture-target resolution, reveal transition and note payload); thin Foundry glue in the existing hooks/apps/sheets calls them. Nothing patches MEJ. Item 7 (revealing is filing) talks to Plan B's `scripts/data/notes-store.mjs` and `scripts/logic/current-session.mjs` through a guarded dynamic import, so this plan builds and tests on its own and the filing switches on when Plan B merges.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, ApplicationV2, DialogV2), Monk's Enhanced Journal 13.06/14.01, vitest 3 (+ jsdom where DOM is built), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-15-companion-ui-review-design.md` — change-list items **7, 8, 14, 15** (§5.6, §5.7, §9, §11), plus the shell-control scoping piece of item 4 that Plan A deferred here (Task 9b).

**Requires Plan B merged** for Task 11's filing to take effect at runtime (the code degrades to a no-op without it). Everything else is independent of Plans A and B. Where Plan A also touches `lang/en.json`, resolve the merge by keeping both sets of keys; no key in this plan is renamed from today's file.

## Global Constraints

- Stock MEJ (native mode) and the API-carrying fork must both keep working; nothing here may depend on the MEJ extension API beyond what the Hub already uses.
- Foundry 13 and 14.
- The companion never patches MEJ; party layers live in the companion's own flags or its own hidden entries.
- Secret text stays soft-hidden (client-side filtering) as documented; notes that mention a secret entry are subject to the same audience containment rule auto-link already enforces.
- Pre-1.0: no migration ceremony is required for the notes store, but existing party notebooks (PR #49) must keep working.
- Anti-goals (spec §3): no new Hub tab, no new settings toggle for players to discover, nothing that needs a GM online for a player's own write, nothing that mixes party text into the GM's canon.
- Unit tests: `npx vitest run` from the worktree root (105 files, all green before you start). e2e: only `tests/e2e/36-scoping-gm-consolidation.spec.mjs`, written in Task 12, not run as part of this plan.
- Commit after every task; PR bodies carry no Claude attribution footer (user rule).

## Review Focus

1. **A checklist secret with a legacy `revealed: true` and no `audience`** must still read as revealed everywhere (sheet, player view, tracker, prep board) after the eye button goes. Pinned in Task 1 (`applyChecklistAudience` / `checklistSeed` tests).
2. **Campaign export when the default timeline is empty but a second campaign timeline has points** must include the second timeline's points and never the legacy singleton. Pinned in Task 6 (`campaignTimepoints` test).
3. **A page in no campaign rendering `@CampaignQuery`** must get unscoped results (an unfiled page links anywhere), and `scope:all` on a campaign page must opt out. Pinned in Task 9 (`scopeHits` tests).
4. **Revealing to a second player after a first reveal** must not file a second note, and un-revealing must retract exactly the note that was filed. Pinned in Task 11 (`revealTransition` tests).
5. **A session created inside a GM-only campaign** (baseline "none") must not get player ownership, with or without the legacy setting. Pinned in Task 10 (`shouldOwnSessionEntry` tests).

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/logic/checklist-reveal.mjs` (new) | Pure: one audience record drives a checklist item's `revealed`/`audience`; dialog seed |
| `scripts/apps/confirm-delete.mjs` (new) | `confirmDelete({ kind, name })` DialogV2 wrapper; pure `deletePromptKeys` |
| `scripts/logic/prep-notes-merge.mjs` (new) | Pure: fold `prepNotes` into GM Notes once |
| `scripts/hooks/prep-notes-migrate.mjs` (new) | Active-GM ready sweep that applies the merge |
| `scripts/apps/group-dialog.mjs` (new) | `promptGroup` (moved out of the Hub) + `openGroupsManager` |
| `scripts/logic/player-groups.mjs` | `groupsSummary` |
| `scripts/logic/auto-capture.mjs` | `resolveCaptureCampaign` |
| `scripts/hooks/auto-capture.mjs` | single-campaign auto-target, success toasts |
| `scripts/logic/doc-export-snapshot.mjs` | `scopeExportRows`, `campaignTimepoints` |
| `scripts/apps/export-dialog.mjs` | scope select, campaign-scoped run |
| `scripts/logic/party-rows.mjs` | `targetProblem` learns `other-campaign` |
| `scripts/hooks/party-relationships-ui.mjs` | picker and drop pass campaign scope |
| `scripts/logic/link-targets.mjs` | `scopeBacklinks` |
| `scripts/search/live-index.mjs` | scoped backlinks, `runQueryScoped` |
| `scripts/logic/query-grammar.mjs` | `scope:` token, `scopeHits` |
| `scripts/hooks/query-enricher.mjs` | scoped enrichment |
| `scripts/logic/hub-open-scope.mjs` (new), `scripts/campaign-companion.mjs` | shell control opens the Hub on the open entry's campaign (deferred from Plan A) |
| `scripts/logic/session-ownership.mjs` | baseline-driven session ownership |
| `scripts/logic/recap-save-state.mjs` (new) | Pure: whether closing the recap editor saves |
| `scripts/sheets/SessionSheet.mjs`, `templates/session.hbs` | single reveal control, delete confirms, save state |
| `scripts/logic/reveal-note.mjs` (new) | Pure: `revealTransition`, `revealNote` payload |
| `scripts/hooks/reveal-filing.mjs` (new) | Glue to Plan B's note store (guarded import) |
| `scripts/hooks/secrets-ui.mjs`, `scripts/hooks/relationships-ui.mjs`, `scripts/apps/CampaignHubPage.mjs`, `scripts/apps/prep-board-app.mjs`, `templates/prep-board.hbs`, `templates/hub.hbs`, `scripts/hooks/knowledge-ui.mjs` | call sites |
| `lang/en.json`, `README.md`, `docs/gm-guide.md` | strings and docs |
| `tests/e2e/36-scoping-gm-consolidation.spec.mjs` (new) | live gate |

---

### Task 1: One reveal control per checklist secret

**Files:**
- Create: `scripts/logic/checklist-reveal.mjs`
- Modify: `scripts/sheets/SessionSheet.mjs` (actions map near the top of the class; `onToggleSecret` ~line 436; `onSecretAudience` ~line 452; player/GM secrets mapping ~line 160)
- Modify: `templates/session.hbs:114-115`
- Modify: `templates/prep-board.hbs:14-18`, `scripts/apps/prep-board-app.mjs` (the `toggleSecret` action and its handler; `revealSecret` handler)
- Modify: `scripts/apps/CampaignHubPage.mjs:1033-1040` (session branch of the Secrets-tab reveal)
- Modify: `lang/en.json` (`session.revealSecret`, `session.hideSecret` removed; `prep.toggleAll` removed)
- Test: `test/checklist-reveal.test.js`

**Interfaces:**
- Produces: `applyChecklistAudience(item, audience, now = Date.now())` → new item `{ ...item, audience, revealed, revealedAt }` where `revealed === audience.all` and stored `audience.all` is always `false`; `checklistSeed(item)` → audience object for `promptAudience` with `all: item.revealed === true`.
- Consumes: `normalizeAudience` from `scripts/logic/reveal-state.mjs`.

- [ ] **Step 1: Write the failing tests**

`test/checklist-reveal.test.js`:

```js
import { describe, it, expect } from "vitest";
import { applyChecklistAudience, checklistSeed } from "../scripts/logic/checklist-reveal.mjs";

const item = { id: "c1", text: "Who paid the guards?", revealed: false, revealedAt: null };

describe("applyChecklistAudience", () => {
  it("Everyone -> revealed flag carries it; stored audience.all is false", () => {
    const next = applyChecklistAudience(item, { all: true, users: [], groups: [] }, 1000);
    expect(next.revealed).toBe(true);
    expect(next.revealedAt).toBe(1000);
    expect(next.audience.all).toBe(false);
  });
  it("named players only -> not revealed to everyone, audience kept", () => {
    const next = applyChecklistAudience(item, { all: false, users: ["u1"], groups: ["g1"] }, 1000);
    expect(next.revealed).toBe(false);
    expect(next.revealedAt).toBeNull();
    expect(next.audience.users).toEqual(["u1"]);
    expect(next.audience.groups).toEqual(["g1"]);
  });
  it("keeps the original revealedAt when already revealed to everyone", () => {
    const already = { ...item, revealed: true, revealedAt: 5 };
    expect(applyChecklistAudience(already, { all: true, users: [], groups: [] }, 1000).revealedAt).toBe(5);
  });
  it("un-reveal clears revealed and revealedAt", () => {
    const already = { ...item, revealed: true, revealedAt: 5, audience: { users: ["u1"], groups: [], all: false } };
    const next = applyChecklistAudience(already, { all: false, users: [], groups: [] }, 1000);
    expect(next.revealed).toBe(false);
    expect(next.revealedAt).toBeNull();
    expect(next.audience.users).toEqual([]);
  });
  it("never mutates its input", () => {
    const frozen = Object.freeze({ ...item });
    applyChecklistAudience(frozen, { all: true, users: [], groups: [] }, 1);
    expect(frozen.revealed).toBe(false);
  });
});

describe("checklistSeed (Review Focus 1: legacy revealed:true with no audience)", () => {
  it("seeds Everyone from the revealed flag", () => {
    const seed = checklistSeed({ id: "c1", text: "x", revealed: true, revealedAt: 1 });
    expect(seed.all).toBe(true);
    expect(seed.users).toEqual([]);
  });
  it("seeds users/groups from the audience and Everyone from the flag", () => {
    const seed = checklistSeed({ id: "c1", revealed: false, audience: { users: ["u1"], groups: [], all: false } });
    expect(seed.all).toBe(false);
    expect(seed.users).toEqual(["u1"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/checklist-reveal.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/logic/checklist-reveal.mjs"`.

- [ ] **Step 3: Write the logic module**

`scripts/logic/checklist-reveal.mjs`:

```js
// scripts/logic/checklist-reveal.mjs
// One audience record drives a Session checklist secret (spec 2026-10-15
// §5.7: one reveal control per checklist secret). "Everyone" is carried by
// the item's existing `revealed` flag - the field every reader (tracker,
// player view, prep board) already honours - and the stored audience's
// `all` is always false, mirroring how block secrets keep "Everyone" in
// Foundry's own class rather than in a companion flag. Pure.
import { normalizeAudience } from "./reveal-state.mjs";

/**
 * @param {{revealed?:boolean, revealedAt?:number|null, audience?:object}} item
 * @param {{all?:boolean, users?:string[], groups?:string[]}} audience  dialog result
 * @param {number} now
 */
export function applyChecklistAudience(item, audience, now = Date.now()) {
  const a = normalizeAudience(audience);
  const revealed = a.all === true;
  const revealedAt = revealed ? (item.revealed === true ? (item.revealedAt ?? now) : now) : null;
  return { ...item, audience: { ...a, all: false }, revealed, revealedAt };
}

/** Seed for promptAudience: users/groups from the record, Everyone from the flag. */
export function checklistSeed(item) {
  return { ...normalizeAudience(item?.audience), all: item?.revealed === true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/checklist-reveal.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Rewire the Session sheet**

In `scripts/sheets/SessionSheet.mjs`:

1. Add to the imports: `import { applyChecklistAudience, checklistSeed } from "../logic/checklist-reveal.mjs";`
2. In the class's `actions` map, delete the `toggleSecret` entry.
3. Delete the whole `static async onToggleSecret(...)` method.
4. Replace the body of `onSecretAudience` from `const audience = await promptAudience({` through the `await this.document.update(...)` line with:

```js
    const audience = await promptAudience({
      title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`),
      audience: checklistSeed(item), groups
    });
    if (!audience) return;
    const current = sessionData(this.document).secrets;
    if (!current.find((s) => s.id === id)) return;
    const secrets = current.map((s) => (s.id === id ? applyChecklistAudience(s, audience) : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
```

Keep the `sendRevealWhisper` call that follows, but pass `previousAudience: checklistSeed(item)` instead of `item.audience` so an already-everyone item whispers nobody again.

5. In the `_prepareContext` secrets mapping (~line 160), the GM branch computes `audienceAll: a.all`. Change it to `audienceAll: s.revealed === true || a.all === true` so the ✱ badge shows for the flag-carried "Everyone".

- [ ] **Step 6: Template changes**

`templates/session.hbs`: delete line 114 (the `<a class="secret-toggle" data-action="toggleSecret" ...>` anchor). Leave the audience anchor as is.

`templates/prep-board.hbs`: delete the `<a data-action="toggleSecret" ...>` line (line 15). Keep `revealSecret`.

`scripts/apps/prep-board-app.mjs`: remove the `toggleSecret` key from `static DEFAULT_OPTIONS.actions` and delete its handler method (grep `toggleSecret`; both hits go). In the `revealSecret` handler, replace its audience seed and write with the same two calls as Step 5: seed with `checklistSeed(item)`, write `applyChecklistAudience(s, audience)`; import both from `../logic/checklist-reveal.mjs`.

- [ ] **Step 7: Hub Secrets tab session branch**

In `scripts/apps/CampaignHubPage.mjs` around line 1033, in the `secretKind === "session"` branch, replace

```js
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: item.audience, groups });
```
with
```js
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: checklistSeed(item), groups });
```
and replace the `current.map((s) => (s.id === secretId ? { ...s, audience } : s))` with `current.map((s) => (s.id === secretId ? applyChecklistAudience(s, audience) : s))`; pass `previousAudience: checklistSeed(item)` to the whisper. Add `import { applyChecklistAudience, checklistSeed } from "../logic/checklist-reveal.mjs";` to the file's imports.

- [ ] **Step 8: Strings**

In `lang/en.json` under `MEJCampaignCompanion.session` delete the keys `revealSecret` and `hideSecret`. Under `MEJCampaignCompanion.prep` delete `toggleAll`. Run `grep -rn "session.revealSecret\|session.hideSecret\|prep.toggleAll" scripts templates` and confirm no references remain.

- [ ] **Step 9: Run the whole unit suite**

Run: `npx vitest run`
Expected: PASS. If `test/session-page-data.test.js` or `test/secrets-tracker.test.js` reference `toggleSecret`, update those expectations to the new shape (they test data, not the action; most likely untouched).

- [ ] **Step 10: Commit**

```bash
git add scripts/logic/checklist-reveal.mjs test/checklist-reveal.test.js scripts/sheets/SessionSheet.mjs templates/session.hbs templates/prep-board.hbs scripts/apps/prep-board-app.mjs scripts/apps/CampaignHubPage.mjs lang/en.json
git commit -m "feat: one reveal control per session checklist secret"
```

---

### Task 2: Delete confirms

**Files:**
- Create: `scripts/apps/confirm-delete.mjs`
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onDeleteDashboard` ~line 938, `onDeleteGroup` ~line 1098)
- Modify: `scripts/sheets/SessionSheet.mjs` (`onDeleteSecret`, `onRemoveAttendee`)
- Modify: `scripts/hooks/knowledge-ui.mjs:258-261`
- Modify: `lang/en.json`
- Test: `test/confirm-delete.test.js`

**Interfaces:**
- Produces: `deletePromptKeys(kind)` → `{ title: "MEJCampaignCompanion.confirmDelete.<kind>.title", body: "MEJCampaignCompanion.confirmDelete.<kind>.body" }` for kinds `dashboard | group | secret | attribute | attendee`; `confirmDelete({ kind, name })` → `Promise<boolean>` (DialogV2.confirm with `rejectClose: false`).

- [ ] **Step 1: Write the failing test**

`test/confirm-delete.test.js`:

```js
import { describe, it, expect } from "vitest";
import { deletePromptKeys, DELETE_KINDS } from "../scripts/apps/confirm-delete.mjs";

describe("deletePromptKeys", () => {
  it("maps every supported kind to its title/body keys", () => {
    for (const kind of DELETE_KINDS) {
      expect(deletePromptKeys(kind)).toEqual({
        title: `MEJCampaignCompanion.confirmDelete.${kind}.title`,
        body: `MEJCampaignCompanion.confirmDelete.${kind}.body`
      });
    }
  });
  it("throws on an unknown kind so a typo cannot silently show the wrong copy", () => {
    expect(() => deletePromptKeys("timeline")).toThrow(/unknown delete kind/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/confirm-delete.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`scripts/apps/confirm-delete.mjs`:

```js
// scripts/apps/confirm-delete.mjs
// One confirm for the five destructive clicks that had none (spec
// 2026-10-15 §5.7): dashboards, player groups, checklist secrets,
// attributes, attendees. Timepoints and timelines keep their own, richer
// confirms. The key builder is pure so vitest pins the copy wiring; the
// dialog itself is Foundry glue. Importable without Foundry: nothing at
// module scope touches `foundry`/`game`.
import { I18N } from "../constants.mjs";

export const DELETE_KINDS = Object.freeze(["dashboard", "group", "secret", "attribute", "attendee"]);

export function deletePromptKeys(kind) {
  if (!DELETE_KINDS.includes(kind)) throw new Error(`unknown delete kind: ${kind}`);
  return { title: `${I18N}.confirmDelete.${kind}.title`, body: `${I18N}.confirmDelete.${kind}.body` };
}

/** @returns {Promise<boolean>} true only when the user confirmed (DialogV2.confirm resolves true/false/null) */
export async function confirmDelete({ kind, name = "" }) {
  const keys = deletePromptKeys(kind);
  const body = game.i18n.format(keys.body, { name: foundry.utils.escapeHTML(name) });
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(keys.title) },
    content: `<p>${body}</p>`,
    rejectClose: false
  });
  return ok === true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/confirm-delete.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Strings**

Add under `MEJCampaignCompanion` in `lang/en.json` (new top-level group, after `"secrets"`):

```json
"confirmDelete": {
  "dashboard": { "title": "Delete dashboard", "body": "Delete the dashboard \"{name}\"? Its saved query is removed for everyone." },
  "group": { "title": "Delete player group", "body": "Delete the group \"{name}\"? Secrets revealed to it stay revealed to its members until you change their audience." },
  "secret": { "title": "Delete secret", "body": "Delete the secret \"{name}\" from this session's checklist?" },
  "attribute": { "title": "Delete attribute", "body": "Delete the attribute \"{name}\"?" },
  "attendee": { "title": "Remove attendee", "body": "Remove {name} from this session's attendees?" }
}
```

- [ ] **Step 6: Wire the five call sites**

`scripts/apps/CampaignHubPage.mjs` — add `import { confirmDelete } from "./confirm-delete.mjs";`. In `onDeleteDashboard`, after reading `id`:

```js
    const row = (game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? []).find((q) => q.id === id);
    if (!(await confirmDelete({ kind: "dashboard", name: row?.name ?? "" }))) return;
```

In `onDeleteGroup`, after reading `id`:

```js
    const group = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)).find((g) => g.id === id);
    if (!(await confirmDelete({ kind: "group", name: group?.name ?? "" }))) return;
```

`scripts/sheets/SessionSheet.mjs` — add `import { confirmDelete } from "../apps/confirm-delete.mjs";`. In `onDeleteSecret`, after `const session = sessionData(this.document);`:

```js
    const item = session.secrets.find((s) => s.id === id);
    if (!(await confirmDelete({ kind: "secret", name: item?.text ?? "" }))) return;
```

In `onRemoveAttendee`, after reading `uuid`:

```js
    const name = this.trueElement?.querySelector?.(`[data-uuid="${CSS.escape(uuid)}"] .mej-cc-attendee-name`)?.textContent ?? "";
    if (!(await confirmDelete({ kind: "attendee", name }))) return;
```

`scripts/hooks/knowledge-ui.mjs:258-261` — add `import { confirmDelete } from "../apps/confirm-delete.mjs";` and replace the delete listener with:

```js
  panel.querySelectorAll(".mej-cc-attr-delete").forEach((a) => a.addEventListener("click", async () => {
    const row = a.closest("[data-attr-id]");
    const name = row?.querySelector(".mej-cc-attr-key")?.value ?? "";
    if (!(await confirmDelete({ kind: "attribute", name }))) return;
    row?.remove();
    commitAttributes();
  }));
```

- [ ] **Step 7: Run the suite and commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/apps/confirm-delete.mjs test/confirm-delete.test.js scripts/apps/CampaignHubPage.mjs scripts/sheets/SessionSheet.mjs scripts/hooks/knowledge-ui.mjs lang/en.json
git commit -m "feat: confirm before deleting dashboards, groups, checklist secrets, attributes and attendees"
```

---

### Task 3: One GM note field per session (prep board shows GM Notes; `prepNotes` folded in once)

**Files:**
- Create: `scripts/logic/prep-notes-merge.mjs`, `scripts/hooks/prep-notes-migrate.mjs`
- Modify: `templates/prep-board.hbs:36-39`, `scripts/apps/prep-board-app.mjs` (`_prepareContext` `notes:` line ~84; the textarea `commit` debounce and `#pendingNotes` machinery in `_onRender` ~lines 88-135; add an `editGmNotes` action)
- Modify: `scripts/campaign-companion.mjs` (`ready` hook: call the sweep after migrations)
- Modify: `lang/en.json` (`prep.notes`, `prep.notesPlaceholder` replaced)
- Test: `test/prep-notes-merge.test.js`

**Interfaces:**
- Produces: `mergePrepNotes(gmNotes, prepNotes, heading)` → `{ gmNotes: string, changed: boolean }`; `planPrepNotesSweep(pages)` → `[{ page, gmNotes }]` for pages with a non-empty `prepNotes` flag.

- [ ] **Step 1: Write the failing tests**

`test/prep-notes-merge.test.js`:

```js
import { describe, it, expect } from "vitest";
import { mergePrepNotes, planPrepNotesSweep } from "../scripts/logic/prep-notes-merge.mjs";

const H = "Scratch notes";

describe("mergePrepNotes", () => {
  it("appends scratch text under a heading, HTML-escaped and paragraphed", () => {
    const out = mergePrepNotes("<p>Existing</p>", "Line one\n<b>two</b>", H);
    expect(out.changed).toBe(true);
    expect(out.gmNotes).toBe("<p>Existing</p><h3>Scratch notes</h3><p>Line one</p><p>&lt;b&gt;two&lt;/b&gt;</p>");
  });
  it("empty GM notes: no leading content", () => {
    expect(mergePrepNotes("", "x", H).gmNotes).toBe("<h3>Scratch notes</h3><p>x</p>");
    expect(mergePrepNotes(undefined, "x", H).gmNotes).toBe("<h3>Scratch notes</h3><p>x</p>");
  });
  it("blank scratch text changes nothing", () => {
    expect(mergePrepNotes("<p>a</p>", "   \n ", H)).toEqual({ gmNotes: "<p>a</p>", changed: false });
    expect(mergePrepNotes("<p>a</p>", null, H)).toEqual({ gmNotes: "<p>a</p>", changed: false });
  });
});

describe("planPrepNotesSweep", () => {
  const page = (prepNotes, gmNotes = "") => ({
    getFlag: (scope, key) => (scope === "mej-campaign-companion" && key === "prepNotes" ? prepNotes : undefined),
    system: { gmNotes }
  });
  it("plans only pages holding scratch text", () => {
    const a = page("keep me", "<p>g</p>");
    const b = page("");
    const c = page(undefined);
    const plan = planPrepNotesSweep([a, b, c], H);
    expect(plan).toHaveLength(1);
    expect(plan[0].page).toBe(a);
    expect(plan[0].gmNotes).toBe("<p>g</p><h3>Scratch notes</h3><p>keep me</p>");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/prep-notes-merge.test.js` → FAIL, module not found.

- [ ] **Step 3: Write the logic**

`scripts/logic/prep-notes-merge.mjs`:

```js
// scripts/logic/prep-notes-merge.mjs
// Spec 2026-10-15 §5.7: one GM note field per session. The prep board's
// "Scratch notes" (a plain-text `prepNotes` flag) fold into the session's
// GM Notes once, under a heading, and the flag is cleared. Pure.

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @param {string|undefined} gmNotes   stored system.gmNotes (HTML)
 * @param {string|null|undefined} prepNotes  plain text from the flag
 * @param {string} heading  localized heading text
 * @returns {{ gmNotes: string, changed: boolean }}
 */
export function mergePrepNotes(gmNotes, prepNotes, heading) {
  const base = typeof gmNotes === "string" ? gmNotes : "";
  const text = typeof prepNotes === "string" ? prepNotes : "";
  if (!text.trim()) return { gmNotes: base, changed: false };
  const paragraphs = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  return { gmNotes: `${base}<h3>${escapeHtml(heading)}</h3>${paragraphs}`, changed: true };
}

/** Pages whose prepNotes flag holds text, with the merged GM Notes to write. */
export function planPrepNotesSweep(pages, heading) {
  const plan = [];
  for (const page of pages ?? []) {
    const prep = page.getFlag("mej-campaign-companion", "prepNotes");
    const { gmNotes, changed } = mergePrepNotes(page.system?.gmNotes, prep, heading);
    if (changed) plan.push({ page, gmNotes });
  }
  return plan;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/prep-notes-merge.test.js` → PASS (5 tests).

- [ ] **Step 5: The sweep hook**

`scripts/hooks/prep-notes-migrate.mjs`:

```js
// scripts/hooks/prep-notes-migrate.mjs
// Active-GM, idempotent: fold every session page's leftover prepNotes into
// its GM Notes and clear the flag. Runs on ready after the versioned
// migrations; a world with no prepNotes text does nothing. Not a dataVersion
// step: the flag's absence is its own "done" marker.
import { MODULE_ID, I18N, SESSION_DOCUMENT_TYPE, SESSION_TYPE } from "../constants.mjs";
import { planPrepNotesSweep } from "../logic/prep-notes-merge.mjs";

export async function migratePrepNotes() {
  if (game.user !== game.users.activeGM) return 0;
  const pages = game.journal.contents.flatMap((e) =>
    e.pages.contents.filter((p) => p.type === SESSION_DOCUMENT_TYPE || p.type === SESSION_TYPE));
  const plan = planPrepNotesSweep(pages, game.i18n.localize(`${I18N}.prep.scratchHeading`));
  for (const { page, gmNotes } of plan) {
    try {
      await page.update({ "system.gmNotes": gmNotes, [`flags.${MODULE_ID}.-=prepNotes`]: null });
    } catch (err) {
      console.error(`${MODULE_ID} | prep-notes fold failed for ${page.uuid}`, err);
    }
  }
  return plan.length;
}
```

In `scripts/campaign-companion.mjs`, inside the `Hooks.once("ready", ...)` handler, after the versioned-migration block (the `if (game.user === game.users.activeGM && game.settings.get(MODULE_ID, DATA_VERSION_SETTING) < CURRENT_DATA_VERSION) { ... }` block ends, ~line 470), add:

```js
  import("./hooks/prep-notes-migrate.mjs")
    .then((m) => m.migratePrepNotes())
    .catch((err) => console.error(`${MODULE_ID} | prep-notes fold failed`, err));
```

- [ ] **Step 6: Prep board shows GM Notes read-only**

`templates/prep-board.hbs`: replace the `mej-cc-prep-notes` section with:

```hbs
    <section class="mej-cc-prep-notes flexcol">
        <header>{{localize 'MEJCampaignCompanion.prep.gmNotes'}}
            <a data-action="editGmNotes" data-tooltip="{{localize 'MEJCampaignCompanion.prep.editGmNotes'}}"><i class="fa-solid fa-pen-to-square"></i> {{localize 'MEJCampaignCompanion.prep.editGmNotes'}}</a>
        </header>
        <div class="mej-cc-prep-gm-notes">{{#if gmNotes}}{{{gmNotes}}}{{else}}<p class="instruction">{{localize 'MEJCampaignCompanion.prep.noGmNotes'}}</p>{{/if}}</div>
    </section>
```

`scripts/apps/prep-board-app.mjs`:
1. In `_prepareContext`, replace `notes: page.getFlag(MODULE_ID, "prepNotes") ?? ""` with `gmNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.system?.gmNotes ?? "", { relativeTo: page, secrets: true, async: true })`.
2. In `_onRender`, delete the textarea lookup, the `#pendingNotes` restore block, the `commit` debounce and its `input` listener, and the `prepNotes` guard line inside the `updateJournalEntryPage` listener (`if (changes?.flags?.[MODULE_ID]?.prepNotes !== undefined) return;`) plus the "capture the live textarea" block. Keep the hook that re-renders on page updates. Delete the `#pendingNotes` field declaration.
3. Add to `static DEFAULT_OPTIONS.actions`: `editGmNotes: PrepBoardApp.onEditGmNotes` and the handler:

```js
  static async onEditGmNotes() {
    const page = this.page;
    await game.MonksEnhancedJournal.openJournalEntry(page.parent);
    // The Session sheet's own action opens the editor; find it once the
    // shell has mounted the page.
    setTimeout(() => {
      const btn = game.MonksEnhancedJournal?.journal?.element?.querySelector?.('[data-action="editGmNotes"]');
      btn?.click();
    }, 400);
  }
```

- [ ] **Step 7: Strings**

In `lang/en.json` `MEJCampaignCompanion.prep`: delete `notes` and `notesPlaceholder`; add

```json
"gmNotes": "GM Notes",
"editGmNotes": "Edit on the session",
"noGmNotes": "No GM notes yet — add them on the session's Session tab.",
"scratchHeading": "Scratch notes"
```

- [ ] **Step 8: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/prep-notes-merge.mjs scripts/hooks/prep-notes-migrate.mjs test/prep-notes-merge.test.js scripts/apps/prep-board-app.mjs templates/prep-board.hbs scripts/campaign-companion.mjs lang/en.json
git commit -m "feat: prep board shows the session's GM Notes; scratch notes fold in once"
```

---

### Task 4: Contributors hint and player groups editable from campaign settings

**Files:**
- Create: `scripts/apps/group-dialog.mjs`
- Modify: `scripts/logic/player-groups.mjs` (add `groupsSummary`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`#promptGroup` ~line 1062 removed; `onAddGroup`/`onEditGroup` import the shared one; `onEditCampaign` ~line 1180 gains a Manage groups button)
- Modify: `lang/en.json` (`hub.contributorsHint`, new `hub.manageGroups`, `secrets.groupsManagerTitle`, `secrets.noGroupsYet`)
- Test: `test/player-groups.test.js` (extend)

**Interfaces:**
- Produces: `groupsSummary(groups, users)` → `[{ id, name, memberNames: string }]` name-sorted; `promptGroup(initial, { titleKey })` (same contract as today's private `#promptGroup`); `openGroupsManager()` → `Promise<void>`, resolves when closed, groups written through `game.settings`.

- [ ] **Step 1: Failing test for `groupsSummary`**

Append to `test/player-groups.test.js`:

```js
import { groupsSummary } from "../scripts/logic/player-groups.mjs";

describe("groupsSummary", () => {
  const users = [{ id: "u1", name: "Zed" }, { id: "u2", name: "Ann" }];
  it("joins member names in user order and sorts groups by name", () => {
    const out = groupsSummary(
      [{ id: "g2", name: "Outer", members: ["u2"] }, { id: "g1", name: "Inner", members: ["u1", "u2", "gone"] }],
      users
    );
    expect(out).toEqual([
      { id: "g1", name: "Inner", memberNames: "Zed, Ann" },
      { id: "g2", name: "Outer", memberNames: "Ann" }
    ]);
  });
  it("empty input gives []", () => expect(groupsSummary(undefined, users)).toEqual([]));
});
```

(If the file already imports from `player-groups.mjs`, extend that import instead of adding a second.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/player-groups.test.js` → FAIL, `groupsSummary` is not exported.

- [ ] **Step 3: Implement `groupsSummary`**

Append to `scripts/logic/player-groups.mjs`:

```js
/** Display rows for a groups list: name-sorted, members resolved to names (unknown ids dropped). */
export function groupsSummary(groups, users) {
  const nameOf = new Map((users ?? []).map((u) => [u.id, u.name]));
  return normalizeGroups(groups)
    .map((g) => ({ id: g.id, name: g.name, memberNames: g.members.map((id) => nameOf.get(id)).filter(Boolean).join(", ") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/player-groups.test.js` → PASS.

- [ ] **Step 5: Move the group prompt and add the manager**

`scripts/apps/group-dialog.mjs`:

```js
// scripts/apps/group-dialog.mjs
// The player-group add/edit prompt (moved out of CampaignHubPage so the
// campaign settings dialog can use it too, spec 2026-10-15 §5.7) and a small
// manager listing groups with add/edit/delete.
import { MODULE_ID, I18N, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { normalizeGroups, upsertGroup, deleteGroup, groupsSummary } from "../logic/player-groups.mjs";
import { confirmDelete } from "./confirm-delete.mjs";

/** Name + member-checkbox dialog; returns {name, members} or null. */
export async function promptGroup(initial = {}, { titleKey }) {
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

function groupsListHtml() {
  const esc = foundry.utils.escapeHTML;
  const rows = groupsSummary(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), game.users.contents);
  if (!rows.length) return `<p class="notes">${game.i18n.localize(`${I18N}.secrets.noGroupsYet`)}</p>`;
  return `<ul class="mej-cc-groups-manager">${rows.map((g) => `
    <li data-group-id="${esc(g.id)}"><strong>${esc(g.name)}</strong> — ${esc(g.memberNames)}
      <a data-manage="edit" data-tooltip="${game.i18n.localize(`${I18N}.secrets.editGroup`)}"><i class="fa-solid fa-pen"></i></a>
      <a data-manage="delete" data-tooltip="${game.i18n.localize(`${I18N}.confirmDelete.group.title`)}"><i class="fa-solid fa-trash"></i></a></li>`).join("")}</ul>`;
}

/** Modal list of groups with add/edit/delete; resolves when closed. */
export async function openGroupsManager() {
  if (!game.user.isGM) return;
  await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.secrets.groupsManagerTitle`) },
    content: `<div class="mej-cc-groups-manager-body">${groupsListHtml()}</div>
      <button type="button" data-manage="add"><i class="fa-solid fa-plus"></i> ${game.i18n.localize(`${I18N}.secrets.addGroup`)}</button>`,
    buttons: [{ action: "close", label: game.i18n.localize("Close"), default: true }],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element;
      const body = root.querySelector(".mej-cc-groups-manager-body");
      const repaint = () => { body.innerHTML = groupsListHtml(); };
      root.addEventListener("click", async (ev) => {
        const el = ev.target.closest("[data-manage]");
        if (!el) return;
        ev.preventDefault();
        const id = el.closest("[data-group-id]")?.dataset.groupId;
        const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
        if (el.dataset.manage === "add") {
          const result = await promptGroup({}, { titleKey: `${I18N}.secrets.addGroup` });
          if (result) await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id: foundry.utils.randomID(8), ...result }));
        } else if (el.dataset.manage === "edit") {
          const existing = groups.find((g) => g.id === id);
          const result = existing && await promptGroup(existing, { titleKey: `${I18N}.secrets.editGroup` });
          if (result) await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id, ...result }));
        } else if (el.dataset.manage === "delete") {
          const existing = groups.find((g) => g.id === id);
          if (existing && await confirmDelete({ kind: "group", name: existing.name })) {
            await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, deleteGroup(groups, id));
          }
        }
        repaint();
      });
    }
  });
}
```

In `scripts/apps/CampaignHubPage.mjs`: delete the private `static async #promptGroup(...)` method; add `import { promptGroup, openGroupsManager } from "./group-dialog.mjs";`; in `onAddGroup` and `onEditGroup` replace `CampaignHubPage.#promptGroup(` with `promptGroup(`.

- [ ] **Step 6: Campaign settings dialog gets the groups manager**

In `onEditCampaign`, change the `contributors` template so the groups block always renders (today it is omitted when there are no groups) and add a manage button:

```js
    const contributors = `
      <fieldset><legend>${esc(game.i18n.localize(`${I18N}.hub.contributors`))}</legend>
        <p class="hint">${esc(game.i18n.localize(`${I18N}.hub.contributorsHint`))}</p>
        <div class="form-group stacked"><label>${esc(game.i18n.localize(`${I18N}.hub.contributorsUsers`))}</label>
          ${choices.users.map((c) => box("contributorUser", c)).join("")}</div>
        <div class="form-group stacked mej-cc-contributor-groups"><label>${esc(game.i18n.localize(`${I18N}.hub.contributorsGroups`))}</label>
          ${choices.groups.map((c) => box("contributorGroup", c)).join("") || `<p class="notes">${esc(game.i18n.localize(`${I18N}.secrets.noGroupsYet`))}</p>`}
          <button type="button" data-action="manageGroups"><i class="fa-solid fa-users-gear"></i> ${esc(game.i18n.localize(`${I18N}.hub.manageGroups`))}</button></div>
      </fieldset>`;
```

Add a `render` option to that `DialogV2.prompt` call:

```js
      render: (event, dialog) => {
        dialog.element.querySelector('[data-action="manageGroups"]')?.addEventListener("click", async (ev) => {
          ev.preventDefault();
          await openGroupsManager();
          // Repaint the group checkboxes from the fresh setting; keep what was ticked.
          const host = dialog.element.querySelector(".mej-cc-contributor-groups");
          const ticked = new Set([...host.querySelectorAll('input[name="contributorGroup"]:checked')].map((i) => i.value));
          const fresh = contributorChoices(game.users.contents, game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), campaignFlagOf(campaign)).groups
            .map((c) => ({ ...c, checked: ticked.has(c.id) || c.checked }));
          host.querySelectorAll("label.checkbox, p.notes").forEach((n) => n.remove());
          const btn = host.querySelector('[data-action="manageGroups"]');
          const html = fresh.map((c) => box("contributorGroup", c)).join("") || `<p class="notes">${esc(game.i18n.localize(`${I18N}.secrets.noGroupsYet`))}</p>`;
          btn.insertAdjacentHTML("beforebegin", html);
        });
      },
```

- [ ] **Step 7: Strings**

`lang/en.json`:
- `hub.contributorsHint` → `"Contributors can take notes, add party relationships and create entries from selected text in this campaign. Entry creation needs a GM connected."`
- add `hub.manageGroups`: `"Manage player groups…"`
- add `secrets.groupsManagerTitle`: `"Player groups"`, `secrets.noGroupsYet`: `"No player groups yet."`
- `secrets.noGroups` → `"No groups defined yet — add them from Campaign settings or the Hub's Secrets tab."`

- [ ] **Step 8: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/apps/group-dialog.mjs scripts/logic/player-groups.mjs test/player-groups.test.js scripts/apps/CampaignHubPage.mjs lang/en.json
git commit -m "feat: player groups manageable from campaign settings; Contributors hint covers notes and party relationships"
```

---

### Task 5: Auto-capture feedback and single-campaign auto-target

**Files:**
- Modify: `scripts/logic/auto-capture.mjs` (add `resolveCaptureCampaign`)
- Modify: `scripts/hooks/auto-capture.mjs` (`captureCampaign` ~line 92, `fileOntoNewestTimepoint` ~98, `createEncounter` ~156-175, `captureCombatEnd` merge path, `captureSharedImage` ~232)
- Modify: `lang/en.json` (`autoCapture.encounterCaptured`, `autoCapture.encounterUpdated`, `autoCapture.mediaCaptured`)
- Test: `test/auto-capture.test.js` (extend)

**Interfaces:**
- Produces: `resolveCaptureCampaign(settingId, campaigns)` → `{ campaign: object|null, reason: "set" | "single" | "none" | "multi" }`.

- [ ] **Step 1: Failing tests**

Append to `test/auto-capture.test.js`:

```js
import { resolveCaptureCampaign } from "../scripts/logic/auto-capture.mjs";

describe("resolveCaptureCampaign", () => {
  const a = { id: "a" }, b = { id: "b" };
  it("an explicit, existing target wins", () => {
    expect(resolveCaptureCampaign("b", [a, b])).toEqual({ campaign: b, reason: "set" });
  });
  it("a single campaign is the target even when the setting is empty or stale", () => {
    expect(resolveCaptureCampaign("", [a])).toEqual({ campaign: a, reason: "single" });
    expect(resolveCaptureCampaign("zzz", [a])).toEqual({ campaign: a, reason: "single" });
  });
  it("several campaigns and no valid target: multi", () => {
    expect(resolveCaptureCampaign("", [a, b])).toEqual({ campaign: null, reason: "multi" });
  });
  it("no campaigns: none (legacy loose behaviour)", () => {
    expect(resolveCaptureCampaign("", [])).toEqual({ campaign: null, reason: "none" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/auto-capture.test.js` → FAIL, not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/auto-capture.mjs`:

```js
/**
 * Which campaign receives captures (spec 2026-10-15 §5.7): the explicit
 * setting when it names an existing campaign; otherwise the only campaign
 * when there is exactly one; otherwise null with the reason.
 */
export function resolveCaptureCampaign(settingId, campaigns) {
  const list = campaigns ?? [];
  const set = settingId ? list.find((c) => c.id === settingId) ?? null : null;
  if (set) return { campaign: set, reason: "set" };
  if (list.length === 1) return { campaign: list[0], reason: "single" };
  return { campaign: null, reason: list.length ? "multi" : "none" };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/auto-capture.test.js` → PASS.

- [ ] **Step 5: Wire the hooks**

In `scripts/hooks/auto-capture.mjs`:

1. Import `resolveCaptureCampaign` from `../logic/auto-capture.mjs` (extend the existing import from that module).
2. Replace `captureCampaign()` with:

```js
/** The campaign that receives captures, resolved per logic/auto-capture.mjs#resolveCaptureCampaign. */
function captureTarget() {
  const id = game.settings.get(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING);
  return resolveCaptureCampaign(id, getCampaigns());
}
```

3. In `fileOntoNewestTimepoint`: replace the first two lines with
```js
  const { campaign, reason } = captureTarget();
  if (reason === "multi") return; // several campaigns, no target chosen: decline silently for media
```
4. In `createEncounter`: replace the first four lines with
```js
  const { campaign, reason } = captureTarget();
  if (reason === "multi") {
    ui.notifications.warn(game.i18n.localize(`${I18N}.hub.captureNoCampaign`));
    return null;
  }
```
and after `await queueFiling(...)` add
```js
  ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.encounterCaptured`, { name: page.name }));
```
5. In the combat-end path, after `if (existingPage) await mergeEncounter(...)` add on the same branch:
```js
  if (existingPage) ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.encounterUpdated`, { name: existingPage.name }));
```
(restructure the `if/else` into a block so the toast sits inside the `existingPage` branch).
6. In `captureSharedImage`, after `queueFiling(...)` add
```js
  ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.mediaCaptured`, { name: caption || src.split("/").pop() }));
```

- [ ] **Step 6: Strings**

`lang/en.json` `MEJCampaignCompanion.autoCapture` add:
```json
"encounterCaptured": "Encounter \"{name}\" recorded on the campaign timeline.",
"encounterUpdated": "Encounter \"{name}\" updated with the outcome.",
"mediaCaptured": "\"{name}\" filed on the campaign timeline."
```
And `hub.captureNoCampaign` → `"Several campaigns exist and none is set to receive captures — choose one under Tools → Auto-capture campaign."`

- [ ] **Step 7: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/auto-capture.mjs scripts/hooks/auto-capture.mjs test/auto-capture.test.js lang/en.json
git commit -m "feat: auto-capture targets the only campaign automatically and confirms each capture"
```

---

### Task 6: Export scoped to the campaign (with its timelines)

**Files:**
- Modify: `scripts/logic/doc-export-snapshot.mjs` (add `scopeExportRows`, `campaignTimepoints`)
- Modify: `scripts/apps/export-dialog.mjs` (`promptExport`, `openExportDialog`, `runExport` title)
- Modify: `scripts/apps/CampaignHubPage.mjs:181` (`onOpenExportDialog` passes the scoped campaign)
- Modify: `lang/en.json` (`export.scope`, `export.scopeCampaign`, `export.scopeWorld`)
- Test: `test/doc-export-snapshot.test.js` (extend)

**Interfaces:**
- Produces: `scopeExportRows(rows, { scope, campaignId, campaignIdOf })` → rows filtered to the campaign when `scope === "campaign"`; `campaignTimepoints(timelines, getTimepoints)` → concatenated timepoints, timeline order preserved.
- `openExportDialog({ campaign = null } = {})`.

- [ ] **Step 1: Failing tests**

Append to `test/doc-export-snapshot.test.js`:

```js
import { scopeExportRows, campaignTimepoints } from "../scripts/logic/doc-export-snapshot.mjs";

describe("scopeExportRows", () => {
  const rows = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
  const campaignIdOf = (row) => ({ a: "camp1", b: null, c: "camp2" })[row.uuid];
  it("campaign scope keeps only that campaign's rows (unfiled excluded: export is a record, not a link scope)", () => {
    expect(scopeExportRows(rows, { scope: "campaign", campaignId: "camp1", campaignIdOf })).toEqual([{ uuid: "a" }]);
  });
  it("world scope keeps everything", () => {
    expect(scopeExportRows(rows, { scope: "world", campaignId: "camp1", campaignIdOf })).toEqual(rows);
  });
  it("campaign scope with no campaign id falls back to everything", () => {
    expect(scopeExportRows(rows, { scope: "campaign", campaignId: null, campaignIdOf })).toEqual(rows);
  });
});

describe("campaignTimepoints (Review Focus 2: empty default timeline, populated second one)", () => {
  it("concatenates every timeline's points in timeline order", () => {
    const t1 = { id: "t1" }, t2 = { id: "t2" };
    const points = { t1: [], t2: [{ id: "p1", label: "Later", links: [] }] };
    expect(campaignTimepoints([t1, t2], (t) => points[t.id])).toEqual([{ id: "p1", label: "Later", links: [] }]);
  });
  it("no timelines -> []", () => expect(campaignTimepoints([], () => [])).toEqual([]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/doc-export-snapshot.test.js` → FAIL, not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/doc-export-snapshot.mjs`:

```js
/**
 * Export scope (spec 2026-10-15 §5.6): "campaign" keeps rows filed in that
 * campaign; "world" (or no campaign id) keeps everything. Unfiled entries
 * are NOT part of a campaign export - an export is the campaign's record.
 */
export function scopeExportRows(rows, { scope, campaignId, campaignIdOf }) {
  if (scope !== "campaign" || !campaignId) return [...(rows ?? [])];
  return (rows ?? []).filter((row) => campaignIdOf(row) === campaignId);
}

/** Every timepoint of every given timeline, timeline order first, then each timeline's own order. */
export function campaignTimepoints(timelines, getTimepoints) {
  return (timelines ?? []).flatMap((t) => getTimepoints(t) ?? []);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/doc-export-snapshot.test.js` → PASS.

- [ ] **Step 5: Dialog and run**

`scripts/apps/export-dialog.mjs`:

1. Imports: add `scopeExportRows, campaignTimepoints` to the `doc-export-snapshot.mjs` import; add `import { campaignTimelines } from "../data/timeline-journal.mjs";` (keep `getTimelineJournal`); add `import { campaignIdOf } from "../logic/campaigns.mjs";`.
2. `promptExport(rows, { campaign })`: when `campaign` is non-null, prepend to `content`:

```js
  const scopeSelect = campaign ? `
    <div class="form-group"><label>${game.i18n.localize(`${I18N}.export.scope`)}</label>
      <select name="scope">
        <option value="campaign" selected>${game.i18n.format(`${I18N}.export.scopeCampaign`, { name: esc(campaign.name) })}</option>
        <option value="world">${game.i18n.localize(`${I18N}.export.scopeWorld`)}</option>
      </select></div>` : "";
```
and return `scope: form.scope?.value ?? "world"` from the callback. Rows are rendered for the world; a `change` listener on the select hides rows outside the campaign. Add to the `DialogV2.prompt` call:

```js
    render: (event, dialog) => {
      const select = dialog.element.querySelector('select[name="scope"]');
      if (!select) return;
      const apply = () => {
        for (const label of dialog.element.querySelectorAll(".mej-cc-export-row")) {
          const inCampaign = label.dataset.campaign === campaign.id;
          label.hidden = select.value === "campaign" && !inCampaign;
          const box = label.querySelector("input");
          if (label.hidden) box.checked = false; else if (!box.dataset.touched) box.checked = true;
        }
      };
      dialog.element.querySelectorAll(".mej-cc-export-row input").forEach((i) => i.addEventListener("change", () => { i.dataset.touched = "1"; }));
      select.addEventListener("change", apply);
      apply();
    },
```
and give each row label `data-campaign="${esc(campaignIdOf(row.page.parent) ?? "")}"`.

3. `openExportDialog({ campaign = null } = {})`:

```js
export async function openExportDialog({ campaign = null } = {}) {
  if (!game.user.isGM) return;
  const rows = eligibleEntries(game.journal.contents, (entry) => mejType(entry));
  if (!rows.length) {
    return void ui.notifications.warn(game.i18n.localize(`${I18N}.export.nothingToExport`));
  }
  const result = await promptExport(orderEligibleEntries(rows, worldTimepoints()), { campaign });
  if (!result || !result.selected.length) return;
  const scoped = scopeExportRows(result.selected, {
    scope: campaign ? result.scope : "world", campaignId: campaign?.id ?? null,
    campaignIdOf: (row) => campaignIdOf(row.page.parent)
  });
  if (!scoped.length) return void ui.notifications.warn(game.i18n.localize(`${I18N}.export.nothingToExport`));
  const timepoints = campaign && result.scope === "campaign"
    ? campaignTimepoints(campaignTimelines(campaign), (t) => Timepoints.getTimepoints(t))
    : worldTimepoints();
  const title = campaign && result.scope === "campaign" ? campaign.name : (game.world.title || game.i18n.localize(`${I18N}.export.defaultTitle`));
  await runExport(scoped, result.includeGM, timepoints, title);
}

/** Legacy singleton timeline's points (world scope), [] when the world has none. */
function worldTimepoints() {
  const journal = getTimelineJournal();
  return journal ? Timepoints.getTimepoints(journal) : [];
}
```

4. `runExport(selectedRows, includeGM, timepoints, title)`: delete its own `const title = ...` line and use the parameter.

5. `scripts/apps/CampaignHubPage.mjs` line 181 maps `openExportDialog: CampaignHubPage.onOpenExportDialog`. Make that handler pass the scope:

```js
  static onOpenExportDialog() {
    const { campaign } = this.#scope();
    return openExportDialog({ campaign });
  }
```
(If the existing handler is an inline arrow, replace it with this static method.)

- [ ] **Step 6: Strings**

`lang/en.json` `MEJCampaignCompanion.export` add:
```json
"scope": "Export",
"scopeCampaign": "This campaign ({name}) with its timelines",
"scopeWorld": "Whole world"
```

- [ ] **Step 7: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/doc-export-snapshot.mjs scripts/apps/export-dialog.mjs scripts/apps/CampaignHubPage.mjs test/doc-export-snapshot.test.js lang/en.json
git commit -m "feat: Word export scoped to the Hub's campaign with its own timelines"
```

---

### Task 7: Party relationship picker and drop honour campaign scope

**Files:**
- Modify: `scripts/logic/party-rows.mjs:57-64` (`targetProblem`)
- Modify: `scripts/hooks/party-relationships-ui.mjs` (`openPicker` ~line 147; `addTarget`'s `targetProblem` ctx)
- Modify: `lang/en.json` (`party.drop.other-campaign`)
- Test: `test/party-rows.test.js` (extend)

**Interfaces:**
- `targetProblem(target, ctx)` gains optional `ctx.sourceCampaignId` and `ctx.campaignIdOf(doc)`; returns `"other-campaign"` when both are set and `sameLinkScope` says no. Existing callers without those keys are unchanged.

- [ ] **Step 1: Failing tests**

Append to `test/party-rows.test.js` (inside or after the existing `targetProblem` describe):

```js
describe("targetProblem campaign scope (spec 2026-10-15 §5.6)", () => {
  const base = { sourceUuid: A, allowed: ["person"], typeOf: () => "person", canLimited: () => true };
  const target = { uuid: B, name: "B" };
  it("another campaign is refused", () => {
    expect(targetProblem(target, { ...base, sourceCampaignId: "c1", campaignIdOf: () => "c2" })).toBe("other-campaign");
  });
  it("same campaign or unfiled on either side is fine", () => {
    expect(targetProblem(target, { ...base, sourceCampaignId: "c1", campaignIdOf: () => "c1" })).toBeNull();
    expect(targetProblem(target, { ...base, sourceCampaignId: "c1", campaignIdOf: () => null })).toBeNull();
    expect(targetProblem(target, { ...base, sourceCampaignId: null, campaignIdOf: () => "c2" })).toBeNull();
  });
  it("callers that pass no scope keep today's behaviour", () => {
    expect(targetProblem(target, base)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/party-rows.test.js` → FAIL on "another campaign is refused" (`null` received).

- [ ] **Step 3: Implement**

In `scripts/logic/party-rows.mjs` add `import { sameLinkScope } from "./link-targets.mjs";` and change `targetProblem`:

```js
export function targetProblem(target, { sourceUuid, allowed, typeOf, canLimited, sourceCampaignId, campaignIdOf }) {
  if (!target || !entryIdOf(target.uuid)) return "not-journal";
  if (target.uuid === sourceUuid) return "self";
  if (!canLimited(target)) return "no-access";
  if (campaignIdOf && !sameLinkScope(sourceCampaignId ?? null, campaignIdOf(target) ?? null)) return "other-campaign";
  const type = typeOf(target);
  if (!type || !(allowed ?? []).includes(type)) return "type-not-allowed";
  return null;
}
```

Check `link-targets.mjs` imports nothing Foundry-only (it imports `field-extractors.mjs`, which is pure) so the test still loads.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/party-rows.test.js` → PASS.

- [ ] **Step 5: Wire the UI**

`scripts/hooks/party-relationships-ui.mjs`: add `import { campaignIdOf } from "../logic/campaigns.mjs";` (if not already imported). In `openPicker` and in `addTarget` (wherever the `ctx` object for `targetProblem`/`eligibleTargets` is built), add two keys:

```js
    sourceCampaignId: campaignIdOf(entry), campaignIdOf: (doc) => campaignIdOf(doc)
```

The drop path already maps `targetProblem` reasons to `L("drop.<reason>")`; add the string.

- [ ] **Step 6: Strings**

`lang/en.json` `MEJCampaignCompanion.party.drop` add `"other-campaign": "That entry belongs to another campaign."`

- [ ] **Step 7: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/party-rows.mjs scripts/hooks/party-relationships-ui.mjs test/party-rows.test.js lang/en.json
git commit -m "feat: party relationship picker and drop stay inside the campaign"
```

---

### Task 8: "Mentioned in" honours campaign scope

**Files:**
- Modify: `scripts/logic/link-targets.mjs` (add `scopeBacklinks`)
- Modify: `scripts/search/live-index.mjs:229-238` (`backlinksForEntry`)
- Test: `test/link-targets.test.js` (extend)

**Interfaces:**
- Produces: `scopeBacklinks(rows, targetCampaignId, campaignIdOfUuid)` → rows whose source is in link scope of the target.

- [ ] **Step 1: Failing test**

Append to `test/link-targets.test.js`:

```js
import { scopeBacklinks } from "../scripts/logic/link-targets.mjs";

describe("scopeBacklinks", () => {
  const rows = [{ uuid: "s1", count: 2 }, { uuid: "s2", count: 1 }, { uuid: "s3", count: 1 }];
  const cid = (uuid) => ({ s1: "c1", s2: "c2", s3: null })[uuid];
  it("drops sources from another campaign, keeps same-campaign and unfiled", () => {
    expect(scopeBacklinks(rows, "c1", cid)).toEqual([{ uuid: "s1", count: 2 }, { uuid: "s3", count: 1 }]);
  });
  it("an unfiled target sees everything", () => {
    expect(scopeBacklinks(rows, null, cid)).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/link-targets.test.js` → FAIL, not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/link-targets.mjs`:

```js
/** Backlink rows whose source is in linking reach of the target (spec 2026-10-15 §5.6). */
export function scopeBacklinks(rows, targetCampaignId, campaignIdOfUuid) {
  return (rows ?? []).filter((row) => sameLinkScope(targetCampaignId ?? null, campaignIdOfUuid(row.uuid) ?? null));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/link-targets.test.js` → PASS.

- [ ] **Step 5: Wire**

In `scripts/search/live-index.mjs`, add `import { scopeBacklinks } from "../logic/link-targets.mjs";` and change `backlinksForEntry`:

```js
export function backlinksForEntry(targetUuid) {
  const idx = ensureIndex();
  const target = fromUuidSync(targetUuid);
  const rows = backlinksFor(backlinks, targetUuid, { gm: game.user.isGM })
    .filter(({ uuid }) => userCanSee(uuid));
  return scopeBacklinks(rows, target ? campaignIdOf(target) : null, (uuid) => campaignIdOf(fromUuidSync(uuid)))
    .map(({ uuid, count, gmOnly }) => {
      const rec = idx.records.get(uuid);
      return { uuid, count, gmOnly, name: rec?.name ?? fromUuidSync(uuid)?.name ?? uuid, type: rec?.type ?? "" };
    });
}
```

- [ ] **Step 6: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/link-targets.mjs scripts/search/live-index.mjs test/link-targets.test.js
git commit -m "feat: Mentioned in lists only sources in the entry's campaign scope"
```

---

### Task 9: `@CampaignQuery` scoped to its page's campaign, `scope:all` opts out

**Files:**
- Modify: `scripts/logic/query-grammar.mjs` (`parseQuery` learns `scope:`; add `scopeHits`)
- Modify: `scripts/search/live-index.mjs` (add `runQueryScoped`)
- Modify: `scripts/hooks/query-enricher.mjs` (`enrichCampaignQuery(match, options)`)
- Modify: `scripts/apps/CampaignHubPage.mjs` dashboards hint string only via `lang/en.json` (`hub.dashboards.queryHint`)
- Test: `test/query-grammar.test.js` (extend)

**Interfaces:**
- `parseQuery(str)` → adds `scope: "campaign" | "all"` (default `"campaign"`); `scope:` with any other value throws `Error("bad-scope")`; a query that is only `scope:all` still throws `empty-query`.
- `scopeHits(hits, parsed, pageCampaignId, campaignIdOfUuid)` → hits filtered by `sameLinkScope` unless `parsed.scope === "all"` or `pageCampaignId` is null.
- `runQueryScoped(queryString, pageCampaignId)` in live-index.

- [ ] **Step 1: Failing tests**

Append to `test/query-grammar.test.js`:

```js
import { scopeHits } from "../scripts/logic/query-grammar.mjs";

describe("scope token (spec 2026-10-15 §5.6)", () => {
  it("defaults to campaign scope", () => expect(parseQuery("type:person").scope).toBe("campaign"));
  it("scope:all opts out and is not free text", () => {
    const p = parseQuery("type:person scope:all");
    expect(p.scope).toBe("all");
    expect(p.text).toBe("");
  });
  it("rejects an unknown scope value", () => expect(() => parseQuery("type:person scope:mine")).toThrow("bad-scope"));
  it("scope alone is still an empty query", () => expect(() => parseQuery("scope:all")).toThrow("empty-query"));
});

describe("scopeHits (Review Focus 3)", () => {
  const hits = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
  const cid = (uuid) => ({ a: "c1", b: "c2", c: null })[uuid];
  it("campaign page: same campaign and unfiled only", () => {
    expect(scopeHits(hits, { scope: "campaign" }, "c1", cid)).toEqual([{ uuid: "a" }, { uuid: "c" }]);
  });
  it("unfiled page: everything", () => expect(scopeHits(hits, { scope: "campaign" }, null, cid)).toEqual(hits));
  it("scope:all: everything", () => expect(scopeHits(hits, { scope: "all" }, "c1", cid)).toEqual(hits));
});
```

(`parseQuery` is already imported at the top of that test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/query-grammar.test.js` → FAIL.

- [ ] **Step 3: Implement**

In `scripts/logic/query-grammar.mjs`:
1. `import { sameLinkScope } from "./link-targets.mjs";`
2. In `parseQuery`, initialise `const parsed = { types: [], tags: [], attrs: [], text: "", scope: "campaign" };`, change the regex to `/^(type|tag|attr|scope):(.+)$/i`, and add a branch before the `else` (attr) branch:

```js
    } else if (prefix === "scope") {
      const v = rest.toLowerCase();
      if (v !== "all" && v !== "campaign") throw new Error("bad-scope");
      parsed.scope = v;
```
The existing empty-query check already ignores `scope`, so `scope:all` alone throws `empty-query`.

3. Append:

```js
/** Drop hits outside the rendering page's campaign unless the query says scope:all (spec 2026-10-15 §5.6). */
export function scopeHits(hits, parsed, pageCampaignId, campaignIdOfUuid) {
  if (parsed?.scope === "all" || !pageCampaignId) return [...(hits ?? [])];
  return (hits ?? []).filter((h) => sameLinkScope(pageCampaignId, campaignIdOfUuid(h.uuid) ?? null));
}
```

4. In `scripts/search/live-index.mjs` add (next to `runQueryAll`), importing `parseQuery, scopeHits` from `../logic/query-grammar.mjs`:

```js
/** runQueryAll, then campaign scope for an enricher rendering inside `pageCampaignId` (null = unfiled page, no filter). */
export function runQueryScoped(queryString, pageCampaignId) {
  const parsed = parseQuery(queryString);
  return scopeHits(runQueryAll(queryString), parsed, pageCampaignId, (uuid) => campaignIdOf(fromUuidSync(uuid)));
}
```

5. In `scripts/hooks/query-enricher.mjs`: import `runQueryScoped` instead of `runQueryAll` and `campaignIdOf` from `../logic/campaigns.mjs`; change the signature to `async function enrichCampaignQuery(match, options)` and the call to `const hits = runQueryScoped(query, campaignIdOf(options?.relativeTo ?? null));`.

6. `lang/en.json` `hub.dashboards.queryHint` → `"Tokens: type:<key>, tag:<tag>, attr:<key>=<value>, scope:all (inline queries only); anything else is full-text search."`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/query-grammar.test.js` → PASS. Then `npx vitest run` → PASS (dashboards still use `runQueryAll`, so their behaviour is unchanged; the `scope` key is ignored there).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/query-grammar.mjs scripts/search/live-index.mjs scripts/hooks/query-enricher.mjs test/query-grammar.test.js lang/en.json
git commit -m "feat: @CampaignQuery results stay in the page's campaign; scope:all opts out"
```

---

### Task 9b: Opening the Hub from the shell control scopes to the open entry's campaign

(Deferred here from Plan A, spec item 4: "opening the Hub from the shell control scopes to the campaign of the entry currently open, when there is one.")

**Files:**
- Create: `scripts/logic/hub-open-scope.mjs`
- Modify: `scripts/campaign-companion.mjs:257-266` (`activateControls` hook)
- Test: `test/hub-open-scope.test.js`

**Interfaces:**
- Produces: `hubScopeForOpenDocument(doc, { campaignIdOf, isHubPlaceholder })` → a campaign folder id, or `""` ("All campaigns") when there is no open document, the open document is the Hub's own placeholder, or the document is unfiled.
- Consumes: `campaignIdOf` from `scripts/logic/campaigns.mjs` (accepts a JournalEntry or JournalEntryPage); `setHubScope` from `scripts/apps/CampaignHubPage.mjs` and `HUB_CAMPAIGN_SCOPE_SETTING` (the same pair `scripts/hooks/folder-context.mjs:24-29` uses); `openHub` from `scripts/integrations/mej-adapter.mjs`.

- [ ] **Step 1: Failing test**

`test/hub-open-scope.test.js`:

```js
import { describe, it, expect } from "vitest";
import { hubScopeForOpenDocument } from "../scripts/logic/hub-open-scope.mjs";

const campaignIdOf = (doc) => doc?.campaign ?? null;
const isHubPlaceholder = (doc) => doc?.type === "campaign-hub";

describe("hubScopeForOpenDocument (spec item 4, shell control)", () => {
  it("an entry filed in a campaign scopes the Hub to it", () => {
    expect(hubScopeForOpenDocument({ campaign: "c1" }, { campaignIdOf, isHubPlaceholder })).toBe("c1");
  });
  it("an unfiled entry, no document, or the Hub placeholder itself means All", () => {
    expect(hubScopeForOpenDocument({ campaign: null }, { campaignIdOf, isHubPlaceholder })).toBe("");
    expect(hubScopeForOpenDocument(null, { campaignIdOf, isHubPlaceholder })).toBe("");
    expect(hubScopeForOpenDocument({ type: "campaign-hub", campaign: "c1" }, { campaignIdOf, isHubPlaceholder })).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/hub-open-scope.test.js` → FAIL, module not found.

- [ ] **Step 3: Implement**

`scripts/logic/hub-open-scope.mjs`:

```js
// scripts/logic/hub-open-scope.mjs
// Spec 2026-10-15 item 4: the shell's Campaign Hub control opens the Hub on
// the campaign of whatever entry the shell is showing. Pure: the hook passes
// the shell's current document and two predicates.

/**
 * @param {object|null} doc   the shell's current document (page or entry), or null
 * @param {{campaignIdOf:(doc:object)=>string|null, isHubPlaceholder:(doc:object)=>boolean}} deps
 * @returns {string} campaign folder id, or "" for All campaigns
 */
export function hubScopeForOpenDocument(doc, { campaignIdOf, isHubPlaceholder }) {
  if (!doc || isHubPlaceholder(doc)) return "";
  return campaignIdOf(doc) ?? "";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/hub-open-scope.test.js` → PASS.

- [ ] **Step 5: Wire the shell control**

In `scripts/campaign-companion.mjs`, replace the `activateControls` hook (lines 257-266) with:

```js
// Toolbar entry: a button alongside MEJ's own header controls on every tab,
// opening (or re-activating) the Hub's shell-page tab, scoped to the
// campaign of the entry the shell is showing (spec 2026-10-15 item 4).
Hooks.on("activateControls", (ej, ctrls) => {
  ctrls.push({
    id: HUB_PAGE_ID,
    label: game.i18n.localize(`${I18N}.hub.title`),
    icon: "fa-solid fa-timeline",
    type: "button",
    visible: true,
    callback: async () => {
      try {
        const [{ hubScopeForOpenDocument }, { campaignIdOf }, { setHubScope }] = await Promise.all([
          import("./logic/hub-open-scope.mjs"),
          import("./logic/campaigns.mjs"),
          import("./apps/CampaignHubPage.mjs")
        ]);
        const doc = ej?.document ?? game.MonksEnhancedJournal?.journal?.document ?? null;
        const scope = hubScopeForOpenDocument(doc, {
          campaignIdOf,
          isHubPlaceholder: (d) => d?.type === HUB_PAGE_ID || d?.id === HUB_PAGE_ID
        });
        if (scope) {
          setHubScope(scope);
          await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, scope);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | scoping the hub to the open entry failed`, err);
      }
      return openHub();
    }
  });
});
```

Make sure `HUB_CAMPAIGN_SCOPE_SETTING` is in the file's `constants.mjs` import (it is already imported for the settings registration; verify with grep). "All campaigns" is left as whatever the picker last held when `scope` is `""` — the spec says scope *to the campaign when there is one*, and a GM browsing an unfiled entry keeps their previous choice rather than being bounced to All. For a player who can see one campaign, Plan A's single-campaign lock makes the picker irrelevant anyway.

- [ ] **Step 6: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/hub-open-scope.mjs test/hub-open-scope.test.js scripts/campaign-companion.mjs
git commit -m "feat: the shell's Campaign Hub control opens on the open entry's campaign"
```

---

### Task 10: Recap editable by the campaign's players without a world setting; visible save state

**Files:**
- Modify: `scripts/logic/session-ownership.mjs:31-38` (`shouldOwnSessionEntry`)
- Modify: `scripts/campaign-companion.mjs:246-251` (preCreate hook) and the `playersWriteSessions` registration (~line 115)
- Create: `scripts/logic/recap-save-state.mjs`
- Modify: `scripts/sheets/SessionSheet.mjs` (`onEditRecap` ~line 359-390)
- Modify: `lang/en.json` (`settings.playersWriteSessions.*`, `session.recapSaving`, `session.recapSaved`)
- Modify: `README.md` settings table row; `docs/gm-guide.md` "Player collaboration" and settings reference
- Test: `test/session-ownership.test.js` (extend), `test/recap-save-state.test.js`

**Interfaces:**
- `shouldOwnSessionEntry(entryData, { sessionType, sessionDocumentType, playersWriteSessions, campaignBaseline = null, observerLevel = 2 })`.
- `recapClosePlan({ live, stored })` → `"saving" | "idle"`.

- [ ] **Step 1: Failing tests**

Append to `test/session-ownership.test.js`:

```js
describe("shouldOwnSessionEntry with a campaign baseline (spec 2026-10-15 item 8)", () => {
  const sessionShape = { pages: [{ type: SESSION_DOCUMENT_TYPE }] };
  const o = (extra) => ({ sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, playersWriteSessions: false, ...extra });
  it("baseline observer or above grants ownership without the setting", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2 }))).toBe(true);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 3 }))).toBe(true);
  });
  it("Review Focus 5: a GM-only campaign (baseline none) never grants it", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 0 }))).toBe(false);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 0, playersWriteSessions: true }))).toBe(false);
  });
  it("outside a campaign the legacy setting still decides", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: null }))).toBe(false);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: null, playersWriteSessions: true }))).toBe(true);
  });
  it("a non-session shape is never owned", () => {
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }] }, o({ campaignBaseline: 3 }))).toBe(false);
  });
});
```

`test/recap-save-state.test.js`:

```js
import { describe, it, expect } from "vitest";
import { recapClosePlan } from "../scripts/logic/recap-save-state.mjs";

describe("recapClosePlan", () => {
  it("saving when the live text differs from the stored recap", () => {
    expect(recapClosePlan({ live: "<p>new</p>", stored: "<p>old</p>" })).toBe("saving");
    expect(recapClosePlan({ live: "<p>new</p>", stored: undefined })).toBe("saving");
  });
  it("idle when nothing changed or the editor has no value", () => {
    expect(recapClosePlan({ live: "<p>same</p>", stored: "<p>same</p>" })).toBe("idle");
    expect(recapClosePlan({ live: undefined, stored: "<p>x</p>" })).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/session-ownership.test.js test/recap-save-state.test.js` → FAIL (baseline cases return false; module not found).

- [ ] **Step 3: Implement**

`scripts/logic/session-ownership.mjs` — replace `shouldOwnSessionEntry`:

```js
export function shouldOwnSessionEntry(entryData, { sessionType, sessionDocumentType, playersWriteSessions, campaignBaseline = null, observerLevel = 2 }) {
  const inCampaign = campaignBaseline !== null && campaignBaseline !== undefined;
  // Inside a campaign the baseline decides (spec 2026-10-15 item 8): a
  // campaign players can at least view makes its sessions theirs to write;
  // a GM-only campaign never does, whatever the legacy setting says.
  // Outside a campaign the legacy world setting keeps deciding.
  const granted = inCampaign ? campaignBaseline >= observerLevel : playersWriteSessions === true;
  if (!granted) return false;
  const pagetype = entryData?.flags?.["monks-enhanced-journal"]?.pagetype;
  if (pagetype === sessionType) return true;
  return Array.isArray(entryData?.pages)
    && entryData.pages.some((p) => p?.type === sessionType || p?.type === sessionDocumentType);
}
```

Update the doc comment above it to say the same.

`scripts/logic/recap-save-state.mjs`:

```js
// scripts/logic/recap-save-state.mjs
// Spec 2026-10-15 §5.2: a visible save state replaces "click the pencil
// again to commit". Pure: the sheet reads the editor's live value and the
// stored recap and asks whether closing will write anything.
import { shouldCommitGmNotes } from "./gm-notes-commit.mjs";

/** @returns {"saving"|"idle"} */
export function recapClosePlan({ live, stored }) {
  return shouldCommitGmNotes(live, stored) ? "saving" : "idle";
}
```

`scripts/campaign-companion.mjs` preCreate hook (lines 246-251):

```js
Hooks.on("preCreateJournalEntry", (entry, data) => {
  if (!game.user.isGM) return;
  const playersWriteSessions = game.settings.get(MODULE_ID, PLAYERS_WRITE_SESSIONS_SETTING);
  const folder = entry.folder ?? game.folders.get(data?.folder?.id ?? data?.folder) ?? null;
  const campaign = campaignOfFolder(folder);
  const campaignBaseline = campaign ? baselineOwnership(campaign) : null;
  if (!shouldOwnSessionEntry(data, {
    sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, playersWriteSessions,
    campaignBaseline, observerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
  })) return;
  entry.updateSource({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
});
```
Add `import { campaignOfFolder } from "./logic/campaigns.mjs";` and `import { baselineOwnership } from "./data/campaign-store.mjs";` if not already imported in that file (grep first; `campaigns.mjs` is likely already imported for other helpers — extend that import).

Setting registration: keep the key and the `onChange`; only the strings change (Step 5). Readers of the setting, all kept: this hook; `onChange` → `offerExistingSessionOwnership`; README/gm-guide text.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/session-ownership.test.js test/recap-save-state.test.js` → PASS.

- [ ] **Step 5: Save state in the sheet, and strings**

`scripts/sheets/SessionSheet.mjs`, in `onEditRecap`, after `const opening = !(editor?.open ?? false);` add:

```js
    if (!opening && editor) {
      const plan = recapClosePlan({ live: editor.value, stored: this.document?.system?.recap });
      if (plan === "saving") {
        const uuid = this.document.uuid;
        ui.notifications.info(game.i18n.localize(`${I18N}.session.recapSaving`), { permanent: false });
        const hookId = Hooks.on("updateJournalEntryPage", (page, changes) => {
          if (page.uuid !== uuid || changes?.system?.recap === undefined) return;
          Hooks.off("updateJournalEntryPage", hookId);
          ui.notifications.info(game.i18n.localize(`${I18N}.session.recapSaved`));
        });
        setTimeout(() => Hooks.off("updateJournalEntryPage", hookId), 10_000);
      }
    }
```
Import `recapClosePlan` from `../logic/recap-save-state.mjs`.

`lang/en.json`:
- `session.recapSaving`: `"Saving recap…"`, `session.recapSaved`: `"Recap saved."`
- `settings.playersWriteSessions.name` → `"Players Write Sessions (outside campaigns)"`; `.hint` → `"Sessions inside a campaign whose Player access is at least \"Players can view\" are already editable by players. Turn this on only to make sessions outside any campaign player-editable too; it also offers ownership of existing sessions."`

Docs: in `README.md`'s Settings table, update the `playersWriteSessions` row's Purpose to the new hint; in the "Player collaboration" feature bullet replace the first sentence with "Sessions created inside a campaign whose baseline is **Players can view** or **Players can edit** are owned by all players, so they can edit the shared recap directly; `playersWriteSessions` now only covers sessions outside any campaign." In `docs/gm-guide.md` "Player collaboration" first paragraph, say the same, and in the settings reference bullet for **Players Write Sessions** use the new name and hint.

- [ ] **Step 6: Suite + commit**

Run: `npx vitest run` → PASS.

```bash
git add scripts/logic/session-ownership.mjs scripts/logic/recap-save-state.mjs scripts/campaign-companion.mjs scripts/sheets/SessionSheet.mjs test/session-ownership.test.js test/recap-save-state.test.js lang/en.json README.md docs/gm-guide.md
git commit -m "feat: campaign sessions are player-editable by baseline; recap shows saving/saved"
```

---

### Task 11: Revealing is filing (requires Plan B at runtime; builds without it)

**Files:**
- Create: `scripts/logic/reveal-note.mjs`, `scripts/hooks/reveal-filing.mjs`
- Modify: `scripts/hooks/secrets-ui.mjs` (`editAudience` ~line 175-200), `scripts/hooks/relationships-ui.mjs:49-70` (`editRelAudience`), `scripts/sheets/SessionSheet.mjs` (`onSecretAudience`), `scripts/apps/CampaignHubPage.mjs` (the three Secrets-tab reveal branches ~lines 1005-1050), `scripts/hooks/auto-capture.mjs` (`captureSharedImage`)
- Modify: `scripts/constants.mjs` (add `REVEAL_NOTES_FLAG`)
- Modify: `lang/en.json` (`revealNote.*`)
- Test: `test/reveal-note.test.js`

**Interfaces:**
- Consumes (Plan B): `addNote(campaignFolderId, payload)` → `Promise<string>` (the note id; if Plan B returns an object, read `.id`), `retractNote(campaignFolderId, id)`, `updateNote(campaignFolderId, id, { audience })` (audience-only patch, GM caller), from `scripts/data/notes-store.mjs`; `currentSession(campaignFolder)` → `{ uuid, startedAt } | null` from `scripts/logic/current-session.mjs`. The payload carries one extra field, `ref`, beyond Plan B's listed fields; Plan B's store must keep unknown fields (spec §9 storage rule).
- Produces: `revealTransition(previous, next)` → `"reveal" | "retract" | "none"`; `revealNote({ entryUuid, entryName, pageUuid, blockId, kind, audience, revealedBy, at, sessionUuid, label })` → `addNote` payload; `fileRevealChange({ entry, target, kind, id, previous, audience, label })` glue; `fileMediaNote({ entry: null, src, caption })`.
- `REVEAL_NOTES_FLAG = "revealNotes"`: a map `{ "<kind>-<id>": noteId }` on the document that holds the reveal record (page for block/checklist, entry for relationships).

- [ ] **Step 1: Failing tests**

`test/reveal-note.test.js`:

```js
import { describe, it, expect } from "vitest";
import { revealTransition, revealNote, revealKey } from "../scripts/logic/reveal-note.mjs";

const none = { users: [], groups: [], all: false };

describe("revealTransition (Review Focus 4)", () => {
  it("nothing -> someone is a reveal", () => {
    expect(revealTransition(none, { users: ["u1"], groups: [], all: false })).toBe("reveal");
    expect(revealTransition(undefined, { users: [], groups: [], all: true })).toBe("reveal");
  });
  it("someone -> someone else is an audience update, not a new reveal", () => {
    expect(revealTransition({ users: ["u1"], groups: [], all: false }, { users: ["u1", "u2"], groups: [], all: false })).toBe("update");
    expect(revealTransition({ users: ["u1"], groups: [], all: false }, { users: [], groups: [], all: true })).toBe("update");
  });
  it("same audience in a different order is none", () => {
    expect(revealTransition({ users: ["u1", "u2"], groups: [], all: false }, { users: ["u2", "u1"], groups: [], all: false })).toBe("none");
  });
  it("someone -> nobody is a retract", () => {
    expect(revealTransition({ users: [], groups: ["g1"], all: false }, none)).toBe("retract");
    expect(revealTransition({ users: [], groups: [], all: true }, none)).toBe("retract");
  });
  it("nobody -> nobody is none", () => expect(revealTransition(none, none)).toBe("none"));
});

describe("revealNote", () => {
  const base = { entryUuid: "JournalEntry.e1", entryName: "The Missing Caravan", pageUuid: "JournalEntry.e1.JournalEntryPage.p1", blockId: "secret-1", kind: "block", revealedBy: "gm", at: 1000, sessionUuid: "JournalEntry.s1", label: "Revealed a secret from The Missing Caravan" };
  it("references the block and never copies secret text", () => {
    const note = revealNote({ ...base, audience: { users: ["u1"], groups: [], all: false } });
    expect(note).toEqual({
      text: "Revealed a secret from The Missing Caravan",
      authorId: "gm", at: 1000, worldDate: null, sessionUuid: "JournalEntry.s1",
      mentions: ["JournalEntry.e1"], kind: "reveal",
      audience: { users: ["u1"], groups: [] },
      ref: { pageUuid: "JournalEntry.e1.JournalEntryPage.p1", blockId: "secret-1", kind: "block" }
    });
    expect(JSON.stringify(note)).not.toMatch(/staged/);
  });
  it("Everyone -> audience null (readable by every baseline reader)", () => {
    expect(revealNote({ ...base, audience: { users: [], groups: [], all: true } }).audience).toBeNull();
  });
});

describe("revealKey", () => {
  it("builds a flag-safe key per reveal record", () => {
    expect(revealKey("block", "secret-1")).toBe("block-secret-1");
    expect(revealKey("rel", "r.1")).toBe("rel-r_1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/reveal-note.test.js` → FAIL, module not found.

- [ ] **Step 3: Pure module**

`scripts/logic/reveal-note.mjs`:

```js
// scripts/logic/reveal-note.mjs
// Spec 2026-10-15 §5 principle 4 and §9: "revealing is filing". A reveal
// that takes a secret from nobody to somebody files one GM-authored note on
// the current session; taking it back to nobody retracts that note. Adding
// a second player to an already-revealed secret files nothing. The note
// REFERENCES the page and block - it never copies secret text - and carries
// the reveal's audience so the note is soft-hidden exactly like the secret.
import { normalizeAudience, isRevealed } from "./reveal-state.mjs";

const audienceKey = (a) => (a.all ? "all" : `${[...a.users].sort().join(",")}|${[...a.groups].sort().join(",")}`);

/** @returns {"reveal"|"retract"|"update"|"none"} */
export function revealTransition(previous, next) {
  const prev = normalizeAudience(previous);
  const nxt = normalizeAudience(next);
  const was = isRevealed(prev);
  const is = isRevealed(nxt);
  if (!was && is) return "reveal";
  if (was && !is) return "retract";
  if (was && is && audienceKey(prev) !== audienceKey(nxt)) return "update";
  return "none";
}

/** Flag-safe key for the revealNotes map ("." is a path separator in Foundry updates). */
export function revealKey(kind, id) {
  return `${kind}-${String(id).replace(/[.]/g, "_")}`;
}

/** The addNote payload for a reveal (Plan B's notes-store contract plus `ref`). */
export function revealNote({ entryUuid, entryName, pageUuid, blockId, kind, audience, revealedBy, at, sessionUuid, label }) {
  const a = normalizeAudience(audience);
  return {
    text: label,
    authorId: revealedBy,
    at,
    worldDate: null,
    sessionUuid: sessionUuid ?? null,
    mentions: entryUuid ? [entryUuid] : [],
    kind: "reveal",
    audience: a.all ? null : { users: [...a.users], groups: [...a.groups] },
    ref: { pageUuid: pageUuid ?? null, blockId: blockId ?? null, kind }
  };
}
```

Check `isRevealed` in `reveal-state.mjs` returns true for `all || users.length || groups.length`; if it only checks users/groups, extend the test expectations to call `normalizeAudience` first (it does today: read the function before relying on it).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/reveal-note.test.js` → PASS.

- [ ] **Step 5: Glue hook**

`scripts/constants.mjs`: after `PARTY_ROWS_FLAG` add
```js
/** Reveal → note bookkeeping (spec 2026-10-15 §9): { "<kind>-<id>": noteId } on the document holding the reveal record. */
export const REVEAL_NOTES_FLAG = "revealNotes";
```

`scripts/hooks/reveal-filing.mjs`:

```js
// scripts/hooks/reveal-filing.mjs
// Glue between the reveal paths and Plan B's note store. Every function
// here is a no-op when the store or the current-session helper is absent
// (Plan B not merged), when the entry is in no campaign, or when no session
// is open - revealing never fails because filing could not happen.
import { MODULE_ID, I18N, REVEAL_NOTES_FLAG } from "../constants.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { revealTransition, revealNote, revealKey } from "../logic/reveal-note.mjs";

async function loadStore() {
  try {
    const [store, session] = await Promise.all([
      import("../data/notes-store.mjs"),
      import("../logic/current-session.mjs")
    ]);
    return { store, currentSession: session.currentSession };
  } catch {
    return null; // Plan B not present
  }
}

/**
 * @param {object} args
 * @param {JournalEntry} args.entry       the entry the secret belongs to
 * @param {Document} args.target          document holding the reveal record (page or entry)
 * @param {"block"|"checklist"|"rel"} args.kind
 * @param {string} args.id                 block section id / checklist item id / relationship id
 * @param {object} args.previous           audience before the dialog
 * @param {object} args.audience           audience after the dialog
 * @param {string} args.label              note text, already localized
 */
export async function fileRevealChange({ entry, target, kind, id, previous, audience, label }) {
  try {
    const transition = revealTransition(previous, audience);
    if (transition === "none") return;
    const campaign = campaignOf(entry);
    if (!campaign) return;
    const loaded = await loadStore();
    if (!loaded) return;
    const key = revealKey(kind, id);
    const existing = target.getFlag(MODULE_ID, REVEAL_NOTES_FLAG)?.[key] ?? null;
    if (transition === "retract") {
      if (existing) {
        await loaded.store.retractNote(campaign.id, existing);
        await target.update({ [`flags.${MODULE_ID}.${REVEAL_NOTES_FLAG}.-=${key}`]: null });
      }
      return;
    }
    if (transition === "update") {
      // The secret stays revealed; the note keeps its place on the session it
      // was filed under and only its audience follows the new one, so a
      // player added later can read the note and one removed no longer can.
      // Plan B's updateNote accepts { audience } (its Interfaces block says so).
      if (existing) {
        const a = revealNote({ entryUuid: entry.uuid, entryName: entry.name, kind, audience, revealedBy: game.user.id, at: Date.now(), sessionUuid: null, label }).audience;
        await loaded.store.updateNote(campaign.id, existing, { audience: a });
      }
      return;
    }
    const session = loaded.currentSession(campaign);
    if (!session) return;
    const result = await loaded.store.addNote(campaign.id, revealNote({
      entryUuid: entry.uuid, entryName: entry.name,
      pageUuid: target.documentName === "JournalEntryPage" ? target.uuid : null,
      blockId: id, kind, audience, revealedBy: game.user.id, at: Date.now(),
      sessionUuid: session.uuid, label
    }));
    const noteId = typeof result === "string" ? result : result?.id ?? null;
    if (noteId) await target.update({ [`flags.${MODULE_ID}.${REVEAL_NOTES_FLAG}.${key}`]: noteId });
  } catch (err) {
    console.error(`${MODULE_ID} | filing a reveal note failed`, err);
  }
}

/** Show Players: one GM note on the current session of the capture campaign. */
export async function fileMediaNote({ campaign, src, caption }) {
  try {
    if (!campaign) return;
    const loaded = await loadStore();
    if (!loaded) return;
    const session = loaded.currentSession(campaign);
    if (!session) return;
    await loaded.store.addNote(campaign.id, {
      text: game.i18n.format(`${I18N}.revealNote.media`, { name: caption || src.split("/").pop() }),
      authorId: game.user.id, at: Date.now(), worldDate: null, sessionUuid: session.uuid,
      mentions: [], kind: "reveal", audience: null, ref: { src, kind: "media" }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | filing a media note failed`, err);
  }
}

/** Localized note labels per kind. */
export function revealLabel(kind, entryName) {
  const key = { block: "block", checklist: "checklist", rel: "relationship" }[kind] ?? "block";
  return game.i18n.format(`${I18N}.revealNote.${key}`, { name: entryName });
}
```

- [ ] **Step 6: Call sites**

Each site already computes `previous`/`audience` and the entry. Add `import { fileRevealChange, revealLabel } from "../hooks/reveal-filing.mjs";` (path relative to the file) and, immediately after the audience write and before/after the whisper:

`scripts/hooks/secrets-ui.mjs` `editAudience`, after the `page.update(... REVEALS_FLAG ...)` line:
```js
  await fileRevealChange({ entry, target: page, kind: "block", id: sectionId, previous, audience, label: revealLabel("block", entry.name) });
```

`scripts/hooks/relationships-ui.mjs` `editRelAudience`, after the `entry.update(... REL_FLAG ...)` line:
```js
  await fileRevealChange({ entry, target: entry, kind: "rel", id: `${relId}-${kind}`, previous, audience, label: revealLabel("rel", entry.name) });
```

`scripts/sheets/SessionSheet.mjs` `onSecretAudience`, after the `this.document.update(...)`:
```js
    await fileRevealChange({ entry: this.document.parent, target: this.document, kind: "checklist", id, previous: checklistSeed(item), audience, label: revealLabel("checklist", this.document.parent?.name ?? this.document.name) });
```

`scripts/apps/CampaignHubPage.mjs` Secrets-tab handler: in the `block` branch after `page.update(...)`:
```js
      await fileRevealChange({ entry, target: page, kind: "block", id: secretId, previous, audience, label: revealLabel("block", entry.name) });
```
in the `session` branch after `page.update(...)`:
```js
      await fileRevealChange({ entry, target: page, kind: "checklist", id: secretId, previous: checklistSeed(item), audience, label: revealLabel("checklist", entry.name) });
```
in the `relationship` branch after `entry.update(...)`:
```js
      await fileRevealChange({ entry, target: entry, kind: "rel", id: `${secretId}-${kind}`, previous, audience, label: revealLabel("rel", entry.name) });
```

`scripts/hooks/auto-capture.mjs` `captureSharedImage`: it currently returns early when the media setting is off. Restructure so the note files regardless of that setting:

```js
function captureSharedImage(src, caption) {
  if (!src) return;
  const { campaign } = captureTarget();
  fileMediaNote({ campaign, src, caption }).catch(() => {});
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  queueFiling(() => fileOntoNewestTimepoint({ src, showPlayers: true, name: caption || "" }));
  ui.notifications.info(game.i18n.format(`${I18N}.autoCapture.mediaCaptured`, { name: caption || src.split("/").pop() }));
}
```
with `import { fileMediaNote } from "./reveal-filing.mjs";`.

- [ ] **Step 7: Strings**

`lang/en.json` add a top-level group:
```json
"revealNote": {
  "block": "Revealed a secret from {name}",
  "checklist": "Revealed a session secret from {name}",
  "relationship": "Revealed a relationship on {name}",
  "media": "Showed \"{name}\" to the players"
}
```

- [ ] **Step 8: Suite + commit**

Run: `npx vitest run` → PASS (the dynamic imports are never executed by vitest).

```bash
git add scripts/logic/reveal-note.mjs scripts/hooks/reveal-filing.mjs scripts/constants.mjs scripts/hooks/secrets-ui.mjs scripts/hooks/relationships-ui.mjs scripts/sheets/SessionSheet.mjs scripts/apps/CampaignHubPage.mjs scripts/hooks/auto-capture.mjs test/reveal-note.test.js lang/en.json
git commit -m "feat: reveals and shown images file a note on the current session (needs the note store)"
```

---

### Task 12: e2e spec 36 and docs

**Files:**
- Create: `tests/e2e/36-scoping-gm-consolidation.spec.mjs`
- Modify: `docs/gm-guide.md` (Secrets: session checklist; Word export scope; Campaign settings groups; auto-capture feedback), `README.md` (Secrets, Docx export, Auto-capture bullets; Settings table)

- [ ] **Step 1: Write the spec**

`tests/e2e/36-scoping-gm-consolidation.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, deleteActorsByPrefix, KNOWN_MEJ_SESSION_ICON_404, cleanupStrandedTestFolders
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const M = "mej-campaign-companion";

async function openEntry(page, entryId, anchorText) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(shell).toBeVisible();
  await expect(shell).toContainText(anchorText);
  return shell;
}

/** Two campaigns, one Person in each, one Session in the first (TT- prefixed). */
async function seed(page) {
  return page.evaluate(async ({ prefix, M }) => {
    const mk = async (name) => {
      const api = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      const { folder } = await api.createCampaign({ name, baseline: "observer" });
      return folder;
    };
    const c1 = await mk(`${prefix}Scope-A`);
    const c2 = await mk(`${prefix}Scope-B`);
    const person = async (name, folder) => JournalEntry.create({
      name, folder: folder.id,
      pages: [{ name, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: `<p>${name} body</p>` } }]
    });
    const pa = await person(`${prefix}Scope-PersonA`, c1);
    const pb = await person(`${prefix}Scope-PersonB`, c2);
    const session = await JournalEntry.create({
      name: `${prefix}Scope-Session`, folder: c1.id,
      pages: [{
        name: "s", type: `${M}.session`,
        flags: { [M]: { session: { sessionNumber: 1, campaignDate: null, attendees: [], secrets: [{ id: "k1", text: "scope-clue", revealed: false, revealedAt: null }] } }, "monks-enhanced-journal": { type: "session" } }
      }]
    });
    await game.settings.set(M, "hubCampaignScope", c1.id);
    return { c1: c1.id, c2: c2.id, pa: pa.id, pb: pb.id, session: session.id };
  }, { prefix: TT_PREFIX, M });
}

test.describe("36 scoping + GM consolidation", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "savedQueries", []);
        await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
        const chatIds = game.messages.filter((m) => m.content?.includes("TT-")).map((m) => m.id);
        if (chatIds.length) await ChatMessage.implementation.deleteDocuments(chatIds);
      });
      await cleanupStrandedTestFolders(gmPage);
      await deleteActorsByPrefix(gmPage);
    });
  });

  test("export dialog offers campaign scope and hides other campaigns' rows", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator("button", { hasText: "Tools" }).click();
    await shell.locator('[data-action="openExportDialog"]').click();
    const dialog = page.locator(".application.dialog", { hasText: "Export to Word" });
    await expect(dialog).toBeVisible();
    const scope = dialog.locator('select[name="scope"]');
    await expect(scope).toHaveValue("campaign");
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonA" })).toBeVisible();
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonB" })).toBeHidden();
    await scope.selectOption("world");
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonB" })).toBeVisible();
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("party picker lists only same-campaign entries", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator('nav.sheet-tabs a[data-tab="relationships"]').click();
    await settle(page, 300);
    await shell.locator("button", { hasText: "Add relationship" }).click();
    const picker = page.locator(".mej-cc-party-picker");
    await expect(picker).toBeVisible();
    await expect(picker.locator(".mej-cc-party-pick", { hasText: "Scope-PersonB" })).toHaveCount(0);
    await expect(picker.locator(".mej-cc-party-pick", { hasText: "Scope-Session" })).toHaveCount(0); // sessions aren't person targets
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("checklist secret has one reveal control; Everyone whispers and shows ✱", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.session, "Scope-Session");
    await shell.locator('nav.sheet-tabs a[data-tab="session"]').click();
    await settle(page, 300);
    const row = shell.locator('.secrets-list [data-id="k1"]');
    await expect(row.locator(".secret-toggle")).toHaveCount(0);
    await row.locator(".secret-audience").click();
    const dialog = page.locator(".application.dialog", { hasText: "Reveal secret to" });
    await dialog.locator('input[name="all"]').check();
    await dialog.locator("button", { hasText: "Apply" }).click();
    await settle(page, 600);
    await expect(row.locator(".mej-cc-audience-count")).toHaveText("✱");
    const whispered = await page.evaluate(() => game.messages.contents.some((m) => m.content?.includes("scope-clue") && m.whisper?.length));
    expect(whispered).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("deleting a dashboard asks first", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "savedQueries", [{ id: "q1", name: "TT-Dash", query: "type:person", showPlayers: false }]));
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator('nav.sheet-tabs a[data-tab="dashboards"]').click();
    await shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"] [data-action="deleteDashboard"]').click();
    const confirm = page.locator(".application.dialog", { hasText: "Delete dashboard" });
    await expect(confirm).toBeVisible();
    await confirm.locator("button", { hasText: "No" }).click();
    await expect(shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"]')).toBeVisible();
    await shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"] [data-action="deleteDashboard"]').click();
    await page.locator(".application.dialog", { hasText: "Delete dashboard" }).locator("button", { hasText: "Yes" }).click();
    await expect(shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"]')).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
```

Before relying on `createCampaign({ name, baseline })` in `seed`, read `scripts/data/campaign-store.mjs` and match its real signature (the function name is `createCampaign`; confirm its argument shape and what it returns, and adjust the two lines accordingly). If the saved-query row shape differs from `{ id, name, query, showPlayers }`, read `CampaignHubPage.#promptDashboard` and match it.

- [ ] **Step 2: Syntax check without running against Foundry**

Run: `npx playwright test --list tests/e2e/36-scoping-gm-consolidation.spec.mjs`
Expected: lists 4 tests (plus the setup project). Do not run the spec; the user runs live tests.

- [ ] **Step 3: Docs**

`docs/gm-guide.md`:
- "Running your first session" → the Secrets block paragraph: each row has an audience control only; "Everyone" is the first checkbox in its dialog. Remove the eye description.
- "The Campaign Hub" → Tools: Export now opens with an **Export** scope select (this campaign with its timelines, or whole world) when the Hub is scoped to a campaign.
- "Campaigns" → Campaign settings: mention the **Manage player groups…** button and the updated Contributors wording.
- "Secrets" → the prep board shows GM Notes read-only with an "Edit on the session" link; scratch notes were folded into GM Notes.
- "Auto-capture": each capture confirms with a notification; a world with exactly one campaign needs no target.
- "Player collaboration" per Task 10.

`README.md`: update the Sessions, Secrets, Auto-capture, Docx export and Player collaboration bullets to match, and the Settings table rows for `playersWriteSessions` and `autoCaptureCampaign` ("Empty with exactly one campaign means that campaign; empty with several means capture declines").

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/36-scoping-gm-consolidation.spec.mjs docs/gm-guide.md README.md
git commit -m "test+docs: e2e gate for scoping and GM consolidation; guide and README updates"
```

---

## Self-review (done while writing)

- **Spec coverage.** Item 14: export (T6), party picker (T7), Mentioned in (T8), `@CampaignQuery` (T9). Item 4's shell-control scoping, deferred from Plan A: T9b. Item 15: one reveal control (T1), one GM note field (T3), delete confirms (T2), Contributors hint + groups from settings (T4), auto-capture toast + single-campaign target (T5). Item 8: baseline-driven recap ownership, demoted setting, save state (T10). Item 7: reveal-filing with audience, retract, media note beside timeline capture (T11). Spec §9 un-reveal/retract rule: T11. Spec §11 is Plan B's.
- **Placeholders.** None: every step has code, a command, or an exact edit instruction.
- **Type consistency.** `applyChecklistAudience`/`checklistSeed` used identically in T1 and T11; `confirmDelete({ kind, name })` in T2 and T4; `captureTarget()` returns `{ campaign, reason }` in T5 and T11; `fileRevealChange` signature identical at all five call sites; `REVEAL_NOTES_FLAG` defined in constants before use.
- **Review Focus** lines 1–5 each name the task and test that pins them.
- **Interface caveats for Plan B** (not deviations, assumptions): `addNote` resolves to the note id (string) or an object with `id`; the store keeps the extra `ref` field; `currentSession(campaignFolder)` returns `{ uuid }` or null. If Plan B lands with different names, T11's `reveal-filing.mjs` is the only file to touch.
