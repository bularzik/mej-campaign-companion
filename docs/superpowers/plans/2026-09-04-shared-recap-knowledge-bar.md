# Shared Session Recap + Collapsible Knowledge Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-player recap section with one shared, collaboratively edited session recap (players edit through ownership; old per-player recaps folded in by a dataVersion-6 migration), let `playersWriteSessions` offer ownership of existing sessions, and let the knowledge panel collapse to a one-line bar remembered per client.

**Architecture:** Pure decision functions in `scripts/logic/` (unit-tested with vitest, no Foundry imports) feed thin Foundry-side code: `SessionSheet` loses the player-recap machinery and gains a stale-field guard and a `collaborate` recap editor; a new `hooks/recap-refresh.mjs` re-renders viewers on recap changes; `hooks/session-ownership-apply.mjs` backs the setting's confirm dialog; the ready-time migration block folds legacy flags; `hooks/knowledge-ui.mjs` renders and toggles the bar.

**Tech Stack:** Foundry VTT 13/14 (ApplicationV2, `<prose-mirror>` collaborative mode, DialogV2), Monk's Enhanced Journal extension API, Handlebars, vitest, Playwright (v14 World A harness, v13 stock gate).

**Spec:** `docs/superpowers/specs/2026-09-04-shared-recap-knowledge-bar-design.md` (read it — including its **Deviations** section, which is binding).

## Global Constraints

- **Companion features never patch MEJ.** Every change is inside `mej-campaign-companion`; nothing under `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` is touched.
- Worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/shared-recap`, branch `feat/shared-recap`, base `main @ ce8486e`. All commands below run from that directory.
- `scripts/logic/*.mjs` files import nothing from Foundry globals (`game`, `foundry`, `CONST`, `Hooks`, `ui`, `JournalEntry`) — they must run under vitest. `scripts/constants.mjs` is allowed.
- Release version `0.17.0`; `CURRENT_DATA_VERSION = 6`.
- Player-facing strings live in `lang/en.json` under `MEJCampaignCompanion`; the i18n prefix constant is `I18N = "MEJCampaignCompanion"`.
- The migration heading is the fixed English string `<h3>Recap — <name></h3>` (em dash U+2014, name HTML-escaped), not localized.
- Playwright: every run uses `--trace off`; shipped tests contain no `retries`, no `waitForTimeout`; cleanup is id-tracked (`TT-` prefix on everything the tests create; never name-match anything else). World A on port 30000 is the user's real world — never confirm the ownership dialog there, never delete anything the test did not create, never touch folder `1oqDUyUhquJvsMOj`.
- The e2e env lock (`<FOUNDRY_DATA>/.claude-e2e-lock`): wait if held; never run `npm run e2e:unlock`.
- Never `git stash`; never push to `main`; conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- The socket dispatcher keeps only the upload-relay actions; no recap relay of any kind is reintroduced.

---

### Task 1: Pure logic for the shared recap (escape, fold, submit guard, refresh gate)

**Files:**
- Create: `scripts/logic/html-escape.mjs`
- Create: `scripts/logic/recap-migration.mjs`
- Create: `scripts/logic/session-submit.mjs`
- Create: `scripts/logic/recap-refresh.mjs`
- Modify: `scripts/logic/doc-export-snapshot.mjs:40-43` (replace the local `escapeHtml` with the import)
- Test: `test/recap-migration.test.js`, `test/session-submit.test.js`, `test/recap-refresh.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `escapeHtml(text: unknown): string`
  - `foldPlayerRecaps(recapHtml: string, entries: Array<{name: string, html: unknown}>): { recap: string, folded: number }`
  - `EDITOR_FIELDS: string[]` and `fieldsToStrip(targetName: string | null): string[]`
  - `recapChanged(changes: object | undefined): boolean` and `shouldRefreshForRecap({ changes, activeEntityId, pageId, editing }): boolean`

- [ ] **Step 1: Write the failing tests**

`test/recap-migration.test.js`:

```js
import { describe, it, expect } from "vitest";
import { foldPlayerRecaps } from "../scripts/logic/recap-migration.mjs";

describe("foldPlayerRecaps", () => {
  it("returns the recap unchanged with folded 0 when there are no entries", () => {
    expect(foldPlayerRecaps("<p>gm</p>", [])).toEqual({ recap: "<p>gm</p>", folded: 0 });
    expect(foldPlayerRecaps(undefined, undefined)).toEqual({ recap: "", folded: 0 });
  });
  it("appends one attributed block per non-empty entry, sorted by name", () => {
    const { recap, folded } = foldPlayerRecaps("<p>gm</p>", [
      { name: "Zed", html: "<p>z</p>" },
      { name: "Ann", html: "<p>a</p>" }
    ]);
    expect(folded).toBe(2);
    expect(recap).toBe("<p>gm</p><h3>Recap — Ann</h3><p>a</p><h3>Recap — Zed</h3><p>z</p>");
  });
  it("drops entries that are empty, whitespace-only, tag-only or not strings", () => {
    const { recap, folded } = foldPlayerRecaps("", [
      { name: "A", html: "" },
      { name: "B", html: "<p></p>" },
      { name: "C", html: "<p>&nbsp; </p>" },
      { name: "D", html: null },
      { name: "E", html: "<p>real</p>" }
    ]);
    expect(folded).toBe(1);
    expect(recap).toBe("<h3>Recap — E</h3><p>real</p>");
  });
  it("escapes the player name in the heading", () => {
    const { recap } = foldPlayerRecaps("", [{ name: "<b>x</b> & y", html: "<p>t</p>" }]);
    expect(recap).toBe("<h3>Recap — &lt;b&gt;x&lt;/b&gt; &amp; y</h3><p>t</p>");
  });
});
```

`test/session-submit.test.js`:

```js
import { describe, it, expect } from "vitest";
import { EDITOR_FIELDS, fieldsToStrip } from "../scripts/logic/session-submit.mjs";

describe("fieldsToStrip", () => {
  it("keeps only the editor that raised the submit", () => {
    expect(fieldsToStrip("system.recap")).toEqual(["system.gmNotes"]);
    expect(fieldsToStrip("system.gmNotes")).toEqual(["system.recap"]);
  });
  it("strips every editor field when the submit came from anything else", () => {
    expect(fieldsToStrip("flags.mej-campaign-companion.session.sessionNumber")).toEqual(EDITOR_FIELDS);
    expect(fieldsToStrip(null)).toEqual(EDITOR_FIELDS);
    expect(fieldsToStrip(undefined)).toEqual(EDITOR_FIELDS);
  });
});
```

`test/recap-refresh.test.js`:

```js
import { describe, it, expect } from "vitest";
import { recapChanged, shouldRefreshForRecap } from "../scripts/logic/recap-refresh.mjs";

describe("recapChanged", () => {
  it("is true for a recap or gmNotes change only", () => {
    expect(recapChanged({ system: { recap: "<p>x</p>" } })).toBe(true);
    expect(recapChanged({ system: { gmNotes: "" } })).toBe(true);
    expect(recapChanged({ name: "n" })).toBe(false);
    expect(recapChanged({ flags: { "mej-campaign-companion": { session: {} } } })).toBe(false);
    expect(recapChanged(undefined)).toBe(false);
  });
});

describe("shouldRefreshForRecap", () => {
  const changes = { system: { recap: "<p>x</p>" } };
  it("refreshes when the shell shows that page and nothing is being edited", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: false })).toBe(true);
  });
  it("never refreshes while an editor is open locally", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: true })).toBe(false);
  });
  it("ignores other pages and irrelevant changes", () => {
    expect(shouldRefreshForRecap({ changes, activeEntityId: "JournalEntry.a.JournalEntryPage.p2", pageId: "p1", editing: false })).toBe(false);
    expect(shouldRefreshForRecap({ changes: { name: "n" }, activeEntityId: "JournalEntry.a.JournalEntryPage.p1", pageId: "p1", editing: false })).toBe(false);
    expect(shouldRefreshForRecap({ changes, activeEntityId: null, pageId: "p1", editing: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/recap-migration.test.js test/session-submit.test.js test/recap-refresh.test.js`
Expected: FAIL — "Failed to resolve import" for each new module.

- [ ] **Step 3: Implement the four modules**

`scripts/logic/html-escape.mjs`:

```js
/**
 * Text-node escape for HTML this module composes itself (export snapshot,
 * recap migration). Deliberately minimal - `&`, `<`, `>` only - and free
 * of Foundry imports so pure logic can use it under vitest.
 */
export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

`scripts/logic/recap-migration.mjs`:

```js
// dataVersion 6 (spec 2026-09-04 §C): per-player recaps fold into the
// shared session recap as attributed blocks. Pure - the ready-time runner
// in campaign-companion.mjs resolves user names and writes the page.
import { escapeHtml } from "./html-escape.mjs";

/** No visible text once tags and non-breaking spaces are stripped. */
function isBlank(html) {
  if (typeof html !== "string") return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

/**
 * @param {string} recapHtml current `system.recap`
 * @param {Array<{name: string, html: unknown}>} entries one per legacy playerRecaps key
 * @returns {{ recap: string, folded: number }}
 */
export function foldPlayerRecaps(recapHtml, entries) {
  const base = recapHtml ?? "";
  const kept = (entries ?? [])
    .filter((e) => !isBlank(e?.html))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!kept.length) return { recap: base, folded: 0 };
  const blocks = kept.map((e) => `<h3>Recap — ${escapeHtml(e.name)}</h3>${e.html}`);
  return { recap: `${base}${blocks.join("")}`, folded: kept.length };
}
```

`scripts/logic/session-submit.mjs`:

```js
// Stale-field guard for the Session sheet's form (spec 2026-09-04,
// Deviations). MEJ's submitOnChange form resubmits EVERY field, so a submit
// raised by the session-number input carries whatever recap HTML this
// client rendered - possibly older than what another owner just saved.
// Only the editor that raised the submit may write its own field.
export const EDITOR_FIELDS = ["system.recap", "system.gmNotes"];

/** @param {string|null|undefined} targetName the `name` of the element that raised the submit */
export function fieldsToStrip(targetName) {
  return EDITOR_FIELDS.filter((field) => field !== targetName);
}
```

`scripts/logic/recap-refresh.mjs`:

```js
// Gate for hooks/recap-refresh.mjs (spec 2026-09-04, Deviations): MEJ only
// re-renders its shell for text.content, ownership and its own flag keys,
// never for system.*, so a viewer would keep a stale shared recap until
// they reopened the page.

export function recapChanged(changes) {
  return changes?.system?.recap !== undefined || changes?.system?.gmNotes !== undefined;
}

/**
 * @param {object} args
 * @param {object} args.changes the updateJournalEntryPage diff
 * @param {string|null} args.activeEntityId uuid shown in the shell's active tab (MEJ: journal.tabs.active().entityId)
 * @param {string} args.pageId the updated page's id
 * @param {boolean} args.editing whether any `.editor-parent.editing` exists in that view
 */
export function shouldRefreshForRecap({ changes, activeEntityId, pageId, editing }) {
  if (!recapChanged(changes)) return false;
  if (editing) return false;
  if (!activeEntityId || !pageId) return false;
  return activeEntityId.endsWith(pageId);
}
```

In `scripts/logic/doc-export-snapshot.mjs` delete the local `function escapeHtml(text) {...}` (lines 40-43) and add `import { escapeHtml } from "./html-escape.mjs";` next to the file's other imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/recap-migration.test.js test/session-submit.test.js test/recap-refresh.test.js test/doc-export-snapshot.test.js`
Expected: PASS (if `test/doc-export-snapshot.test.js` does not exist, run `npx vitest run` and expect the full suite green).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/html-escape.mjs scripts/logic/recap-migration.mjs scripts/logic/session-submit.mjs scripts/logic/recap-refresh.mjs scripts/logic/doc-export-snapshot.mjs test/recap-migration.test.js test/session-submit.test.js test/recap-refresh.test.js
git commit -m "feat: pure logic for the shared recap (fold, submit guard, refresh gate)"
```

---

### Task 2: Pure logic for ownership selection and the knowledge summary

**Files:**
- Modify: `scripts/logic/session-ownership.mjs` (append one export)
- Create: `scripts/logic/knowledge-summary.mjs`
- Test: `test/session-ownership.test.js` (append a describe), `test/knowledge-summary.test.js`

**Interfaces:**
- Produces:
  - `sessionEntriesNeedingOwnership(entries, { sessionType, sessionDocumentType, ownerLevel }): entries[]`
  - `knowledgeSummary({ tags: number, attributes: number, backlinks: number }, format: (key: string, data: object) => string): string`

- [ ] **Step 1: Write the failing tests**

Append to `test/session-ownership.test.js`:

```js
import { sessionEntriesNeedingOwnership } from "../scripts/logic/session-ownership.mjs";

describe("sessionEntriesNeedingOwnership", () => {
  const OWNER = 3;
  const sel = { sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, ownerLevel: OWNER };
  const entry = (id, level, pages) => ({ id, ownership: level === undefined ? undefined : { default: level }, pages: { contents: pages } });

  it("keeps a session entry whose default ownership is below OWNER", () => {
    const e = entry("a", 2, [{ type: SESSION_DOCUMENT_TYPE }]);
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
  });
  it("accepts the bare in-memory page type MEJ's fixType leaves behind", () => {
    const e = entry("a", 0, [{ type: SESSION_TYPE }]);
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
  });
  it("drops an entry that is already OWNER", () => {
    expect(sessionEntriesNeedingOwnership([entry("a", 3, [{ type: SESSION_DOCUMENT_TYPE }])], sel)).toEqual([]);
  });
  it("drops entries with no session page", () => {
    expect(sessionEntriesNeedingOwnership([entry("a", 0, [{ type: "text" }]), entry("b", 0, [])], sel)).toEqual([]);
  });
  it("treats missing ownership as 0 and tolerates a plain pages array", () => {
    const e = { id: "a", pages: [{ type: SESSION_DOCUMENT_TYPE }] };
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
    expect(sessionEntriesNeedingOwnership(undefined, sel)).toEqual([]);
  });
});
```

(Keep the existing `import { describe, it, expect } from "vitest";` and constants import at the top; the new import line goes beside the existing `shouldOwnSessionEntry` import.)

`test/knowledge-summary.test.js`:

```js
import { describe, it, expect } from "vitest";
import { knowledgeSummary } from "../scripts/logic/knowledge-summary.mjs";

// Localizer stub: renders the key's last segment plus the count so both the
// key selection (One vs plural) and the data passed are visible.
const format = (key, data) => `${key.split(".").pop()}:${data.count}`;

describe("knowledgeSummary", () => {
  it("is empty when every count is zero", () => {
    expect(knowledgeSummary({ tags: 0, attributes: 0, backlinks: 0 }, format)).toBe("");
    expect(knowledgeSummary({}, format)).toBe("");
  });
  it("uses the singular key for exactly one", () => {
    expect(knowledgeSummary({ tags: 1, attributes: 0, backlinks: 0 }, format)).toBe("tagsOne:1");
  });
  it("joins non-zero parts in tags, attributes, mentions order with a middle dot", () => {
    expect(knowledgeSummary({ tags: 3, attributes: 1, backlinks: 5 }, format)).toBe("tags:3 · attributesOne:1 · mentions:5");
  });
  it("omits zero parts in the middle", () => {
    expect(knowledgeSummary({ tags: 2, attributes: 0, backlinks: 1 }, format)).toBe("tags:2 · mentionsOne:1");
  });
  it("passes the full i18n key", () => {
    const keys = [];
    knowledgeSummary({ tags: 2 }, (k) => { keys.push(k); return ""; });
    expect(keys).toEqual(["MEJCampaignCompanion.knowledge.summary.tags"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/session-ownership.test.js test/knowledge-summary.test.js`
Expected: FAIL — `sessionEntriesNeedingOwnership` is not exported; `knowledge-summary.mjs` cannot be resolved.

- [ ] **Step 3: Implement**

Append to `scripts/logic/session-ownership.mjs`:

```js
/**
 * Existing JournalEntries the `playersWriteSessions` setting should offer
 * to open up when it is switched on (spec 2026-09-04 §B): any entry holding
 * a session page whose default ownership is below OWNER. Accepts a live
 * collection (`pages.contents`) or a plain array, and both the prefixed
 * document type and the bare key MEJ's fixType() leaves on mounted pages.
 */
export function sessionEntriesNeedingOwnership(entries, { sessionType, sessionDocumentType, ownerLevel }) {
  return (entries ?? []).filter((e) => {
    const level = e?.ownership?.default ?? 0;
    if (level >= ownerLevel) return false;
    const pages = Array.isArray(e?.pages) ? e.pages : (e?.pages?.contents ?? []);
    return pages.some((p) => p?.type === sessionDocumentType || p?.type === sessionType);
  });
}
```

`scripts/logic/knowledge-summary.mjs`:

```js
// One-line summary for the collapsed knowledge bar (spec 2026-09-04 §D):
// "3 tags · 1 attribute · 5 mentions". Zero counts are omitted; "" means
// everything is empty and the template shows knowledge.summary.empty.
import { I18N } from "../constants.mjs";

/**
 * @param {{tags?: number, attributes?: number, backlinks?: number}} counts
 * @param {(key: string, data: object) => string} format localizer (game.i18n.format in production)
 */
export function knowledgeSummary({ tags = 0, attributes = 0, backlinks = 0 } = {}, format) {
  return [[tags, "tags"], [attributes, "attributes"], [backlinks, "mentions"]]
    .filter(([n]) => n > 0)
    .map(([n, key]) => format(`${I18N}.knowledge.summary.${key}${n === 1 ? "One" : ""}`, { count: n }))
    .join(" · ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/session-ownership.test.js test/knowledge-summary.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/session-ownership.mjs scripts/logic/knowledge-summary.mjs test/session-ownership.test.js test/knowledge-summary.test.js
git commit -m "feat: ownership selection and knowledge summary logic"
```

---

### Task 3: One shared recap on the Session sheet

**Files:**
- Modify: `templates/session.hbs:26-68` (the description tab)
- Modify: `scripts/sheets/SessionSheet.mjs` (imports, `DEFAULT_OPTIONS`, `_prepareBodyContext:200-224`, `_dragDrop:256-271`, `_ingestRecapImage:303-331`, `onEditPlayerRecap:371-380`, `onSubmit:487-519`, `_disableFields:521-537`, `subRender:539-553`, `activateListeners:559-562`)
- Modify: `scripts/hooks/socket.mjs` (drop the recap action), `scripts/constants.mjs:140-141`, `scripts/hooks/media-relay.mjs:32,73-74` (comments)
- Modify: `styles/campaign-companion.css:3-50,136-152`, `lang/en.json` (`session.playerRecaps`, `session.editMyRecap`, `session.recapNoGM`)
- Delete: `scripts/hooks/player-recap.mjs`, `scripts/logic/player-recap.mjs`, `test/player-recap.test.js`, `test/player-recap-hooks.test.js`
- Test: `test/socket-dispatcher.test.js`, `tests/e2e/06-player-collab.spec.mjs` (rewritten)

**Interfaces:**
- Consumes: `fieldsToStrip` from `scripts/logic/session-submit.mjs` (Task 1).
- Produces: the recap editor is `.editor-parent[data-editor-id='recap']` holding `prose-mirror[name="system.recap"]` (with the `collaborate` attribute for owners); the pencil is `button[data-action="editRecap"]`; image drop/paste target is that editor parent. Task 4's e2e and Task 8's screenshot spec rely on these selectors.

- [ ] **Step 1: Rewrite the description tab in `templates/session.hbs`**

Replace lines 26-68 (from `<div class="tab{{#if subtabs.description.active}}` through the closing `</div>` of that tab) with:

```hbs
                <div class="tab{{#if subtabs.description.active}} active{{/if}}" data-group="primary" data-tab="description">
                    <div class="tab-inner flexcol">
                        {{!-- The one shared recap (spec 2026-09-04 §A). `collaborate` only for
                              owners: MEJ activates non-toggled editors at render for every
                              viewer, and a non-owner's pm.editDocument join is refused. --}}
                        <div class="flexcol editor-parent" data-editor-id="recap">
                            {{#if editable}}
                            <button type="button" class="unbutton control-button always-interactive editor-edit" data-action="editRecap" data-tooltip="{{localize 'MEJCampaignCompanion.session.editRecap'}}">
                                <i class="fas fa-feather" inert></i>
                            </button>
                            {{/if}}
                            <div class="editor editor-display wrapper scrollable{{#unless owner}} not-owner{{/unless}}" data-key="system.recap">
                                {{{ enrichedRecap }}}
                            </div>
                            <div class="editor editor-control wrapper">
                                <prose-mirror name="system.recap" value="{{ data.system.recap }}" document-uuid="{{ document.uuid }}"{{#if owner}} collaborate{{/if}}></prose-mirror>
                            </div>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 2: Strip the player-recap machinery from `scripts/sheets/SessionSheet.mjs`**

Imports: delete `import { buildRecapEntries } from "../logic/player-recap.mjs";` and `import { savePlayerRecap } from "../hooks/player-recap.mjs";`; add `import { fieldsToStrip } from "../logic/session-submit.mjs";`. Delete the `myRecapFlag` const (lines 30-31).

`DEFAULT_OPTIONS`: delete the `editPlayerRecap: SessionSheet.onEditPlayerRecap,` action and the whole `form: { handler: SessionSheet.onSubmit }` block with its comment (lines 51-60) — the base class's `onSubmit` is used again (it carries MEJ's own per-user Notes relay, which non-owners still need).

`_prepareBodyContext`: delete lines 200-224 (the "Player recaps:" comment through `context.otherRecaps = ...;`).

`_dragDrop`: replace the second `DragDrop` block (lines 256-271, comment included) with:

```js
    // Image files dropped on the shared recap (spec 2026-09-04 §A). Owners
    // only - the editor is read-only for everyone else. File drops carry no
    // `type` TextEditor.getDragEventData() would recognize, so this reads
    // event.dataTransfer.files directly rather than reusing _onDropAttendee.
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".editor-parent[data-editor-id='recap']",
      permissions: {
        drop: () => this.document.isOwner
      },
      callbacks: {
        drop: this._onDropRecapImage.bind(this)
      }
    }).bind(html);
```

`_ingestRecapImage`: replace the doc comment and the body's tail. New doc comment:

```js
  /**
   * Upload (directly if the user already holds FILES_UPLOAD, otherwise
   * relayed through the active GM - see hooks/media-relay.mjs) and append
   * the result to the shared recap. Both paths land in the same
   * RELAY_UPLOAD_DIR() and share the same type/size validation up front.
   * Owners only: a non-owner's drop/paste is ignored before any upload.
   */
```

First line of the method body becomes `if (!this.document.isOwner) return;` (before the type check). Replace lines 321-325 (`const recaps = ...` through `await savePlayerRecap(...)`) with:

```js
      const current = this.document.system?.recap ?? "";
      const img = document.createElement("img");
      img.src = path;
      await this.document.update({ "system.recap": `${current}<p>${img.outerHTML}</p>` });
```

and change the catch's log text to `` `${MODULE_ID} | image drop/paste into recap failed` ``.

Delete `onEditPlayerRecap` with its comment (lines 371-380), `onSubmit` with its comment (lines 487-519), `_disableFields` with its comment (lines 521-537) and `subRender` with its comment (lines 539-553).

Add, where `onSubmit` was:

```js
  // Stale-field guard (spec 2026-09-04, Deviations). MEJ's submitOnChange
  // form resubmits every field, so a submit raised by the session-number
  // input would write back whatever recap HTML this client rendered -
  // stale the moment another owner saved. Only the editor that raised the
  // submit may write its own field; every other submit leaves both rich
  // text fields alone. The change event bubbles from the <prose-mirror>
  // itself, so event.target is that element.
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const target = event?.target;
    const targetName = target?.closest?.("prose-mirror")?.getAttribute("name") ?? target?.name ?? null;
    for (const field of fieldsToStrip(targetName)) foundry.utils.deleteProperty(submitData, field);
    return submitData;
  }
```

`activateListeners`: the paste binding becomes `$(".editor-parent[data-editor-id='recap']", html).on("paste", this._onPasteRecapImage.bind(this));`.

- [ ] **Step 3: Remove the relay action and the deleted modules' references**

`scripts/hooks/socket.mjs`: import only `SOCKET, UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION`; delete the `handleSaveRecapRequest` import; `HANDLERS` keeps the two upload entries; `GM_ACTIONS = new Set([UPLOAD_MEDIA_ACTION])`. Update the header comment's "GM_ACTIONS lists every action…" paragraph to name only the upload relay.

`scripts/constants.mjs`: delete lines 140-141 (`SAVE_RECAP_ACTION` and its doc comment). If `MAX_RECAP_HTML_LENGTH` is defined in constants, delete it too (it may live only in the deleted `logic/player-recap.mjs`; `grep -rn MAX_RECAP_HTML_LENGTH scripts test` must return nothing afterwards).

`scripts/hooks/media-relay.mjs`: line 32 becomes `//    Same honest-trust posture as MEJ's own saveUserData relay.`; lines 73-74 become ` * ensures an active GM exists (see SessionSheet's upload-permission branch).`

Delete the four files:

```bash
git rm scripts/hooks/player-recap.mjs scripts/logic/player-recap.mjs test/player-recap.test.js test/player-recap-hooks.test.js
```

`test/socket-dispatcher.test.js`: import only `UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION`; delete the `includes SAVE_RECAP_ACTION` test; in the two `isAuthorizedForAction` GM tests keep only the `UPLOAD_MEDIA_ACTION` expectations.

`lang/en.json`: delete the `playerRecaps`, `editMyRecap` and `recapNoGM` keys under `session`.

`styles/campaign-companion.css`: replace lines 3-50 (the two long comments and the two `.player-recap-self` rules) with:

```css
/* Session sheet: MEJ's .editor-edit pencil is absolutely positioned against
   whatever ancestor happens to be positioned. Give each editor parent its
   own context so the recap and GM-notes pencils sit on their own editors. */
.session-container .editor-parent {
  position: relative;
}
```

and delete lines 136-152 (the `.journal-subsheet[editable='false'] ... .player-recap-self ...` rule and its comment). Run `grep -n "player-recap" styles/campaign-companion.css` — must be empty.

- [ ] **Step 4: Run the unit suite**

Run: `npx vitest run`
Expected: PASS; `grep -rn "playerRecap\|player-recap\|SAVE_RECAP" scripts templates styles lang` returns only `scripts/campaign-companion.mjs` hits if Task 6 already landed (none otherwise).

- [ ] **Step 5: Rewrite `tests/e2e/06-player-collab.spec.mjs`**

Replace the whole file:

```js
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const VIEWPORT = { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } };
const RECAP_EDITOR = ".editor-parent[data-editor-id='recap']";

/** Create a session directly with the given default ownership level, independent of the playersWriteSessions setting. */
async function createSession(page, name, level) {
  return page.evaluate(async ({ n, level }) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "mej-campaign-companion.session",
        flags: { "monks-enhanced-journal": { type: "session" } },
        system: { recap: "<p>GM opening line.</p>", gmNotes: "" }
      }],
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS[level] }
    });
    return entry.id;
  }, { n: name, level });
}

async function openSession(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator('nav.sheet-tabs a[data-tab="description"]').click();
  await settle(page, 200);
  return shell;
}

/** Open the recap editor, type, and commit the way a real blur does (the prose-mirror element's own change event). */
async function typeIntoRecap(page, shell, text) {
  await shell.locator('button[data-action="editRecap"]').click();
  await settle(page, 200);
  const editor = shell.locator(`${RECAP_EDITOR} prose-mirror`);
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await settle(page, 200);
}

async function commitRecap(page) {
  await page.evaluate((sel) => {
    document.querySelector(`${sel} prose-mirror`).dispatchEvent(new Event("change", { bubbles: true }));
  }, RECAP_EDITOR);
  await settle(page, 800);
}

async function recapOf(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).pages.contents[0].system.recap, entryId);
}

async function dropFileOnRecap(page, file) {
  await page.evaluate(async ({ sel, file }) => {
    let blob;
    if (file.zeros) blob = new Uint8Array(file.zeros);
    else blob = await (await fetch(file.url)).blob();
    const f = new File([blob], file.name, { type: file.type });
    const dt = new DataTransfer();
    dt.items.add(f);
    const el = document.querySelector(sel);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    el.dispatchEvent(new DragEvent("dragenter", opts));
    el.dispatchEvent(new DragEvent("dragover", opts));
    el.dispatchEvent(new DragEvent("drop", opts));
  }, { sel: RECAP_EDITOR, file });
}

async function newSeat(browser, userName) {
  const context = await browser.newContext(VIEWPORT);
  const page = await context.newPage();
  const errors = trackConsoleErrors(page, { ignore: IGNORE });
  await login(page, userName);
  return { context, page, errors };
}

test.describe("06 player collaboration", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((j) => j.name?.startsWith("TT-")).map((j) => j.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
      });
    });
  });

  test("an owning player edits the shared recap; it persists to system.recap and every seat reads it", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Shared Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    const p1Shell = await openSession(p1.page, entryId);
    expect(await p1.page.evaluate((id) => game.journal.get(id).isOwner, entryId)).toBe(true);
    await typeIntoRecap(p1.page, p1Shell, " Player one adds the ambush.");
    await commitRecap(p1.page);

    await gm.page.waitForFunction(
      (id) => game.journal.get(id)?.pages?.contents?.[0]?.system?.recap?.includes("Player one adds the ambush."),
      entryId, { timeout: 10_000 }
    );
    const persisted = await recapOf(gm.page, entryId);
    expect(persisted).toContain("GM opening line.");
    expect(persisted).toContain("Player one adds the ambush.");
    // The per-player flag is gone for good - nothing writes it any more.
    expect(await gm.page.evaluate((id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "playerRecaps"), entryId)).toBeUndefined();

    const p2 = await newSeat(browser, "User 2");
    const p2Shell = await openSession(p2.page, entryId);
    await expect(p2Shell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("Player one adds the ambush.");
    // Exactly one recap editor on the tab - the Player Recaps section is gone.
    await expect(p2Shell.locator('.tab[data-tab="description"] prose-mirror')).toHaveCount(1);
    await expect(p2Shell.locator(".player-recaps-section, .player-recap-self, .other-recap")).toHaveCount(0);

    assertNoConsoleErrors(p1.errors);
    assertNoConsoleErrors(p2.errors);
    await p1.context.close();
    await p2.context.close();
    await gm.context.close();
  });

  test("a non-owner player sees the recap read-only: no pencil, disabled editor, drops ignored", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Observer Session`, "OBSERVER");

    const p1 = await newSeat(browser, "User 1");
    const shell = await openSession(p1.page, entryId);
    expect(await p1.page.evaluate((id) => game.journal.get(id).isOwner, entryId)).toBe(false);
    await expect(shell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("GM opening line.");
    await expect(shell.locator('button[data-action="editRecap"]')).toHaveCount(0);
    await expect(shell.locator(`${RECAP_EDITOR} prose-mirror`)).toHaveJSProperty("disabled", true);
    await expect(shell.locator(`${RECAP_EDITOR} prose-mirror`)).not.toHaveAttribute("collaborate", "");

    await dropFileOnRecap(p1.page, { url: "icons/svg/mystery-man.svg", name: "TT-ignored.svg", type: "image/svg+xml" });
    await settle(p1.page, 1500);
    expect(await recapOf(gm.page, entryId)).not.toContain("<img");
    await expect(p1.page.locator("#notifications li.notification")).toHaveCount(0);

    assertNoConsoleErrors(p1.errors);
    await p1.context.close();
    await gm.context.close();
  });

  test("two owners edit at once: both sentences persist (collaborative editor, not last-writer-wins)", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Concurrent Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    const p2 = await newSeat(browser, "User 2");
    const p1Shell = await openSession(p1.page, entryId);
    const p2Shell = await openSession(p2.page, entryId);
    await expect(p1Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toHaveAttribute("collaborate", "");

    await typeIntoRecap(p1.page, p1Shell, " Alpha sentence from one.");
    await typeIntoRecap(p2.page, p2Shell, " Beta sentence from two.");
    // Each seat's editor receives the other's steps before either saves.
    await expect(p1Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toContainText("Beta sentence from two.", { timeout: 10_000 });
    await expect(p2Shell.locator(`${RECAP_EDITOR} prose-mirror`)).toContainText("Alpha sentence from one.", { timeout: 10_000 });
    await commitRecap(p1.page);
    await commitRecap(p2.page);

    await gm.page.waitForFunction(
      (id) => {
        const r = game.journal.get(id)?.pages?.contents?.[0]?.system?.recap ?? "";
        return r.includes("Alpha sentence from one.") && r.includes("Beta sentence from two.");
      },
      entryId, { timeout: 10_000 }
    );

    assertNoConsoleErrors(p1.errors);
    assertNoConsoleErrors(p2.errors);
    await p1.context.close();
    await p2.context.close();
    await gm.context.close();
  });

  test("relayed image: an owning player without FILES_UPLOAD drops an image, the GM relays it, it lands in the shared recap", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Relay Session`, "OWNER");

    const p1 = await newSeat(browser, "User 1");
    expect(await p1.page.evaluate(() => game.user.can("FILES_UPLOAD"))).toBe(false);
    const shell = await openSession(p1.page, entryId);
    await shell.locator(RECAP_EDITOR).waitFor();
    await dropFileOnRecap(p1.page, { url: "icons/svg/mystery-man.svg", name: "TT-relay-test.svg", type: "image/svg+xml" });

    // Relay is a multi-chunk socket round trip GM-side - give it real time.
    await gm.page.waitForFunction(
      (id) => (game.journal.get(id)?.pages?.contents?.[0]?.system?.recap ?? "").includes("<img"),
      entryId, { timeout: 15_000 }
    );
    const recap = await recapOf(gm.page, entryId);
    expect(recap).toContain("GM opening line.");
    expect(recap).toMatch(/worlds\/.*mej-campaign-companion.*uploads/);

    assertNoConsoleErrors(p1.errors);
    await p1.context.close();
    await gm.context.close();
  });

  test("an oversized file drop produces a clean client-side error, no upload attempted", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const entryId = await createSession(page, `${TT_PREFIX}Oversized Session`, "OBSERVER");
    const shell = await openSession(page, entryId);
    await shell.locator(RECAP_EDITOR).waitFor();
    // 11MB of zeros - over MAX_RELAY_FILE_BYTES (10MB); the size check runs before any upload.
    await dropFileOnRecap(page, { zeros: 11 * 1024 * 1024, name: "TT-too-big.png", type: "image/png" });
    await settle(page, 500);
    await expect(page.locator("#notifications li.notification.warning", { hasText: /too large/i })).toHaveCount(1);
    expect(await recapOf(page, entryId)).not.toContain("<img");
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 6: Run the rewritten spec and the sheet smoke spec**

Run: `npx playwright test tests/e2e/06-player-collab.spec.mjs tests/e2e/01-session.spec.mjs --trace off`
Expected: PASS. If the concurrent test fails because the second seat's editor never shows the first seat's text, do NOT weaken the assertion: report `BLOCKED` with the browser console output of both seats (the controller rules on whether `collaborate` survives).

- [ ] **Step 7: Commit**

```bash
git add -A templates/session.hbs scripts/sheets/SessionSheet.mjs scripts/hooks/socket.mjs scripts/constants.mjs scripts/hooks/media-relay.mjs styles/campaign-companion.css lang/en.json test/socket-dispatcher.test.js tests/e2e/06-player-collab.spec.mjs
git commit -m "feat: one shared session recap - remove per-player recaps, collaborate for owners, stale-field guard"
```

---

### Task 4: Viewers see recap changes live

**Files:**
- Create: `scripts/hooks/recap-refresh.mjs`
- Modify: `scripts/campaign-companion.mjs:144` (register at init, after `registerTimelineDirectory();`)
- Test: `tests/e2e/06-player-collab.spec.mjs` (append one test)

**Interfaces:**
- Consumes: `recapChanged`, `shouldRefreshForRecap` (Task 1); the Task 3 selectors.
- Produces: `registerRecapRefresh()`.

- [ ] **Step 1: Write the hook**

`scripts/hooks/recap-refresh.mjs`:

```js
// Re-render a Session view when its shared recap (or GM notes) changes on
// another client (spec 2026-09-04, Deviations). MEJ's own
// updateJournalEntryPage hook reloads the shell for text.content, ownership
// and its flag keys - never for system.*, so a viewer kept a stale recap
// until they reopened the page. Never touches a view with an editor open.
// Inert without MEJ (no shell; the popped-out branch only fires for a
// rendered MEJ sheet).
import { MODULE_ID } from "../constants.mjs";
import { recapChanged, shouldRefreshForRecap } from "../logic/recap-refresh.mjs";

function rootOf(app) {
  const el = app?.element;
  return el instanceof HTMLElement ? el : (el?.[0] instanceof HTMLElement ? el[0] : null);
}

function isEditing(root) {
  return !!root?.querySelector(".editor-parent.editing");
}

export function registerRecapRefresh() {
  Hooks.on("updateJournalEntryPage", (page, changes) => {
    if (!recapChanged(changes)) return;
    try {
      const shell = game.MonksEnhancedJournal?.journal;
      if (shell?.rendered) {
        const activeEntityId = shell.tabs?.active?.()?.entityId ?? null;
        if (shouldRefreshForRecap({ changes, activeEntityId, pageId: page.id, editing: isEditing(rootOf(shell)) })) {
          shell.render({ tempOwnership: shell.tempOwnership, reload: true, focus: false });
          return;
        }
      }
      const sheet = page._sheet;
      if (sheet?.rendered && !sheet.enhancedjournal && !isEditing(rootOf(sheet))) {
        sheet.render(true, { reload: true });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recap refresh failed`, err);
    }
  });
}
```

- [ ] **Step 2: Register it**

In `scripts/campaign-companion.mjs`, add `import { registerRecapRefresh } from "./hooks/recap-refresh.mjs";` beside the `registerTimelineDirectory` import, and directly after the `registerTimelineDirectory();` call in `Hooks.once("init")` add:

```js
  // Shared recap: other seats' saves re-render an idle view (spec 2026-09-04).
  registerRecapRefresh();
```

- [ ] **Step 3: Append the e2e test to `tests/e2e/06-player-collab.spec.mjs`**

Inside the describe, after the concurrent-edit test:

```js
  test("a viewer's open session refreshes when another owner saves the recap", async ({ browser }) => {
    const gm = await newSeat(browser, "Gamemaster");
    const entryId = await createSession(gm.page, `${TT_PREFIX}Live Session`, "OWNER");
    const gmShell = await openSession(gm.page, entryId);
    await expect(gmShell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("GM opening line.");

    const p1 = await newSeat(browser, "User 1");
    const p1Shell = await openSession(p1.page, entryId);
    await typeIntoRecap(p1.page, p1Shell, " Live update from one.");
    await commitRecap(p1.page);

    // The GM never reopened the page: the hook re-rendered the shell.
    await expect(gmShell.locator(`${RECAP_EDITOR} .editor-display`)).toContainText("Live update from one.", { timeout: 10_000 });
    await expect(gmShell.locator(RECAP_EDITOR)).not.toHaveClass(/editing/);

    assertNoConsoleErrors(p1.errors);
    assertNoConsoleErrors(gm.errors);
    await p1.context.close();
    await gm.context.close();
  });
```

- [ ] **Step 4: Run**

Run: `npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/recap-refresh.mjs scripts/campaign-companion.mjs tests/e2e/06-player-collab.spec.mjs
git commit -m "feat: re-render idle session views when the shared recap changes"
```

---

### Task 5: `playersWriteSessions` offers ownership of existing sessions

**Files:**
- Create: `scripts/hooks/session-ownership-apply.mjs`
- Modify: `scripts/campaign-companion.mjs:74-81` (setting registration gains `onChange`)
- Modify: `lang/en.json` (`settings.playersWriteSessions.hint`, new `applyExisting`, `applied`)
- Test: `tests/e2e/21-players-write-sessions.spec.mjs` (new)

**Interfaces:**
- Consumes: `sessionEntriesNeedingOwnership` (Task 2).
- Produces: `sessionsNeedingOwnership(): JournalEntry[]`, `applySessionOwnership(entries): Promise<number>`, `offerExistingSessionOwnership(): Promise<void>`.

- [ ] **Step 1: Write the hook module**

`scripts/hooks/session-ownership-apply.mjs`:

```js
// playersWriteSessions reaches existing sessions (spec 2026-09-04 §B).
// The preCreateJournalEntry stamp in campaign-companion.mjs still covers
// new entries; this is the one-shot offer made when the setting turns on.
// GM client only - a world setting's onChange fires on every client.
import { MODULE_ID, I18N, SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { sessionEntriesNeedingOwnership } from "../logic/session-ownership.mjs";

export function sessionsNeedingOwnership() {
  return sessionEntriesNeedingOwnership(game.journal.contents, {
    sessionType: SESSION_TYPE,
    sessionDocumentType: SESSION_DOCUMENT_TYPE,
    ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  });
}

/** One batch update; returns how many entries were written. */
export async function applySessionOwnership(entries) {
  if (!entries?.length) return 0;
  await JournalEntry.implementation.updateDocuments(
    entries.map((e) => ({ _id: e.id, "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }))
  );
  return entries.length;
}

export async function offerExistingSessionOwnership() {
  if (!game.user.isGM) return;
  const entries = sessionsNeedingOwnership();
  if (!entries.length) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${I18N}.settings.playersWriteSessions.name`) },
    content: `<p>${game.i18n.format(`${I18N}.settings.playersWriteSessions.applyExisting`, { count: entries.length })}</p>`,
    rejectClose: false
  });
  if (!ok) return;
  const count = await applySessionOwnership(entries);
  ui.notifications.info(game.i18n.format(`${I18N}.settings.playersWriteSessions.applied`, { count }));
}
```

- [ ] **Step 2: Wire the setting**

In `scripts/campaign-companion.mjs` add `import { offerExistingSessionOwnership } from "./hooks/session-ownership-apply.mjs";` and change the `PLAYERS_WRITE_SESSIONS_SETTING` registration to:

```js
  game.settings.register(MODULE_ID, PLAYERS_WRITE_SESSIONS_SETTING, {
    name: `${I18N}.settings.playersWriteSessions.name`,
    hint: `${I18N}.settings.playersWriteSessions.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    // Turning it on offers ownership of existing sessions (spec 2026-09-04 §B);
    // turning it off changes nothing.
    onChange: (value) => {
      if (value !== true) return;
      offerExistingSessionOwnership().catch((err) => console.error(`${MODULE_ID} | offering session ownership failed`, err));
    }
  });
```

`lang/en.json`, under `settings.playersWriteSessions`:

```json
      "playersWriteSessions": {
        "name": "Players Write Sessions",
        "hint": "New Session entries are owned by all players, so any player can edit the shared recap. Turning this on also offers to grant ownership of existing sessions.",
        "applyExisting": "Grant all players ownership of {count} existing session entries? Sessions created from now on are already covered.",
        "applied": "Updated ownership on {count} session entries."
      },
```

- [ ] **Step 3: Write the e2e spec `tests/e2e/21-players-write-sessions.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, TT_PREFIX, trackConsoleErrors, assertNoConsoleErrors, settle, KNOWN_MEJ_SESSION_ICON_404 } from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const APPLY = "/modules/mej-campaign-companion/scripts/hooks/session-ownership-apply.mjs";

// World A is the user's real world: the confirm dialog is ALWAYS answered
// No here. The grant itself runs through applySessionOwnership on the one
// TT entry this test created - never on the world-wide candidate list.
test.describe("21 players write sessions", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "playersWriteSessions", false);
      const ids = game.journal.filter((j) => j.name?.startsWith("TT-")).map((j) => j.id);
      if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    });
  });

  test("turning the setting on offers ownership of existing sessions; No leaves them alone; the grant opens one up", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const entryId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{ name: n, type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "session" } } }],
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      return entry.id;
    }, `${TT_PREFIX}Existing Session`);

    const listed = await page.evaluate(async ({ id, mod }) => {
      const { sessionsNeedingOwnership } = await import(mod);
      return sessionsNeedingOwnership().some((e) => e.id === id);
    }, { id: entryId, mod: APPLY });
    expect(listed).toBe(true);

    await page.evaluate(() => game.settings.set("mej-campaign-companion", "playersWriteSessions", true));
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toContainText(/existing session/i);
    await dialog.locator('button[data-action="no"]').click();
    await settle(page, 300);
    expect(await page.evaluate((id) => game.journal.get(id).ownership.default, entryId)).toBe(1);

    const granted = await page.evaluate(async ({ id, mod }) => {
      const { applySessionOwnership } = await import(mod);
      const n = await applySessionOwnership([game.journal.get(id)]);
      return { n, level: game.journal.get(id).ownership.default };
    }, { id: entryId, mod: APPLY });
    expect(granted).toEqual({ n: 1, level: 3 });

    // Turning it off is silent.
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "playersWriteSessions", false));
    await settle(page, 300);
    await expect(page.locator("dialog.application")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 4: Run**

Run: `npx playwright test tests/e2e/21-players-write-sessions.spec.mjs --trace off`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/session-ownership-apply.mjs scripts/campaign-companion.mjs lang/en.json tests/e2e/21-players-write-sessions.spec.mjs
git commit -m "feat: playersWriteSessions offers ownership of existing sessions"
```

---

### Task 6: dataVersion 6 — fold legacy player recaps

**Files:**
- Modify: `scripts/constants.mjs:84` (`CURRENT_DATA_VERSION = 6`)
- Modify: `scripts/campaign-companion.mjs` (ready-time migration block, after the v5 step and before `await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);`)
- Test: `tests/e2e/19-reveal-migration.spec.mjs` (bump the two `=== 5` waits to `=== 6`; append one test)

**Interfaces:**
- Consumes: `foldPlayerRecaps` (Task 1).

- [ ] **Step 1: Bump the version and add the step**

`scripts/constants.mjs`: `export const CURRENT_DATA_VERSION = 6;`

`scripts/campaign-companion.mjs`: add `import { foldPlayerRecaps } from "./logic/recap-migration.mjs";` and insert, after the v5 block's `if (stamped) console.log(...)` line:

```js
    // v6: per-player recaps fold into the shared recap as attributed blocks
    // (spec 2026-09-04 §C), then the legacy flag is removed. Idempotent: a
    // page without the flag is skipped. Per-page failures are logged and
    // skipped; the version bump below still happens.
    let foldedPages = 0;
    let foldedRecaps = 0;
    for (const entry of game.journal.contents) {
      for (const page of entry.pages.contents) {
        if (page.type !== SESSION_DOCUMENT_TYPE && page.type !== SESSION_TYPE) continue;
        const flag = page.getFlag(MODULE_ID, "playerRecaps");
        if (!flag || typeof flag !== "object") continue;
        const entries = Object.entries(flag).map(([userId, html]) => ({ name: game.users.get(userId)?.name ?? userId, html }));
        const { recap, folded } = foldPlayerRecaps(page.system?.recap ?? "", entries);
        const update = { [`flags.${MODULE_ID}.-=playerRecaps`]: null };
        if (folded) update["system.recap"] = recap;
        try {
          await page.update(update);
          foldedPages += 1;
          foldedRecaps += folded;
        } catch (err) {
          console.error(`${MODULE_ID} | player-recap fold failed for ${page.uuid}`, err);
        }
      }
    }
    if (foldedPages) console.log(`${MODULE_ID} | folded ${foldedRecaps} player recap(s) into ${foldedPages} session page(s)`);
```

- [ ] **Step 2: Update `tests/e2e/19-reveal-migration.spec.mjs`**

Change both `game.settings.get("mej-campaign-companion", "dataVersion") === 5` waits to `=== 6`. Append inside the describe:

```js
  test("v6 folds per-player recaps into the shared recap and removes the flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    const { id, user1 } = await page.evaluate(async (prefix) => {
      const user1 = game.users.getName("User 1");
      const user2 = game.users.getName("User 2");
      const entry = await JournalEntry.create({
        name: `${prefix}Migrate-Session`,
        pages: [{
          name: "s",
          type: "mej-campaign-companion.session",
          flags: {
            "monks-enhanced-journal": { type: "session" },
            "mej-campaign-companion": { playerRecaps: { [user1.id]: "<p>Boot prints led away.</p>", [user2.id]: "<p></p>" } }
          },
          system: { recap: "<p>GM text.</p>", gmNotes: "" }
        }]
      });
      return { id: entry.id, user1: user1.name };
    }, TT_PREFIX);
    try {
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 5));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const state = await page.evaluate((e) => {
        const p = game.journal.get(e).pages.contents[0];
        return { recap: p.system.recap, flag: p.getFlag("mej-campaign-companion", "playerRecaps") };
      }, id);
      expect(state.recap).toBe(`<p>GM text.</p><h3>Recap — ${user1}</h3><p>Boot prints led away.</p>`);
      expect(state.flag).toBeUndefined();
      // Idempotence: a second run leaves the recap alone.
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 5));
      await reloadGame(page);
      await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 6, null, { timeout: 60_000 });
      const again = await page.evaluate((e) => game.journal.get(e).pages.contents[0].system.recap, id);
      expect(again).toBe(state.recap);
    } finally {
      await page.evaluate(async ({ e, v }) => {
        await game.journal.get(e)?.delete();
        await game.settings.set("mej-campaign-companion", "dataVersion", v);
      }, { e: id, v: versionBefore });
    }
    assertNoConsoleErrors(errors);
  });
```

Note: rewinding `dataVersion` to 5 also re-runs the v2–v5 steps against World A; they are idempotent (the existing test already rewinds to 3).

- [ ] **Step 3: Run**

Run: `npx vitest run && npx playwright test tests/e2e/19-reveal-migration.spec.mjs --trace off`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs tests/e2e/19-reveal-migration.spec.mjs
git commit -m "feat: dataVersion 6 folds per-player recaps into the shared recap"
```

---

### Task 7: Knowledge panel collapses to a bar

**Files:**
- Modify: `scripts/constants.mjs` (add `KNOWLEDGE_COLLAPSED_SETTING`)
- Modify: `scripts/campaign-companion.mjs` (register the client setting next to `HUB_CAMPAIGN_SCOPE_SETTING`)
- Modify: `templates/knowledge-panel.hbs:1` (root element + header bar)
- Modify: `scripts/hooks/knowledge-ui.mjs` (`injectPanel` context, `bindCollapseBar`)
- Modify: `styles/campaign-companion.css` (after the `.mej-cc-knowledge-empty` rule)
- Modify: `lang/en.json` (`knowledge.title`, `knowledge.summary.*`)
- Test: `tests/e2e/07-knowledge.spec.mjs` (append one test; add `reloadGame` to the helper import)

**Interfaces:**
- Consumes: `knowledgeSummary` (Task 2).
- Produces: `KNOWLEDGE_COLLAPSED_SETTING = "knowledgePanelCollapsed"`; DOM `section.mej-cc-knowledge[.collapsed] > header.mej-cc-knowledge-bar`.

- [ ] **Step 1: Setting and constant**

`scripts/constants.mjs`, after `HUB_CAMPAIGN_SCOPE_SETTING`'s definition:

```js
/** Client setting: the knowledge panel is collapsed to its bar on every sheet (spec 2026-09-04 §D). */
export const KNOWLEDGE_COLLAPSED_SETTING = "knowledgePanelCollapsed";
```

`scripts/campaign-companion.mjs`: add `KNOWLEDGE_COLLAPSED_SETTING` to the constants import and, after the `HUB_CAMPAIGN_SCOPE_SETTING` registration:

```js
  game.settings.register(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING, {
    scope: "client", config: false, type: Boolean, default: false
  });
```

- [ ] **Step 2: Template**

Replace line 1 of `templates/knowledge-panel.hbs` with:

```hbs
<section class="mej-cc-knowledge{{#if collapsed}} collapsed{{/if}}" data-page-uuid="{{pageUuid}}">
    <header class="mej-cc-knowledge-bar" role="button" tabindex="0" aria-expanded="{{#if collapsed}}false{{else}}true{{/if}}">
        <i class="fa-solid fa-chevron-down mej-cc-knowledge-chevron"></i>
        <span class="mej-cc-knowledge-title">{{localize "MEJCampaignCompanion.knowledge.title"}}</span>
        <span class="mej-cc-knowledge-summary">{{#if summary}}{{summary}}{{else}}{{localize "MEJCampaignCompanion.knowledge.summary.empty"}}{{/if}}</span>
    </header>
```

(The three `<details>` blocks follow unchanged.)

- [ ] **Step 3: Hook**

`scripts/hooks/knowledge-ui.mjs`: import `KNOWLEDGE_COLLAPSED_SETTING` from `../constants.mjs` and `knowledgeSummary` from `../logic/knowledge-summary.mjs`. In `injectPanel`, replace the `renderTemplate` call's context object with:

```js
    {
      pageUuid: page.uuid, canEdit, tags: getTags(page), attributes, backlinks,
      collapsed: game.settings.get(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING),
      summary: knowledgeSummary(
        { tags: getTags(page).length, attributes: attributes.length, backlinks: backlinks.length },
        (key, data) => game.i18n.format(key, data)
      )
    }
```

Directly after `bindPanel(panel, page, sheet, shellHosted);` add `bindCollapseBar(panel);`, and add the function above `bindBacklinks`:

```js
// Whole-panel collapse (spec 2026-09-04 §D): one client setting, read on
// every injection, so the state follows the user across sheets, re-renders
// and reloads. The inner <details> keep their own open/closed state.
function bindCollapseBar(panel) {
  const bar = panel.querySelector(".mej-cc-knowledge-bar");
  if (!bar) return;
  const toggle = async () => {
    const collapsed = !panel.classList.contains("collapsed");
    panel.classList.toggle("collapsed", collapsed);
    bar.setAttribute("aria-expanded", String(!collapsed));
    try {
      await game.settings.set(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING, collapsed);
    } catch (err) {
      console.error(`${MODULE_ID} | saving the knowledge panel state failed`, err);
    }
  };
  bar.addEventListener("click", toggle);
  bar.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}
```

- [ ] **Step 4: Styles and strings**

`styles/campaign-companion.css`, after the `.mej-cc-knowledge-empty` rule:

```css
/* Collapsed state: only the bar stays (spec 2026-09-04 §D). */
.mej-cc-knowledge-bar {
  display: flex;
  align-items: center;
  gap: 0.5em;
  cursor: pointer;
  font-weight: bold;
  user-select: none;
}

.mej-cc-knowledge-summary {
  margin-left: auto;
  font-weight: normal;
  font-size: 0.9em;
  opacity: 0.75;
}

.mej-cc-knowledge-chevron {
  transition: transform 120ms ease;
}

.mej-cc-knowledge.collapsed > details {
  display: none;
}

.mej-cc-knowledge.collapsed .mej-cc-knowledge-chevron {
  transform: rotate(-90deg);
}
```

`lang/en.json`, inside `knowledge` (keep the existing keys):

```json
      "title": "Knowledge",
      "summary": {
        "tags": "{count} tags",
        "tagsOne": "1 tag",
        "attributes": "{count} attributes",
        "attributesOne": "1 attribute",
        "mentions": "{count} mentions",
        "mentionsOne": "1 mention",
        "empty": "empty"
      },
```

- [ ] **Step 5: e2e in `tests/e2e/07-knowledge.spec.mjs`**

Add `reloadGame` to the `./helpers/foundry.mjs` import. Append inside the describe:

```js
  test("the panel collapses to its bar; the state follows the client across sheets and a reload", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const personId = await createPerson(page, `${TT_PREFIX}Bar Person`);
    const placeId = await createPlace(page, `${TT_PREFIX}Bar Place`);
    await page.evaluate(async (id) => {
      await game.journal.get(id).pages.contents[0].update({ "flags.mej-campaign-companion.tags": ["alpha"] });
    }, personId);
    try {
      const { panel } = await openEntry(page, personId);
      await expect(panel).not.toHaveClass(/collapsed/);
      await expect(panel.locator(".mej-cc-knowledge-summary")).toHaveText("1 tag");
      await panel.locator(".mej-cc-knowledge-bar").click();
      await expect(panel).toHaveClass(/collapsed/);
      await expect(panel.locator("details").first()).toBeHidden();
      expect(await page.evaluate(() => game.settings.get("mej-campaign-companion", "knowledgePanelCollapsed"))).toBe(true);

      const { panel: placePanel } = await openEntry(page, placeId);
      await expect(placePanel).toHaveClass(/collapsed/);
      await expect(placePanel.locator(".mej-cc-knowledge-summary")).toHaveText("empty");

      await reloadGame(page);
      const { panel: afterReload } = await openEntry(page, placeId);
      await expect(afterReload).toHaveClass(/collapsed/);
      await afterReload.locator(".mej-cc-knowledge-bar").click();
      await expect(afterReload).not.toHaveClass(/collapsed/);
      await expect(afterReload.locator("details").first()).toBeVisible();
      expect(await page.evaluate(() => game.settings.get("mej-campaign-companion", "knowledgePanelCollapsed"))).toBe(false);
    } finally {
      await page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    }
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 6: Run**

Run: `npx vitest run && npx playwright test tests/e2e/07-knowledge.spec.mjs --trace off`
Expected: PASS (the existing seven 07 tests still pass — `openEntry` still finds exactly one `.mej-cc-knowledge`).

- [ ] **Step 7: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs templates/knowledge-panel.hbs scripts/hooks/knowledge-ui.mjs styles/campaign-companion.css lang/en.json tests/e2e/07-knowledge.spec.mjs
git commit -m "feat: knowledge panel collapses to a bar, remembered per client"
```

---

### Task 8: Docs, screenshot spec, version, full verification

**Files:**
- Modify: `module.json:5` (`"version": "0.17.0"`), `CHANGELOG.md` (new top entry)
- Modify: `docs/gm-guide.md:45-49,273-279,315`, `docs/player-guide.md:11-31,129`, `README.md:143-154`, `docs/manual-test-checklist.md:65`
- Modify: `tests/e2e/guide-screenshots.spec.mjs:807-845,1404-1426` (and the comments at 661 and 1336)

**Interfaces:**
- Consumes: everything above; no new code.

- [ ] **Step 1: `module.json` and `CHANGELOG.md`**

`module.json`: `"version": "0.17.0"`. Prepend to `CHANGELOG.md` (above the 0.16.0 entry):

```markdown
## 0.17.0 (2026-09-04)

One shared session recap, and a knowledge panel that gets out of the way.
Data migration: dataVersion 6 folds every per-player recap into its
session's shared recap as a `Recap — <player>` block and removes the
per-player flag (active GM, on first load).

- **The Session sheet's Recap tab holds one recap.** The separate "Player
  Recaps" section is gone: the table edits a single document. Players edit
  it when they own the session entry — Foundry's collaborative editor keeps
  simultaneous owners in sync — and read it otherwise. The GM-relay save
  path for per-player recaps is removed (image uploads for players without
  upload permission are still relayed).
- **Saves no longer overwrite each other's recap.** A save raised by any
  other field on the sheet (session number, date) leaves the recap and GM
  notes untouched; only the editor being used writes its own field.
- **Open session views refresh when another owner saves the recap.**
- **Players Write Sessions reaches existing sessions.** Turning the setting
  on offers to grant all players ownership of every existing session entry
  (a confirm dialog with the count); turning it off changes nothing.
- **The knowledge panel (tags, attributes, mentioned-in) collapses to a
  one-line bar** with a summary of what it holds. The state is remembered
  per client and applies to every sheet.
```

- [ ] **Step 2: GM guide**

`docs/gm-guide.md` line 47 (image alt): change "with the GM recap text and the Player Recaps heading below" to "with the shared recap text below". Replace line 49 with:

```markdown
- **Recap** is the session's one shared recap, behind the edit pencil at the right. You write it; so does any player who owns the entry (see [Player collaboration](#player-collaboration)) — several people can have it open at once and see each other's typing. A save from any other field on the sheet never touches the recap, and an open session view refreshes when someone else saves it.
```

Replace lines 275-279 (the three paragraphs of **Player collaboration**) with:

```markdown
Turning on the **Players Write Sessions** setting makes new Session entries — from the docx import wizard or MEJ's own New Entry dialog — owned by all players by default, so an owning player can open the Recap tab and edit the shared recap the same way you do. When you turn it on, the companion also offers to grant ownership of every session entry that already exists; answer **No** to leave them as they are and open individual entries up through Foundry's ownership dialog instead. Turning the setting off never removes ownership. A player's Session sheet shows three tabs rather than four — Recap, Session and Notes, with no Relationships tab.

Players who don't have Foundry's file-upload permission still get inline images into the recap: the upload is relayed through an active GM's client, then written to the recap by the player's own owner update. A player who doesn't own the entry sees the recap read-only — there is no relay for recap text.

Ownership is Foundry's: an owning player's client receives the whole page, including **GM Notes**, even though the sheet never shows them that tab. Keep anything that must stay hidden in a GM-only entry rather than a player-writable session.
```

Replace line 315 with:

```markdown
- **Players Write Sessions** (default: off) — see [Player collaboration](#player-collaboration). Turn this on to let players edit the shared recap; it also offers to open up existing sessions.
```

- [ ] **Step 3: Player guide**

`docs/player-guide.md`: line 13 alt text: replace "the GM's recap at the top of the Recap tab, and this player's own recap under a Player Recaps heading with an edit pencil beside it" with "the session's shared recap on the Recap tab with an edit pencil beside it". Replace line 15 with:

```markdown
The Recap tab holds one recap for the whole table — what happened, as the GM and the players write it together.
```

Replace lines 19-31 (the whole **Reading session pages & writing your recap** body up to and including the "If there's no pencil at all…" paragraph) with:

```markdown
Your GM will let you know how to find a session page — usually by sharing it directly in Foundry, or by pointing you to it in the Hub's index (more on that below). If you own the entry, a pencil sits at the right of the recap; click it to open the editor and add what your character remembers, noticed, or wants to flag for next time:

![The recap open for editing, with the full formatting toolbar directly above the recap text](images/recap-editing.png)

**Click the pencil again to close the editor when you're done, before you go anywhere else.** That is what commits your text: closing the editor takes focus off it, and the editor writes what you typed on its way out. If someone else has the recap open at the same time you'll see their typing appear as they go — you're editing one document together, not two copies.

If there's no pencil at all, you don't own that session — the **Players Write Sessions** setting and per-entry ownership are both the GM's to set, so ask them. You can still read the recap, and it refreshes on your screen when someone else saves it.
```

Replace line 129 with:

```markdown
**Can the GM read my recap?** Yes — there is one recap per session and everyone at the table, GM included, reads and (if they own the entry) edits the same text. Treat it as public.
```

Run `npm run check:links` afterwards; it must pass.

- [ ] **Step 4: README and checklist**

`README.md`: replace the **Player collaboration notes** section body (lines 145-154, everything under the heading up to `## Error handling and troubleshooting`) with:

```markdown
Session entries can be made player-writable via the `playersWriteSessions` setting; owning players edit the session's one shared recap directly through the sheet, using Foundry's collaborative ProseMirror editor (simultaneous owners see each other's edits). Turning the setting on offers to grant ownership of existing session entries as well. There is no relay path for recap text: a player without ownership reads the recap and cannot write it.

Players without file-upload permission still get inline images into a recap they own: the upload itself is relayed through an active GM's client (`scripts/hooks/media-relay.mjs`), and the resulting `<img>` is written by the player's own owner update.

**Trust model:** Foundry's client-side socket API gives a receiving client no server-verified sender identity, so the upload relay validates the claimed sender resolves to a real user, enforces the file's extension from its validated MIME type, writes only under the world's relay upload directory, and logs every rejection. What it doesn't eliminate is a socket-reachable client claiming another user's id to upload an image on their behalf — bounded to that directory, the same bound MEJ's own relay precedent accepts.
```

`docs/manual-test-checklist.md` line 65: change "alongside the recap sections" to "alongside the recap, collapsed to its bar when you have collapsed it elsewhere".

- [ ] **Step 5: Keep `tests/e2e/guide-screenshots.spec.mjs` runnable**

This file is skipped unless `GUIDE_SHOTS=1`; it must still reference real selectors. Replace lines 823-843 (the `page.evaluate` seeding `system.recap` + `playerRecaps`, with its object literal) with:

```js
    await page.evaluate(async ({ sessionId, recap }) => {
      const entry = game.journal.get(sessionId);
      const p = entry.pages.contents[0];
      await p.update({ system: { recap } });
      // User 1 owns the entry so the player-seat shots show the pencil on the shared recap.
      await entry.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
    }, {
      sessionId,
      // Kept short: the description tab has ~180px at this window size.
      recap: "<p>The party found the caravan's last stop — a burned-out waystation. Vane's story about bandits doesn't add up.</p><p>Boot prints led away from where the \"bandits\" supposedly came from.</p>"
    });
```

(delete the now-unused `user1Id`/`playerRecap` variables if nothing else reads them — `grep -n "user1Id\|playerRecap" tests/e2e/guide-screenshots.spec.mjs` must show no remaining use.)

Replace lines 1404-1426 (the "User 1's own recap field, mid-edit" block) with:

```js
  // The shared recap, mid-edit from User 1's seat: toggle the editRecap
  // pencil (MEJ's shared `.editor-parent.editing` show/hide CSS), click
  // into the now-visible <prose-mirror> and type an addition so the shot
  // shows a real in-progress editing state.
  const recapSection = sessionShell.locator(".editor-parent[data-editor-id='recap']");
  await recapSection.locator('button[data-action="editRecap"]').click();
  await settle(page, 300);
  await expect(recapSection).toHaveClass(/editing/);
  const recapEditor = recapSection.locator("prose-mirror .editor-content, prose-mirror");
  await recapEditor.first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Someone should ask the harbor guard directly.");
  await settle(page, 300);
  await shot(sessionShell, "recap-editing");
  // Toggle back off before moving on - tidy state, not load-bearing.
  await recapSection.locator('button[data-action="editRecap"]').click();
  await settle(page, 300);
```

Update the comments at lines 661 and 1336 so neither mentions `playerRecaps` / the player-recap pencil (one line each: "template only ever keys system.recap/system.gmNotes" and drop the `hasGM` sentence).

Then regenerate the two affected guide images: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs --trace off`. If the run passes, commit the changed `docs/images/session-sheet-gm.png`, `docs/images/session-sheet-player.png` and `docs/images/recap-editing.png` (only those three — `git add` them by name). If it fails for a reason outside this task's edits, report it as a concern; the stale images then ship and the controller records a follow-up.

- [ ] **Step 6: Full verification**

Run, in order, from the worktree:

```bash
npx vitest run
npm run check:links
npm run check:vendor
npx playwright test --trace off
npm run e2e:stock:v13
FOUNDRY_TARGET=v13 npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs tests/e2e/01-session.spec.mjs --trace off -g "native mode|stamped with the redirect|v5 migration|recap editor"
npm run e2e:stock:v13:cleanup
```

Expected: unit green; links and vendor OK; v14 e2e all pass (skips allowed only where the spec already skips); v13 stock 8/8; the v13 native-mode subset passes; cleanup passes. Record the exact counts in the report.

- [ ] **Step 7: Commit**

```bash
git add module.json CHANGELOG.md docs/gm-guide.md docs/player-guide.md README.md docs/manual-test-checklist.md tests/e2e/guide-screenshots.spec.mjs
git commit -m "chore: release notes, guides and version for 0.17.0"
```

---

## Self-review notes

- Spec §A → Task 3 (template, sheet, removals) + Deviations (collaborate, stale-field guard) in Task 3, live refresh in Task 4.
- Spec §B → Tasks 2 (predicate) and 5 (hook, dialog, setting, e2e) with the World A safety rule from Deviations.
- Spec §C → Tasks 1 (fold) and 6 (runner, e2e).
- Spec §D → Tasks 2 (summary) and 7.
- Spec §E → each task's tests; Task 8 runs the full gates and updates docs/README/CHANGELOG/version.
- Names used across tasks: `fieldsToStrip` (1→3), `recapChanged`/`shouldRefreshForRecap` (1→4), `foldPlayerRecaps` (1→6), `sessionEntriesNeedingOwnership` (2→5), `knowledgeSummary` (2→7), `KNOWLEDGE_COLLAPSED_SETTING` (7 only), selectors `.editor-parent[data-editor-id='recap']` / `button[data-action="editRecap"]` (3→4, 8).
